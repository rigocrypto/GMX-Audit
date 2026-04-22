const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { runBillingMigrations } = require("../../src/billing/migrate");
const { openBillingDb } = require("../../src/billing/db");
const { getManagedAccessDecision } = require("../../src/billing/billingService");

describe("billing gate", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "billing-gate-test-"));
    process.env.BILLING_DB_PATH = path.join(root, "billing.db");
    runBillingMigrations();
  });

  afterEach(() => {
    delete process.env.BILLING_DB_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("allows active client", () => {
    const db = openBillingDb();
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO billing_accounts (
        client_id, stripe_customer_id, plan, billing_status,
        current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("active-client", "cus_active", "growth", "active", ts, ts, 0, ts, ts);
    db.close();

    const decision = getManagedAccessDecision("active-client");
    assert.equal(decision.allowed, true);
    assert.equal(decision.readOnly, false);
  });

  it("blocks canceled client after grace window", () => {
    const db = openBillingDb();
    const ts = new Date().toISOString();
    const oldPeriodEnd = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO billing_accounts (
        client_id, stripe_customer_id, plan, billing_status,
        current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("old-canceled", "cus_old", "growth", "canceled", ts, oldPeriodEnd, 1, ts, ts);
    db.close();

    const decision = getManagedAccessDecision("old-canceled");
    assert.equal(decision.allowed, false);
    assert.equal(decision.readOnly, false);
  });
});
