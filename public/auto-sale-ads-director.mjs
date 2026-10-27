// Small read-only director panel. Render all campaign identifiers as textContent.
// Only loaded after a signed Telegram admin session was explicitly allowed by the server.
export function mountAdsDirectorReport({root,documentObj,fetchImpl,authHeaders}={}){
  if(!root||!documentObj||typeof fetchImpl!=='function'
    ||typeof authHeaders!=='function')throw new Error('invalid_ads_director_panel_dependencies');
  const panel=documentObj.createElement('details');
  panel.className='awg-ads-director-report';
  panel.style.cssText='margin:16px 0;padding:16px;border:1px solid #42505e;border-radius:14px';
  const summary=documentObj.createElement('summary');
  summary.textContent='Рекламная аналитика Telegram Ads';
  summary.style.cursor='pointer';
  panel.append(summary);
  const status=documentObj.createElement('p');
  status.textContent='Откройте раздел для загрузки проверенных данных.';
  panel.append(status);
  const body=documentObj.createElement('div');
  panel.append(body);
  let loading=false;
  async function read(){
    if(loading)return;
    loading=true;
    status.textContent='Загрузка рекламных кампаний…';
    try{
      const response=await fetchImpl('/api/auto-sale/ads/director-report',{
        method:'GET',headers:authHeaders({accept:'application/json'}),
        cache:'no-store'
      });
      if(!response.ok)throw new Error('ads_report_http_'+response.status);
      const data=await response.json();
      if(!Array.isArray(data.rows))throw new Error('invalid_ads_report');
      const columns=[
        ['campaignId','Кампания'],['botStarts','Запуски бота'],
        ['miniappOpens','Открытия Mini App'],['vehicleViews','Просмотры авто'],
        ['leadSubmissions','Заявки'],['managerContacts','Контакты менеджера'],
        ['costPerLead','CPL']
      ];
      const table=documentObj.createElement('table');
      table.className='auto-data-table mini';
      const thead=documentObj.createElement('thead'),tr=documentObj.createElement('tr');
      for(const [,label] of columns){
        const th=documentObj.createElement('th');th.textContent=label;tr.append(th);
      }
      thead.append(tr);table.append(thead);
      const tbody=documentObj.createElement('tbody');
      for(const row of data.rows){
        const tr=documentObj.createElement('tr');
        for(const [key] of columns){
          const td=documentObj.createElement('td'),v=row[key];
          td.textContent=key==='costPerLead'
            ?v&&Number.isFinite(v.amount)?v.amount.toFixed(2)+' '+v.currency:'—'
            :String(v??'—');
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);body.replaceChildren(table);
      status.textContent=data.rows.length
        ?'Отчёт по подтверждённым серверным событиям. Оплаченные клики и расходы пока не подключены.'
        :'Подтверждённых рекламных событий пока нет.';
    }catch{
      status.textContent='Не удалось загрузить отчёт. Повторите открытие раздела.';
      body.replaceChildren();
    }finally{loading=false;}
  }
  panel.addEventListener('toggle',()=>{if(panel.open)void read()});
  const attach=()=>{if(!root.contains(panel))root.append(panel)};
  attach();
  const Observer=documentObj.defaultView?.MutationObserver;
  const observer=Observer?new Observer(attach):null;
  if(observer)observer.observe(root,{childList:true});
  return ()=>{observer?.disconnect();panel.remove()};
}
