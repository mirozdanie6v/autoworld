import {Uint64} from '@ydbjs/value/primitive';
import {AUTO_SALE_DOMAIN_SCHEMA_VERSION} from './ydb-domain-store.mjs';
import {legacyStateToDomainRows} from './ydb-domain-migration.mjs';

const text=value=>String(value??'').trim();
const u64=value=>new Uint64(BigInt(Math.max(0,Number(value)||0)));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

const specs={
  leads:{key:row=>text(row.id)},
  quotes:{key:row=>text(row.id)},
  orders:{key:row=>text(row.id)},
  payments:{key:row=>text(row.orderId)+'\u0000'+text(row.id)},
  notes:{key:row=>text(row.leadId)+'\u0000'+text(row.id)},
  team:{key:row=>text(row.id)},
  catalog:{key:row=>text(row.id)},
  telegramBindings:{key:row=>text(row.subjectType)+'\u0000'+text(row.subjectId)}
};

function diffRows(previous=[],next=[],keyOf){
  const before=new Map((previous||[]).map(row=>[keyOf(row),row]));
  const after=new Map((next||[]).map(row=>[keyOf(row),row]));
  const deletes=[];
  const upserts=[];
  for(const [key,row] of before){
    if(!after.has(key))deletes.push(row);
  }
  for(const [key,row] of after){
    if(!before.has(key)||!same(before.get(key),row))upserts.push(row);
  }
  return{deletes,upserts};
}

export function buildDomainDiff(previousState={},nextState={}){
  const previous=legacyStateToDomainRows(previousState);
  const next=legacyStateToDomainRows(nextState);
  const changes={};
  for(const [name,spec] of Object.entries(specs)){
    changes[name]=diffRows(previous[name],next[name],spec.key);
  }
  const forceOwnerUpsert=(name,id)=>{
    const row=(next[name]||[]).find(item=>text(item.id)===text(id));
    if(!row)return;
    if(changes[name].deletes.some(item=>text(item.id)===text(id)))return;
    if(!changes[name].upserts.some(item=>text(item.id)===text(id)))changes[name].upserts.push(row);
  };
  const paymentOwners=new Set([
    ...changes.payments.upserts.map(row=>text(row.orderId)),
    ...changes.payments.deletes.map(row=>text(row.orderId))
  ]);
  for(const orderId of paymentOwners)forceOwnerUpsert('orders',orderId);
  const noteOwners=new Set([
    ...changes.notes.upserts.map(row=>text(row.leadId)),
    ...changes.notes.deletes.map(row=>text(row.leadId))
  ]);
  for(const leadId of noteOwners)forceOwnerUpsert('leads',leadId);
  return{previous,next,changes};
}

export function summarizeDomainDiff(diff){
  const out={};
  for(const [name,change] of Object.entries(diff?.changes||{})){
    out[name]={upserts:change.upserts.length,deletes:change.deletes.length};
  }
  return out;
}

export async function applyDomainDiff(tx,diff,{compatRevision=0,status='dual-write'}={}){
  const c=diff.changes;

  for(const row of c.payments.deletes)await tx`
    DELETE FROM auto_sale_payments WHERE order_id=${text(row.orderId)} AND id=${text(row.id)}
  `;
  for(const row of c.notes.deletes)await tx`
    DELETE FROM auto_sale_notes WHERE lead_id=${text(row.leadId)} AND id=${text(row.id)}
  `;
  for(const row of c.telegramBindings.deletes)await tx`
    DELETE FROM auto_sale_telegram_bindings WHERE subject_type=${text(row.subjectType)} AND subject_id=${text(row.subjectId)}
  `;
  for(const row of c.quotes.deletes)await tx`DELETE FROM auto_sale_quotes WHERE id=${text(row.id)}`;
  for(const row of c.orders.deletes)await tx`DELETE FROM auto_sale_orders WHERE id=${text(row.id)}`;
  for(const row of c.leads.deletes)await tx`DELETE FROM auto_sale_leads WHERE id=${text(row.id)}`;
  for(const row of c.team.deletes)await tx`DELETE FROM auto_sale_team WHERE id=${text(row.id)}`;
  for(const row of c.catalog.deletes)await tx`DELETE FROM auto_sale_catalog WHERE id=${text(row.id)}`;

  for(const row of c.leads.upserts)await tx`
    UPSERT INTO auto_sale_leads (id,row_version,sort_order,status,manager,source,client_created,payload,updated_at)
    VALUES (${text(row.id)},${u64(compatRevision)},${u64(row.sortOrder)},${text(row.status)},${text(row.manager)},${text(row.source)},${Boolean(row.clientCreated)},${JSON.stringify(row.payload||{})},${text(row.updatedAt)})
  `;
  for(const row of c.quotes.upserts)await tx`
    UPSERT INTO auto_sale_quotes (id,row_version,sort_order,lead_id,status,quote_version,payload,updated_at)
    VALUES (${text(row.id)},${u64(compatRevision)},${u64(row.sortOrder)},${text(row.leadId)},${text(row.status)},${u64(row.quoteVersion)},${JSON.stringify(row.payload||{})},${text(row.updatedAt)})
  `;
  for(const row of c.orders.upserts)await tx`
    UPSERT INTO auto_sale_orders (id,row_version,sort_order,lead_id,stage,manager,risk_type,payload,updated_at)
    VALUES (${text(row.id)},${u64(compatRevision)},${u64(row.sortOrder)},${text(row.leadId)},${text(row.stage)},${text(row.manager)},${text(row.riskType)},${JSON.stringify(row.payload||{})},${text(row.updatedAt)})
  `;
  for(const row of c.payments.upserts)await tx`
    UPSERT INTO auto_sale_payments (order_id,id,sort_order,amount,payment_date,method,payload,created_at)
    VALUES (${text(row.orderId)},${text(row.id)},${u64(row.sortOrder)},${Number(row.amount)||0},${text(row.paymentDate)},${text(row.method)},${JSON.stringify(row.payload||{})},${text(row.createdAt)})
  `;
  for(const row of c.notes.upserts)await tx`
    UPSERT INTO auto_sale_notes (lead_id,id,sort_order,text,payload,created_at)
    VALUES (${text(row.leadId)},${text(row.id)},${u64(row.sortOrder)},${text(row.text)},${JSON.stringify(row.payload||{})},${text(row.createdAt)})
  `;
  for(const row of c.team.upserts)await tx`
    UPSERT INTO auto_sale_team (id,row_version,sort_order,name,role,active,payload,updated_at)
    VALUES (${text(row.id)},${u64(compatRevision)},${u64(row.sortOrder)},${text(row.name)},${text(row.role)},${Boolean(row.active)},${JSON.stringify(row.payload||{})},${text(row.updatedAt)})
  `;
  for(const row of c.catalog.upserts)await tx`
    UPSERT INTO auto_sale_catalog (id,row_version,sort_order,origin,active,auction_date,payload,updated_at)
    VALUES (${text(row.id)},${u64(compatRevision)},${u64(row.sortOrder)},${text(row.origin)},${Boolean(row.active)},${text(row.auctionDate)},${JSON.stringify(row.payload||{})},${text(row.updatedAt)})
  `;
  const now=new Date().toISOString();
  for(const row of c.telegramBindings.upserts)await tx`
    UPSERT INTO auto_sale_telegram_bindings (subject_type,subject_id,telegram_user_id,username,first_name,last_name,linked_at,updated_at)
    VALUES (${text(row.subjectType)},${text(row.subjectId)},${text(row.telegramUserId)},${text(row.username)},${text(row.firstName)},${text(row.lastName)},${text(row.linkedAt)},${now})
  `;

  const metaId=u64(1);
  const revision=u64(compatRevision);
  const schemaVersion=u64(AUTO_SALE_DOMAIN_SCHEMA_VERSION);
  await tx`
    UPSERT INTO auto_sale_state_meta (id,compat_revision,schema_version,migration_status,source_revision,updated_at)
    VALUES (${metaId},${revision},${schemaVersion},${text(status)},${revision},${now})
  `;
}


export async function replaceDomainSnapshotInTransaction(tx,state,{compatRevision=0,status='dual-write-catchup'}={}){
  const [paymentKeys]=await tx`SELECT order_id,id FROM auto_sale_payments`;
  for(const row of paymentKeys)await tx`DELETE FROM auto_sale_payments WHERE order_id=${text(row.order_id)} AND id=${text(row.id)}`;
  const [noteKeys]=await tx`SELECT lead_id,id FROM auto_sale_notes`;
  for(const row of noteKeys)await tx`DELETE FROM auto_sale_notes WHERE lead_id=${text(row.lead_id)} AND id=${text(row.id)}`;
  const [bindingKeys]=await tx`SELECT subject_type,subject_id FROM auto_sale_telegram_bindings`;
  for(const row of bindingKeys)await tx`DELETE FROM auto_sale_telegram_bindings WHERE subject_type=${text(row.subject_type)} AND subject_id=${text(row.subject_id)}`;

  const [quoteKeys]=await tx`SELECT id FROM auto_sale_quotes`;
  for(const row of quoteKeys)await tx`DELETE FROM auto_sale_quotes WHERE id=${text(row.id)}`;
  const [orderKeys]=await tx`SELECT id FROM auto_sale_orders`;
  for(const row of orderKeys)await tx`DELETE FROM auto_sale_orders WHERE id=${text(row.id)}`;
  const [leadKeys]=await tx`SELECT id FROM auto_sale_leads`;
  for(const row of leadKeys)await tx`DELETE FROM auto_sale_leads WHERE id=${text(row.id)}`;
  const [teamKeys]=await tx`SELECT id FROM auto_sale_team`;
  for(const row of teamKeys)await tx`DELETE FROM auto_sale_team WHERE id=${text(row.id)}`;
  const [catalogKeys]=await tx`SELECT id FROM auto_sale_catalog`;
  for(const row of catalogKeys)await tx`DELETE FROM auto_sale_catalog WHERE id=${text(row.id)}`;

  const empty={initialized:false,leads:[],quotes:[],orders:[],notes:{},team:[],catalog:[]};
  const fullDiff=buildDomainDiff(empty,state);
  await applyDomainDiff(tx,fullDiff,{compatRevision,status});
  return summarizeDomainDiff(fullDiff);
}
