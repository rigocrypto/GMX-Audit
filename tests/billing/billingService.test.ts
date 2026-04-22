const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { runBillingMigrations } = require("../../src/billing/migrate");
const { openBillingDb } = require("../../src/billing/db");
const {
  getBillingAccount,
  getEntitlements,
  getManagedAccessDecision,
  isManagedAccessAllowed
} = require("../../src/billing/billingService");

describe("billingService", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "billing-service-test-"));
    process.env.BILLING_DB_PATH = path.join(root, "billing.db");
    runBillingMigrations();
  });

  afterEach(() => {
    delete process.env.BILLING_DB_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns null for missing billing account", () => {
    const account = getBillingAccount("missing");
    assert.equal(account, null);
    assert.equal(isManagedAccessAllowed("missing"), false);
  });

  it("allows active accounts and maps growth entitlements", () => {
    const db = openBillingDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO billing_accounts (
        client_id, org_name, email, stripe_customer_id, plan, billing_status,
        current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "example",
      "Example",
      "ops@example.com",
      "cus_123",
      "growth",
      "active",
      now,
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      0,
      now,
      now
    );
    db.close();

    const decision = getManagedAccessDecision("example");
    assert.equal(decision.allowed, true);

    const entitlements = getEntitlements("example");
    assert.equal(entitlements.maxClients, 1);
    assert.equal(entitlements.scanFrequency, "nightly");
    assert.equal(entitlements.retentionDays, 30);
    assert.equal(entitlements.dashboardAccess, true);
    assert.equal(entitlements.alertsEnabled, true);
  });

  it("keeps read-only access during canceled grace period", () => {
    const db = openBillingDb();
    const now = new Date().toISOString();
    const periodEnd = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO billing_accounts (
        client_id, org_name, email, stripe_customer_id, plan, billing_status,
        current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("example", "Example", "ops@example.com", "cus_123", "growth", "canceled", now, periodEnd, 1, now, now);
    db.close();

    const decision = getManagedAccessDecision("example");
    assert.equal(decision.allowed, false);
    assert.equal(decision.readOnly, true);
  });
});
