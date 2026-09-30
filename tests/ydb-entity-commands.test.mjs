import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addAutoSaleNote,
  addAutoSalePayment,
  deleteAutoSaleLeadCascade,
  mutateAutoSaleEntity,
  mutateAutoSaleEntityBatch,
  readAutoSaleEntity
} from '../server/ydb-entity-commands.mjs';

const clone=value=>structuredClone(value);
const text=value=>String(value??'').trim();

function makeStores(initial){
  let state=clone(initial);
  const versions=new Map();
  for(const [resource,key] of [['lead','leads'],['quote','quotes'],['order','orders'],['team','team'],['catalog','catalog']]){
    for(const item of state[key]||[])versions.set(resource+':'+item.id,state.revision);
  }
  const domainStore={
    async loadState(){return clone(state)},
    async entityRowVersion(resource,id){return versions.has(resource+':'+id)?versions.get(resource+':'+id):null}
  };
  const legacyStore={
    async commitDomainState(previous,next,{expectedRevision=null,notifications=[]}={}){
      if(expectedRevision!==null&&Number(expectedRevision)!==Number(state.revision)){
        return{status:409,data:{error:'revision_conflict',currentRevision:state.revision,state:clone(state)}};
      }
      const before=state;
      const revision=Number(state.revision)+1;
      state={...clone(next),revision,initialized:true};
      for(const [resource,key] of [['lead','leads'],['quote','quotes'],['order','orders'],['team','team'],['catalog','catalog']]){
        const prev=new Map((before[key]||[]).map(x=>[text(x.id),x]));
        const curr=new Map((state[key]||[]).map(x=>[text(x.id),x]));
        for(const [id,item] of curr){
          const changed=!prev.has(id)||JSON.stringify(prev.get(id))!==JSON.stringify(item);
          if(changed)versions.set(resource+':'+id,revision);
        }
        for(const id of prev.keys())if(!curr.has(id))versions.delete(resource+':'+id);
      }
      const prevNotes=before.notes||{},currNotes=state.notes||{};
      for(const id of new Set([...Object.keys(prevNotes),...Object.keys(currNotes)])){
        if(JSON.stringify(prevNotes[id]||[])!==JSON.stringify(currNotes[id]||[]))versions.set('lead:'+id,revision);
      }
      const prevOrders=new Map((before.orders||[]).map(x=>[text(x.id),x]));
      for(const order of state.orders||[]){
        const old=prevOrders.get(text(order.id));
        if(JSON.stringify(old?.payments||[])!==JSON.stringify(order.payments||[]))versions.set('order:'+order.id,revision);
      }
      return{status:200,data:{ok:true,revision,notifications:{queued:notifications.length,ids:notifications.map(x=>x.id)}}};
    }
  };
  return{legacyStore,domainStore,getState:()=>clone(state),versions};
}

function base(){
  return{
    revision:10,initialized:true,
    leads:[{id:'L-1',name:'Client',contact:'@client',model:'BMW X5',status:'В работе',nextAction:'2026-10-01',source:'Mini App',manager:'Дмитрий'}],
    quotes:[],
    orders:[{id:'O-1',leadId:'L-1',model:'BMW X5',stage:'Выкуп',manager:'Дмитрий',riskType:'Нет',total:1000,cost:900,payments:[],paid:0}],
    notes:{},
    team:[{id:'TM-1',name:'Дмитрий',role:'Менеджер',active:true}],
    catalog:[{id:'CAR-1',brand:'BMW',model:'X5',price:45000,image:'https://example.com/x5.jpg',active:true}]
  };
}

test('entity read returns aggregate row version',async()=>{
  const stores=makeStores(base());
  const result=await readAutoSaleEntity({...stores,resource:'lead',id:'L-1'});
  assert.equal(result.status,200);
  assert.equal(result.data.rowVersion,10);
  assert.equal(result.data.entity.name,'Client');
});

test('lead patch succeeds with row version and stale version conflicts',async()=>{
  const stores=makeStores(base());
  const first=await mutateAutoSaleEntity({
    ...stores,resource:'lead',operation:'patch',id:'L-1',
    expectedRowVersion:10,input:{priority:'Высокий'}
  });
  assert.equal(first.status,200);
  assert.equal(first.data.rowVersion,11);
  assert.equal(stores.getState().leads[0].priority,'Высокий');

  const stale=await mutateAutoSaleEntity({
    ...stores,resource:'lead',operation:'patch',id:'L-1',
    expectedRowVersion:10,input:{priority:'Низкий'}
  });
  assert.equal(stale.status,409);
  assert.equal(stale.data.error,'entity_conflict');
  assert.equal(stale.data.currentRowVersion,11);
});

test('creating a lead does not require global baseRevision',async()=>{
  const stores=makeStores(base());
  const result=await mutateAutoSaleEntity({
    ...stores,resource:'lead',operation:'create',id:'L-2',
    input:{id:'L-2',name:'Second',contact:'@second',model:'Kia K5',status:'Новый',nextAction:'2026-10-02',source:'Mini App'}
  });
  assert.equal(result.status,200);
  assert.equal(result.data.rowVersion,11);
  assert.equal(stores.getState().leads.length,2);
});

test('note append bumps lead aggregate row version',async()=>{
  const stores=makeStores(base());
  const result=await addAutoSaleNote({
    ...stores,leadId:'L-1',expectedRowVersion:10,input:{text:'Новая заметка'}
  });
  assert.equal(result.status,201);
  assert.equal(result.data.rowVersion,11);
  assert.equal(await stores.domainStore.entityRowVersion('lead','L-1'),11);
  assert.equal(stores.getState().notes['L-1'][0].text,'Новая заметка');
});

test('payment append bumps order aggregate row version and recalculates paid',async()=>{
  const stores=makeStores(base());
  const result=await addAutoSalePayment({
    ...stores,orderId:'O-1',expectedRowVersion:10,
    input:{id:'P-1',amount:250,date:'2026-09-29',method:'Банк'}
  });
  assert.equal(result.status,201);
  assert.equal(result.data.rowVersion,11);
  assert.equal(result.data.paid,250);
  assert.equal(await stores.domainStore.entityRowVersion('order','O-1'),11);
  assert.equal(stores.getState().orders[0].paid,250);
});

test('lead delete is refused while dependent order exists',async()=>{
  const stores=makeStores(base());
  const result=await mutateAutoSaleEntity({
    ...stores,resource:'lead',operation:'delete',id:'L-1',expectedRowVersion:10
  });
  assert.equal(result.status,409);
  assert.equal(result.data.error,'lead_has_dependencies');
});

test('admin cascade delete removes lead and all related CRM aggregates',async()=>{
  const initial=base();
  initial.quotes=[{id:'Q-1',leadId:'L-1',model:'BMW X5',status:'Согласован',version:1}];
  initial.orders=[{...initial.orders[0],payments:[{id:'P-1',amount:250,date:'2026-09-30',method:'Банк'}],paid:250}];
  initial.notes={'L-1':[{id:'N-1',text:'Test note',at:'2026-09-30T10:00:00Z'}]};
  const stores=makeStores(initial);
  const result=await deleteAutoSaleLeadCascade({
    ...stores,id:'L-1',expectedRowVersion:10
  });
  assert.equal(result.status,200);
  assert.equal(result.data.operation,'delete-cascade');
  assert.deepEqual(result.data.deleted.quotes,['Q-1']);
  assert.deepEqual(result.data.deleted.orders,['O-1']);
  assert.equal(result.data.deleted.notes,1);
  assert.equal(result.data.deleted.payments,1);
  const state=stores.getState();
  assert.equal(state.leads.length,0);
  assert.equal(state.quotes.length,0);
  assert.equal(state.orders.length,0);
  assert.deepEqual(state.notes,{});
  assert.equal(state.team.length,1);
  assert.equal(state.catalog.length,1);
});

test('cascade lead delete still enforces optimistic row version',async()=>{
  const stores=makeStores(base());
  const result=await deleteAutoSaleLeadCascade({
    ...stores,id:'L-1',expectedRowVersion:9
  });
  assert.equal(result.status,409);
  assert.equal(result.data.error,'entity_conflict');
  assert.equal(stores.getState().leads.length,1);
});

test('catalog item can be patched and deleted by row version',async()=>{
  const stores=makeStores(base());
  const patched=await mutateAutoSaleEntity({
    ...stores,resource:'catalog',operation:'patch',id:'CAR-1',expectedRowVersion:10,input:{active:false}
  });
  assert.equal(patched.status,200);
  assert.equal(patched.data.rowVersion,11);
  const deleted=await mutateAutoSaleEntity({
    ...stores,resource:'catalog',operation:'delete',id:'CAR-1',expectedRowVersion:11
  });
  assert.equal(deleted.status,200);
  assert.equal(stores.getState().catalog.length,0);
});


test('entity batch commits quote lead and note as one versioned operation',async()=>{
  const stores=makeStores(base());
  const result=await mutateAutoSaleEntityBatch({
    ...stores,
    operations:[
      {resource:'quote',operation:'create',id:'Q-1',input:{id:'Q-1',leadId:'L-1',model:'BMW X5',status:'Черновик',version:1}},
      {resource:'lead',operation:'patch',id:'L-1',baseRowVersion:10,input:{status:'Расчёт'}},
      {resource:'note',operation:'create',leadId:'L-1',baseRowVersion:10,input:{id:'N-1',text:'Расчёт создан.'}}
    ]
  });
  assert.equal(result.status,200);
  assert.equal(result.data.revision,11);
  assert.equal(result.data.rowVersions['lead:L-1'],11);
  assert.equal(result.data.rowVersions['quote:Q-1'],11);
  const state=stores.getState();
  assert.equal(state.leads[0].status,'Расчёт');
  assert.equal(state.quotes[0].id,'Q-1');
  assert.equal(state.notes['L-1'][0].text,'Расчёт создан.');
});

test('entity batch rejects stale aggregate version before mutating state',async()=>{
  const stores=makeStores(base());
  const before=stores.getState();
  const result=await mutateAutoSaleEntityBatch({
    ...stores,
    operations:[
      {resource:'lead',operation:'patch',id:'L-1',baseRowVersion:9,input:{priority:'Высокий'}},
      {resource:'note',operation:'create',leadId:'L-1',baseRowVersion:9,input:{id:'N-STALE',text:'Не должно сохраниться'}}
    ]
  });
  assert.equal(result.status,409);
  assert.equal(result.data.error,'entity_conflict');
  assert.equal(result.data.currentRowVersion,10);
  assert.deepEqual(stores.getState(),before);
});

test('entity batch allows child operation on aggregate created in the same batch',async()=>{
  const stores=makeStores(base());
  const result=await mutateAutoSaleEntityBatch({
    ...stores,
    operations:[
      {resource:'lead',operation:'create',id:'L-NEW',input:{id:'L-NEW',name:'New',contact:'@new',model:'Kia K5',status:'Новый',nextAction:'2026-10-03',source:'Mini App'}},
      {resource:'note',operation:'create',leadId:'L-NEW',input:{id:'N-NEW',text:'Лид создан.'}}
    ]
  });
  assert.equal(result.status,200);
  assert.equal(result.data.rowVersions['lead:L-NEW'],11);
  assert.equal(stores.getState().notes['L-NEW'][0].text,'Лид создан.');
});
