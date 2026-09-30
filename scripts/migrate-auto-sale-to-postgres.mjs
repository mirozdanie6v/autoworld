import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const {Pool}=pg;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceUrl=process.env.SOURCE_STATE_URL||'https://auto-sale.viiversion.com/api/auto-sale/state';
const databaseUrl=String(process.env.DATABASE_URL||'').trim();
if(!databaseUrl)throw new Error('DATABASE_URL is required');
const response=await fetch(sourceUrl,{headers:{accept:'application/json'},cache:'no-store'});
if(!response.ok)throw new Error(`Source state request failed: ${response.status}`);
const state=await response.json();
const leads=Array.isArray(state.leads)?state.leads:[],quotes=Array.isArray(state.quotes)?state.quotes:[],orders=Array.isArray(state.orders)?state.orders:[],team=Array.isArray(state.team)?state.team:[],notes=state.notes&&typeof state.notes==='object'?state.notes:{};
const pool=new Pool({connectionString:databaseUrl,max:2});
const db=await pool.connect();
const text=v=>String(v??'').trim(),num=v=>Number(v)||0,bool=v=>v===true||v===1||v==='1';
try{
  await db.query(await readFile(path.join(root,'yandex','postgres','001_init.sql'),'utf8'));
  await db.query('BEGIN');
  for(const m of team)await db.query(`INSERT INTO auto_sale_team(id,name,role,phone,telegram,active,payload_json,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,phone=EXCLUDED.phone,telegram=EXCLUDED.telegram,active=EXCLUDED.active,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,[text(m.id),text(m.name),text(m.role)||'Менеджер',text(m.phone),text(m.telegram),bool(m.active),JSON.stringify(m)]);
  for(const lead of leads)await db.query(`INSERT INTO auto_sale_leads(id,status,manager,source,client_created,payload_json,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,manager=EXCLUDED.manager,source=EXCLUDED.source,client_created=EXCLUDED.client_created,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,[text(lead.id),text(lead.status)||'Новый',text(lead.manager)||'Не назначен',text(lead.source)||'Mini App',bool(lead.clientCreated),JSON.stringify(lead)]);
  for(const q of quotes)await db.query(`INSERT INTO auto_sale_quotes(id,lead_id,status,version,payload_json,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET lead_id=EXCLUDED.lead_id,status=EXCLUDED.status,version=EXCLUDED.version,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,[text(q.id),text(q.leadId),text(q.status)||'Черновик',Math.max(1,num(q.version)),JSON.stringify(q)]);
  for(const order of orders){const clean={...order};delete clean.payments;await db.query(`INSERT INTO auto_sale_orders(id,lead_id,stage,manager,risk_type,payload_json,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET lead_id=EXCLUDED.lead_id,stage=EXCLUDED.stage,manager=EXCLUDED.manager,risk_type=EXCLUDED.risk_type,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,[text(order.id),text(order.leadId),text(order.stage)||'Выкуп',text(order.manager)||'Не назначен',text(order.riskType)||'Нет',JSON.stringify(clean)]);for(const p of Array.isArray(order.payments)?order.payments:[])await db.query(`INSERT INTO auto_sale_payments(id,order_id,amount_usd,payment_date,method,note,payload_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(order_id,id) DO UPDATE SET amount_usd=EXCLUDED.amount_usd,payment_date=EXCLUDED.payment_date,method=EXCLUDED.method,note=EXCLUDED.note,payload_json=EXCLUDED.payload_json`,[text(p.id),text(order.id),num(p.amount),text(p.date)||null,text(p.method)||'Банк',text(p.note),JSON.stringify(p),text(p.createdAt)||new Date().toISOString()])}
  for(const [leadId,value] of Object.entries(notes)){const list=Array.isArray(value)?value:[];for(let i=0;i<list.length;i++){const n=list[i],at=text(n.at)||new Date().toISOString(),id=text(n.id)||`${leadId}-${at}-${i}`,payload={...n,id,at};await db.query(`INSERT INTO auto_sale_notes(id,lead_id,text,payload_json,created_at) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(id) DO UPDATE SET text=EXCLUDED.text,payload_json=EXCLUDED.payload_json`,[id,leadId,text(n.text),JSON.stringify(payload),at])}}
  await db.query('UPDATE auto_sale_state_meta SET revision=$1,updated_at=NOW() WHERE id=1',[Number(state.revision)||0]);
  await db.query('COMMIT');
  console.log(`AUTO_SALE_POSTGRES_MIGRATION_OK leads=${leads.length} quotes=${quotes.length} orders=${orders.length} team=${team.length}`);
}catch(error){try{await db.query('ROLLBACK')}catch{}throw error}finally{db.release();await pool.end()}
