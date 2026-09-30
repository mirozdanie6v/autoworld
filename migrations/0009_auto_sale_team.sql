CREATE TABLE IF NOT EXISTS auto_sale_team (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Менеджер',
  phone TEXT NOT NULL DEFAULT '',
  telegram TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO auto_sale_team (id,name,role,phone,telegram,active,payload_json,updated_at) VALUES
('TM-DMITRY','Дмитрий','Менеджер','','',1,'{"id":"TM-DMITRY","name":"Дмитрий","role":"Менеджер","phone":"","telegram":"","active":true,"planDeals":4,"note":""}',datetime('now')),
('TM-ANNA','Анна','Менеджер','','',1,'{"id":"TM-ANNA","name":"Анна","role":"Менеджер","phone":"","telegram":"","active":true,"planDeals":4,"note":""}',datetime('now')),
('TM-MAKSIM','Максим','Менеджер','','',1,'{"id":"TM-MAKSIM","name":"Максим","role":"Менеджер","phone":"","telegram":"","active":true,"planDeals":4,"note":""}',datetime('now'));

INSERT OR REPLACE INTO schema_meta (version) VALUES (9);
