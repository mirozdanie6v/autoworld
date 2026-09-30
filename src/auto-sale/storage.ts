import type { AnyRecord, D1DatabaseLike } from './types.js';

const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const num=(v:unknown)=>Number(v)||0;
const bool=(v:unknown)=>v===true||v===1||v==='1';
const parse=(value:string):AnyRecord=>{try{return JSON.parse(value) as AnyRecord}catch{return{}}};
const id=(obj:AnyRecord,prefix:string)=>text(obj.id)||`${prefix}-${Date.now()}-${crypto.randomUUID().slice(0,8)}`;

export async function getRevision(db:D1DatabaseLike):Promise<number>{
  const row=await db.prepare('SELECT revision FROM auto_sale_state_meta WHERE id=1').first<{revision:number}>();
  return Number(row?.revision)||0;
}
export async function bumpRevision(db:D1DatabaseLike):Promise<number>{
  await db.prepare('UPDATE auto_sale_state_meta SET revision=revision+1, updated_at=? WHERE id=1').bind(new Date().toISOString()).run();
  return getRevision(db);
}

export async function putLead(db:D1DatabaseLike,lead:AnyRecord):Promise<AnyRecord>{
  lead.id=id(lead,'L');
  await db.prepare(`INSERT INTO auto_sale_leads (id,status,manager,source,client_created,payload_json,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,manager=excluded.manager,source=excluded.source,client_created=excluded.client_created,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .bind(text(lead.id),text(lead.status)||'Новый',text(lead.manager)||'Не назначен',text(lead.source)||'Mini App',bool(lead.clientCreated)?1:0,JSON.stringify(lead),new Date().toISOString()).run();
  return lead;
}
export async function putQuote(db:D1DatabaseLike,quote:AnyRecord):Promise<AnyRecord>{
  quote.id=id(quote,'Q');
  await db.prepare(`INSERT INTO auto_sale_quotes (id,lead_id,status,version,payload_json,updated_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lead_id=excluded.lead_id,status=excluded.status,version=excluded.version,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .bind(text(quote.id),text(quote.leadId),text(quote.status)||'Черновик',Math.max(1,num(quote.version)),JSON.stringify(quote),new Date().toISOString()).run();
  return quote;
}
export async function putOrder(db:D1DatabaseLike,order:AnyRecord):Promise<AnyRecord>{
  order.id=id(order,'O');
  const clean={...order}; delete clean.payments;
  await db.prepare(`INSERT INTO auto_sale_orders (id,lead_id,stage,manager,risk_type,payload_json,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lead_id=excluded.lead_id,stage=excluded.stage,manager=excluded.manager,risk_type=excluded.risk_type,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .bind(text(order.id),text(order.leadId),text(order.stage)||'Выкуп',text(order.manager)||'Не назначен',text(order.riskType)||'Нет',JSON.stringify(clean),new Date().toISOString()).run();
  return order;
}
export async function putPayment(db:D1DatabaseLike,orderId:string,payment:AnyRecord):Promise<AnyRecord>{
  payment.id=id(payment,'PAY');
  await db.prepare(`INSERT INTO auto_sale_payments (id,order_id,amount_usd,payment_date,method,note,payload_json,created_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(order_id,id) DO UPDATE SET amount_usd=excluded.amount_usd,payment_date=excluded.payment_date,method=excluded.method,note=excluded.note,payload_json=excluded.payload_json`)
    .bind(text(payment.id),orderId,num(payment.amount),text(payment.date),text(payment.method)||'Банк',text(payment.note),JSON.stringify(payment),text(payment.createdAt)||new Date().toISOString()).run();
  return payment;
}
export async function putNote(db:D1DatabaseLike,leadId:string,note:AnyRecord,index=0):Promise<AnyRecord>{
  const at=text(note.at)||new Date().toISOString();
  const noteId=text(note.id)||`${leadId}-${at}-${index}`;
  const payload={...note,id:noteId,at};
  await db.prepare(`INSERT INTO auto_sale_notes (id,lead_id,text,payload_json,created_at)
    VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,payload_json=excluded.payload_json`)
    .bind(noteId,leadId,text(note.text),JSON.stringify(payload),at).run();
  return payload;
}
export async function putTeamMember(db:D1DatabaseLike,member:AnyRecord):Promise<AnyRecord>{
  member.id=id(member,'TM');
  await db.prepare(`INSERT INTO auto_sale_team (id,name,role,phone,telegram,active,payload_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,phone=excluded.phone,telegram=excluded.telegram,active=excluded.active,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .bind(text(member.id),text(member.name),text(member.role)||'Менеджер',text(member.phone),text(member.telegram),bool(member.active)?1:0,JSON.stringify(member),new Date().toISOString()).run();
  return member;
}

export async function loadState(db:D1DatabaseLike):Promise<AnyRecord>{
  const leadsR=await db.prepare('SELECT payload_json FROM auto_sale_leads ORDER BY updated_at,id').all<{payload_json:string}>();
  const quotesR=await db.prepare('SELECT payload_json FROM auto_sale_quotes ORDER BY updated_at,id').all<{payload_json:string}>();
  const ordersR=await db.prepare('SELECT id,payload_json FROM auto_sale_orders ORDER BY updated_at,id').all<{id:string,payload_json:string}>();
  const paymentsR=await db.prepare('SELECT order_id,payload_json FROM auto_sale_payments ORDER BY payment_date,created_at,id').all<{order_id:string,payload_json:string}>();
  const notesR=await db.prepare('SELECT lead_id,payload_json FROM auto_sale_notes ORDER BY created_at,id').all<{lead_id:string,payload_json:string}>();
  const teamR=await db.prepare('SELECT payload_json FROM auto_sale_team ORDER BY active DESC,name,id').all<{payload_json:string}>();
  const leads=(leadsR.results||[]).map(r=>parse(r.payload_json));
  const quotes=(quotesR.results||[]).map(r=>parse(r.payload_json));
  const team=(teamR.results||[]).map(r=>parse(r.payload_json));
  const byOrder=new Map<string,AnyRecord[]>();
  for(const r of paymentsR.results||[]){const list=byOrder.get(r.order_id)||[];list.push(parse(r.payload_json));byOrder.set(r.order_id,list)}
  const orders=(ordersR.results||[]).map(r=>{const order=parse(r.payload_json),payments=byOrder.get(r.id)||[];return{...order,payments,paid:payments.reduce((s,p)=>s+num(p.amount),0)}});
  const notes:Record<string,AnyRecord[]>={};
  for(const r of notesR.results||[])(notes[r.lead_id]||=[]).push(parse(r.payload_json));
  return{revision:await getRevision(db),initialized:leads.length>0,leads,quotes,orders,notes,team};
}
