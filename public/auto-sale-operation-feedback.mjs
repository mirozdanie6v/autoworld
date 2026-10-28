// Unified, server-acknowledged feedback for AutoWorld entity operations.
// UI-only: no schema, payment arithmetic, lifecycle or backend changes.
export function describeOperation(operations=[]) {
  const ops=Array.isArray(operations)?operations:[];
  const has=(resource,operation)=>ops.some(x=>x?.resource===resource&&(!operation||x.operation===operation));
  if(!ops.length||ops.every(x=>x?.resource==='note'))return null;
  const first=ops.find(x=>x?.resource!=='note')||ops[0];
  const identity=String(first?.orderId||first?.id||'');
  if(has('order','create'))return {kind:'modal',key:'order-create:'+identity,title:'Создаём заказ',success:'Заказ создан',detail:'Проверяем и сохраняем данные сделки'};
  if(has('payment','create'))return {kind:'modal',key:'payment:'+identity,title:'Регистрируем платёж',success:'Платёж зарегистрирован',detail:'Ожидаем подтверждения записи на сервере'};
  if(ops.some(x=>x?.resource==='order'&&x.operation==='patch'&&Object.hasOwn(x.input||{},'stage')))
    return {kind:'modal',key:'order-stage:'+identity,title:'Обновляем этап заказа',success:'Этап заказа обновлён',detail:'Проверяем условия перехода и сохраняем изменения'};
  if(has('quote'))return {kind:'inline',key:'quote:'+identity,title:'Сохраняем расчёт',success:'Расчёт сохранён'};
  if(has('lead','create'))return {kind:'inline',key:'lead-create:'+identity,title:'Отправляем заявку',success:'Заявка создана'};
  if(has('lead'))return {kind:'inline',key:'lead:'+identity,title:'Сохраняем заявку',success:'Заявка сохранена'};
  if(has('order'))return {kind:'inline',key:'order:'+identity,title:'Сохраняем заказ',success:'Заказ сохранён'};
  if(has('catalog'))return {kind:'inline',key:'catalog:'+identity,title:'Обновляем автомобиль',success:'Данные автомобиля сохранены'};
  if(has('team'))return {kind:'inline',key:'team:'+identity,title:'Сохраняем сотрудника',success:'Данные сотрудника сохранены'};
  return {kind:'inline',key:'other:'+identity,title:'Сохраняем изменения',success:'Изменения сохранены'};
}
const CSS=String.raw`
.awg-op-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px;background:rgba(3,9,18,.66);backdrop-filter:blur(3px)}
.awg-op-overlay[hidden],.awg-op-toast[hidden]{display:none!important}
.awg-op-card{box-sizing:border-box;width:min(92vw,370px);padding:24px;border:1px solid rgba(150,180,218,.28);border-radius:18px;background:#111b29;color:#f3f7ff;box-shadow:0 24px 75px rgba(0,0,0,.4);text-align:center}
.awg-op-card strong,.awg-op-card small{display:block}
.awg-op-card strong{font-size:17px;margin:12px 0 7px}
.awg-op-card small{font-size:13px;line-height:1.5;opacity:.76}
.awg-op-spinner{display:inline-block;width:25px;height:25px;border:3px solid rgba(220,235,255,.22);border-top-color:#c8e6ff;border-radius:50%;animation:awg-op-spin .85s linear infinite}
@keyframes awg-op-spin{to{transform:rotate(360deg)}}
.awg-op-toast{position:fixed;z-index:2147483001;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);box-sizing:border-box;width:max-content;max-width:min(92vw,440px);padding:11px 16px;border:1px solid rgba(126,171,207,.4);border-radius:12px;background:#152434;color:#f5f8fc;box-shadow:0 12px 36px rgba(0,0,0,.3);font-size:13px;line-height:1.5;text-align:center}
.awg-op-toast[data-state="success"]{border-color:rgba(91,193,137,.5);color:#d6f8e5}
.awg-op-toast[data-state="error"]{border-color:rgba(250,116,116,.6);color:#ffdbdb}
.awg-op-button-busy{position:relative;opacity:.8;cursor:progress!important}
.awg-op-button-busy:after{content:"";display:inline-block;vertical-align:middle;margin-left:9px;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:awg-op-spin .85s linear infinite}
@media(prefers-reduced-motion:reduce){.awg-op-spinner,.awg-op-button-busy:after{animation:none}}
`;
export function installOperationFeedback(win) {
  if(!win||win.__AWG_OPERATION_UI__||typeof win.__AUTO_SALE_ENTITY_BATCH__!=='function')return win?.__AWG_OPERATION_UI__||null;
  const doc=win.document;
  const original=win.__AUTO_SALE_ENTITY_BATCH__;
  const originalDelete=win.__AUTO_SALE_DELETE_LEAD__;
  const style=doc.createElement('style');style.id='awg-operation-feedback-style';style.textContent=CSS;doc.head.appendChild(style);
  const overlay=doc.createElement('div');overlay.className='awg-op-overlay';overlay.hidden=true;
  overlay.setAttribute('aria-live','polite');overlay.setAttribute('aria-atomic','true');
  overlay.innerHTML='<div class="awg-op-card" role="status"><span class="awg-op-spinner" aria-hidden="true"></span><strong data-awg-op-title></strong><small data-awg-op-detail></small></div>';
  const toast=doc.createElement('div');toast.className='awg-op-toast';toast.hidden=true;toast.setAttribute('role','status');
  doc.body.append(overlay,toast);
  let sequence=0,toastTimer=null;
  const pending=new Set();
  const schedule=(fn,ms)=>win.setTimeout(fn,ms);
  function notify(message,state='progress',duration=1500) {
    if(toastTimer!==null)win.clearTimeout(toastTimer);
    toast.hidden=false;toast.dataset.state=state;toast.textContent=message;
    toast.setAttribute('role',state==='error'?'alert':'status');
    const id=++sequence;
    toastTimer=duration?schedule(()=>{if(sequence===id)toast.hidden=true},duration):null;
  }
  function findButton(config) {
    const focus=doc.activeElement;
    if(focus?.tagName==='BUTTON'&&focus.isConnected)return focus;
    const selector=config.key.startsWith('order-')?'#orderForm button[type="submit"]':
      config.key.startsWith('payment:')?'#orderForm button[type="submit"]':
      config.key.startsWith('quote:')?'#quoteForm button[type="submit"]':
      config.key.startsWith('lead:')?'#leadEditForm button[type="submit"]':
      config.key.startsWith('lead-create:')?'#requestForm button[type="submit"]':
      config.key.startsWith('catalog:')?'#catalogCarForm button[type="submit"]':
      config.key.startsWith('team:')?'#directorTeamForm button[data-director-save]':null;
    return selector?doc.querySelector(selector):null;
  }
  function begin(config) {
    const button=findButton(config),initialDisabled=button?.disabled||false;
    if(button&&!initialDisabled){
      button.disabled=true;button.classList.add('awg-op-button-busy');button.setAttribute('aria-busy','true');
    }
    if(config.kind==='modal'){
      overlay.hidden=false;
      overlay.querySelector('[data-awg-op-title]').textContent=config.title;
      overlay.querySelector('[data-awg-op-detail]').textContent=config.detail||'Сохраняем изменения';
    } else notify(config.title,'progress',0);
    const slow=schedule(()=>{
      if(config.kind==='modal'&&!overlay.hidden)
        overlay.querySelector('[data-awg-op-detail]').textContent='Сервер обрабатывает запрос. Не повторяйте действие.';
      else if(config.kind==='inline')notify(config.title+' — ожидаем подтверждения сервера','progress',0);
    },2500);
    return ()=>{
      win.clearTimeout(slow);
      if(config.kind==='modal')overlay.hidden=true;
      if(button?.isConnected&&!initialDisabled){button.disabled=false;button.classList.remove('awg-op-button-busy');button.removeAttribute('aria-busy')}
    };
  }
  async function tracked(config,run) {
    if(!config)return run();
    if(pending.has(config.key)){
      const error=new Error('operation_in_progress');error.code='operation_in_progress';throw error;
    }
    pending.add(config.key);
    const end=begin(config);
    try {
      const result=await run();
      if(result?.ok===false)throw Object.assign(new Error(result.error||'entity_not_saved'),{code:result.error||'entity_not_saved'});
      end();notify(config.success,'success',2300);
      return result;
    } catch(error) {
      end();
      notify(error?.code==='operation_in_progress'?'Операция уже выполняется.':
        error?.code==='entity_conflict'?'Данные изменились. Проверьте карточку и повторите сохранение.':
        'Не удалось сохранить. Проверьте данные и соединение, затем повторите действие.','error',5200);
      throw error;
    } finally {pending.delete(config.key)}
  }
  win.__AUTO_SALE_ENTITY_BATCH__=(operations)=>tracked(describeOperation(operations),()=>original(operations));
  if(typeof originalDelete==='function')
    win.__AUTO_SALE_DELETE_LEAD__=(id)=>tracked({kind:'modal',key:'delete:'+id,title:'Удаляем заявку',success:'Заявка удалена',detail:'Удаляем заявку и связанные записи'},()=>originalDelete(id));
  const uploads=new Map();
  function uploadStart(id,total,label='Загрузка фотографий') {
    uploads.set(id,{total,done:0,label});
    notify(label+': 0 из '+total,'progress',0);
  }
  function uploadStep(id) {
    const item=uploads.get(id);if(!item)return;
    item.done+=1;
    notify(item.label+': '+item.done+' из '+item.total,'progress',0);
  }
  function uploadEnd(id,ok=true) {
    const item=uploads.get(id);if(!item)return;
    uploads.delete(id);
    notify(ok?'Фотографии загружены':'Ошибка загрузки. Проверьте файлы и повторите загрузку.',ok?'success':'error',ok?2200:5500);
  }
  const controller={uploadStart,uploadStep,uploadEnd,describeOperation};
  win.__AWG_OPERATION_UI__=controller;
  return controller;
}
if(typeof window!=='undefined')installOperationFeedback(window);
