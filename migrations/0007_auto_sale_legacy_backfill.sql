PRAGMA foreign_keys = ON;

UPDATE auto_sale_quotes
SET payload_json = json_set(
  payload_json,
  '$.validUntil', COALESCE(NULLIF(json_extract(payload_json,'$.validUntil'),''), date('now','+7 day'))
)
WHERE status <> 'Черновик'
  AND (json_extract(payload_json,'$.validUntil') IS NULL OR trim(json_extract(payload_json,'$.validUntil')) = '');

UPDATE auto_sale_orders
SET payload_json = json_set(
  payload_json,
  '$.riskType', CASE
    WHEN COALESCE(NULLIF(json_extract(payload_json,'$.riskType'),''), NULLIF(json_extract(payload_json,'$.risk'),''), 'Нет') = 'Нет' THEN 'Нет'
    WHEN COALESCE(NULLIF(json_extract(payload_json,'$.riskType'),''), NULLIF(json_extract(payload_json,'$.risk'),'')) IN ('Ожидает судно','Документы','Повреждение','Задержка','Оплата','Другое')
      THEN COALESCE(NULLIF(json_extract(payload_json,'$.riskType'),''), NULLIF(json_extract(payload_json,'$.risk'),''))
    ELSE 'Другое'
  END,
  '$.riskNote', CASE
    WHEN COALESCE(NULLIF(json_extract(payload_json,'$.riskType'),''), NULLIF(json_extract(payload_json,'$.risk'),''), 'Нет') = 'Нет' THEN ''
    ELSE COALESCE(NULLIF(json_extract(payload_json,'$.riskNote'),''), NULLIF(json_extract(payload_json,'$.risk'),''), 'Перенесено из прежней записи риска')
  END
)
WHERE json_extract(payload_json,'$.riskType') IS NULL
   OR (COALESCE(NULLIF(json_extract(payload_json,'$.riskType'),''), 'Нет') <> 'Нет' AND COALESCE(NULLIF(json_extract(payload_json,'$.riskNote'),''), '') = '');

INSERT OR IGNORE INTO auto_sale_payments (id,order_id,amount_usd,payment_date,method,note,payload_json,created_at)
SELECT
  'PAY-LEGACY',
  o.id,
  CAST(json_extract(o.payload_json,'$.paid') AS INTEGER),
  '2026-09-12',
  'Банк',
  'Перенесено из прежнего поля оплаты',
  json_object('id','PAY-LEGACY','amount',CAST(json_extract(o.payload_json,'$.paid') AS INTEGER),'date','2026-09-12','method','Банк','note','Перенесено из прежнего поля оплаты'),
  CURRENT_TIMESTAMP
FROM auto_sale_orders o
WHERE CAST(COALESCE(json_extract(o.payload_json,'$.paid'),0) AS INTEGER) > 0
  AND NOT EXISTS (SELECT 1 FROM auto_sale_payments p WHERE p.order_id=o.id);

INSERT OR IGNORE INTO schema_meta (version) VALUES (7);
