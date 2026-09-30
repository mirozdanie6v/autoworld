export const ORDER_STAGES = ['Запрос','Подбор','Расчёт','Согласование','Выкуп','Подготовка к отправке','В пути','Таможня','Доставка','Выдача'];
const LEGACY_ORDER_STAGES={'Порт США':'Подготовка к отправке','В море':'В пути'};
export const normalizeOrderStage=stage=>LEGACY_ORDER_STAGES[stage]||stage;
export const LEAD_STATUSES = ['Новый','В работе','Расчёт','Ожидает клиента','Сделка','Отказ'];
export const MANAGERS = [];
export const SOURCES = ['Telegram','Instagram','Сайт','Рекомендации','WhatsApp'];

const n = value => Number(value) || 0;

export const seedLeads = () => [];
export const seedQuotes = () => [];
export const seedOrders = () => [];

export function calculateQuote(parts = {}) {
  return ['lot','auction','inland','ocean','customs','repair','service'].reduce((sum,key)=>sum+n(parts[key]),0);
}

export function quoteCost(parts = {}) {
  return ['lot','auction','inland','ocean','customs','repair'].reduce((sum,key)=>sum+n(parts[key]),0);
}

export function orderMargin(order = {}) {
  return n(order.total) - n(order.cost);
}

export function nextId(prefix, items = []) {
  const max = items.reduce((m,item)=>{
    const hit = String(item.id || '').match(/(\d+)$/);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}-${max + 1}`;
}

export function orderStageIndex(stage) {
  const idx = ORDER_STAGES.indexOf(normalizeOrderStage(stage));
  return idx < 0 ? 0 : idx;
}

export function nextOrderStage(stage) {
  return ORDER_STAGES[Math.min(orderStageIndex(stage)+1, ORDER_STAGES.length-1)];
}

export function leadStage(status) {
  const map = {
    'Новый':'Запрос',
    'В работе':'Подбор',
    'Расчёт':'Расчёт',
    'Ожидает клиента':'Согласование',
    'Сделка':'Выкуп',
    'Отказ':'Запрос'
  };
  return map[status] || 'Запрос';
}

export function clientStage(lead, order) {
  return order?.stage ? normalizeOrderStage(order.stage) : leadStage(lead?.status);
}

export function filterLeads(leads = [], filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  return leads.filter(lead => {
    const hay = `${lead.id} ${lead.name} ${lead.contact} ${lead.model}`.toLowerCase();
    return (!query || hay.includes(query)) &&
      (!filters.status || filters.status === 'all' || lead.status === filters.status) &&
      (!filters.source || filters.source === 'all' || lead.source === filters.source) &&
      (!filters.manager || filters.manager === 'all' || lead.manager === filters.manager);
  });
}

export function filterOrders(orders = [], filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  return orders.filter(order => {
    const hay = `${order.id} ${order.customer} ${order.model} ${order.vin} ${order.lot}`.toLowerCase();
    return (!query || hay.includes(query)) &&
      (!filters.stage || filters.stage === 'all' || normalizeOrderStage(order.stage) === normalizeOrderStage(filters.stage)) &&
      (!filters.manager || filters.manager === 'all' || order.manager === filters.manager) &&
      (!filters.risk || filters.risk === 'all' || (filters.risk === 'risk' ? order.risk !== 'Нет' : order.risk === 'Нет'));
  });
}

export function sourceStats(leads = [], orders = []) {
  const sources = [...new Set([...SOURCES, ...leads.map(x=>x.source).filter(Boolean)])];
  return sources.map(source => {
    const leadCount = leads.filter(x=>x.source===source).length;
    const deals = orders.filter(x=>x.source===source).length;
    return {source, leads:leadCount, deals, conversion:leadCount ? Math.round(deals/leadCount*100) : 0};
  }).filter(x=>x.leads || x.deals).sort((a,b)=>b.leads-a.leads);
}

export function managerStats(leads = [], orders = []) {
  const managers = [...new Set([...MANAGERS, ...leads.map(x=>x.manager).filter(Boolean)])];
  return managers.map(manager => {
    const ownedLeads = leads.filter(x=>x.manager===manager);
    const active = ownedLeads.filter(x=>!['Сделка','Отказ'].includes(x.status)).length;
    const deals = orders.filter(x=>x.manager===manager);
    const revenue = deals.reduce((sum,x)=>sum+n(x.total),0);
    const margin = deals.reduce((sum,x)=>sum+orderMargin(x),0);
    return {manager, leads:ownedLeads.length, active, deals:deals.length, revenue, margin};
  }).sort((a,b)=>b.revenue-a.revenue);
}

export function financeStats(orders = []) {
  const turnover = orders.reduce((sum,x)=>sum+n(x.total),0);
  const cost = orders.reduce((sum,x)=>sum+n(x.cost),0);
  const paid = orders.reduce((sum,x)=>sum+n(x.paid),0);
  const margin = turnover - cost;
  return {turnover,cost,paid,margin,outstanding:Math.max(0,turnover-paid),avgCheck:orders.length?Math.round(turnover/orders.length):0,marginPct:turnover?Math.round(margin/turnover*1000)/10:0};
}

export function dashboardStats(leads = [], orders = [], quotes = []) {
  const activeLeads = leads.filter(x=>!['Сделка','Отказ'].includes(x.status)).length;
  const newLeads = leads.filter(x=>x.status==='Новый').length;
  const waiting = leads.filter(x=>x.status==='Ожидает клиента').length;
  const inTransit = orders.filter(x=>!['Запрос','Подбор','Расчёт','Согласование','Выдача'].includes(x.stage)).length;
  const risky = orders.filter(x=>x.risk && x.risk!=='Нет').length;
  const wonLeadIds = new Set(orders.map(x=>x.leadId).filter(Boolean));
  const conversion = leads.length ? Math.round(wonLeadIds.size/leads.length*100) : 0;
  const openQuotes = quotes.filter(x=>!['Согласован','Отказ'].includes(x.status)).length;
  return {activeLeads,newLeads,waiting,inTransit,risky,conversion,openQuotes,deals:orders.length};
}

export function funnelStats(leads = [], orders = []) {
  const counts = {
    'Лиды': leads.length,
    'В работе': leads.filter(x=>['В работе','Расчёт','Ожидает клиента','Сделка'].includes(x.status)).length,
    'Расчёт': leads.filter(x=>['Расчёт','Ожидает клиента','Сделка'].includes(x.status)).length,
    'Согласовано': leads.filter(x=>['Ожидает клиента','Сделка'].includes(x.status)).length,
    'Сделки': new Set(orders.map(x=>x.leadId).filter(Boolean)).size
  };
  return Object.entries(counts).map(([label,value])=>({label,value}));
}

export function lostReasons(leads = []) {
  const lost = leads.filter(x=>x.status==='Отказ');
  const map = new Map();
  for (const lead of lost) {
    const reason = lead.lostReason || 'Причина не указана';
    map.set(reason,(map.get(reason)||0)+1);
  }
  return [...map.entries()].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count);
}
