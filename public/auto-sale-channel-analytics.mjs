const clean=value=>String(value??'').trim();
const timestamp=value=>{
  const raw=clean(value);if(!raw)return null;
  const time=Date.parse(raw);return Number.isFinite(time)?time:null;
};

export function leadChannel(lead={}){
  const provider=clean(lead.acquisitionChannel||lead.clientProvider).toLowerCase();
  if(provider==='vk')return'ВКонтакте';
  if(provider==='telegram'||clean(lead.telegramUserId))return'Telegram';
  const source=clean(lead.source);
  return /^(vk|вк|вконтакте)$/i.test(source)?'ВКонтакте':source||'Не указан';
}

export function channelSourceStats(leads=[],orders=[]){
  const byLead=new Map(leads.map(lead=>[lead.id,lead]));
  const groups=new Map();
  const group=label=>{
    if(!groups.has(label))groups.set(label,{source:label,leads:0,deals:0,conversion:0});
    return groups.get(label);
  };
  for(const lead of leads)group(leadChannel(lead)).leads++;
  for(const order of orders)group(leadChannel(byLead.get(order.leadId)||order)).deals++;
  return [...groups.values()].map(row=>({...row,conversion:row.leads?Math.round(row.deals/row.leads*100):0})).sort((a,b)=>b.leads-a.leads);
}

export function channelResponseStats(leads=[],{now=Date.now(),waitingMinutes=30}={}){
  const groups=new Map();
  for(const lead of leads){
    const label=leadChannel(lead);
    if(!groups.has(label))groups.set(label,{channel:label,total:0,waiting:0,waitingOverLimit:0,measured:0,unmeasured:0,responseMinutes:[],waitingLeadIds:[]});
    const row=groups.get(label);row.total++;
    const submitted=timestamp(lead.clientSubmittedAt),action=timestamp(lead.firstManagerActionAt);
    if(submitted!==null&&action!==null&&action>=submitted&&action<=now){
      row.measured++;row.responseMinutes.push((action-submitted)/60_000);
    }else if(submitted===null||action!==null||clean(lead.status)!=='Новый')row.unmeasured++;
    if(clean(lead.status)==='Новый'&&action===null){
      row.waiting++;row.waitingLeadIds.push(lead.id);
      const start=submitted??timestamp(lead.createdAt);
      if(start!==null&&now-start>=waitingMinutes*60_000)row.waitingOverLimit++;
    }
  }
  return [...groups.values()].map(({responseMinutes,...row})=>({...row,
    averageResponseMinutes:responseMinutes.length?responseMinutes.reduce((a,b)=>a+b,0)/responseMinutes.length:null
  })).sort((a,b)=>b.total-a.total);
}

export function responseTimeLabel(minutes){
  if(minutes===null||!Number.isFinite(minutes))return'Нет измерений';
  if(minutes<1)return'< 1 мин';
  if(minutes<60)return`${Math.round(minutes)} мин`;
  if(minutes<1440)return`${(minutes/60).toFixed(1)} ч`;
  return`${(minutes/1440).toFixed(1)} дн`;
}
