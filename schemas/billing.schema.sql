PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS billing_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL UNIQUE,
  org_name TEXT,
  email TEXT,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  plan TEXT NOT NULL CHECK (plan IN ('growth', 'regression_pro', 'enterprise', 'custom')),
  billing_status TEXT NOT NULL CHECK (
    billing_status IN ('lead', 'trialing', 'active', 'past_due', 'canceled', 'suspended', 'incomplete')
  ),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  last_invoice_id TEXT,
  last_payment_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  billing_account_id INTEGER,
  payload_summary TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS provisioning_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  billing_account_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('enabled', 'disabled', 'plan_changed', 'manual_override')),
  details TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_billing_accounts_client_id ON billing_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_accounts_stripe_customer_id ON billing_accounts(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_event_id ON stripe_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_provisioning_log_billing_account_id ON provisioning_log(billing_account_id);
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS billing_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL UNIQUE,
  org_name TEXT,
  email TEXT,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  plan TEXT NOT NULL DEFAULT 'growth' CHECK (plan IN ('growth', 'regression_pro', 'enterprise', 'custom')),
  billing_status TEXT NOT NULL DEFAULT 'lead' CHECK (billing_status IN ('lead', 'trialing', 'active', 'past_due', 'canceled', 'suspended', 'incomplete')),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  last_invoice_id TEXT,
  last_payment_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_accounts_stripe_customer_id
  ON billing_accounts(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_billing_accounts_client_id
  ON billing_accounts(client_id);

CREATE TABLE IF NOT EXISTS stripe_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  billing_account_id INTEGER,
  payload_summary TEXT,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_stripe_event_id
  ON stripe_events(stripe_event_id);

CREATE TABLE IF NOT EXISTS provisioning_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  billing_account_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('enabled', 'disabled', 'plan_changed', 'manual_override')),
  details TEXT,
  performed_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provisioning_log_billing_account_id
  ON provisioning_log(billing_account_id);

CREATE TABLE IF NOT EXISTS stripe_catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_key TEXT NOT NULL UNIQUE,
  stripe_product_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  currency TEXT NOT NULL,
  unit_amount INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_stripe_catalog_items_catalog_key
  ON stripe_catalog_items(catalog_key);

CREATE TABLE IF NOT EXISTS billing_payment_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  stripe_payment_intent_id TEXT,
  payment_status TEXT NOT NULL,
  amount_total INTEGER,
  currency TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_payment_sessions_client_id
  ON billing_payment_sessions(client_id);

CREATE INDEX IF NOT EXISTS idx_billing_payment_sessions_checkout_session_id
  ON billing_payment_sessions(stripe_checkout_session_id);
