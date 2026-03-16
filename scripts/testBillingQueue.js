#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const SCENARIO_WAIT_MS = Math.max(500, Number(process.env.BILLING_TEST_TIMEOUT_MS || 1500));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "billing-queue-test-"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function waitFor(message, predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${message}`);
}

function countQueuedJobs(queueDir) {
  return [path.join(queueDir, "jobs"), path.join(queueDir, "inprogress")].reduce((total, dirPath) => {
    if (!fs.existsSync(dirPath)) {
      return total;
    }
    return total + fs.readdirSync(dirPath).filter((name) => name.endsWith(".json")).length;
  }, 0);
}

function createHarnessLogs() {
  return {
    stdout: [],
    stderr: []
  };
}

function logsContain(logs, fragments) {
  const combined = `${logs.stdout.join("")}\n${logs.stderr.join("")}`;
  return fragments.every((fragment) => combined.includes(fragment));
}

function startWorker(queueDir, extraEnv = {}, logs = createHarnessLogs()) {
  const worker = spawn(process.execPath, [path.join("scripts", "billingWebhook.js")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_dummy",
      PORT: "0",
      BILLING_POLL_MS: "1000",
      QUEUE_DIR_OVERRIDE: queueDir,
      BILLING_TEST_MODE: "1",
      BILLING_TEST_DELAY_MS: "200",
      BILLING_TEST_EXIT_CODE: "0",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  worker.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    logs.stdout.push(text);
    process.stdout.write(text);
  });

  worker.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    logs.stderr.push(text);
    process.stderr.write(text);
  });

  return { worker, logs };
}

async function stopWorker(worker) {
  if (worker.exitCode !== null) {
    return;
  }

  worker.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (worker.exitCode === null) {
        worker.kill("SIGKILL");
      }
    }, 2000);

    worker.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function createJob(eventId, sessionId) {
  return {
    eventId,
    sessionId,
    createdAt: new Date().toISOString(),
    customerEmail: "test@client.com",
    intakePath: path.resolve("docs", "intake-template.json"),
    archiveTarget: null,
    attempts: 0,
    maxAttempts: 3
  };
}

function postWebhook(port, eventObj) {
  return new Promise((resolve) => {
    const body = JSON.stringify(eventObj);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/webhook",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "test",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      }
    );

    req.on("error", () => resolve(0));
    req.write(body);
    req.end();
  });
}

async function testHappyPath() {
  console.log("\nScenario: happy path");
  const queueDir = tmpDir();
  const job = createJob("evt_happy_001", "cs_happy_001");
  writeJson(path.join(queueDir, "jobs", `${job.eventId}.json`), job);

  const { worker } = startWorker(queueDir);
  try {
    await waitFor("happy-path completion", () => {
      const processedEventsPath = path.join(queueDir, "processed-events.json");
      const processedSessionsPath = path.join(queueDir, "processed-sessions.json");
      return fs.existsSync(processedEventsPath) && fs.existsSync(processedSessionsPath);
    });

    const processedEvents = readJson(path.join(queueDir, "processed-events.json"));
    const processedSessions = readJson(path.join(queueDir, "processed-sessions.json"));
    assert(processedEvents.includes(job.eventId), "happy path should record processed event id");
    assert(processedSessions.includes(job.sessionId), "happy path should record processed session id");
    assert(!fs.existsSync(path.join(queueDir, "jobs", `${job.eventId}.json`)), "happy path should remove job from jobs/");
    assert(!fs.existsSync(path.join(queueDir, "inprogress", `${job.eventId}.json`)), "happy path should clear inprogress/");
    console.log("PASS happy path");
  } finally {
    await stopWorker(worker);
  }
}

async function testCorruptJob() {
  console.log("\nScenario: corrupt JSON");
  const queueDir = tmpDir();
  ensureDir(path.join(queueDir, "jobs"));
  fs.writeFileSync(path.join(queueDir, "jobs", "bad-job.json"), "THIS IS NOT JSON", "utf8");

  const { worker } = startWorker(queueDir);
  try {
    await waitFor("corrupt job to move to failed/", () => fs.existsSync(path.join(queueDir, "failed", "bad-job.json")));
    assert(!fs.existsSync(path.join(queueDir, "jobs", "bad-job.json")), "corrupt job should leave jobs/");
    console.log("PASS corrupt JSON handling");
  } finally {
    await stopWorker(worker);
  }
}

async function testCrashRecovery() {
  console.log("\nScenario: crash recovery");
  const queueDir = tmpDir();
  const job = createJob("evt_recovery_001", "cs_recovery_001");
  writeJson(path.join(queueDir, "jobs", `${job.eventId}.json`), job);

  const initial = startWorker(queueDir, {
    BILLING_TEST_DELAY_MS: "6000"
  });

  try {
    await waitFor("job claim into inprogress/", () => fs.existsSync(path.join(queueDir, "inprogress", `${job.eventId}.json`)));
    await stopWorker(initial.worker);

    assert(fs.existsSync(path.join(queueDir, "inprogress", `${job.eventId}.json`)), "crash simulation should leave job in inprogress/");

    const restarted = startWorker(queueDir, {
      BILLING_TEST_DELAY_MS: "200"
    }, createHarnessLogs());
    try {
      await waitFor("recovery log", () => logsContain(restarted.logs, ["\"event\":\"worker.crash_recovery\"", `\"file\":\"${job.eventId}.json\"`, "\"status\":\"requeued\""]));
      await waitFor("recovered job completion", () => {
        const processedEventsPath = path.join(queueDir, "processed-events.json");
        return fs.existsSync(processedEventsPath) && readJson(processedEventsPath).includes(job.eventId);
      });

      const processedSessions = readJson(path.join(queueDir, "processed-sessions.json"));
      assert(processedSessions.includes(job.sessionId), "recovery should record processed session id");
      assert(!fs.existsSync(path.join(queueDir, "jobs", `${job.eventId}.json`)), "recovery should clear jobs/");
      assert(!fs.existsSync(path.join(queueDir, "inprogress", `${job.eventId}.json`)), "recovery should clear inprogress/");
      console.log("PASS crash recovery");
    } finally {
      await stopWorker(restarted.worker);
    }
  } finally {
    await stopWorker(initial.worker);
  }
}

async function testCrashRecoveryIncrementsAttempts() {
  console.log("\nScenario: crash recovery increments attempts");
  const queueDir = tmpDir();
  const job = createJob("evt_attempts_001", "cs_attempts_001");
  job.attempts = 1;
  job.maxAttempts = 2;
  writeJson(path.join(queueDir, "inprogress", `${job.eventId}.json`), job);
  ensureDir(path.join(queueDir, "jobs"));
  ensureDir(path.join(queueDir, "failed"));

  const { worker } = startWorker(queueDir, {
    BILLING_TEST_DELAY_MS: "5000"
  });
  try {
    await waitFor("recovery to settle", () => {
      return fs.existsSync(path.join(queueDir, "failed", `${job.eventId}.json`))
        || fs.existsSync(path.join(queueDir, "jobs", `${job.eventId}.json`));
    });

    const failedPath = path.join(queueDir, "failed", `${job.eventId}.json`);
    const jobsPath = path.join(queueDir, "jobs", `${job.eventId}.json`);

    if (fs.existsSync(jobsPath)) {
      const recovered = readJson(jobsPath);
      assert(recovered.attempts === 2, "recovery should increment attempts from 1 to 2");
      assert((recovered.attemptHistory || []).some((entry) => entry.reason === "crash-recovery"), "recovery should append crash-recovery history");
    } else {
      assert(fs.existsSync(failedPath), "recovery should move exhausted job to failed/");
      const failed = readJson(failedPath);
      assert(failed.attempts === 2, "failed recovery should preserve incremented attempt count");
      assert((failed.attemptHistory || []).some((entry) => entry.reason === "crash-recovery"), "failed recovery should append crash-recovery history");
    }

    console.log("PASS crash recovery attempt accounting");
  } finally {
    await stopWorker(worker);
  }
}

async function testStaleLock() {
  console.log("\nScenario: stale lock");
  const queueDir = tmpDir();
  ensureDir(queueDir);
  fs.writeFileSync(path.join(queueDir, "worker.lock"), "99999999\n", "utf8");

  const { worker } = startWorker(queueDir);
  try {
    await waitFor("worker to acquire fresh lock", () => {
      if (!fs.existsSync(path.join(queueDir, "worker.lock"))) {
        return false;
      }
      const pid = Number(fs.readFileSync(path.join(queueDir, "worker.lock"), "utf8").trim());
      return pid === worker.pid;
    });
    console.log("PASS stale lock recovery");
  } finally {
    await stopWorker(worker);
  }
}

async function testWebhookSessionDedupe() {
  console.log("\nScenario: webhook session dedupe");
  const queueDir = tmpDir();
  const port = 3099;
  const started = startWorker(queueDir, {
    PORT: String(port),
    BILLING_SKIP_SIG_VERIFY: "1",
    DEFAULT_INTAKE_PATH: path.resolve("docs", "intake-template.json")
  });
  const { worker, logs } = started;

  try {
    await waitFor("webhook listener", () => logsContain(logs, ["\"event\":\"worker.started\"", `\"port\":${port}`]), SCENARIO_WAIT_MS * 2);

    const sessionId = "cs_dedupetest_001";
    const firstEvent = {
      id: "evt_dedupetest_001",
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          metadata: {}
        }
      }
    };

    const firstStatus = await postWebhook(port, firstEvent);
    await sleep(SCENARIO_WAIT_MS);
    const secondStatus = await postWebhook(port, {
      ...firstEvent,
      id: "evt_dedupetest_002"
    });

    await sleep(SCENARIO_WAIT_MS);

    const jobCount = countQueuedJobs(queueDir);

    assert(firstStatus === 200, `first webhook POST should return 200 (got ${firstStatus})`);
    assert(secondStatus === 200, `second webhook POST should return 200 (got ${secondStatus})`);
    assert(jobCount <= 1, `duplicate session should enqueue at most one job (got ${jobCount})`);

    console.log("PASS webhook session dedupe");
  } finally {
    await stopWorker(worker);
  }
}

async function testWebhookEventDedupe() {
  console.log("\nScenario: webhook event-level dedupe");
  const queueDir = tmpDir();
  const port = 3098;
  const started = startWorker(queueDir, {
    PORT: String(port),
    BILLING_SKIP_SIG_VERIFY: "1",
    DEFAULT_INTAKE_PATH: path.resolve("docs", "intake-template.json")
  });
  const { worker, logs } = started;

  try {
    await waitFor("webhook listener", () => logsContain(logs, ["\"event\":\"worker.started\"", `\"port\":${port}`]), SCENARIO_WAIT_MS * 2);

    const event = {
      id: "evt_eventdedupe_001",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_eventdedupe_001",
          metadata: {}
        }
      }
    };

    const firstStatus = await postWebhook(port, event);
    await sleep(SCENARIO_WAIT_MS);
    const secondStatus = await postWebhook(port, event);
    await sleep(SCENARIO_WAIT_MS);

    const jobCount = countQueuedJobs(queueDir);

    assert(firstStatus === 200, `first event POST should return 200 (got ${firstStatus})`);
    assert(secondStatus === 200, `second event POST should return 200 (got ${secondStatus})`);
    assert(jobCount <= 1, `duplicate event should enqueue at most one job (got ${jobCount})`);

    console.log("PASS webhook event-level dedupe");
  } finally {
    await stopWorker(worker);
  }
}

async function main() {
  await testHappyPath();
  await testCorruptJob();
  await testCrashRecovery();
  await testCrashRecoveryIncrementsAttempts();
  await testStaleLock();
  await testWebhookSessionDedupe();
  await testWebhookEventDedupe();
  console.log("\nAll billing queue tests passed.");
}

main().catch((err) => {
  console.error(`\nBilling queue test failure: ${err.message}`);
  process.exit(1);
});