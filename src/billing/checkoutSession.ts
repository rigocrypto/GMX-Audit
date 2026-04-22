import Stripe from "stripe";

import { BillingPlan } from "./types";

const PLAN_PRICE_ENV: Record<BillingPlan, string | undefined> = {
  growth: process.env.STRIPE_GROWTH_PRICE_ID,
  regression_pro: process.env.STRIPE_REGRESSION_PRO_PRICE_ID,
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID,
  custom: process.env.STRIPE_ENTERPRISE_PRICE_ID
};

export type CreateCheckoutSessionInput = {
  clientId: string;
  plan: BillingPlan;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
};

export async function createManagedCheckoutSession(input: CreateCheckoutSessionInput): Promise<string> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Missing STRIPE_SECRET_KEY");

  const priceId = PLAN_PRICE_ENV[input.plan];
  if (!priceId) {
    throw new Error(`No Stripe price ID configured for plan: ${input.plan}`);
  }

  const stripe = new Stripe(secret);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail,
    metadata: {
      client_id: input.clientId,
      plan_key: input.plan,
      product: "gmx-audit-managed"
    },
    subscription_data: {
      metadata: {
        client_id: input.clientId,
        plan_key: input.plan,
        product: "gmx-audit-managed"
      }
    }
  });

  if (!session.url) {
    throw new Error("Stripe session did not return a URL");
  }

  return session.url;
}
