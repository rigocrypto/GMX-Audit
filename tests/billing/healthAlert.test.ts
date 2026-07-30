const assert = require("assert");

const { probeHealth, reportChannelConfig } = require("../../src/billing/healthAlert");
const { listConfiguredAlertChannels } = require("../../src/billing/alerts");
const { githubContextFromEnv, sanitizeEndpoint } = require("../../src/billing/incidentIssue");

type FetchResult = { ok: boolean; status: number; body: string };

function stubFetch(sequence: FetchResult[]) {
  let call = 0;
  const original = (global as any).fetch;
  (global as any).fetch = async () => {
    const item = sequence[Math.min(call, sequence.length - 1)];
    call += 1;
    return {
      ok: item.ok,
      status: item.status,
      text: async () => item.body
    };
  };
  return {
    calls: () => call,
    restore: () => {
      (global as any).fetch = original;
    }
  };
}

const HEALTH_ENV = [
  "BILLING_ALERT_WEBHOOK_URL",
  "BILLING_ALERT_EMAIL_TO",
  "BILLING_ALERT_EMAIL_FROM",
  "SMTP_HOST",
  "SMTP_PORT",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_REPOSITORY"
];

describe("billing health probe", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of HEALTH_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of HEALTH_ENV) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("reports healthy on the first successful probe without a second probe", async () => {
    const fetchStub = stubFetch([{ ok: true, status: 200, body: '{"ok":true}' }]);
    try {
      const result = await probeHealth("https://svc/health", 2, 0, 1000);
      assert.equal(result.ok, true);
      assert.equal(result.failures, 0);
      assert.equal(fetchStub.calls(), 1, "should short-circuit after first success");
    } finally {
      fetchStub.restore();
    }
  });

  it("does NOT declare an outage when a single blip recovers on the second probe", async () => {
    const fetchStub = stubFetch([
      { ok: false, status: 503, body: "down" },
      { ok: true, status: 200, body: '{"ok":true}' }
    ]);
    try {
      const result = await probeHealth("https://svc/health", 2, 0, 1000);
      assert.equal(result.ok, true, "transient blip must not be an outage");
      assert.equal(fetchStub.calls(), 2);
    } finally {
      fetchStub.restore();
    }
  });

  it("declares an outage only after all consecutive probes fail", async () => {
    const fetchStub = stubFetch([
      { ok: false, status: 404, body: "not found" },
      { ok: false, status: 404, body: "not found" }
    ]);
    try {
      const result = await probeHealth("https://svc/health", 2, 0, 1000);
      assert.equal(result.ok, false);
      assert.equal(result.failures, 2);
      assert.equal(result.last.status, 404);
    } finally {
      fetchStub.restore();
    }
  });

  it("treats a network error (no response) as a failed probe", async () => {
    const original = (global as any).fetch;
    (global as any).fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    try {
      const result = await probeHealth("https://svc/health", 2, 0, 1000);
      assert.equal(result.ok, false);
      assert.equal(result.last.status, 0);
      assert.equal(result.failures, 2);
    } finally {
      (global as any).fetch = original;
    }
  });
});

describe("billing alert channel config check", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of HEALTH_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of HEALTH_ENV) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("warns when no notification channel is configured", () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      const report = reportChannelConfig();
      assert.equal(report.hasAnyChannel, false);
      assert.equal(report.channels.length, 0);
      assert.ok(
        errors.some((line) => line.includes("NO notification channel")),
        "must emit a visible no-channel warning"
      );
    } finally {
      console.error = originalError;
    }
  });

  it("counts the GitHub incident issue as a channel when a token + repo are present", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPOSITORY = "acme/widgets";
    assert.notEqual(githubContextFromEnv(), null);

    const report = reportChannelConfig();
    assert.ok(report.hasAnyChannel);
    assert.ok(report.channels.includes("github-issue"));
    // No push channels are configured, so github-issue is the only one.
    assert.deepEqual(listConfiguredAlertChannels(), []);
  });

  it("detects a configured webhook push channel", () => {
    process.env.BILLING_ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    const report = reportChannelConfig();
    assert.ok(report.channels.includes("webhook"));
    assert.ok(report.hasAnyChannel);
  });
});

describe("incident issue endpoint sanitization", () => {
  it("reduces a URL to host only (drops scheme, path, and fragment)", () => {
    assert.equal(
      sanitizeEndpoint("https://billing-webhook-production.up.railway.app/health"),
      "billing-webhook-production.up.railway.app"
    );
  });

  it("strips a token query string so it cannot leak into a public issue", () => {
    const result = sanitizeEndpoint("https://svc.example.com/health?token=SECRET123&x=1");
    assert.equal(result, "svc.example.com");
    assert.ok(!result.includes("SECRET123"));
    assert.ok(!result.includes("token"));
  });

  it("strips embedded basic-auth userinfo credentials", () => {
    const result = sanitizeEndpoint("https://user:hunter2@internal.example.com/health");
    assert.equal(result, "internal.example.com");
    assert.ok(!result.includes("hunter2"));
    assert.ok(!result.includes("user"));
  });

  it("falls back to a generic label on unparseable input", () => {
    assert.equal(sanitizeEndpoint("not a url"), "billing health endpoint");
  });
});
