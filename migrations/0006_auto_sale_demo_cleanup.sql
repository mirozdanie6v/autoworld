PRAGMA foreign_keys = ON;

DELETE FROM auto_sale_payments WHERE order_id LIKE 'O-DEMO-%';
DELETE FROM auto_sale_notes WHERE lead_id LIKE 'L-DEMO-%';
DELETE FROM auto_sale_orders WHERE id LIKE 'O-DEMO-%' OR lead_id LIKE 'L-DEMO-%';
DELETE FROM auto_sale_quotes WHERE id LIKE 'Q-DEMO-%' OR lead_id LIKE 'L-DEMO-%';
DELETE FROM auto_sale_leads WHERE id LIKE 'L-DEMO-%';

INSERT OR IGNORE INTO schema_meta (version) VALUES (6);
