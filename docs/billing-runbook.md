# Billing Runbook

## Scope

This runbook covers billing operations for managed clients, including webhook processing, status checks, manual overrides, and incident response.

## Commands

- `npm run billing:migrate`
- `npm run billing:seed`
- `npm run billing:status -- --client <clientId>`
- `npm run billing:webhook-server`

## Billing Portal Endpoint

The billing server can create a Stripe-hosted customer portal session.

Route:

- `POST /api/billing/portal`

Request requirements:

- `Authorization: Bearer <BILLING_PORTAL_API_TOKEN>`
- JSON body with `clientId`

Required env:

- `BILLING_PORTAL_RETURN_URL`
- `BILLING_PORTAL_API_TOKEN`
- `BILLING_PORTAL_RATE_LIMIT_WINDOW_MS` (default: `60000` ms)
- `BILLING_PORTAL_RATE_LIMIT_MAX` (default: `10` requests per window)

**Note:** Rate limiting state is in-memory and resets on server restart. For
multi-instance deployments, replace the default `express-rate-limit` store with
a shared store (e.g. Redis via `rate-limit-redis`) before going multi-instance.

## Daily Checks

1. Verify webhook process health endpoint returns `ok`.
2. Spot-check recent Stripe events in `stripe_events` table.
3. Spot-check managed clients with `billing:status` before scheduled windows.
4. Confirm no unexpected `past_due` transitions.

## Manual Status Check

Use:

```bash
npm run billing:status -- --client example
```

Review:

- account status (`active`, `past_due`, etc.)
- current period end date
- access decision (`allowed`, `readOnly`, reason)
- entitlement mapping

## Manual Overrides

When emergency continuity is approved, write explicit override entries into `provisioning_log` with action `manual_override`.
Do not silently alter billing state without an audit log entry.

Recommended policy:

- limit override windows (24-72h)
- require ticket/approval reference in override details

## Failed Payments

Trigger: `invoice.payment_failed`

Operator actions:

1. Confirm transition to `past_due`.
2. Notify account owner.
3. Keep historical artifacts read-only.
4. Do not run new managed scans until paid.

If Stripe retry succeeds (`invoice.paid`):

1. Account should return to `active`.
2. Re-enable managed scheduler execution.

## Cancellation

Trigger: `customer.subscription.deleted`

Operator actions:

1. Verify state becomes `canceled`.
2. Ensure managed runs are skipped.
3. Keep read-only dashboard/artifact access during grace period.
4. Archive client handoff notes after grace period.

## Payment Disputes

1. Mark account operationally suspended if risk policy requires.
2. Preserve all run artifacts and logs.
3. Track dispute references in internal ticketing.
4. Re-enable only when dispute clears or override is approved.

## Troubleshooting

### Webhook signature failures

- Verify `STRIPE_WEBHOOK_SECRET` matches Stripe endpoint configuration.
- Ensure raw body parser is used for webhook route.
- Ensure proxy/CDN does not alter payload.

### Duplicate event processing concerns

- Check `stripe_events` for `stripe_event_id` uniqueness.
- Duplicate deliveries should be accepted and no-op.

### Client blocked unexpectedly

1. Run `billing:status` for client.
2. Confirm Stripe subscription status and latest invoice state.
3. Execute `syncFromStripe` fallback if metadata drift suspected.

## Security Handling

- Never print secret keys in logs.
- Never store card PAN/CVC locally.
- Restrict Stripe Dashboard access to approved operators.

## Stripe Test Mode End-to-End Validation

This checklist validates that the webhook handler correctly processes real Stripe events, verifies signatures, and updates billing state. Run this once before treating billing as production-ready.

When: after CI passes, before Billing Portal integration.
Time: about 30 minutes.
Environment: local Stripe test mode only.

### Prerequisites

1. Set Stripe test credentials only:
	- `STRIPE_SECRET_KEY=sk_test_...`
	- install Stripe CLI: `https://stripe.com/docs/stripe-cli`
2. Start from a known billing database state:

```bash
npm run billing:migrate
npm run billing:seed
```

3. Verify baseline state:

```bash
npm run billing:status -- --client example
```

Expected baseline: seeded client is `active` on plan `growth`.

### Step 1: Start webhook server

Terminal 1:

```bash
npm run billing:webhook-server
```

Expected:
- server starts successfully
- webhook route is available at `/api/webhooks/stripe`
- health route responds at `/health`

Leave this process running.

### Step 2: Start Stripe CLI forwarder

Terminal 2:

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Expected: Stripe CLI prints a signing secret similar to `whsec_test_...`.

Set that secret in the same shell used to start the server, or restart the server after exporting it:

```bash
$env:STRIPE_WEBHOOK_SECRET='whsec_test_...'
```

Leave Stripe CLI running.

### Step 3: checkout.session.completed

Terminal 3:

```bash
stripe trigger checkout.session.completed
```

Verify:
- webhook server logs successful processing
- `stripe_events` gets a new row
- billing account is created or updated
- Stripe customer or subscription IDs are persisted when present

Check:

```bash
npm run billing:status -- --client example
```

Pass condition: event is accepted, signature verification succeeds, and account state is updated without error.

### Step 4: invoice.paid

Terminal 3:

```bash
stripe trigger invoice.paid
```

Verify:
- billing status becomes `active`
- `last_payment_at` is updated
- provisioning log records an enabling or payment-received action
- managed access decision is allowed

Check:

```bash
npm run billing:status -- --client example
```

Pass condition: account is active and usable.

### Step 5: invoice.payment_failed

Terminal 3:

```bash
stripe trigger invoice.payment_failed
```

Verify:
- billing status becomes `past_due`
- provisioning log records the billing issue
- managed access behaves according to current policy

Check:

```bash
npm run billing:status -- --client example
```

Pass condition: `past_due` state is reflected consistently in status output and gating.

### Step 6: customer.subscription.deleted

Terminal 3:

```bash
stripe trigger customer.subscription.deleted
```

Verify:
- billing status becomes `canceled`
- provisioning log contains a disabling action
- new managed runs are blocked
- dashboard access follows the current canceled/read-only policy

Check:

```bash
npm run billing:status -- --client example
```

Pass condition: canceled state is persisted and gating reflects it.

### Step 7: Duplicate event idempotency

Replay the same event if possible, or repeat a trigger to confirm duplicate deliveries do not double-apply state transitions.

Verify:
- no duplicate billing account rows
- no duplicate provisioning actions for the same Stripe event ID
- `stripe_events` uniqueness guard prevents double-processing

Recommended check:

```bash
npm run billing:status -- --client example
```

Pass condition: second delivery is accepted as a no-op.

### Step 8: Invalid signature rejection

Temporarily set an incorrect webhook secret and send another Stripe event.

Verify:
- webhook route returns `400`
- no billing state changes are written
- no provisioning log entry is added

Then restore the correct webhook secret.

Pass condition: invalid signatures are rejected without mutation.

### Record the result

Capture a short verification note after the run:

```markdown
## Stripe CLI Validation Results

Date: 2026-04-22
Environment: local test mode

Passed:
- checkout.session.completed
- invoice.paid
- invoice.payment_failed
- customer.subscription.deleted
- duplicate event idempotency
- invalid signature rejection

Notes:
- `past_due` currently blocks new managed runs
- `canceled` preserves read-only dashboard access during grace period
```

Only move on to Billing Portal after this checklist passes once end to end.
