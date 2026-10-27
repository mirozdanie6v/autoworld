import test from 'node:test';
import assert from 'node:assert/strict';
import {advancePercentForLead,advanceAmountFromPercent,validAdvancePercent} from '../public/auto-sale-payment-balance.mjs';
import {canCreateOrder,buildUsPaymentPlan,paymentPlanTotal,paymentsTotal} from '../public/auto-sale-business-rules.mjs';
import {validateOrder} from '../server/auto-sale-rules.mjs';
import {syncYdbState} from '../server/ydb-sync.mjs';

const preliminary={id:'Q-US',leadId:'L-US',status:'Согласован',origin:'США',model:'Audi Q3',version:1,
  quoteSchema:'awg-quote-us-simple-2026-10-26',tariffVersion:'2026-10-26-us-car-plus-repair',
  lot:50172.92,repair:1000,total:51172.92};
const lead={id:'L-US',name:'Client',contact:'@client',model:'Audi Q3',origin:'США',
  status:'Ожидает клиента',nextAction:'2026-10-30',deposit:0};

test('new USA order advance starts at 50 percent and calculates exact cents',()=>{
  assert.equal(advancePercentForLead(lead,60000),50);
  assert.equal(advanceAmountFromPercent(60000,50),30000);
  assert.equal(advanceAmountFromPercent(51172.92,50),25586.46);
  assert.equal(advanceAmountFromPercent(51172.92,40),20469.17);
  assert.equal(validAdvancePercent(0),false);
  assert.equal(validAdvancePercent(100),true);
  assert.equal(validAdvancePercent(101),false);
});

test('existing $30,000 payment remains unchanged and its percentage can be edited',()=>{
  const percent=advancePercentForLead({...lead,deposit:30000},51172.92);
  assert.equal(advanceAmountFromPercent(51172.92,percent),30000);
  assert.equal(advancePercentForLead({...lead,depositPercent:30,deposit:30000},60000),30);
});

test('USA contract creation accepts $30,000 at 50% of $60,000 even with $51,172.92 preliminary quote',()=>{
  const eligibility=canCreateOrder({quote:preliminary,agreedOrderTotal:60000,deposit:30000,depositPercent:50});
  assert.equal(eligibility.ok,true,eligibility.reason);
  assert.equal(canCreateOrder({quote:preliminary,agreedOrderTotal:60000,deposit:25000,depositPercent:50}).ok,false);
  assert.equal(canCreateOrder({quote:preliminary,agreedOrderTotal:60000,deposit:30000,depositPercent:101}).ok,false);
  assert.equal(canCreateOrder({quote:{status:'Согласован',origin:'Грузия',total:30000},deposit:1000}).ok,true);
});

test('50% USA payment plan totals to agreed contract cents, regardless of preliminary cost',()=>{
  const plan=buildUsPaymentPlan({...preliminary,total:51172.92},25586.46);
  assert.equal(plan.length,4);
  assert.equal(plan[0].amount,25586.46);
  assert.equal(paymentPlanTotal(plan),51172.92);
});

function mockStore(initial){
  let state=structuredClone(initial);
  return {
    async loadState(){return structuredClone(state)},
    async replaceState(next){state={...structuredClone(next),revision:(state.revision||1)+1};return{status:200,data:{ok:true,revision:state.revision}}}
  };
}
test('YDB approves a real 50% contract-price order; rejects a mismatched contract total',async()=>{
  const recordedLead={...lead,status:'Ожидает клиента',deposit:30000,depositPercent:50,
    agreedOrderTotal:60000,depositDate:'2026-10-27',paymentMethod:'Банк'};
  const initial={revision:7,initialized:true,leads:[recordedLead],quotes:[preliminary],orders:[],notes:{},catalog:[],team:[]};
  const order={id:'O-US',leadId:lead.id,model:'Audi Q3',origin:'США',stage:'Выкуп',
    total:60000,cost:60000,paid:30000,
    paymentPlan:buildUsPaymentPlan({...preliminary,total:60000},30000),
    payments:[{id:'PAY-1',amount:30000,date:'2026-10-27',method:'Банк',paymentStage:'auction_deposit'}]};
  assert.deepEqual(validateOrder(order),[]);
  assert.equal(paymentsTotal(order.payments),30000);
  const store=mockStore(initial);
  const updated={...structuredClone(initial),baseRevision:7,
    leads:[{...recordedLead,status:'Сделка'}],orders:[order]};
  const ok=await syncYdbState(store,updated);
  assert.equal(ok.status,200,JSON.stringify(ok.data));
  const other=mockStore(initial);
  const mismatched=structuredClone(updated);mismatched.orders[0].total=51172.92;
  mismatched.orders[0].paymentPlan=buildUsPaymentPlan({...preliminary,total:51172.92},30000);
  const denied=await syncYdbState(other,mismatched);
  assert.equal(denied.status,400);
  assert.equal(denied.data.error,'agreed_order_total_mismatch');
});
