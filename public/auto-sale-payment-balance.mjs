// Monetary checks use integer minor units. The ledger is authoritative when
// payment rows exist; order.paid is a legacy compatibility cache.
export function usdCents(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.round(n*100):0;
}
export function paymentLedgerCents(payments=[]){
  return (Array.isArray(payments)?payments:[]).reduce((sum,item)=>sum+Math.max(0,usdCents(item?.amount)),0);
}
export function orderPaymentBalance(order={},pendingAmount=0){
  const totalCents=Math.max(0,usdCents(order?.total));
  const records=Array.isArray(order?.payments)?order.payments:[];
  const paidCents=records.length?paymentLedgerCents(records):Math.max(0,usdCents(order?.paid));
  const projectedCents=paidCents+Math.max(0,usdCents(pendingAmount));
  const remainingCents=Math.max(0,totalCents-projectedCents);
  return{
    totalCents,paidCents,projectedCents,remainingCents,
    paid:paidCents/100,remaining:remainingCents/100,
    fullyPaid:totalCents>0&&remainingCents===0,
    overpaid:projectedCents>totalCents
  };
}
const dollarFormatter=new Intl.NumberFormat('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});
export function usdMoney(value){return '$'+dollarFormatter.format(usdCents(value)/100);}

 
// Auction advance is a configurable share of the AGREED contract price.
// Existing paid deposits are preserved and expressed as a percentage instead
// of silently replacing their historical amount with the new 50% default.
export const DEFAULT_AUCTION_ADVANCE_PERCENT = 50;
export function advancePercentForLead(lead={},agreedTotal=0){
  if(lead.depositPercent!==undefined&&lead.depositPercent!==null&&String(lead.depositPercent)!=='')
    return Number(lead.depositPercent);
  const total=usdCents(agreedTotal),paid=usdCents(lead.deposit);
  if(total>0&&paid>0)return Number((paid/total*100).toFixed(6));
  return DEFAULT_AUCTION_ADVANCE_PERCENT;
}
export function advanceAmountFromPercent(agreedTotal,percent){
  const total=usdCents(agreedTotal),pct=Number(percent);
  if(total<=0||!Number.isFinite(pct)||pct<=0||pct>100)return 0;
  return Math.round(total*pct/100)/100;
}
export function validAdvancePercent(percent){
  const pct=Number(percent);
  return Number.isFinite(pct)&&pct>0&&pct<=100;
}
