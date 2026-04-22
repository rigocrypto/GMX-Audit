# Billing Runbook

## Scope

This runbook covers billing operations for managed clients, including webhook processing, status checks, manual overrides, and incident response.

## Commands

- `npm run billing:migrate`
- `npm run billing:seed`
- `npm run billing:status -- --client <clientId>`
- `npm run billing:webhook-server`

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
