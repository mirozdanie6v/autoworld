BEGIN;

CREATE TABLE IF NOT EXISTS auto_sale_state_meta (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO auto_sale_state_meta (id, revision)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS auto_sale_leads (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  manager TEXT NOT NULL,
  source TEXT NOT NULL,
  client_created BOOLEAN NOT NULL DEFAULT FALSE,
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_sale_quotes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES auto_sale_leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_sale_orders (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES auto_sale_leads(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  manager TEXT NOT NULL,
  risk_type TEXT NOT NULL DEFAULT 'Нет',
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_sale_payments (
  id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES auto_sale_orders(id) ON DELETE CASCADE,
  amount_usd NUMERIC(14,2) NOT NULL,
  payment_date DATE,
  method TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (order_id, id)
);

CREATE TABLE IF NOT EXISTS auto_sale_notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES auto_sale_leads(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_sale_team (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Менеджер',
  phone TEXT NOT NULL DEFAULT '',
  telegram TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_sale_leads_status ON auto_sale_leads(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_leads_manager ON auto_sale_leads(manager, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_quotes_lead ON auto_sale_quotes(lead_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_orders_lead ON auto_sale_orders(lead_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_orders_stage ON auto_sale_orders(stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_payments_order ON auto_sale_payments(order_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_auto_sale_notes_lead ON auto_sale_notes(lead_id, created_at DESC);

COMMIT;
