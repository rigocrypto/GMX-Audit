import Stripe from "stripe";

import { openBillingDb } from "./db";

const DEFAULT_PRODUCT_NAME = "Example Product";
const DEFAULT_CURRENCY = "usd";
const DEFAULT_UNIT_AMOUNT = 2000;
const DEFAULT_CATALOG_KEY = "one_time_checkout";

export type CreateOneTimeCheckoutInput = {
  clientId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  productName?: string;
  currency?: string;
  unitAmount?: number;
};

export type CreatedOneTimeCheckoutSession = {
  url: string;
  sessionId: string;
  productId: string;
  priceId: string;
};

type CatalogRow = {
  stripe_product_id: string;
  stripe_price_id: string;
  product_name: string;
  currency: string;
  unit_amount: number;
};

type PaymentSessionCompletion = {
  clientId: string;
  sessionId: string;
  productId?: string;
  priceId?: string;
  stripeCustomerId?: string;
  paymentIntentId?: string;
  amountTotal?: number | null;
  currency?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeCurrency(input?: string): string {
  const value = (input || DEFAULT_CURRENCY).trim().toLowerCase();
  return value.length > 0 ? value : DEFAULT_CURRENCY;
}

function normalizeUnitAmount(input?: number): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input <= 0) {
    return DEFAULT_UNIT_AMOUNT;
  }

  return input;
}

function getStripeClient(input?: Stripe): Stripe {
  if (input) return input;

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  return new Stripe(secret);
}

function loadCatalogItem(catalogKey: string): CatalogRow | null {
  const db = openBillingDb();
  try {
    const row = db
      .prepare(
        `SELECT stripe_product_id, stripe_price_id, product_name, currency, unit_amount
         FROM stripe_catalog_items
         WHERE catalog_key = ?
         LIMIT 1`
      )
      .get(catalogKey) as CatalogRow | undefined;
    return row || null;
  } finally {
    db.close();
  }
}

function saveCatalogItem(args: {
  catalogKey: string;
  productId: string;
  priceId: string;
  productName: string;
  currency: string;
  unitAmount: number;
}): void {
  const db = openBillingDb();
  try {
    const now = nowIso();
    db.prepare(
      `INSERT INTO stripe_catalog_items (
        catalog_key, stripe_product_id, stripe_price_id, product_name, currency, unit_amount, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(catalog_key) DO UPDATE SET
        stripe_product_id = excluded.stripe_product_id,
        stripe_price_id = excluded.stripe_price_id,
        product_name = excluded.product_name,
        currency = excluded.currency,
        unit_amount = excluded.unit_amount,
        updated_at = excluded.updated_at`
    ).run(args.catalogKey, args.productId, args.priceId, args.productName, args.currency, args.unitAmount, now, now);
  } finally {
    db.close();
  }
}

async function ensureCatalogItem(
  stripeClient: Stripe,
  input: Pick<CreateOneTimeCheckoutInput, "productName" | "currency" | "unitAmount">
): Promise<{ productId: string; priceId: string }> {
  const catalogKey = DEFAULT_CATALOG_KEY;
  const productName = input.productName?.trim() || DEFAULT_PRODUCT_NAME;
  const currency = normalizeCurrency(input.currency);
  const unitAmount = normalizeUnitAmount(input.unitAmount);
  const existing = loadCatalogItem(catalogKey);

  if (
    existing &&
    existing.product_name === productName &&
    existing.currency === currency &&
    existing.unit_amount === unitAmount
  ) {
    return {
      productId: existing.stripe_product_id,
      priceId: existing.stripe_price_id
    };
  }

  const product = await stripeClient.products.create({
    name: productName,
    default_price_data: {
      currency,
      unit_amount: unitAmount
    }
  });

  const priceId = typeof product.default_price === "string" ? product.default_price : product.default_price?.id;
  if (!priceId) {
    throw new Error("Stripe product did not return a default price");
  }

  saveCatalogItem({
    catalogKey,
    productId: product.id,
    priceId,
    productName,
    currency,
    unitAmount
  });

  return { productId: product.id, priceId };
}

function recordCheckoutSession(args: {
  clientId: string;
  sessionId: string;
  productId: string;
  priceId: string;
  stripeCustomerId?: string;
  paymentIntentId?: string;
  paymentStatus: string;
  amountTotal?: number | null;
  currency?: string | null;
}): void {
  const db = openBillingDb();
  try {
    const now = nowIso();
    db.prepare(
      `INSERT INTO billing_payment_sessions (
        client_id,
        stripe_checkout_session_id,
        stripe_customer_id,
        stripe_product_id,
        stripe_price_id,
        stripe_payment_intent_id,
        payment_status,
        amount_total,
        currency,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_checkout_session_id) DO UPDATE SET
        stripe_customer_id = COALESCE(excluded.stripe_customer_id, billing_payment_sessions.stripe_customer_id),
        stripe_product_id = COALESCE(excluded.stripe_product_id, billing_payment_sessions.stripe_product_id),
        stripe_price_id = COALESCE(excluded.stripe_price_id, billing_payment_sessions.stripe_price_id),
        stripe_payment_intent_id = COALESCE(excluded.stripe_payment_intent_id, billing_payment_sessions.stripe_payment_intent_id),
        payment_status = excluded.payment_status,
        amount_total = COALESCE(excluded.amount_total, billing_payment_sessions.amount_total),
        currency = COALESCE(excluded.currency, billing_payment_sessions.currency),
        updated_at = excluded.updated_at`
    ).run(
      args.clientId,
      args.sessionId,
      args.stripeCustomerId ?? null,
      args.productId,
      args.priceId,
      args.paymentIntentId ?? null,
      args.paymentStatus,
      args.amountTotal ?? null,
      args.currency ?? null,
      now,
      now
    );
  } finally {
    db.close();
  }
}

export function markOneTimeCheckoutCompleted(args: PaymentSessionCompletion): void {
  const db = openBillingDb();
  try {
    const now = nowIso();
    db.prepare(
      `INSERT INTO billing_payment_sessions (
        client_id,
        stripe_checkout_session_id,
        stripe_customer_id,
        stripe_product_id,
        stripe_price_id,
        stripe_payment_intent_id,
        payment_status,
        amount_total,
        currency,
        completed_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_checkout_session_id) DO UPDATE SET
        client_id = excluded.client_id,
        stripe_customer_id = COALESCE(excluded.stripe_customer_id, billing_payment_sessions.stripe_customer_id),
        stripe_product_id = COALESCE(excluded.stripe_product_id, billing_payment_sessions.stripe_product_id),
        stripe_price_id = COALESCE(excluded.stripe_price_id, billing_payment_sessions.stripe_price_id),
        stripe_payment_intent_id = COALESCE(excluded.stripe_payment_intent_id, billing_payment_sessions.stripe_payment_intent_id),
        payment_status = excluded.payment_status,
        amount_total = COALESCE(excluded.amount_total, billing_payment_sessions.amount_total),
        currency = COALESCE(excluded.currency, billing_payment_sessions.currency),
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at`
    ).run(
      args.clientId,
      args.sessionId,
      args.stripeCustomerId ?? null,
      args.productId ?? null,
      args.priceId ?? null,
      args.paymentIntentId ?? null,
      "paid",
      args.amountTotal ?? null,
      args.currency ?? null,
      now,
      now,
      now
    );
  } finally {
    db.close();
  }
}

export async function createOneTimeCheckoutSession(
  input: CreateOneTimeCheckoutInput,
  stripeClient?: Stripe
): Promise<CreatedOneTimeCheckoutSession> {
  const client = getStripeClient(stripeClient);
  const catalogItem = await ensureCatalogItem(client, input);

  const metadata = {
    client_id: input.clientId,
    product: "gmx-audit-one-time",
    catalog_key: DEFAULT_CATALOG_KEY
  };

  const session = await client.checkout.sessions.create({
    line_items: [
      {
        price: catalogItem.priceId,
        quantity: 1
      }
    ],
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail,
    customer_creation: "always",
    metadata,
    payment_intent_data: {
      metadata
    }
  });

  if (!session.url) {
    throw new Error("Stripe session did not return a URL");
  }

  recordCheckoutSession({
    clientId: input.clientId,
    sessionId: session.id,
    productId: catalogItem.productId,
    priceId: catalogItem.priceId,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
    paymentStatus: session.payment_status || "unpaid",
    amountTotal: session.amount_total,
    currency: session.currency
  });

  return {
    url: session.url,
    sessionId: session.id,
    productId: catalogItem.productId,
    priceId: catalogItem.priceId
  };
}