const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const Stripe = require("stripe");

const { runBillingMigrations } = require("../../src/billing/migrate");
const { openBillingDb } = require("../../src/billing/db");
const { createBillingWebhookApp } = require("../../src/billing/webhookHandler");

function post(port, payload, signature) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/webhooks/stripe",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...(signature ? { "stripe-signature": signature } : {})
        }
      },
      (res) => {
        let chunks = "";
        res.on("data", (chunk) => {
          chunks += chunk.toString();
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, body: chunks });
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("webhookHandler", () => {
  let root;
  let server;
  let stripe;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "billing-webhook-test-"));
    process.env.BILLING_DB_PATH = path.join(root, "billing.db");
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
    process.env.STRIPE_GROWTH_PRICE_ID = "price_growth";

    runBillingMigrations();

    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const app = createBillingWebhookApp(stripe);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", () => resolve()));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
    delete process.env.BILLING_DB_PATH;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_GROWTH_PRICE_ID;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects invalid signature", async () => {
    const payload = JSON.stringify({ id: "evt_bad", object: "event", type: "invoice.paid", data: { object: {} } });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const res = await post(address.port, payload, "invalid");
    assert.equal(res.status, 400);
  });

  it("processes invoice.paid and is idempotent", async () => {
    const evt = {
      id: "evt_paid_1",
      object: "event",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          object: "invoice",
          customer: "cus_123",
          subscription: "sub_123",
          lines: {
            data: [
              {
                object: "line_item",
                period: {
                  start: Math.floor(Date.now() / 1000),
                  end: Math.floor(Date.now() / 1000) + 86400
                },
                pricing: {
                  price_details: {
                    price: "price_growth"
                  }
                }
              }
            ]
          }
        }
      }
    };

    const payload = JSON.stringify(evt);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const first = await post(address.port, payload, signature);
    assert.equal(first.status, 200);

    const second = await post(address.port, payload, signature);
    assert.equal(second.status, 200);

    const db = openBillingDb();
    const account = db.prepare("SELECT billing_status FROM billing_accounts WHERE stripe_customer_id = ?").get("cus_123");
    const events = db.prepare("SELECT COUNT(*) as c FROM stripe_events WHERE stripe_event_id = ?").get("evt_paid_1");
    db.close();

    assert.equal(account.billing_status, "active");
    assert.equal(events.c, 1);
  });

  it("accepts unknown events with 200", async () => {
    const evt = {
      id: "evt_unknown_1",
      object: "event",
      type: "charge.succeeded",
      data: { object: { id: "ch_1" } }
    };
    const payload = JSON.stringify(evt);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const res = await post(address.port, payload, signature);
    assert.equal(res.status, 200);
  });
});
