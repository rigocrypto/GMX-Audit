# Stripe Integration Architecture

## Overview

GMX Audit Control Center keeps OSS functionality free and ungated.
Billing controls only managed-service capabilities (hosted scheduler runs, hosted dashboards, alerts, and SLA-style operations).

Core principles:

- Stripe is the payment processor and invoice source.
- Internal billing tables in SQLite are the app's operational source of truth.
- Webhooks are authoritative for status transitions.
- Browser redirects are non-authoritative convenience UX.
- Event handling is idempotent via stripe_event_id deduplication.

## Payment Flows

### Self-serve checkout (Growth / Regression Pro)

1. User starts checkout via Stripe Payment Link or Checkout Session.
2. Stripe creates customer, subscription, invoice, payment intent.
3. Stripe redirects user to success/cancel URL.
4. Stripe emits webhooks to `/api/webhooks/stripe`.
5. Backend verifies signature and updates `billing_accounts`.
6. Managed features are enabled when billing status reaches active.

Primary webhook sequence:

- `checkout.session.completed`
- `invoice.paid`
- optionally `customer.subscription.updated`

### Sales-assisted onboarding (Enterprise / Custom)

1. Operator creates customer/subscription in Stripe Dashboard.
2. Stripe emails invoice or collects payment method.
3. `invoice.paid` activates account.
4. Operator provisions managed client config and token.

### Renewal and cancellation lifecycle

1. Renewal invoice emitted by Stripe.
2. `invoice.paid` keeps account active and updates period end.
3. `invoice.payment_failed` marks account `past_due`.
4. Stripe retry succeeds -> `invoice.paid` restores `active`.
5. Cancellation/deletion -> `customer.subscription.deleted` marks `canceled`.
6. Managed runs stop; dashboard enters billing-required/read-only policy window.

## Webhook Architecture

### Prioritized events

- P0: `checkout.session.completed`
- P0: `invoice.paid`
- P1: `invoice.payment_failed`
- P1: `customer.subscription.deleted`
- P2: `customer.subscription.updated`

### Processing steps

1. Parse raw body at route level.
2. Verify Stripe signature via `constructEvent`.
3. Check dedupe store (`stripe_events.stripe_event_id`).
4. Route to event handler.
5. Persist billing status transitions.
6. Persist provisioning log entry.
7. Record processed event.

### Idempotency

- Duplicate webhook IDs return HTTP 200 with `duplicate: true`.
- Each event ID is inserted once via unique index.
- Event replays do not create duplicate side effects.

### Error behavior

- 400 for invalid signatures.
- 500 for transient internal failures (Stripe retries).
- 200 for unknown but valid event types after recording skip.

## Billing State Machine

Internal states:

- `lead`
- `trialing`
- `active`
- `past_due`
- `suspended`
- `incomplete`
- `canceled`

Mapping guideline:

- Stripe `trialing` -> app `trialing`
- Stripe `active` -> app `active`
- Stripe `past_due` -> app `past_due`
- Stripe `unpaid`/`paused` -> app `suspended`
- Stripe `incomplete`/`incomplete_expired` -> app `incomplete`
- Stripe `canceled` -> app `canceled`

Managed policy:

- `active`/`trialing`: managed execution allowed.
- `canceled`: execution blocked; read-only dashboard grace window allowed.
- `past_due`/`suspended`/`incomplete`: execution blocked.

## Security Requirements

- Verify webhook signatures using `STRIPE_WEBHOOK_SECRET`.
- Never trust redirect query params as billing source of truth.
- Store Stripe keys only in environment variables.
- Do not log full card/payment method data.
- Use HTTPS for webhook delivery in production.
- Keep dedupe records (`stripe_events`) for replay safety.

## Future Expansion

- Stripe Billing Portal endpoint for self-service card updates/cancellation.
- Auto-provisioning of managed client config after payment activation.
- Multi-currency plans and localized pricing.
- Usage-based add-ons (run-volume metering).
- Subscription schedules and annual contracts.
