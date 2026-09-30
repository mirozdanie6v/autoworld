PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO auto_sale_leads (id,status,manager,source,client_created,payload_json,updated_at) VALUES
('L-DEMO-205','Сделка','Максим','WhatsApp',0,json_object(
  'id','L-DEMO-205','name','Demo Delivery','contact','demo','model','Ford Mustang Mach-E 2022','budget',36000,
  'source','WhatsApp','manager','Максим','status','Сделка','priority','Средний','createdAt','2026-08-18T10:00:00Z',
  'nextAction','2026-09-13','note','Автомобиль передан во внутреннюю доставку.','deposit',14000,
  'depositDate','2026-08-22','paymentMethod','Банк','demo',json('true')
),'2026-09-12T08:00:00Z'),
('L-DEMO-206','Сделка','Дмитрий','Сайт',0,json_object(
  'id','L-DEMO-206','name','Demo Handoff','contact','demo','model','Tesla Model 3 Long Range 2023','budget',34000,
  'source','Сайт','manager','Дмитрий','status','Сделка','priority','Средний','createdAt','2026-08-12T10:00:00Z',
  'nextAction','2026-09-13','note','Автомобиль готов к выдаче клиенту.','deposit',16000,
  'depositDate','2026-08-15','paymentMethod','Банк','demo',json('true')
),'2026-09-12T08:00:00Z');

INSERT OR IGNORE INTO auto_sale_quotes (id,lead_id,status,version,payload_json,updated_at) VALUES
('Q-DEMO-205','L-DEMO-205','Согласован',1,json_object(
  'id','Q-DEMO-205','leadId','L-DEMO-205','model','Ford Mustang Mach-E 2022','lot',23000,'auction',1000,
  'inland',700,'ocean',2400,'customs',5200,'repair',600,'service',1500,'total',34400,
  'status','Согласован','version',1,'validUntil','2026-09-18','updatedAt','2026-08-22T08:00:00Z','demo',json('true')
),'2026-09-12T08:00:00Z'),
('Q-DEMO-206','L-DEMO-206','Согласован',1,json_object(
  'id','Q-DEMO-206','leadId','L-DEMO-206','model','Tesla Model 3 Long Range 2023','lot',22100,'auction',950,
  'inland',650,'ocean',2300,'customs',5000,'repair',400,'service',1500,'total',32900,
  'status','Согласован','version',1,'validUntil','2026-09-18','updatedAt','2026-08-15T08:00:00Z','demo',json('true')
),'2026-09-12T08:00:00Z');

INSERT OR IGNORE INTO auto_sale_orders (id,lead_id,stage,manager,risk_type,payload_json,updated_at) VALUES
('O-DEMO-205','L-DEMO-205','Доставка','Максим','Задержка',json_object(
  'id','O-DEMO-205','leadId','L-DEMO-205','customer','Demo Delivery','model','Ford Mustang Mach-E 2022',
  'manager','Максим','source','WhatsApp','total',34400,'cost',32900,'stage','Доставка','eta','2026-09-16',
  'lot','DEMO-205','vin','DEMO-MACHE-205','location','Автовоз до города выдачи','riskType','Задержка',
  'riskNote','Перенос прибытия на один день из-за графика перевозчика.','risk','Задержка','updatedAt','2026-09-12T03:50:00Z','demo',json('true')
),'2026-09-12T08:00:00Z'),
('O-DEMO-206','L-DEMO-206','Выдача','Дмитрий','Нет',json_object(
  'id','O-DEMO-206','leadId','L-DEMO-206','customer','Demo Handoff','model','Tesla Model 3 Long Range 2023',
  'manager','Дмитрий','source','Сайт','total',32900,'cost',31400,'stage','Выдача','eta','2026-09-12',
  'lot','DEMO-206','vin','DEMO-M3-206','location','Площадка выдачи','riskType','Нет','riskNote','','risk','Нет',
  'updatedAt','2026-09-12T03:40:00Z','demo',json('true')
),'2026-09-12T08:00:00Z');

INSERT OR IGNORE INTO auto_sale_payments (id,order_id,amount_usd,payment_date,method,note,payload_json,created_at) VALUES
('PAY-1','O-DEMO-205',14000,'2026-08-22','Банк','Депозит',json_object('id','PAY-1','amount',14000,'date','2026-08-22','method','Банк','note','Депозит'),'2026-08-22T08:00:00Z'),
('PAY-2','O-DEMO-205',16000,'2026-09-09','Банк','Основная доплата',json_object('id','PAY-2','amount',16000,'date','2026-09-09','method','Банк','note','Основная доплата'),'2026-09-09T08:00:00Z'),
('PAY-1','O-DEMO-206',16000,'2026-08-15','Банк','Депозит',json_object('id','PAY-1','amount',16000,'date','2026-08-15','method','Банк','note','Депозит'),'2026-08-15T08:00:00Z'),
('PAY-2','O-DEMO-206',16900,'2026-09-11','Банк','Финальный расчёт',json_object('id','PAY-2','amount',16900,'date','2026-09-11','method','Банк','note','Финальный расчёт'),'2026-09-11T08:00:00Z');

INSERT OR IGNORE INTO auto_sale_notes (id,lead_id,text,payload_json,created_at) VALUES
('N-DEMO-205','L-DEMO-205','Автомобиль передан на автовоз. ETA перенесён на один день.',json_object('id','N-DEMO-205','at','2026-09-12T03:50:00Z','text','Автомобиль передан на автовоз. ETA перенесён на один день.'),'2026-09-12T03:50:00Z'),
('N-DEMO-206','L-DEMO-206','Автомобиль готов к выдаче, финальный расчёт получен.',json_object('id','N-DEMO-206','at','2026-09-12T03:40:00Z','text','Автомобиль готов к выдаче, финальный расчёт получен.'),'2026-09-12T03:40:00Z');

UPDATE auto_sale_state_meta SET revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=1;
INSERT OR IGNORE INTO schema_meta (version) VALUES (8);
