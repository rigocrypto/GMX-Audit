import { createBillingAlertNotifierFromEnv } from "./alerts";
import { openBillingDb } from "./db";
import { runBillingMigrations } from "./migrate";

type CountRow = { c: number };

function getCount(sql: string, params: unknown[] = []): number {
  const db = openBillingDb();
  try {
    const row = db.prepare(sql).get(...params) as CountRow | undefined;
    return Number(row?.c ?? 0);
  } finally {
    db.close();
  }
}

function ensureSummaryTables(): void {
  const db = openBillingDb();
  try {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS billing_webhook_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stripe_event_id TEXT,
        event_type TEXT,
        http_status INTEGER NOT NULL,
        error_code TEXT,
        is_duplicate INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`
    ).run();
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  runBillingMigrations();
  ensureSummaryTables();

  const lookbackHours = Number.parseInt(process.env.BILLING_DAILY_SUMMARY_LOOKBACK_HOURS || "24", 10);
  const lookback = Number.isFinite(lookbackHours) && lookbackHours > 0 ? lookbackHours : 24;
  const windowExpr = `-${lookback} hours`;

  const successfulPayments = getCount(
    `SELECT COUNT(*) as c
     FROM billing_payment_sessions
     WHERE payment_status = 'paid'
       AND COALESCE(completed_at, updated_at, created_at) >= datetime('now', ?)` ,
    [windowExpr]
  );

  const failedPayments = getCount(
    `SELECT COUNT(*) as c
     FROM stripe_events
     WHERE event_type = 'invoice.payment_failed'
       AND processed_at >= datetime('now', ?)` ,
    [windowExpr]
  );

  const webhook4xx = getCount(
    `SELECT COUNT(*) as c
     FROM billing_webhook_attempts
     WHERE http_status BETWEEN 400 AND 499
       AND created_at >= datetime('now', ?)` ,
    [windowExpr]
  );

  const webhook5xx = getCount(
    `SELECT COUNT(*) as c
     FROM billing_webhook_attempts
     WHERE http_status BETWEEN 500 AND 599
       AND created_at >= datetime('now', ?)` ,
    [windowExpr]
  );

  const replayedEvents = getCount(
    `SELECT COUNT(*) as c
     FROM billing_webhook_attempts
     WHERE is_duplicate = 1
       AND created_at >= datetime('now', ?)` ,
    [windowExpr]
  );

  const notifier = createBillingAlertNotifierFromEnv();
  await notifier({
    title: "Daily billing summary",
    level: "info",
    source: "billing-summary",
    message: `Billing summary for last ${lookback}h`,
    details: {
      successfulPayments,
      failedPayments,
      webhook4xx,
      webhook5xx,
      replayedEvents,
      lookbackHours: lookback
    }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        successfulPayments,
        failedPayments,
        webhook4xx,
        webhook5xx,
        replayedEvents,
        lookbackHours: lookback
      },
      null,
      2
    )
  );
}

main().catch((error: Error) => {
  console.error("[billing:summary] failed", { error: error.message });
  process.exitCode = 1;
});