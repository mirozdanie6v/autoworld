// Only replay a version-conflicted entity batch if its intended fields remain
// identical to the snapshot the user actually edited. Never turn a stale
// payment, deletion, or competing edit into a silent overwrite.
const collection={lead:'leads',quote:'quotes',order:'orders',team:'team',catalog:'catalog'};
const entity=(state,resource,id)=>(state?.[collection[resource]]||[]).find(x=>String(x.id)===String(id))||null;
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const list=value=>Array.isArray(value)?value:[];
const id=value=>String(value??'').trim();
const childId=operation=>id(operation?.input?.id);

export function canSafelyRebaseEntityBatch(operations=[],before={},after={}){
  if(!before||!after||!Array.isArray(operations)||operations.length===0)return false;
  for(const operation of operations){
    const resource=String(operation?.resource||''),op=String(operation?.operation||'');
    const input=operation?.input||{};
    if(resource==='payment'){
      if(op!=='create')return false;
      const orderId=id(operation.orderId||operation.id),old=entity(before,'order',orderId),live=entity(after,'order',orderId);
      if(!old||!live||!childId(operation))return false;
      // A payment may affect the outstanding balance and its installment.
      // Never retry against an order that received another payment or change
      // to its financial plan/stage after this form was opened.
      if(!same(old.payments,live.payments)||!same(old.paid,live.paid)
        ||!same(old.total,live.total)||!same(old.paymentPlan,live.paymentPlan)
        ||!same(old.stage,live.stage))return false;
      if(list(live.payments).some(p=>id(p.id)===childId(operation)))return false;
      const amount=Number(input.amount);
      if(!Number.isFinite(amount)||amount<=0||amount>Number(live.total||0)-Number(live.paid||0)+0.0001)return false;
      continue;
    }
    if(resource==='note'){
      if(op!=='create')return false;
      const leadId=id(operation.leadId||operation.id);
      if(!entity(before,'lead',leadId)||!entity(after,'lead',leadId)||!childId(operation))return false;
      if(list(after.notes?.[leadId]).some(note=>id(note.id)===childId(operation)))return false;
      continue;
    }
    if(!collection[resource])return false;
    const entityId=id(operation.id||input.id),old=entity(before,resource,entityId),live=entity(after,resource,entityId);
    if(op==='create'){
      if(old||live||!entityId)return false;
      continue;
    }
    // Explicit deletions require the operator to reconfirm after a conflict.
    if(op!=='patch'||!old||!live)return false;
    if(resource==='quote'&&['agreed','changes_requested'].includes(String(input.clientDecision||''))){
      // Client consent applies to the complete quote they saw, not merely
      // the status. Never silently approve a different price, version or
      // manager-edited vehicle after an optimistic-version conflict.
      if(!same(old,live))return false;
    }
    for(const [field,value] of Object.entries(input)){
      if(field==='id'||field==='updatedAt')continue;
      // If a concurrently edited field differs, abort instead of overwriting.
      if(!same(old[field],live[field])&&!same(live[field],value))return false;
    }
  }
  return true;
}
