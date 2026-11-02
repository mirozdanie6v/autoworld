// Optional, session-only behavior analytics. Never stores names, contact details or Telegram IDs.
const API='/api/auto-sale/visitor-analytics';
const sessionId=crypto.randomUUID().replace(/-/g,'');
const labels={
 app_open:'Открытие Mini App',catalog_open:'Каталог',car_open:'Карточка автомобиля',
 photo_view:'Фотография',filter_change:'Изменение фильтра',
 request_open:'Открытие заявки',request_attempt:'Попытка отправки',
 request_success:'Заявка отправлена',request_failure:'Ошибка отправки'
};
let enabled=false,configChecked=false,configPending=false,queue=[],timer=0,reportCache=null,reportAt=0;
const access=()=>window.__AUTO_SALE_ACCESS__||{};
const headers=()=>window.__AUTO_SALE_AUTH_HEADERS__?.({'content-type':'application/json'})||{'content-type':'application/json'};
const clientAllowed=()=>access().role==='client'&&access().authenticated===true;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function flush(){
 if(!enabled||!clientAllowed()||!queue.length)return;
 const pending=queue.splice(0,20);
 try{
  const response=await fetch(API+'/events',{method:'POST',headers:headers(),body:JSON.stringify({sessionId,events:pending}),keepalive:true,cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(response.status===403||response.status===503)enabled=false;
 }catch{/* Telemetry is best-effort and must never interrupt applications or quotes. */}
 if(queue.length)timer=setTimeout(()=>{void flush()},1000);
}
export function trackVisitorEvent(type,carId=''){
 if(!enabled||!clientAllowed()||!Object.hasOwn(labels,type))return;
 const safeCar=String(carId||'');
 queue.push({eventId:crypto.randomUUID().replace(/-/g,''),type,carId:/^[a-zA-Z0-9_:-]{1,100}$/.test(safeCar)?safeCar:''});
 if(queue.length>=20){clearTimeout(timer);void flush();return}
 clearTimeout(timer);timer=setTimeout(()=>{void flush()},1100);
}
export async function ensureVisitorTracking(){
 if(configChecked||configPending||!clientAllowed())return;
 configPending=true;
 try{
  const response=await fetch(API+'/config',{cache:'no-store',signal:AbortSignal.timeout(5000)});
  const config=response.ok?await response.json():{};
  enabled=config.enabled===true;
  configChecked=true;
  if(enabled)trackVisitorEvent('app_open');
 }catch{configChecked=true}
 finally{configPending=false}
}
document.addEventListener('click',event=>{
 if(!enabled||!clientAllowed())return;
 const target=event.target;
 if(!(target instanceof Element))return;
 const car=target.closest('[data-detail],[data-extra-detail],[data-car-photo-detail],.auto-car .auto-car-media');
 if(car){const card=car.closest('.auto-car');trackVisitorEvent('car_open',car.dataset.detail||car.dataset.extraDetail||car.dataset.carPhotoDetail||card?.querySelector('[data-detail]')?.dataset.detail||'');return}
 const slide=target.closest('[data-car-slide-next],[data-car-slide-prev],[data-car-slide-thumb]');
 if(slide){const modal=slide.closest('[data-car-detail-bg]');trackVisitorEvent('photo_view',modal?.querySelector('[data-car-detail-request]')?.dataset.carDetailRequest||'');return}
 const request=target.closest('[data-request-car],[data-car-detail-request],[data-open-request]');
 if(request){trackVisitorEvent('request_open',request.dataset.requestCar||request.dataset.carDetailRequest||'');return}
 const catalog=target.closest('[data-go="catalog"]');
 if(catalog)trackVisitorEvent('catalog_open');
},true);
document.addEventListener('change',event=>{
 if(!enabled||!clientAllowed())return;
 if(['brandFilter','originFilter','budgetFilter','autoSearch'].includes(event.target?.id))trackVisitorEvent('filter_change');
},true);
document.addEventListener('submit',event=>{
 if(event.target?.id!=='requestForm')return;
 trackVisitorEvent('request_attempt',event.target?.elements?.carId?.value||'');
},true);
window.addEventListener('pagehide',()=>{if(enabled&&queue.length)void flush()});
export function visitorAnalyticsPanelShell(){
 return '<section class="auto-section" data-awg-analytics-panel><div class="auto-section-head"><div><span class="auto-eyebrow">ПОВЕДЕНИЕ ПОСЕТИТЕЛЕЙ</span><h2>Активность в Mini App</h2></div><button class="auto-btn ghost" type="button" data-awg-analytics-refresh>Обновить</button></div><article class="auto-panel"><div data-awg-analytics-report aria-live="polite">Получаем статистику…</div></article></section>';
}
function metric(title,value,note){
 return '<div class="auto-kpi"><span>'+esc(title)+'</span><b>'+esc(value)+'</b><small>'+esc(note||'')+'</small></div>';
}
function row(title,value){
 return '<div class="auto-data-row static"><span><b>'+esc(title)+'</b></span><span>'+esc(value)+'</span></div>';
}
function renderReport(report){
 const c=report.counts||{},opens=Number(c.app_open||0),success=Number(c.request_success||0),conv=opens?Math.round(success/opens*1000)/10:0;
 const kpis='<div class="auto-kpis auto-kpis-admin">'+
  metric('Сессии',report.sessions,'Не уникальные люди')+
  metric('Карточки',c.car_open||0,'Открытия')+
  metric('Галерея',c.photo_view||0,'Переключения фото')+
  metric('Заявки',success,'Подтверждённые в интерфейсе')+
  metric('Конверсия',conv+'%','От открытий приложения')+'</div>';
 const flow=['app_open','catalog_open','car_open','request_open','request_attempt','request_success','request_failure']
  .map(k=>row(labels[k],c[k]||0)).join('');
 const cars=(report.topCars||[]).map(car=>row('ID '+car.carId,car.views+' просмотров')).join('')||'<p>Просмотров пока нет.</p>';
 const sources=(report.sources||[]).map(s=>row(s.source,s.opens+' открытий')).join('')||'<p>Нет данных.</p>';
 const sessions=(report.recentSessions||[]).slice(0,10).map(s=>{
  const steps=s.events.slice(-8).map(e=>esc(labels[e.type]||e.type)+(e.carId?' · '+esc(e.carId):'')).join(' → ');
  return '<div class="auto-data-row static"><span><b>Сессия '+esc(s.sessionId)+'</b><small>'+steps+'</small></span></div>';
 }).join('')||'<p>История пока пуста.</p>';
 return '<p>Последние '+esc(report.days)+' дней · статистика анонимных сессий. Рекламные кампании будут связаны только после проверки атрибуции.</p>'+
  (report.limited?'<p>Показаны не все события: достигнут лимит отчёта.</p>':'')+kpis+
  '<div class="auto-panel-grid admin"><div><h3>Воронка действий</h3><div class="auto-data-table mini">'+flow+'</div></div>'+
  '<div><h3>Популярные автомобили</h3><div class="auto-data-table mini">'+cars+'</div></div></div>'+
  '<div class="auto-panel-grid admin"><div><h3>Источники запуска</h3><div class="auto-data-table mini">'+sources+'</div></div>'+
  '<div><h3>Последние сессии</h3><div class="auto-data-table mini">'+sessions+'</div></div></div>';
}
export async function hydrateVisitorAnalytics(root,{force=false}={}){
 if(access().role!=='admin')return;
 const target=root.querySelector('[data-awg-analytics-report]');
 if(!target)return;
 if(!force&&reportCache&&Date.now()-reportAt<30000){target.innerHTML=renderReport(reportCache);return}
 try{
  const response=await fetch(API+'/report?days=7',{headers:headers(),cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(response.status===503){if(target.isConnected)target.textContent='Аналитика пока отключена. Включение — после проверки отдельной тестовой YDB.';return}
  if(!response.ok){if(target.isConnected)target.textContent='Не удалось получить статистику (HTTP '+response.status+').';return}
  const report=await response.json();reportCache=report;reportAt=Date.now();
  if(target.isConnected)target.innerHTML=renderReport(report);
 }catch{if(target.isConnected)target.textContent='Сервис аналитики временно недоступен. Работа с заявками продолжается.'}
}
document.addEventListener('click',event=>{
 const btn=event.target?.closest?.('[data-awg-analytics-refresh]');
 if(btn)void hydrateVisitorAnalytics(document,{force:true});
});
