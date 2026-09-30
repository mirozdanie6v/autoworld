import {validateQuote} from './auto-sale-business-rules.mjs';
const K={quotes:'auto-sale-quotes-v2',notes:'auto-sale-notes-v2'};
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
const write=(key,value)=>{if(window.__AUTO_SALE_CACHE_WRITE__)window.__AUTO_SALE_CACHE_WRITE__(key,value);else localStorage.setItem(key,JSON.stringify(value))};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'$'+new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(Number(v)||0);
const dateRu=v=>{if(!v)return'—';const d=new Date(`${v}T00:00:00`);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'})};
const quoteFor=leadId=>read(K.quotes,[]).filter(q=>q.leadId===leadId).sort((a,b)=>(Number(b.version)||0)-(Number(a.version)||0))[0];
const rows=[['lot','Цена лота'],['auction','Сбор аукциона'],['inland','Доставка по США'],['ocean','Морская доставка'],['customs','Таможня / оформление'],['repair','Ремонт / подготовка'],['service','Услуга компании']];

function panel(leadId,q){
  if(!q||q.status==='Черновик')return'';
  const actionable=['Отправлен','На согласовании'].includes(q.status);
  const agreed=q.status==='Согласован';
  const changes=q.clientDecision==='changes_requested';
  return `<section class="auto-client-quote" data-client-quote="${esc(q.id)}" data-lead="${esc(leadId)}">
    <div class="auto-client-quote-head"><div><span>РАСЧЁТ · ${esc(q.id)} · V${Number(q.version)||1}</span><h3>${esc(q.model||'Расчёт автомобиля')}</h3></div><b class="auto-status ${agreed?'good':''}">${esc(q.status)}</b></div>
    <div class="auto-client-quote-lines">${rows.map(([key,label])=>`<div><span>${label}</span><strong>${money(q[key])}</strong></div>`).join('')}</div>
    <div class="auto-client-quote-total"><span><b>Итого под ключ</b><small>Расчёт действует до ${dateRu(q.validUntil)}</small></span><strong>${money(q.total)}</strong></div>
    ${agreed?(saving?'<div role="status" class="auto-client-decision"><b>Сохраняем решение…</b></div>':'<div class="auto-client-decision good"><b>Расчёт согласован</b><span>Решение сохранено. Следующий шаг — депозит и оформление заказа.</span></div>'):''}
    ${changes?`<div class="auto-client-decision warn"><b>Запрошены изменения</b><span>${esc(q.clientComment||'Менеджер получил ваш запрос и подготовит следующую версию расчёта.')}</span></div>`:''}
    ${actionable?`<div class="auto-client-quote-actions"><button type="button" class="auto-btn primary" data-client-quote-agree="${esc(q.id)}">Согласовать расчёт</button><button type="button" class="auto-btn ghost" data-client-quote-change="${esc(q.id)}">Нужны изменения</button></div><div class="auto-client-change" data-client-change-panel hidden><label>Что нужно изменить?<textarea data-client-quote-comment placeholder="Например: другой бюджет, комплектация, сроки доставки…"></textarea></label><div class="auto-actions"><button type="button" class="auto-btn primary" data-client-quote-send-change="${esc(q.id)}">Отправить менеджеру</button><button type="button" class="auto-btn ghost" data-client-quote-cancel-change>Отмена</button></div></div>`:''}
  </section>`;
}

function updateGuide(modal,q){
  const node=modal.querySelector('.auto-guide span');if(!node)return;
  let next='';
  if(q?.status==='Согласован')next=saving?'Сохраняем решение…':'Расчёт согласован. Следующий шаг — внесение депозита и создание заказа.';
  else if(q?.clientDecision==='changes_requested')next='Запрос на изменения отправлен. Менеджер подготовит обновлённый расчёт.';
  else if(q&&['Отправлен','На согласовании'].includes(q.status))next='Проверьте расчёт ниже и нажмите «Согласовать расчёт» или «Нужны изменения».';
  if(next&&node.textContent!==next)node.textContent=next;
}

function enhanceClient(){
  const modal=document.querySelector('[data-client-detail-bg] .auto-tg-modal');if(!modal)return;
  const id=modal.querySelector('[data-tg-manager]')?.dataset.tgManager||'';if(!id)return;
  const q=quoteFor(id);if(!q||q.status==='Черновик')return;
  const current=modal.querySelector('.auto-client-quote');
  const state=`${q.status}|${q.clientDecision||''}|${q.clientComment||''}|${saving}`;
  if(current?.dataset.clientQuote===q.id&&current.dataset.state===state){updateGuide(modal,q);return}
  current?.remove();
  const grid=modal.querySelector('.auto-client-order-grid');
  if(grid){grid.insertAdjacentHTML('afterend',panel(id,q));const node=modal.querySelector('.auto-client-quote');if(node)node.dataset.state=state}
  updateGuide(modal,q);
}

function enhanceManager(){
  const form=document.querySelector('#leadEditForm');if(!form)return;
  const leadId=String(form.elements.id?.value||'');if(!leadId)return;
  const q=quoteFor(leadId),side=form.closest('.auto-modal-grid')?.querySelector('.auto-side-panel');if(!q||!side)return;
  const state=`${q.status}|${q.clientDecision||''}|${q.clientComment||''}`;
  let box=side.querySelector('.auto-client-manager-decision');
  if(!q.clientDecision){box?.remove();return}
  if(box?.dataset.state===state)return;
  const good=q.clientDecision==='agreed';
  const text=good?'Клиент согласовал расчёт. Зафиксируйте сумму, дату и способ получения депозита.':`Клиент просит изменить расчёт: ${q.clientComment||'без комментария'}`;
  const html=`<div class="auto-client-manager-decision auto-client-decision ${good?'good':'warn'}" data-state="${esc(state)}"><b>${good?'Расчёт согласован клиентом':'Клиент запросил изменения'}</b><span>${esc(text)}</span></div>`;
  if(box)box.outerHTML=html;else side.insertAdjacentHTML('afterbegin',html);
}

function enhance(){enhanceClient();enhanceManager()}

function decisionError(message){
  const panel=document.querySelector('.auto-client-quote');if(!panel)return;
  panel.querySelector('.auto-client-sync-error')?.remove();
  panel.insertAdjacentHTML('beforeend',`<div role="alert" class="auto-client-sync-error auto-client-decision warn"><b>Не удалось согласовать расчёт</b><span>${esc(message)}</span></div>`);
}

let saving=false;
async function saveDecision(id,decision,comment=''){
  if(saving)return false;
  const before=read(K.quotes,[]).find(q=>q.id===id);if(!before||!['Отправлен','На согласовании'].includes(before.status))return false;
  if(decision==='agreed'){
    const errors=validateQuote({...before,status:'Согласован'});
    if(errors.length){decisionError('Менеджеру нужно завершить проверку автомобиля и данные расчёта. '+errors.join(' '));return false}
  }
  const list=read(K.quotes,[]),index=list.findIndex(q=>q.id===id);if(index<0)return false;
  const q=list[index],now=new Date().toISOString();
  const nextQuote=decision==='agreed'
    ?{...q,status:'Согласован',clientDecision:'agreed',clientDecisionAt:now,agreedAt:q.agreedAt||now,updatedAt:now}
    :{...q,status:q.status==='Отправлен'?'На согласовании':q.status,clientDecision:'changes_requested',clientDecisionAt:now,clientComment:comment.trim(),updatedAt:now};
  const note={id:'NOTE-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),at:now,text:decision==='agreed'?'Клиент согласовал расчёт '+q.id+'.':'Клиент запросил изменения по расчёту '+q.id+': '+(comment.trim()||'без комментария')+'.'};
  saving=true;enhance();
  try{
    if(window.__AUTO_SALE_ENTITY_BATCH__){
      await window.__AUTO_SALE_ENTITY_BATCH__([
        {resource:'quote',operation:'patch',id:q.id,input:nextQuote},
        {resource:'note',operation:'create',leadId:q.leadId,input:note}
      ]);
    }else{
      list[index]=nextQuote;write(K.quotes,list);
      const localNotes=read(K.notes,{});localNotes[q.leadId]=localNotes[q.leadId]||[];localNotes[q.leadId].push(note);write(K.notes,localNotes);
      window.dispatchEvent(new CustomEvent('auto-sale-client-decision',{detail:{leadId:q.leadId,quoteId:q.id,decision}}));
      queueMicrotask(enhance);
      if(window.__AUTO_SALE_FLUSH__){
        const result=await window.__AUTO_SALE_FLUSH__();
        if(!result?.ok){
          const current=read(K.quotes,[]),row=current.findIndex(x=>x.id===id);if(row>=0){current[row]=before;write(K.quotes,current)}
          const currentNotes=read(K.notes,{});currentNotes[q.leadId]=(currentNotes[q.leadId]||[]).filter(x=>x.id!==note.id);write(K.notes,currentNotes);
          window.dispatchEvent(new CustomEvent('auto-sale-client-decision',{detail:{leadId:q.leadId,quoteId:q.id,decision:'failed'}}));
          saving=false;enhance();decisionError('Решение не сохранено на сервере. Проверьте соединение и повторите действие.');
          return false;
        }
      }
      return true;
    }
    list[index]=nextQuote;write(K.quotes,list);
    const notes=read(K.notes,{});notes[q.leadId]=notes[q.leadId]||[];notes[q.leadId].push(note);write(K.notes,notes);
    window.dispatchEvent(new CustomEvent('auto-sale-client-decision',{detail:{leadId:q.leadId,quoteId:q.id,decision}}));
    queueMicrotask(enhance);
    return true;
  }catch(error){
    console.warn('AUTO SALE client decision entity save failed',error);
    window.dispatchEvent(new CustomEvent('auto-sale-client-decision',{detail:{leadId:q.leadId,quoteId:q.id,decision:'failed'}}));
    saving=false;enhance();decisionError(error?.code==='entity_conflict'?'Расчёт был изменён менеджером. Откройте его заново и повторите решение.':'Решение не сохранено на сервере. Проверьте соединение и повторите действие.');
    return false;
  }finally{
    saving=false;enhance();
  }
}

const style=document.createElement('style');style.id='auto-client-quote-style';style.textContent=`
.auto-client-quote{margin:18px 0;padding:18px;border:1px solid rgba(93,169,255,.34);border-radius:20px;background:rgba(40,105,170,.08)}
.auto-client-quote-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}.auto-client-quote-head span{font-size:11px;font-weight:800;letter-spacing:.08em;color:#79b9ff}.auto-client-quote-head h3{margin:5px 0 0;font-size:18px}.auto-client-quote-lines{display:grid;gap:0;border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden}.auto-client-quote-lines div{display:flex;justify-content:space-between;gap:16px;padding:11px 12px;border-bottom:1px solid rgba(255,255,255,.07)}.auto-client-quote-lines div:last-child{border-bottom:0}.auto-client-quote-lines span{color:#9ea8b8}.auto-client-quote-total{display:flex;justify-content:space-between;gap:16px;align-items:end;padding:16px 2px 4px}.auto-client-quote-total span{display:grid;gap:4px}.auto-client-quote-total small{color:#8f99a8}.auto-client-quote-total strong{font-size:28px;color:#6bb6ff}.auto-client-quote-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.auto-client-decision{display:grid;gap:5px;margin-top:14px;padding:13px 14px;border-radius:14px}.auto-client-decision.good{background:rgba(48,185,120,.11);border:1px solid rgba(48,185,120,.3)}.auto-client-decision.warn{background:rgba(255,179,71,.09);border:1px solid rgba(255,179,71,.3)}.auto-client-decision span{color:#b6bec9;line-height:1.45}.auto-client-manager-decision{margin:0 0 18px}.auto-client-change{margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.09)}.auto-client-change label{display:grid;gap:8px;font-weight:700}.auto-client-change textarea{min-height:96px;resize:vertical}.auto-client-change .auto-actions{margin-top:10px}@media(max-width:520px){.auto-client-quote-actions{grid-template-columns:1fr}.auto-client-quote-total{align-items:flex-start}.auto-client-quote-total strong{font-size:24px}}
`;if(!document.getElementById(style.id))document.head.append(style);

new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('click',event=>{
  const syntheticCore=event.target.closest?.('[data-quote-action]');if(syntheticCore)return;
  const agree=event.target.closest?.('[data-client-quote-agree]');if(agree){event.preventDefault();const q=read(K.quotes,[]).find(x=>x.id===agree.dataset.clientQuoteAgree);if(!q)return;const ok=typeof confirm==='function'?confirm(`Согласовать расчёт на ${money(q.total)}?`):true;if(ok)saveDecision(q.id,'agreed');return}
  const change=event.target.closest?.('[data-client-quote-change]');if(change){event.preventDefault();const p=change.closest('.auto-client-quote')?.querySelector('[data-client-change-panel]');if(p){p.hidden=false;p.querySelector('textarea')?.focus()}return}
  const cancel=event.target.closest?.('[data-client-quote-cancel-change]');if(cancel){event.preventDefault();const p=cancel.closest('[data-client-change-panel]');if(p)p.hidden=true;return}
  const send=event.target.closest?.('[data-client-quote-send-change]');if(send){event.preventDefault();const p=send.closest('[data-client-change-panel]'),comment=String(p?.querySelector('[data-client-quote-comment]')?.value||'').trim();if(!comment){const area=p?.querySelector('[data-client-quote-comment]');area?.focus();area?.setAttribute('placeholder','Напишите, что нужно изменить в расчёте');return}saveDecision(send.dataset.clientQuoteSendChange,'changes_requested',comment);return}
},true);
window.addEventListener('auto-sale-client-decision',()=>queueMicrotask(enhance));
window.addEventListener('auto-sale-server-rejected',()=>{const box=document.querySelector('.auto-client-quote');if(box&&!box.querySelector('.auto-client-sync-error'))box.insertAdjacentHTML('beforeend','<div class="auto-client-sync-error auto-client-decision warn"><b>Не удалось сохранить решение</b><span>Повторите действие через несколько секунд.</span></div>')});
enhance();
