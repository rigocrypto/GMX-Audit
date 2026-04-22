# Managed Service Mode

Managed mode adds a lightweight hosted runner layer on top of OSS gmx-audit. The OSS commands remain unchanged and public.

## What Managed Mode Does

- Runs scheduled multi-client scans from operator infrastructure
- Reuses existing OSS scripts for rotation, triage, dashboard, proof packaging, and report generation
- Stores per-client artifacts under `outputs/managed/...`
- Sends alerts to Slack and email sink outputs
- Serves latest dashboards behind bearer-token auth

## Client Configuration

Client configs live in `config/clients/*.config.ts`.

Example (`config/clients/example.config.ts`):

```ts
{
  id: "example",
  displayName: "Example Client",
  protocol: "GMX",
  chains: ["arbitrum", "avalanche"],
  scheduleCron: "0 2 * * *",
  env: {
    ARBITRUM_RPC_URL: "ARBITRUM_RPC_URL",
    AVALANCHE_RPC_URL: "AVALANCHE_RPC_URL"
  },
  alerts: {
    slackWebhookEnv: "EXAMPLE_SLACK_WEBHOOK_URL",
    emailTo: ["security@example.com"]
  },
  auth: {
    dashboardTokenEnv: "EXAMPLE_DASHBOARD_TOKEN"
  },
  tiers: "ci"
}
```

The `env` map points to operator-provided environment variable names (no secrets in repo).

## Run Once

```bash
npm run managed:run -- --client example --once --price 3400
```

Optional chain override:

```bash
npm run managed:run -- --client example --chains arbitrum --price 3400
```

## Scheduler

```bash
npm run managed:scheduler -- --client all
```

Single client schedule:

```bash
npm run managed:scheduler -- --client example
```

## Artifact Layout

Managed run output path:

```text
outputs/managed/<clientId>/<YYYY-MM-DD>/<runId>/
```

Per run artifacts include:

- `rotation-<chain>.log`
- `triage-result.json`
- `results.db`
- `dashboard.html`
- `proof-packages/` (if proofs found)
- `reports/` (generated Immunefi markdown)
- `run-summary.json`
- `alerts/email-sink.json` (if email targets configured)

## Dashboard Server

Start server:

```bash
npm run managed:serve
```

Default port: `8787` (override with `MANAGED_PORT`).

Routes:

- `GET /clients`
- `GET /client/<id>/runs`
- `GET /client/<id>/latest`
- `GET /client/<id>/latest/summary`

Auth:

- `Authorization: Bearer <token>`
- Token source env var is configured per client using `auth.dashboardTokenEnv`

## Security Notes

- Never commit secrets. Use `.env.managed` locally and keep only `.env.managed.example` in git.
- Rotate RPC/API tokens regularly.
- Use least-privilege secrets per environment.
- Keep managed runner infrastructure private; expose only dashboard endpoints as needed.

## Billing Lifecycle

Managed operations are gated by internal billing state derived from Stripe webhooks.

Primary webhook events:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Behavior:

- `active` / `trialing`: managed runs are allowed.
- `past_due`, `incomplete`, `suspended`: managed runs are blocked.
- `canceled`: managed runs are blocked; historical access can remain read-only within grace policy.

Dashboard behavior:

- Latest dashboard route returns a billing-required notice when account is not active.
- Historical metadata routes can remain available during read-only grace windows.

For architecture and operational procedures, see:

- `docs/stripe-integration.md`
- `docs/billing-runbook.md`
