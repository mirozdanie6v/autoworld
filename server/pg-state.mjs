import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {leadTransitionAllowed,quoteTransitionAllowed,validateLead,validateOrder,validateQuote} from '../dist/assets/modules/auto-sale/rules.js';
const {Pool}=pg;
const text=v=>String(v??'').trim();
const num=v=>Number(v)||0;
const bool=v=>v===true||v===1||v==='1';
const arr=v=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'):[];
const same=(a,b)=>String(a??'')===String(b??'');
const bad=(error,data={})=>({status:400,data:{error,...data}});
const latestQuote=(quotes,leadId)=>quotes.filter(q=>text(q.leadId)===leadId).sort((a,b)=>num(b.version)-num(a.version))[0];

export async function createPostgresStateStore({databaseUrl,schemaPath}){
  const pool=new Pool({connectionString:databaseUrl,max:8,idleTimeoutMillis:30000,connectionTimeoutMillis:10000});
  await pool.query(await readFile(schemaPath,'utf8'));
  await pool.query('SELECT 1');

  async function loadState(db=pool){
    const [meta,leadsR,quotesR,ordersR,paymentsR,notesR,teamR]=await Promise.all([
      db.query('SELECT revision FROM auto_sale_state_meta WHERE id=1'),
      db.query('SELECT payload_json FROM auto_sale_leads ORDER BY updated_at,id'),
      db.query('SELECT payload_json FROM auto_sale_quotes ORDER BY updated_at,id'),
      db.query('SELECT id,payload_json FROM auto_sale_orders ORDER BY updated_at,id'),
      db.query('SELECT order_id,payload_json FROM auto_sale_payments ORDER BY payment_date,created_at,id'),
      db.query('SELECT lead_id,payload_json FROM auto_sale_notes ORDER BY created_at,id'),
      db.query('SELECT payload_json FROM auto_sale_team ORDER BY active DESC,name,id')]);
    const leads=leadsR.rows.map(r=>r.payload_json||{}),quotes=quotesR.rows.map(r=>r.payload_json||{}),team=teamR.rows.map(r=>r.payload_json||{});
    const byOrder=new Map();for(const r of paymentsR.rows){const list=byOrder.get(r.order_id)||[];list.push(r.payload_json||{});byOrder.set(r.order_id,list)}
    const orders=ordersR.rows.map(r=>{const order=r.payload_json||{},payments=byOrder.get(r.id)||[];return{...order,payments,paid:payments.reduce((s,p)=>s+num(p.amount),0)}});
    const notes={};for(const r of notesR.rows)(notes[r.lead_id]||=[]).push(r.payload_json||{});
    return{revision:Number(meta.rows[0]?.revision)||0,initialized:leads.length>0,leads,quotes,orders,notes,team};
  }

  async function syncState(input){
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      const rev=await db.query('SELECT revision FROM auto_sale_state_meta WHERE id=1 FOR UPDATE');
      const current=Number(rev.rows[0]?.revision)||0,previous=await loadState(db),supplied=input.baseRevision;
      if(supplied!==undefined&&supplied!==null&&Number(supplied)!==current){await db.query('ROLLBACK');return{status:409,data:{error:'revision_conflict',currentRevision:current,state:previous}}}
      const leads=arr(input.leads),quotes=arr(input.quotes),orders=arr(input.orders),team=arr(input.team),notes=input.notes&&typeof input.notes==='object'?input.notes:{};
      const pLeads=new Map(arr(previous.leads).map(x=>[text(x.id),x])),pQuotes=new Map(arr(previous.quotes).map(x=>[text(x.id),x])),pOrders=new Map(arr(previous.orders).map(x=>[text(x.id),x])),initialized=Boolean(previous.initialized);
      const fail=async result=>{await db.query('ROLLBACK');return result};
      for(const m of team){if(!text(m.id)||!text(m.name))return fail(bad('invalid_team_member',{id:m.id||''}));if(!['Директор','Менеджер','Логист','Администратор'].includes(text(m.role)))return fail(bad('invalid_team_role',{id:m.id}))}
      for(const lead of leads){const errors=validateLead(lead);if(errors.length)return fail(bad('invalid_lead',{id:lead.id,details:errors}));const before=pLeads.get(text(lead.id));if(initialized&&before){const agreed=quotes.some(q=>text(q.leadId)===text(lead.id)&&text(q.status)==='Согласован');if(!leadTransitionAllowed(text(before.status),text(lead.status),{hasAgreedQuote:agreed,deposit:num(lead.deposit)}))return fail(bad('invalid_lead_transition',{id:lead.id,from:before.status,to:lead.status}))}}
      for(const quote of quotes){const errors=validateQuote(quote);if(errors.length)return fail(bad('invalid_quote',{id:quote.id,details:errors}));const before=pQuotes.get(text(quote.id));if(initialized&&before){if(!same(before.leadId,quote.leadId))return fail(bad('quote_lead_locked',{id:quote.id}));if(!quoteTransitionAllowed(text(before.status),text(quote.status)))return fail(bad('invalid_quote_transition',{id:quote.id,from:before.status,to:quote.status}));if(['Согласован','Отказ'].includes(text(before.status)))for(const key of ['leadId','model','lot','auction','inland','ocean','customs','repair','service','total','version','validUntil'])if(!same(before[key],quote[key]))return fail(bad('locked_quote_changed',{id:quote.id,field:key}))}else if(initialized&&!quoteTransitionAllowed('',text(quote.status)))return fail(bad('invalid_initial_quote_status',{id:quote.id,status:quote.status}))}
      const seen=new Set();for(const order of orders){const leadId=text(order.leadId);if(seen.has(leadId))return fail(bad('duplicate_order_for_lead',{leadId}));seen.add(leadId);const before=pOrders.get(text(order.id)),errors=validateOrder(order,initialized&&before?text(before.stage):'');if(errors.length)return fail(bad('invalid_order',{id:order.id,details:errors}));if(initialized&&before){for(const key of ['leadId','model','total','cost'])if(!same(before[key],order[key]))return fail(bad('locked_order_field_changed',{id:order.id,field:key}))}else if(initialized){const lead=leads.find(x=>text(x.id)===leadId),quote=latestQuote(quotes,leadId);if(text(order.stage)!=='Выкуп')return fail(bad('new_order_must_start_at_purchase',{id:order.id}));if(!lead||text(lead.status)!=='Сделка'||!quote||text(quote.status)!=='Согласован'||num(lead.deposit)<=0)return fail(bad('order_prerequisites_missing',{id:order.id}));if([...pOrders.values()].some(x=>text(x.leadId)===leadId))return fail(bad('duplicate_order_for_lead',{leadId}))}}
      for(const m of team)await db.query(`INSERT INTO auto_sale_team(id,name,role,phone,telegram,active,payload_json,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,phone=EXCLUDED.phone,telegram=EXCLUDED.telegram,active=EXCLUDED.active,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,[text(m.id),text(m.name),text(m.role)||'Менеджер',text(m.phone),text(m.telegram),bool(m.active),JSON.stringify(m)]);
      for(const lead of leads)await db.query(`INSERT INTO auto_sale_leads(id,status,manager,source,client_created,payload_json,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,manager=EXCLUDED.manager,source=EXCLUDED.source,client_created=EXCLUDED.client_created,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,[text(lead.id),text(lead.status)||'Новый',text(lead.manager)||'Не назначен',text(lead.source)||'Mini App',bool(lead.clientCreated),JSON.stringify(lead)]);
      for(const q of quotes)await db.query(`INSERT INTO auto_sale_quotes(id,lead_id,status,version,payload_json,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET lead_id=EXCLUDED.lead_id,status=EXCLUDED.status,version=EXCLUDED.version,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,[text(q.id),text(q.leadId),text(q.status)||'Черновик',Math.max(1,num(q.version)),JSON.stringify(q)]);
      for(const order of orders){const clean={...order};delete clean.payments;await db.query(`INSERT INTO auto_sale_orders(id,lead_id,stage,manager,risk_type,payload_json,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET lead_id=EXCLUDED.lead_id,stage=EXCLUDED.stage,manager=EXCLUDED.manager,risk_type=EXCLUDED.risk_type,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,[text(order.id),text(order.leadId),text(order.stage)||'Выкуп',text(order.manager)||'Не назначен',text(order.riskType)||'Нет',JSON.stringify(clean)]);for(const p of arr(order.payments))await db.query(`INSERT INTO auto_sale_payments(id,order_id,amount_usd,payment_date,method,note,payload_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(order_id,id) DO UPDATE SET amount_usd=EXCLUDED.amount_usd,payment_date=EXCLUDED.payment_date,method=EXCLUDED.method,note=EXCLUDED.note,payload_json=EXCLUDED.payload_json`,[text(p.id),text(order.id),num(p.amount),text(p.date)||null,text(p.method)||'Банк',text(p.note),JSON.stringify(p),text(p.createdAt)||new Date().toISOString()])}
      for(const [leadId,value] of Object.entries(notes)){const list=arr(value);for(let i=0;i<list.length;i++){const n=list[i],at=text(n.at)||new Date().toISOString(),id=text(n.id)||`${leadId}-${at}-${i}`,payload={...n,id,at};await db.query(`INSERT INTO auto_sale_notes(id,lead_id,text,payload_json,created_at) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(id) DO UPDATE SET text=EXCLUDED.text,payload_json=EXCLUDED.payload_json`,[id,leadId,text(n.text),JSON.stringify(payload),at])}}
      const bump=await db.query('UPDATE auto_sale_state_meta SET revision=revision+1,updated_at=NOW() WHERE id=1 RETURNING revision');await db.query('COMMIT');return{status:200,data:{ok:true,revision:Number(bump.rows[0]?.revision)||current+1}};
    }catch(error){try{await db.query('ROLLBACK')}catch{}throw error}finally{db.release()}
  }
  return{loadState,syncState,ping:()=>pool.query('SELECT 1'),close:()=>pool.end()};
}
