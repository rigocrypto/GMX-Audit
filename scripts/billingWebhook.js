#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const stripe = require("stripe");
const { spawn } = require("child_process");

require("dotenv").config();

const PORT = Number(process.env.PORT || 3000);
const QUEUE_DIR = path.resolve(process.env.QUEUE_DIR_OVERRIDE || path.join(process.cwd(), "outputs", "billing-queue"));
const JOBS_DIR = path.join(QUEUE_DIR, "jobs");
const FAILED_DIR = path.join(QUEUE_DIR, "failed");
const PROCESSED_EVENTS_PATH = path.join(QUEUE_DIR, "processed-events.json");
const PROCESSED_SESSIONS_PATH = path.join(QUEUE_DIR, "processed-sessions.json");
const INPROGRESS_DIR = path.join(QUEUE_DIR, "inprogress");
const LOCK_PATH = path.join(QUEUE_DIR, "worker.lock");
const POLL_MS = Math.max(1000, Number(process.env.BILLING_POLL_MS || 5000));
const WORKER_CONCURRENCY = 1;

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const archiveTarget = process.env.BATCH_ARCHIVE_TARGET || null;
const defaultNotify = process.env.DEFAULT_NOTIFY_EMAIL || null;
const intakeBasePath = process.env.INTAKE_BASE_PATH || "inputs";
const intakeAllowedDir = path.resolve(process.cwd(), process.env.INTAKES_DIR || intakeBasePath);

function log(level, event, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    ...data
  };
  const line = `${JSON.stringify(entry)}\n`;
  if (level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

function configFingerprint() {
  const value = [
    `pollMs=${POLL_MS}`,
    `maxAttempts=${Math.max(1, Number(process.env.BILLING_MAX_ATTEMPTS || 3))}`,
    `intakeAllowedDir=${intakeAllowedDir}`,
    `archiveTargetConfigured=${archiveTarget ? 1 : 0}`,
    `strict=${process.env.STRICT || ""}`
  ].join("|");
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function deployConfigFingerprint() {
  const value = [
    `pollMs=${POLL_MS}`,
    `maxAttempts=${Math.max(1, Number(process.env.BILLING_MAX_ATTEMPTS || 3))}`,
    `archiveTargetConfigured=${archiveTarget ? 1 : 0}`,
    `strict=${process.env.STRICT ? 1 : 0}`
  ].join("|");
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

if (!stripeSecret || !webhookSecret) {
  log("error", "worker.config_invalid", {
    reason: "missing_stripe_credentials"
  });
  process.exit(1);
}

const stripeClient = stripe(stripeSecret);

function ensureDirs() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.mkdirSync(FAILED_DIR, { recursive: true });
  fs.mkdirSync(INPROGRESS_DIR, { recursive: true });
}

function loadProcessedSet(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Set();
  }
  try {
    const values = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return new Set(Array.isArray(values) ? values : []);
  } catch (_) {
    return new Set();
  }
}

function saveProcessedSet(filePath, set) {
  const values = Array.from(set.values()).sort();
  fs.writeFileSync(filePath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
}

function countJsonFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((fileName) => fileName.endsWith(".json")).length;
  } catch (_) {
    return 0;
  }
}

function appendAttemptHistory(job, entry) {
  job.attemptHistory = [
    ...(Array.isArray(job.attemptHistory) ? job.attemptHistory : []),
    entry
  ];
}

function hasQueuedSession(sessionId) {
  if (!sessionId) {
    return false;
  }

  const dirs = [JOBS_DIR, INPROGRESS_DIR];
  for (const dirPath of dirs) {
    let files = [];
    try {
      files = fs.readdirSync(dirPath).filter((fileName) => fileName.endsWith(".json"));
    } catch (_) {
      files = [];
    }

    for (const fileName of files) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(dirPath, fileName), "utf8"));
        if (job && job.sessionId === sessionId) {
          return true;
        }
      } catch (_) {
        // Ignore unreadable queue entries here; they are handled in the worker loop.
      }
    }
  }

  return false;
}

function normalizeIntakeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function resolveIntakePath(session) {
  const metadata = session && session.metadata ? session.metadata : {};

  if (metadata.intakePath) {
    const fullPath = path.resolve(process.cwd(), String(metadata.intakePath));
    return fullPath;
  }

  if (metadata.intakeId) {
    const intakeId = normalizeIntakeId(metadata.intakeId);
    return path.join(intakeAllowedDir, `${intakeId}.json`);
  }

  const defaultPath = process.env.DEFAULT_INTAKE_PATH || "docs/intake-template.json";
  return path.resolve(process.cwd(), defaultPath);
}

function validateIntakeProvenance(intakePath, customerEmail) {
  const resolvedPath = path.resolve(intakePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Intake not found: ${resolvedPath}`);
  }

  const insideAllowedRoot = resolvedPath.startsWith(intakeAllowedDir + path.sep) || resolvedPath === intakeAllowedDir;
  const insideDefaultDocs = resolvedPath.startsWith(path.resolve(process.cwd(), "docs") + path.sep);
  if (!insideAllowedRoot && !insideDefaultDocs) {
    throw new Error(`Intake path outside allowed roots: ${resolvedPath}`);
  }

  const intake = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  if (customerEmail && intake && intake.clientContact && String(intake.clientContact).toLowerCase() !== String(customerEmail).toLowerCase()) {
    throw new Error("Intake owner mismatch");
  }

  return resolvedPath;
}

function buildJob(event) {
  const session = event.data.object || {};
  const customerEmail = session.customer_email || defaultNotify;
  const resolvedIntakePath = resolveIntakePath(session);
  const intakePath = validateIntakeProvenance(resolvedIntakePath, customerEmail);

  return {
    eventId: event.id,
    sessionId: session.id || null,
    createdAt: new Date().toISOString(),
    customerEmail,
    intakePath,
    archiveTarget,
    attempts: 0,
    maxAttempts: Math.max(1, Number(process.env.BILLING_MAX_ATTEMPTS || 3))
  };
}

function enqueueJob(job, processedEvents, processedSessions) {
  if (processedEvents.has(job.eventId)) {
    return false;
  }
  if (job.sessionId && processedSessions.has(job.sessionId)) {
    return false;
  }
  if (job.sessionId && hasQueuedSession(job.sessionId)) {
    return false;
  }

  const jobPath = path.join(JOBS_DIR, `${job.eventId}.json`);
  if (fs.existsSync(jobPath)) {
    return false;
  }
  fs.writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  return true;
}

function runDeliverable(job) {
  if (process.env.BILLING_TEST_MODE === "1") {
    return new Promise((resolve) => {
      const delayMs = Math.max(0, Number(process.env.BILLING_TEST_DELAY_MS || 0));
      const exitCode = Number(process.env.BILLING_TEST_EXIT_CODE || 0);
      setTimeout(() => resolve(exitCode), delayMs);
    });
  }

  return new Promise((resolve) => {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = [
      "run",
      "deliverable",
      "--",
      "--intake",
      job.intakePath,
      "--batch-preflight",
      "1",
      "--strict",
      "--batch-fail-fast"
    ];

    if (job.archiveTarget) {
      args.push("--batch-archive", job.archiveTarget);
    }
    if (job.customerEmail) {
      args.push("--batch-notify", job.customerEmail);
    }

    const child = spawn(npmCmd, args, {
      stdio: "inherit",
      env: process.env,
      cwd: process.cwd(),
      shell: false
    });

    child.on("close", (code) => {
      resolve(typeof code === "number" ? code : 1);
    });

    child.on("error", () => resolve(1));
  });
}

function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    try {
      const pid = parseInt(fs.readFileSync(LOCK_PATH, "utf8").trim(), 10);
      process.kill(pid, 0); // throws if PID is dead
      return false; // still running
    } catch (_) {
      // Stale lock — previous process is dead
      const stalePid = Number.parseInt(fs.readFileSync(LOCK_PATH, "utf8").trim(), 10);
      try { fs.unlinkSync(LOCK_PATH); } catch (_2) { /* noop */ }
      log("warn", "lock.stale_cleared", { stalePid });
    }
  }
  try {
    fs.writeFileSync(LOCK_PATH, `${process.pid}\n`, { flag: "wx" });
    return true;
  } catch (_) {
    return false;
  }
}

function releaseLock() {
  if (fs.existsSync(LOCK_PATH)) {
    try {
      fs.unlinkSync(LOCK_PATH);
    } catch (_) {
      // noop
    }
  }
}

let processing = false;

function recoverInprogressJobs() {
  const staleInprogress = fs.readdirSync(INPROGRESS_DIR).filter((n) => n.endsWith(".json"));
  for (const stale of staleInprogress) {
    const from = path.join(INPROGRESS_DIR, stale);
    const to = path.join(JOBS_DIR, stale);

    if (fs.existsSync(to)) {
      fs.unlinkSync(from);
      log("warn", "worker.crash_recovery", {
        file: stale,
        status: "discarded_duplicate"
      });
      continue;
    }

    let job;
    try {
      job = JSON.parse(fs.readFileSync(from, "utf8"));
    } catch (_) {
      const failedPath = path.join(FAILED_DIR, stale);
      fs.renameSync(from, failedPath);
      log("error", "job.corrupt_quarantined", {
        file: stale,
        queue: "inprogress"
      });
      continue;
    }

    job.attempts = Number(job.attempts || 0) + 1;
    job.lastAttemptAt = new Date().toISOString();
    appendAttemptHistory(job, {
      attempt: job.attempts,
      reason: "crash-recovery",
      at: job.lastAttemptAt
    });

    if (job.attempts >= Number(job.maxAttempts || 1)) {
      const failedPath = path.join(FAILED_DIR, stale);
      fs.writeFileSync(failedPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
      fs.unlinkSync(from);
      log("error", "job.failed_permanently", {
        eventId: job.eventId || null,
        sessionId: job.sessionId || null,
        file: stale,
        reason: "crash_recovery_exhausted",
        attempts: job.attempts,
        maxAttempts: job.maxAttempts
      });
      continue;
    }

    fs.writeFileSync(to, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    fs.unlinkSync(from);
    log("warn", "worker.crash_recovery", {
      file: stale,
      eventId: job.eventId || null,
      sessionId: job.sessionId || null,
      newAttempts: job.attempts,
      status: "requeued"
    });
  }
}

async function processNextJob(processedEvents, processedSessions) {
  if (processing) return;
  if (!acquireLock()) {
    return;
  }
  processing = true;

  try {
    const files = fs.readdirSync(JOBS_DIR).filter((name) => name.endsWith(".json")).sort();
    if (files.length === 0) {
      return;
    }

    const fileName = files[0];
    const jobPath = path.join(JOBS_DIR, fileName);
    let job;
    try {
      job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    } catch (parseErr) {
      const failedPath = path.join(FAILED_DIR, fileName);
      fs.renameSync(jobPath, failedPath);
      log("error", "job.corrupt_quarantined", {
        file: fileName,
        queue: "jobs"
      });
      return;
    }

    if (processedEvents.has(job.eventId) || (job.sessionId && processedSessions.has(job.sessionId))) {
      log("info", "job.duplicate_rejected", {
        eventId: job.eventId || null,
        sessionId: job.sessionId || null,
        reason: processedEvents.has(job.eventId) ? "event" : "session",
        source: "worker"
      });
      fs.unlinkSync(jobPath);
      return;
    }

    // Claim: atomically move into inprogress/ so a crash doesn't leave the job in jobs/
    const inprogressPath = path.join(INPROGRESS_DIR, fileName);
    try {
      fs.renameSync(jobPath, inprogressPath);
    } catch (claimErr) {
      log("warn", "job.claim_failed", {
        file: fileName,
        error: claimErr.message
      });
      return;
    }

    const attemptNumber = Number(job.attempts || 0) + 1;
    const startedAtMs = Date.now();
    log("info", "job.started", {
      eventId: job.eventId || null,
      sessionId: job.sessionId || null,
      attempt: attemptNumber
    });
    const exitCode = await runDeliverable(job);

    if (exitCode === 0) {
      processedEvents.add(job.eventId);
      if (job.sessionId) {
        processedSessions.add(job.sessionId);
      }
      saveProcessedSet(PROCESSED_EVENTS_PATH, processedEvents);
      saveProcessedSet(PROCESSED_SESSIONS_PATH, processedSessions);
      fs.unlinkSync(inprogressPath);
      log("info", "job.succeeded", {
        eventId: job.eventId || null,
        sessionId: job.sessionId || null,
        attempt: attemptNumber,
        durationMs: Date.now() - startedAtMs
      });
    } else {
      job.attempts = Number(job.attempts || 0) + 1;
      job.lastExitCode = exitCode;
      job.lastAttemptAt = new Date().toISOString();
      appendAttemptHistory(job, {
        attempt: job.attempts,
        exitCode,
        at: job.lastAttemptAt
      });
      if (job.attempts >= Number(job.maxAttempts || 1)) {
        const failedPath = path.join(FAILED_DIR, fileName);
        fs.writeFileSync(failedPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
        fs.unlinkSync(inprogressPath);
        log("error", "job.failed_permanently", {
          eventId: job.eventId || null,
          sessionId: job.sessionId || null,
          lastExitCode: exitCode,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts
        });
      } else {
        fs.writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
        fs.unlinkSync(inprogressPath);
        log("warn", "job.retry_scheduled", {
          eventId: job.eventId || null,
          sessionId: job.sessionId || null,
          lastExitCode: exitCode,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts
        });
      }
    }
  } catch (err) {
    log("error", "worker.error", {
      error: err.message
    });
  } finally {
    processing = false;
    releaseLock();
  }
}

function startServer() {
  ensureDirs();
  const processedEvents = loadProcessedSet(PROCESSED_EVENTS_PATH);
  const processedSessions = loadProcessedSet(PROCESSED_SESSIONS_PATH);

  recoverInprogressJobs();

  const app = express();

  app.get("/health", (_, res) => {
    res.json({
      ok: true,
      concurrency: WORKER_CONCURRENCY,
      workerRunning: processing,
      queueDir: QUEUE_DIR,
      jobsDir: JOBS_DIR,
      inprogressDir: INPROGRESS_DIR,
      failedDir: FAILED_DIR,
      counts: {
        jobs: countJsonFiles(JOBS_DIR),
        inprogress: countJsonFiles(INPROGRESS_DIR),
        failed: countJsonFiles(FAILED_DIR)
      },
      lockPath: LOCK_PATH
    });
  });

  app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
    const signature = req.headers["stripe-signature"];
    let event;

    if (process.env.BILLING_SKIP_SIG_VERIFY === "1") {
      try {
        event = JSON.parse(req.body.toString("utf8"));
      } catch (_) {
        res.status(400).send("Invalid JSON");
        return;
      }
    } else {
      try {
        event = stripeClient.webhooks.constructEvent(req.body, signature, webhookSecret);
      } catch (err) {
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
      }
    }

    if (event.type === "checkout.session.completed") {
      try {
        const session = event.data.object || {};
        if (processedEvents.has(event.id)) {
          log("info", "job.duplicate_rejected", {
            eventId: event.id,
            sessionId: session.id || null,
            reason: "event",
            source: "webhook"
          });
          res.json({ received: true });
          return;
        }
        if (session.id && processedSessions.has(session.id)) {
          log("info", "job.duplicate_rejected", {
            eventId: event.id,
            sessionId: session.id,
            reason: "session",
            source: "webhook"
          });
          res.json({ received: true });
          return;
        }
        const job = buildJob(event);
        const inserted = enqueueJob(job, processedEvents, processedSessions);
        if (inserted) {
          log("info", "job.enqueued", {
            eventId: job.eventId || null,
            sessionId: job.sessionId || null
          });
        } else {
          log("info", "job.duplicate_rejected", {
            eventId: job.eventId || null,
            sessionId: job.sessionId || null,
            reason: job.sessionId && hasQueuedSession(job.sessionId) ? "session_queued" : "event_queued",
            source: "webhook"
          });
        }
      } catch (err) {
        log("error", "webhook.rejected", {
          eventId: event.id || null,
          error: err.message
        });
      }
    }

    res.json({ received: true });
  });

  setInterval(() => {
    processNextJob(processedEvents, processedSessions).catch((err) => {
      log("error", "worker.queue_loop_failed", {
        error: err.message
      });
    });
  }, POLL_MS);

  const server = app.listen(PORT, () => {
    const address = server.address();
    const listenPort = address && typeof address === "object" ? address.port : PORT;
    log("info", "worker.started", {
      port: listenPort,
      concurrency: WORKER_CONCURRENCY,
      pollMs: POLL_MS,
      maxAttempts: Math.max(1, Number(process.env.BILLING_MAX_ATTEMPTS || 3)),
      intakeAllowedDir,
      archiveTargetConfigured: Boolean(archiveTarget),
      configHash: configFingerprint(),
      deployConfigHash: deployConfigFingerprint(),
      queueDir: QUEUE_DIR,
      singleInstance: true
    });
  });
}

process.on("SIGINT", () => {
  releaseLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  releaseLock();
  process.exit(0);
});
process.on("exit", () => {
  releaseLock();
});

startServer();
