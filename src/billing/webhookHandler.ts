import express, { Request, Response } from "express";
import Stripe from "stripe";

import { openBillingDb } from "./db";
import { BillingPlan, BillingStatus } from "./types";

type StripeEvent = Stripe.Event;

function nowIso(): string {
  return new Date().toISOString();
}

function inferPlanFromPriceId(priceId?: string | null): BillingPlan {
  if (!priceId) return "custom";
  if (priceId === process.env.STRIPE_GROWTH_PRICE_ID) return "growth";
  if (priceId === process.env.STRIPE_REGRESSION_PRO_PRICE_ID) return "regression_pro";
  if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) return "enterprise";
  return "custom";
}

function mapStripeSubscriptionStatus(status?: Stripe.Subscription.Status): BillingStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "suspended";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
      return "incomplete";
    case "paused":
      return "suspended";
    default:
      return "incomplete";
  }
}

function metadataValue(metadata: Record<string, string> | null | undefined, key: string): string | undefined {
  if (!metadata) return undefined;
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summarizePayload(event: StripeEvent): string {
  const payload = {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    created: event.created
  };
  return JSON.stringify(payload);
}

export function isEventProcessed(stripeEventId: string): boolean {
  const db = openBillingDb();
  try {
    const row = db
      .prepare("SELECT id FROM stripe_events WHERE stripe_event_id = ? LIMIT 1")
      .get(stripeEventId) as { id: number } | undefined;
    return Boolean(row);
  } finally {
    db.close();
  }
}

export function markEventProcessed(stripeEventId: string, eventType: string, billingAccountId?: number): void {
  const db = openBillingDb();
  try {
    db.prepare(
      `INSERT INTO stripe_events (stripe_event_id, event_type, billing_account_id, payload_summary, processed_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(stripeEventId, eventType, billingAccountId ?? null, "{}", nowIso());
  } finally {
    db.close();
  }
}

export function logProvisioningAction(
  billingAccountId: number,
  action: "enabled" | "disabled" | "plan_changed" | "manual_override",
  details: Record<string, unknown>
): void {
  const db = openBillingDb();
  try {
    db.prepare(
      `INSERT INTO provisioning_log (billing_account_id, action, details, performed_by, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(billingAccountId, action, JSON.stringify(details), "system", nowIso());
  } finally {
    db.close();
  }
}

function getBillingAccountIdByStripeCustomer(stripeCustomerId: string): number | undefined {
  const db = openBillingDb();
  try {
    const row = db
      .prepare("SELECT id FROM billing_accounts WHERE stripe_customer_id = ? LIMIT 1")
      .get(stripeCustomerId) as { id: number } | undefined;
    return row?.id;
  } finally {
    db.close();
  }
}

export function findOrCreateBillingAccount(stripeCustomerId: string, metadata: Record<string, string> = {}): number {
  const db = openBillingDb();
  try {
    const existing = db
      .prepare("SELECT id FROM billing_accounts WHERE stripe_customer_id = ?")
      .get(stripeCustomerId) as { id: number } | undefined;
    if (existing) return existing.id;

    const clientId = metadata.client_id || `stripe-${stripeCustomerId}`;
    const orgName = metadata.org_name || null;
    const email = metadata.email || null;
    const plan = (metadata.plan_key as BillingPlan | undefined) || "growth";
    const ts = nowIso();

    const result = db
      .prepare(
        `INSERT INTO billing_accounts (
          client_id,
          org_name,
          email,
          stripe_customer_id,
          plan,
          billing_status,
          cancel_at_period_end,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 'lead', 0, ?, ?)`
      )
      .run(clientId, orgName, email, stripeCustomerId, plan, ts, ts);

    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

export function updateBillingStatus(
  billingAccountId: number,
  newStatus: BillingStatus,
  eventData: {
    stripeSubscriptionId?: string;
    stripePriceId?: string | null;
    plan?: BillingPlan;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
    lastInvoiceId?: string;
    lastPaymentAt?: string;
  }
): void {
  const db = openBillingDb();
  try {
    db.prepare(
      `UPDATE billing_accounts
       SET billing_status = ?,
           stripe_subscription_id = COALESCE(?, stripe_subscription_id),
           stripe_price_id = COALESCE(?, stripe_price_id),
           plan = COALESCE(?, plan),
           current_period_start = COALESCE(?, current_period_start),
           current_period_end = COALESCE(?, current_period_end),
           cancel_at_period_end = COALESCE(?, cancel_at_period_end),
           last_invoice_id = COALESCE(?, last_invoice_id),
           last_payment_at = COALESCE(?, last_payment_at),
           updated_at = ?
       WHERE id = ?`
    ).run(
      newStatus,
      eventData.stripeSubscriptionId ?? null,
      eventData.stripePriceId ?? null,
      eventData.plan ?? null,
      eventData.currentPeriodStart ?? null,
      eventData.currentPeriodEnd ?? null,
      typeof eventData.cancelAtPeriodEnd === "boolean" ? (eventData.cancelAtPeriodEnd ? 1 : 0) : null,
      eventData.lastInvoiceId ?? null,
      eventData.lastPaymentAt ?? null,
      nowIso(),
      billingAccountId
    );
  } finally {
    db.close();
  }
}

function linkEvent(stripeEventId: string, eventType: string, billingAccountId?: number): void {
  const db = openBillingDb();
  try {
    db.prepare(
      `INSERT INTO stripe_events (stripe_event_id, event_type, billing_account_id, payload_summary, processed_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(stripeEventId, eventType, billingAccountId ?? null, JSON.stringify({ eventType }), nowIso());
  } finally {
    db.close();
  }
}

function upsertCustomerFields(stripeCustomerId: string, updates: { email?: string; orgName?: string; clientId?: string }): void {
  const db = openBillingDb();
  try {
    db.prepare(
      `UPDATE billing_accounts
       SET email = COALESCE(?, email),
           org_name = COALESCE(?, org_name),
           client_id = COALESCE(?, client_id),
           updated_at = ?
       WHERE stripe_customer_id = ?`
    ).run(updates.email ?? null, updates.orgName ?? null, updates.clientId ?? null, nowIso(), stripeCustomerId);
  } finally {
    db.close();
  }
}

function handleCheckoutSessionCompleted(event: StripeEvent): number | undefined {
  const session = event.data.object as Stripe.Checkout.Session;
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : undefined;
  if (!stripeCustomerId) return undefined;

  const metadata = (session.metadata || {}) as Record<string, string>;
  const billingAccountId = findOrCreateBillingAccount(stripeCustomerId, {
    ...metadata,
    email: session.customer_details?.email || metadata.email || ""
  });

  upsertCustomerFields(stripeCustomerId, {
    email: session.customer_details?.email || undefined,
    orgName: metadata.org_name,
    clientId: metadata.client_id
  });

  updateBillingStatus(billingAccountId, "incomplete", {
    stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : undefined,
    plan: (metadata.plan_key as BillingPlan | undefined) || "growth"
  });

  logProvisioningAction(billingAccountId, "plan_changed", {
    event: event.type,
    step: "checkout_completed",
    sessionId: session.id
  });

  return billingAccountId;
}

function handleInvoicePaid(event: StripeEvent): number | undefined {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : undefined;
  if (!stripeCustomerId) return undefined;

  const accountId = findOrCreateBillingAccount(stripeCustomerId);
  const line = invoice.lines?.data?.[0];
  const priceId = line?.pricing && "price_details" in line.pricing ? line.pricing.price_details?.price : null;
  const periodStart = line?.period?.start ? new Date(line.period.start * 1000).toISOString() : undefined;
  const periodEnd = line?.period?.end ? new Date(line.period.end * 1000).toISOString() : undefined;

  updateBillingStatus(accountId, "active", {
    stripeSubscriptionId: typeof invoice.subscription === "string" ? invoice.subscription : undefined,
    stripePriceId: priceId,
    plan: inferPlanFromPriceId(priceId),
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    lastInvoiceId: invoice.id,
    lastPaymentAt: nowIso()
  });

  logProvisioningAction(accountId, "enabled", {
    event: event.type,
    invoiceId: invoice.id,
    periodEnd
  });

  return accountId;
}

function handleInvoicePaymentFailed(event: StripeEvent): number | undefined {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : undefined;
  if (!stripeCustomerId) return undefined;

  const accountId = findOrCreateBillingAccount(stripeCustomerId);
  updateBillingStatus(accountId, "past_due", {
    lastInvoiceId: invoice.id
  });

  logProvisioningAction(accountId, "disabled", {
    event: event.type,
    invoiceId: invoice.id,
    reason: "payment_failed"
  });

  return accountId;
}

function handleSubscriptionUpdated(event: StripeEvent): number | undefined {
  const sub = event.data.object as Stripe.Subscription;
  const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : undefined;
  if (!stripeCustomerId) return undefined;

  const accountId = findOrCreateBillingAccount(stripeCustomerId, sub.metadata as Record<string, string>);
  const firstItem = sub.items?.data?.[0];
  const priceId = firstItem?.price?.id || null;

  updateBillingStatus(accountId, mapStripeSubscriptionStatus(sub.status), {
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    plan: inferPlanFromPriceId(priceId),
    currentPeriodStart: sub.current_period_start
      ? new Date(sub.current_period_start * 1000).toISOString()
      : undefined,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : undefined,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end)
  });

  logProvisioningAction(accountId, "plan_changed", {
    event: event.type,
    subscriptionId: sub.id,
    status: sub.status
  });

  return accountId;
}

function handleSubscriptionDeleted(event: StripeEvent): number | undefined {
  const sub = event.data.object as Stripe.Subscription;
  const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : undefined;
  if (!stripeCustomerId) return undefined;

  const accountId = findOrCreateBillingAccount(stripeCustomerId, sub.metadata as Record<string, string>);
  const firstItem = sub.items?.data?.[0];
  const priceId = firstItem?.price?.id || null;

  updateBillingStatus(accountId, "canceled", {
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    plan: inferPlanFromPriceId(priceId),
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : undefined,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end)
  });

  logProvisioningAction(accountId, "disabled", {
    event: event.type,
    subscriptionId: sub.id,
    reason: "subscription_deleted"
  });

  return accountId;
}

function routeEvent(event: StripeEvent): number | undefined {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutSessionCompleted(event);
    case "invoice.paid":
      return handleInvoicePaid(event);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(event);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event);
    default:
      return undefined;
  }
}

export function createBillingWebhookApp(stripeClient?: Stripe): express.Express {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret && !stripeClient) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  const client = stripeClient ?? new Stripe(secret as string);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req: Request, res: Response) => {
    if (!webhookSecret) {
      res.status(500).json({ ok: false, error: "missing_webhook_secret" });
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      res.status(400).json({ ok: false, error: "missing_signature" });
      return;
    }

    let event: StripeEvent;
    try {
      event = client.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (error) {
      res.status(400).json({ ok: false, error: "invalid_signature", message: (error as Error).message });
      return;
    }

    try {
      if (isEventProcessed(event.id)) {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }

      const linkedAccountId = routeEvent(event);
      linkEvent(event.id, event.type, linkedAccountId);
      res.status(200).json({ ok: true, eventType: event.type });
    } catch (error) {
      console.error("[billing:webhook] unexpected processing error", {
        eventId: event.id,
        eventType: event.type,
        error: (error as Error).message
      });

      if (
        event.type !== "checkout.session.completed" &&
        event.type !== "invoice.paid" &&
        event.type !== "invoice.payment_failed" &&
        event.type !== "customer.subscription.updated" &&
        event.type !== "customer.subscription.deleted"
      ) {
        if (!isEventProcessed(event.id)) {
          const db = openBillingDb();
          try {
            db.prepare(
              `INSERT INTO stripe_events (stripe_event_id, event_type, billing_account_id, payload_summary, processed_at)
               VALUES (?, ?, ?, ?, ?)`
            ).run(event.id, event.type, null, summarizePayload(event), nowIso());
          } finally {
            db.close();
          }
        }

        res.status(200).json({ ok: true, skipped: true });
        return;
      }

      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  return app;
}
