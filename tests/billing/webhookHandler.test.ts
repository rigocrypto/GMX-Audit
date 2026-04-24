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

function postJson(port, pathName, payload, token) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathName,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
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
    req.write(body);
    req.end();
  });
}

describe("webhookHandler", () => {
  let root;
  let server;
  let stripe;
  let createCheckoutSession;
  let alerts;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "billing-webhook-test-"));
    process.env.BILLING_DB_PATH = path.join(root, "billing.db");
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
    process.env.STRIPE_GROWTH_PRICE_ID = "price_growth";
    process.env.BILLING_PORTAL_API_TOKEN = "portal-token";
    process.env.BILLING_PORTAL_RETURN_URL = "https://managed.example.com/billing";
    process.env.BILLING_PORTAL_RATE_LIMIT_MAX = "10";
    process.env.BILLING_WEBHOOK_RATE_LIMIT_MAX = "120";
    process.env.BILLING_ALERT_WEBHOOK_4XX_THRESHOLD = "5";
    process.env.BILLING_ALERT_WEBHOOK_5XX_THRESHOLD = "3";
    process.env.BILLING_ALERT_WEBHOOK_CONSECUTIVE_FAILURES = "3";

    runBillingMigrations();

    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    alerts = [];
    createCheckoutSession = async ({ clientId }) => ({
      url: `https://checkout.stripe.test/${clientId}`,
      sessionId: `cs_${clientId}`,
      productId: "prod_example",
      priceId: "price_example"
    });

    const app = createBillingWebhookApp({
      stripeClient: stripe,
      createPortalSession: async (stripeCustomerId, returnUrl) => {
        return `${returnUrl}?customer=${stripeCustomerId}`;
      },
      createCheckoutSession,
      alertNotifier: async (alert) => {
        alerts.push(alert);
      }
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", () => resolve()));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
    delete process.env.BILLING_DB_PATH;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_GROWTH_PRICE_ID;
    delete process.env.BILLING_PORTAL_API_TOKEN;
    delete process.env.BILLING_PORTAL_RETURN_URL;
    delete process.env.BILLING_PORTAL_RATE_LIMIT_MAX;
    delete process.env.BILLING_WEBHOOK_RATE_LIMIT_MAX;
    delete process.env.BILLING_ALERT_WEBHOOK_4XX_THRESHOLD;
    delete process.env.BILLING_ALERT_WEBHOOK_5XX_THRESHOLD;
    delete process.env.BILLING_ALERT_WEBHOOK_CONSECUTIVE_FAILURES;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates a billing portal session for an authorized client", async () => {
    const db = openBillingDb();
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO billing_accounts (
        client_id, stripe_customer_id, plan, billing_status,
        current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("portal-client", "cus_portal", "growth", "active", ts, ts, 0, ts, ts);
    db.close();

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const res = await postJson(address.port, "/api/billing/portal", { clientId: "portal-client" }, "portal-token");
    const body = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.url, "https://managed.example.com/billing?customer=cus_portal");
  });

  it("rejects unauthorized portal requests", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const res = await postJson(address.port, "/api/billing/portal", { clientId: "portal-client" });
    assert.equal(res.status, 401);
  });

  it("creates a one-time checkout session", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const res = await postJson(
      address.port,
      "/api/billing/checkout-session",
      {
        clientId: "client-one-time",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        customerEmail: "ops@example.com"
      }
    );

    const body = JSON.parse(res.body);
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.url, "https://checkout.stripe.test/client-one-time");
    assert.equal(body.sessionId, "cs_client-one-time");
    assert.equal(body.productId, "prod_example");
    assert.equal(body.priceId, "price_example");
  });

  it("rejects incomplete checkout session requests", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const res = await postJson(address.port, "/api/billing/checkout-session", {
      clientId: "client-one-time"
    });

    assert.equal(res.status, 400);
  });

  it("rate limits repeated portal requests", async () => {
    process.env.BILLING_PORTAL_RATE_LIMIT_MAX = "1";

    await new Promise((resolve) => server.close(() => resolve()));

    const app = createBillingWebhookApp({
      stripeClient: stripe,
      createPortalSession: async (stripeCustomerId, returnUrl) => {
        return `${returnUrl}?customer=${stripeCustomerId}`;
      },
      alertNotifier: async (alert) => {
        alerts.push(alert);
      }
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", () => resolve()));

    const db = openBillingDb();
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO billing_accounts (
        client_id, stripe_customer_id, plan, billing_status,
        current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("portal-rate-limit-client", "cus_rate_limit", "growth", "active", ts, ts, 0, ts, ts);
    db.close();

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const first = await postJson(
      address.port,
      "/api/billing/portal",
      { clientId: "portal-rate-limit-client" },
      "portal-token"
    );
    const second = await postJson(
      address.port,
      "/api/billing/portal",
      { clientId: "portal-rate-limit-client" },
      "portal-token"
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  });

  it("rejects invalid signature", async () => {
    const payload = JSON.stringify({ id: "evt_bad", object: "event", type: "invoice.paid", data: { object: {} } });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const res = await post(address.port, payload, "invalid");
    assert.equal(res.status, 400);
  });

  it("rate limits repeated webhook requests", async () => {
    process.env.BILLING_WEBHOOK_RATE_LIMIT_MAX = "1";

    await new Promise((resolve) => server.close(() => resolve()));

    const app = createBillingWebhookApp({
      stripeClient: stripe,
      createPortalSession: async (stripeCustomerId, returnUrl) => {
        return `${returnUrl}?customer=${stripeCustomerId}`;
      },
      alertNotifier: async (alert) => {
        alerts.push(alert);
      }
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", () => resolve()));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const payload = JSON.stringify({ id: "evt_rate_limit", object: "event", type: "invoice.paid", data: { object: {} } });
    const first = await post(address.port, payload, "invalid");
    const second = await post(address.port, payload, "invalid");

    assert.equal(first.status, 400);
    assert.equal(second.status, 429);
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

  it("records completed one-time payment checkouts without mutating subscription accounts", async () => {
    const evt = {
      id: "evt_checkout_paid_1",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_paid_1",
          object: "checkout.session",
          mode: "payment",
          customer: "cus_one_time_123",
          payment_intent: "pi_123",
          amount_total: 2000,
          currency: "usd",
          metadata: {
            client_id: "client-one-time"
          }
        }
      }
    };

    const payload = JSON.stringify(evt);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const res = await post(address.port, payload, signature);
    assert.equal(res.status, 200);

    const db = openBillingDb();
    const session = db
      .prepare(
        "SELECT client_id, stripe_customer_id, stripe_payment_intent_id, payment_status, amount_total, currency FROM billing_payment_sessions WHERE stripe_checkout_session_id = ?"
      )
      .get("cs_paid_1");
    const account = db.prepare("SELECT COUNT(*) as c FROM billing_accounts WHERE stripe_customer_id = ?").get("cus_one_time_123");
    db.close();

    assert.equal(session.client_id, "client-one-time");
    assert.equal(session.stripe_customer_id, "cus_one_time_123");
    assert.equal(session.stripe_payment_intent_id, "pi_123");
    assert.equal(session.payment_status, "paid");
    assert.equal(session.amount_total, 2000);
    assert.equal(session.currency, "usd");
    assert.equal(account.c, 0);
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

  it("emits immediate alert for invoice.payment_failed", async () => {
    const evt = {
      id: "evt_failed_1",
      object: "event",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_failed_1",
          object: "invoice",
          customer: "cus_failed_1",
          subscription: "sub_failed_1",
          amount_due: 500,
          currency: "usd"
        }
      }
    };

    const payload = JSON.stringify(evt);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const res = await post(address.port, payload, signature);
    assert.equal(res.status, 200);

    const invoiceAlert = alerts.find((item) => item.title === "Invoice payment failed");
    assert.ok(invoiceAlert);
    assert.equal(invoiceAlert.level, "critical");
    assert.equal(invoiceAlert.source, "billing-webhook");
  });
});
