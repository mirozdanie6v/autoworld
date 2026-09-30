PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auto_sale_leads (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  manager TEXT NOT NULL,
  source TEXT NOT NULL,
  client_created INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auto_sale_quotes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auto_sale_orders (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  manager TEXT NOT NULL,
  risk_type TEXT NOT NULL DEFAULT 'Нет',
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auto_sale_payments (
  id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  amount_usd INTEGER NOT NULL,
  payment_date TEXT NOT NULL,
  method TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id, id)
);

CREATE TABLE IF NOT EXISTS auto_sale_notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  text TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auto_sale_state_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO auto_sale_state_meta (id, revision) VALUES (1, 0);

CREATE INDEX IF NOT EXISTS idx_auto_sale_leads_status ON auto_sale_leads(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_leads_manager ON auto_sale_leads(manager, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_quotes_lead ON auto_sale_quotes(lead_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_orders_lead ON auto_sale_orders(lead_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_orders_stage ON auto_sale_orders(stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_payments_order ON auto_sale_payments(order_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_notes_lead ON auto_sale_notes(lead_id, created_at DESC);

INSERT OR IGNORE INTO schema_meta (version) VALUES (5);
