import test from 'node:test';
import assert from 'node:assert/strict';
import {canSafelyRebaseEntityBatch as safe} from '../public/auto-sale-entity-safe-retry.mjs';

const order=(override={})=>({
  id:'O1',leadId:'L1',origin:'Грузия',stage:'Доставка',
  total:12000,paid:6801,manager:'Дмитрий',location:'Тбилиси',
  paymentPlan:[],payments:[{id:'PAY-1',amount:6801,method:'Банк'}],...override
});
const lead=(override={})=>({id:'L1',name:'Клиент',status:'Сделка',manager:'Дмитрий',...override});
const state=(o=order(),l=lead(),notes={L1:[]})=>({orders:[o],leads:[l],notes,quotes:[],team:[],catalog:[]});
const payment={resource:'payment',operation:'create',orderId:'O1',input:{id:'PAY-2',amount:5199,date:'2026-10-27',method:'Наличные'}};
const note={resource:'note',operation:'create',leadId:'L1',input:{id:'NOTE-2',text:'Новая заметка'}};

test('payment retry is safe after unrelated metadata change, for US and Georgia',()=>{
  for(const origin of ['США','Грузия']){
    const before=state(order({origin}),lead());
    const after=state(order({origin,location:'Новый склад'}),lead());
    assert.equal(safe([payment],before,after),true,origin);
  }
});
test('payment retry refuses concurrent balance, plan, stage changes or duplicate IDs',()=>{
  const before=state();
  const cases=[
    order({paid:7000}),
    order({payments:[...order().payments,{id:'PAY-2',amount:100}]}),
    order({total:11000}),
    order({paymentPlan:[{id:'custom',amount:12000}]}),
    order({stage:'Выдача'})
  ];
  for(const afterOrder of cases)assert.equal(safe([payment],before,state(afterOrder)),false);
  assert.equal(safe([{...payment,input:{...payment.input,amount:6000}}],before,state()),false);
  assert.equal(safe([{...payment,input:{...payment.input,id:''}}],before,state()),false);
});
test('batch can rebase unrelated lead note but cannot overwrite another manager',()=>{
  const before=state();
  const after=state(order(),lead({name:'Клиент'}),{L1:[{id:'NOTE-OTHER',text:'Коллега добавил заметку'}]});
  const ops=[{resource:'lead',operation:'patch',id:'L1',input:{status:'Сделка'}} ,note];
  assert.equal(safe(ops,before,after),true);
  assert.equal(safe([{resource:'lead',operation:'patch',id:'L1',input:{manager:'Анна'}}],
    before,state(order(),lead({manager:'Максим'}))),false);
  assert.equal(safe([note],before,state(order(),lead(),{L1:[note.input]})),false);
});
test('order and quote updates cannot silently overwrite concurrent edits',()=>{
  const before=state(order());
  const patch={resource:'order',operation:'patch',id:'O1',input:{location:'Новороссийск',updatedAt:'2026-10-27T08:00:00Z'}};
  assert.equal(safe([patch],before,state(order({paid:6801,manager:'Анна'}))),true);
  assert.equal(safe([patch],before,state(order({location:'Москва'}))),false);
  const old={...before,quotes:[{id:'Q1',status:'Черновик',service:100}]};
  const next={...before,quotes:[{id:'Q1',status:'Черновик',service:120}]};
  assert.equal(safe([{resource:'quote',operation:'patch',id:'Q1',input:{service:150}}],old,next),false);
});
test('create/delete/replayed child operations remain guarded',()=>{
  const before=state(),after=state();
  assert.equal(safe([{resource:'order',operation:'delete',id:'O1'}],before,after),false);
  assert.equal(safe([{resource:'lead',operation:'create',id:'L2',input:{name:'Тест'}}],before,after),true);
  assert.equal(safe([{resource:'lead',operation:'create',id:'L1',input:{name:'Тест'}}],before,after),false);
  assert.equal(safe([{resource:'payment',operation:'create',orderId:'O1',input:{...payment.input,id:'PAY-1'}}],before,after),false);
  assert.equal(safe([],before,after),false);
});
