import {AWG_QUOTE_V2_SCHEMA,AWG_QUOTE_V2_TARIFF,v2Quote,modesV2,quoteV2Amounts,quoteV2Rate,quoteV2TotalRub,quoteV2Form} from './auto-sale-quote-v2.mjs';
import {awgTariff,awgCryptoFee,awgPendingItems,awgPackageUsd,AWG_TARIFF_VERSION,AWG_US_LOGISTICS} from './auto-sale-tariffs.mjs';
import {quoteCostRows,quoteRowsTotal,ageCategoryForDate,ageCategoryForMonth,ageCategoryForYear,defaultRepairCountry,defaultPartsCountry,rubToUsd,TKS_CALCULATOR_URL,QUOTE_AUDIT_SCHEMA,tksParameters} from './auto-sale-quote-audit.mjs';
import {quoteVehicleFields,quoteCostAuditFields,quoteCustomsFields} from './auto-sale-quote-form.mjs';
import {AWG_GEORGIA_TARIFF_VERSION,georgiaQuoteForm,georgiaQuoteAmounts,georgiaDraftForEditing,formatGeorgiaUsd} from './auto-sale-georgia-quote.mjs';
import {normalizePowerUnit,toMetricHorsepower,quotePowerInput,convertPowerInput} from './auto-sale-power-units.mjs';
import {catalogVehicleSnapshot,isCatalogVehicleLead,catalogLeadSpecsText,renderCatalogLeadVehicle,catalogCarForLead,catalogBudgetUsd,catalogPriceRub} from './auto-sale-catalog-lead.mjs';
import {catalogRubPerUsd} from './auto-sale-catalog-fx.mjs';
import {catalogCustomsFacts,catalogCustomsForLead} from './auto-sale-catalog-customs.mjs';
import {installNumericZeroFocus} from './auto-sale-numeric-zero-focus.mjs';
import {
  ORDER_STAGES, LEAD_STATUSES, SOURCES,
  seedLeads, seedQuotes, seedOrders, calculateQuote, quoteCost, nextId, distributedId,
  orderStageIndex, nextOrderStage, normalizeOrderStage, clientStage, filterLeads, filterOrders,
  managerStats, financeStats, dashboardStats, funnelStats, lostReasons
} from './auto-sale-core.mjs?v=20261011-vk-notifications-v1';
import {
  QUOTE_STATUSES,RISK_TYPES,PAYMENT_METHODS,leadTransitionAllowed,
  validateClientRequest,validateManagerLead,validateLeadUpdate,validateQuote,
  canCreateOrder,validateOrderUpdate,normalizePayments,paymentsTotal,nextPaymentId,
  PAYMENT_STAGE_DEFS,auctionDepositRange,buildUsPaymentPlan,paymentStageState,nextPaymentStage,migratePaymentsToPlan,validatePaymentStageEntry,
  VERIFICATION_RESULTS,normalizeVehicleVerification
} from './auto-sale-business-rules.mjs';
import {AUTO_SALE_MANAGERS,managerTelegramIdentity} from './auto-sale-manager-directory.mjs';
import {channelSourceStats as sourceStats,channelResponseStats,responseTimeLabel} from './auto-sale-channel-analytics.mjs';

const root=document.querySelector('#app');
if(!root)throw new Error('AUTO SALE root not found');
installNumericZeroFocus(document);
const today=new Date().toISOString().slice(0,10);
const addDays=(date,days)=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const SOURCE_OPTIONS=[...new Set([...SOURCES,'ВКонтакте','Mini App','Телефон','Офис'])];
const CLIENT_ORIGINS=['США','Грузия'];
const TRANSPORT_MODES=['Море','Автовоз','Не требуется','Другое'];
const carOrigin=car=>String(car?.origin||'').trim()||((car?.auctionDate||car?.lot||car?.auction)?'США':'Уточняется');
const purchaseScenarioLabel=origin=>origin==='США'?'Аукцион США':origin==='Грузия'?'Авто в Грузии':String(origin||'Уточняется');
const supportedClientOrigin=origin=>CLIENT_ORIGINS.includes(String(origin||'').trim());
const managerOriginOptions=current=>[...new Set([...(current&&!CLIENT_ORIGINS.includes(current)?[current]:[]),...CLIENT_ORIGINS])];
const defaultTransportMode=origin=>origin==='США'?'Море':origin==='Грузия'?'Автовоз':'Другое';
const transportLabel=q=>q?.transportMode==='Море'?'Морская перевозка':q?.transportMode==='Автовоз'?'Перевозка автовозом':q?.transportMode==='Не требуется'?'Международная перевозка не требуется':'Международная перевозка';
const defaultCars=[];
const KEYS={leads:'auto-sale-leads-v2',quotes:'auto-sale-quotes-v2',orders:'auto-sale-orders-v2',notes:'auto-sale-notes-v2',catalog:'auto-sale-catalog-v1',team:'auto-sale-team-v1',role:'auto-sale-role-v2'};
const parse=(storage,key,fallback)=>{try{const x=JSON.parse(storage.getItem(key)||'null');return x??fallback}catch{return fallback}};
const persist=(key,value)=>{try{if(window.__AUTO_SALE_CACHE_WRITE__)window.__AUTO_SALE_CACHE_WRITE__(key,value);else localStorage.setItem(key,JSON.stringify(value))}catch{}};
const activeManagers=()=>{const team=parse(localStorage,KEYS.team,[]),savedLeads=parse(localStorage,KEYS.leads,[]),savedOrders=parse(localStorage,KEYS.orders,[]);const canonical=Object.keys(AUTO_SALE_MANAGERS);const fromTeam=Array.isArray(team)?team.filter(x=>x&&x.active!==false&&x.role==='Менеджер').map(x=>String(x.name||'').trim()):[];const fromAssignments=[...(Array.isArray(savedLeads)?savedLeads:[]),...(Array.isArray(savedOrders)?savedOrders:[])].map(x=>String(x?.manager||'').trim()).filter(Boolean);return[...new Set([...canonical,...fromTeam,...fromAssignments].filter(Boolean))]};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'$'+new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(Number(v)||0);
const rubMoney=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(v)||0)+' ₽';
const catalogPriceText=car=>{
  if(Number(car?.price)>0)return 'от '+money(car.price);
  if(Number(car?.priceRub)>0)return rubMoney(car.priceRub);
  if(Number(car?.estimatedBidUsd)>0)return 'ставка ≈ '+money(car.estimatedBidUsd);
  return 'по расчёту';
};
const catalogOldPriceRub=car=>{
  const before=Number(car?.priceBeforeDiscountRub)||0,current=Number(car?.priceRub)||0;
  return before>current&&current>0?before:0;
};
const catalogPriceSub=car=>catalogOldPriceRub(car)?'цена со скидкой':Number(car?.price)>0?'ориентир под ключ':Number(car?.priceRub)>0?'цена источника':Number(car?.estimatedBidUsd)>0?'расчётная ставка':'стоимость уточняется';
const catalogDeliveryHint=car=>{const value=String(car?.delivery||'').trim();return !value||value==='Срок по запросу'?(carOrigin(car)==='США'?'2,5–3,5 месяца':'5–10 дней'):value};
const catalogPriceHtml=car=>{
  const old=catalogOldPriceRub(car);
  return `${old?`<s class="auto-price-old">${rubMoney(old)}</s>`:''}<b>${catalogPriceText(car)}</b><span>${catalogPriceSub(car)}</span>`;
};
const dateRu=v=>{if(!v)return'—';const d=new Date(`${v}T00:00:00`);return Number.isNaN(d.getTime())?esc(v):d.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'})};
const auctionDateText=v=>String(v||'').trim()||'уточняется';
const auctionDateTime=value=>{
  const raw=String(value||'').trim();if(!raw)return null;
  const m=raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if(m){const t=Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]));return Number.isNaN(t)?null:t}
  const t=Date.parse(raw);return Number.isNaN(t)?null:t;
};
const auctionToday=()=>{const d=new Date();return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())}; const auctionEnded=car=>{if(carOrigin(car)!=='США')return false;const t=auctionDateTime(car?.auctionDate);return t!==null&&t<auctionToday()};
const auctionSort=(a,b)=>{
  const today=auctionToday(),ta=auctionDateTime(a?.auctionDate),tb=auctionDateTime(b?.auctionDate);
  const rank=t=>t===null?2:(t>=today?0:1),ra=rank(ta),rb=rank(tb);
  if(ra!==rb)return ra-rb;
  if(ra===0)return ta-tb;
  if(ra===1)return tb-ta;
  return String(b?.sourcePostId||'').localeCompare(String(a?.sourcePostId||''),undefined,{numeric:true});
};
const sortedByAuction=list=>[...list].sort(auctionSort);
const dateTimeRu=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})};
const showErrors=(form,errors)=>{let box=form.querySelector('.auto-form-error');if(!box){box=document.createElement('div');box.className='auto-form-error full';form.prepend(box)}box.innerHTML=errors.map(x=>`<span>${esc(x)}</span>`).join('')};
const MAX_INTERIOR_PHOTOS=4;
const MAX_OTHER_PHOTOS=6;
const parsePhotoList=value=>{try{const x=JSON.parse(String(value||'[]'));return Array.isArray(x)?x.filter(Boolean):[]}catch{return[]}};
const photoThumb=(src,kind,index,label)=>`<div class="catalog-photo-thumb"><img src="${esc(src)}" alt="${esc(label)}"><button type="button" data-catalog-photo-remove="${kind}" data-photo-index="${index}" aria-label="Удалить фото">×</button></div>`;
function catalogPhotoEditor(car){
  const main=String(car?.image||''),interior=Array.isArray(car?.interiorPhotos)?car.interiorPhotos:[],other=Array.isArray(car?.otherPhotos)?car.otherPhotos:[];
  return `<div class="catalog-photo-editor full" data-catalog-photo-editor>
    <div class="catalog-photo-block">
      <div class="catalog-photo-title"><b>Главное фото</b><small>Показывается в карточке автомобиля</small></div>
      <input type="hidden" name="image" value="${esc(main)}">
      <div class="catalog-photo-preview main" data-photo-preview="main">${main?photoThumb(main,'main',0,'Главное фото'):'<div class="catalog-photo-empty">Главное фото не выбрано</div>'}</div>
      <label class="catalog-photo-upload">Загрузить главное фото<input type="file" accept="image/jpeg,image/png,image/webp" data-catalog-photo-upload="main"></label>
      <input class="catalog-photo-url" name="imageUrl" type="url" value="${/^https?:/i.test(main)?esc(main):''}" placeholder="или вставьте URL изображения">
    </div>
    <div class="catalog-photo-block">
      <div class="catalog-photo-title"><b>Фото салона</b><small>До ${MAX_INTERIOR_PHOTOS} фото</small></div>
      <input type="hidden" name="interiorPhotos" value="${esc(JSON.stringify(interior))}">
      <div class="catalog-photo-preview" data-photo-preview="interior">${interior.length?interior.map((src,i)=>photoThumb(src,'interior',i,'Фото салона')).join(''):'<div class="catalog-photo-empty">Фото салона пока нет</div>'}</div>
      <label class="catalog-photo-upload">Добавить фото салона<input type="file" multiple accept="image/jpeg,image/png,image/webp" data-catalog-photo-upload="interior"></label>
    </div>
    <div class="catalog-photo-block">
      <div class="catalog-photo-title"><b>Другие фото</b><small>Кузов, детали, повреждения · до ${MAX_OTHER_PHOTOS} фото</small></div>
      <input type="hidden" name="otherPhotos" value="${esc(JSON.stringify(other))}">
      <div class="catalog-photo-preview" data-photo-preview="other">${other.length?other.map((src,i)=>photoThumb(src,'other',i,'Дополнительное фото')).join(''):'<div class="catalog-photo-empty">Дополнительных фото пока нет</div>'}</div>
      <label class="catalog-photo-upload">Добавить другие фото<input type="file" multiple accept="image/jpeg,image/png,image/webp" data-catalog-photo-upload="other"></label>
    </div>
    <p class="catalog-photo-hint">Фото загружаются с устройства и автоматически уменьшаются для быстрой работы демо.</p>
  </div>`;
}
function updateCatalogPhotoPreviews(form){
  const main=String(form.elements.image?.value||'');
  const interior=parsePhotoList(form.elements.interiorPhotos?.value);
  const other=parsePhotoList(form.elements.otherPhotos?.value);
  const mainBox=form.querySelector('[data-photo-preview="main"]');
  const interiorBox=form.querySelector('[data-photo-preview="interior"]');
  const otherBox=form.querySelector('[data-photo-preview="other"]');
  if(mainBox)mainBox.innerHTML=main?photoThumb(main,'main',0,'Главное фото'):'<div class="catalog-photo-empty">Главное фото не выбрано</div>';
  if(interiorBox)interiorBox.innerHTML=interior.length?interior.map((src,i)=>photoThumb(src,'interior',i,'Фото салона')).join(''):'<div class="catalog-photo-empty">Фото салона пока нет</div>';
  if(otherBox)otherBox.innerHTML=other.length?other.map((src,i)=>photoThumb(src,'other',i,'Дополнительное фото')).join(''):'<div class="catalog-photo-empty">Дополнительных фото пока нет</div>';
}
function readFileDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));reader.readAsDataURL(file)})}
function compressCatalogPhoto(file){
  return new Promise(async(resolve,reject)=>{
    if(!file||!/^image\/(jpeg|png|webp)$/i.test(file.type||'')){reject(new Error('Поддерживаются JPG, PNG и WebP.'));return}
    if(file.size>15*1024*1024){reject(new Error('Файл слишком большой. Максимум 15 МБ.'));return}
    let raw;
    try{raw=await readFileDataUrl(file)}catch(error){reject(error);return}
    if(typeof Image==='undefined'||typeof document?.createElement!=='function'){resolve(raw);return}
    const img=new Image();
    img.onload=()=>{
      try{
        let width=img.naturalWidth||img.width,height=img.naturalHeight||img.height;
        const maxSide=1200,scale=Math.min(1,maxSide/Math.max(width,height));
        width=Math.max(1,Math.round(width*scale));height=Math.max(1,Math.round(height*scale));
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext?.('2d');if(!ctx){resolve(raw);return}
        ctx.drawImage(img,0,0,width,height);
        let quality=.8,data=canvas.toDataURL('image/jpeg',quality);
        while(data.length>145000&&quality>.5){quality-=.08;data=canvas.toDataURL('image/jpeg',quality)}
        if(data.length>180000){
          const scale2=Math.sqrt(180000/data.length);
          const w2=Math.max(1,Math.round(width*scale2)),h2=Math.max(1,Math.round(height*scale2));
          const canvas2=document.createElement('canvas');canvas2.width=w2;canvas2.height=h2;
          const ctx2=canvas2.getContext?.('2d');if(ctx2){ctx2.drawImage(img,0,0,w2,h2);data=canvas2.toDataURL('image/jpeg',.62)}
        }
        resolve(data);
      }catch{resolve(raw)}
    };
    img.onerror=()=>reject(new Error('Не удалось обработать изображение. Используйте JPG, PNG или WebP.'));
    img.src=raw;
  });
}
function ensureCatalogCarId(form){
  let id=String(form.elements.id?.value||'').trim();
  if(!id){
    id=`CAR-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
    if(form.elements.id)form.elements.id.value=id;
  }
  return id;
}
const apiHeaders=extra=>window.__AUTO_SALE_AUTH_HEADERS__?window.__AUTO_SALE_AUTH_HEADERS__(extra):extra;
async function uploadCatalogPhoto(dataUrl,file,carId,kind){
  const response=await fetch('/api/auto-sale/media',{
    method:'POST',
    headers:apiHeaders({'content-type':'application/json'}),
    body:JSON.stringify({carId,category:kind,dataUrl,fileName:file?.name||`${kind}.jpg`})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error==='media_storage_not_configured'?'Файловое хранилище ещё не подключено.':'Не удалось загрузить фото в хранилище.');
  if(!data.url)throw new Error('Хранилище не вернуло адрес изображения.');
  return data.url;
}
async function deleteCatalogPhoto(url){
  if(!/^https:\/\/storage\.yandexcloud\.net\//i.test(String(url||'')))return;
  try{
    await fetch('/api/auto-sale/media',{
      method:'DELETE',
      headers:apiHeaders({'content-type':'application/json'}),
      body:JSON.stringify({url})
    });
  }catch{}
}
async function handleCatalogPhotoUpload(input){
  const form=input.closest('#catalogCarForm');if(!form)return;
  const kind=input.dataset.catalogPhotoUpload,files=[...(input.files||[])];if(!files.length)return;
  const carId=ensureCatalogCarId(form);
  input.disabled=true;
  const uploadLabel=input.closest('.catalog-photo-upload');
  const originalText=uploadLabel?.childNodes?.[0]?.textContent||'';
  if(uploadLabel?.childNodes?.[0])uploadLabel.childNodes[0].textContent='Загрузка…';
  try{
    const uploaded=[];
    for(const file of files){
      const converted=await compressCatalogPhoto(file);
      uploaded.push(await uploadCatalogPhoto(converted,file,carId,kind));
    }
    if(kind==='main'){
      const previous=String(form.elements.image.value||'');
      form.elements.image.value=uploaded[0]||'';
      if(form.elements.imageUrl)form.elements.imageUrl.value='';
      if(previous&&previous!==form.elements.image.value)deleteCatalogPhoto(previous);
    }else{
      const field=kind==='interior'?form.elements.interiorPhotos:form.elements.otherPhotos;
      const limit=kind==='interior'?MAX_INTERIOR_PHOTOS:MAX_OTHER_PHOTOS;
      const current=parsePhotoList(field.value);
      const allowed=Math.max(0,limit-current.length);
      const accepted=uploaded.slice(0,allowed);
      const rejected=uploaded.slice(allowed);
      field.value=JSON.stringify([...current,...accepted]);
      for(const url of rejected)deleteCatalogPhoto(url);
    }
    updateCatalogPhotoPreviews(form);
  }catch(error){showErrors(form,[error?.message||'Не удалось загрузить фото.'])}
  finally{
    input.value='';input.disabled=false;
    if(uploadLabel?.childNodes?.[0])uploadLabel.childNodes[0].textContent=originalText||'Загрузить фото';
  }
}
async function removeCatalogPhoto(button){
  const form=button.closest('#catalogCarForm');if(!form)return;
  const kind=button.dataset.catalogPhotoRemove,index=Number(button.dataset.photoIndex)||0;
  let removed='';
  if(kind==='main'){
    removed=String(form.elements.image.value||'');
    form.elements.image.value='';
    if(form.elements.imageUrl)form.elements.imageUrl.value='';
  }else{
    const field=kind==='interior'?form.elements.interiorPhotos:form.elements.otherPhotos;
    const list=parsePhotoList(field.value);
    removed=String(list[index]||'');
    list.splice(index,1);field.value=JSON.stringify(list);
  }
  updateCatalogPhotoPreviews(form);
  if(removed)await deleteCatalogPhoto(removed);
}

const MAX_VERIFICATION_PHOTOS=8;
const verificationPhotoThumb=(src,index)=>`<div class="catalog-photo-thumb"><img src="${esc(src)}" alt="Фото автомобиля до покупки"><button type="button" data-verification-photo-remove="${index}" aria-label="Удалить фото проверки">×</button></div>`;
function verificationPhotoEditor(verification={}){
  const photos=Array.isArray(verification.photos)?verification.photos:[];
  return `<div class="catalog-photo-editor auto-verification-photos full">
    <div class="catalog-photo-block">
      <div class="catalog-photo-title"><b>Фото до покупки</b><small>Кузов, салон, повреждения · до ${MAX_VERIFICATION_PHOTOS} фото</small></div>
      <input type="hidden" name="verificationPhotos" value="${esc(JSON.stringify(photos))}">
      <div class="catalog-photo-preview" data-verification-photo-preview>${photos.length?photos.map((src,i)=>verificationPhotoThumb(src,i)).join(''):'<div class="catalog-photo-empty">Фото проверки пока не добавлены</div>'}</div>
      <label class="catalog-photo-upload">Добавить фото проверки<input type="file" multiple accept="image/jpeg,image/png,image/webp" data-verification-photo-upload></label>
      <p class="catalog-photo-hint">Фото сохраняются в файловом хранилище и входят в досье конкретного лота.</p>
    </div>
  </div>`;
}
function updateVerificationPhotoPreview(form){
  const photos=parsePhotoList(form.elements.verificationPhotos?.value);
  const box=form.querySelector('[data-verification-photo-preview]');
  if(box)box.innerHTML=photos.length?photos.map((src,i)=>verificationPhotoThumb(src,i)).join(''):'<div class="catalog-photo-empty">Фото проверки пока не добавлены</div>';
}
async function handleVerificationPhotoUpload(input){
  const form=input.closest('#quoteForm');if(!form)return;
  const files=[...(input.files||[])];if(!files.length)return;
  input.disabled=true;
  try{
    const current=parsePhotoList(form.elements.verificationPhotos?.value),allowed=Math.max(0,MAX_VERIFICATION_PHOTOS-current.length),uploaded=[];
    const ref=String(form.elements.id?.value||form.elements.leadId?.value||'draft').replace(/[^A-Za-z0-9_-]/g,'_');
    for(const file of files.slice(0,allowed)){
      const converted=await compressCatalogPhoto(file);
      uploaded.push(await uploadCatalogPhoto(converted,file,`VERIFY-${ref}`,'verification'));
    }
    form.elements.verificationPhotos.value=JSON.stringify([...current,...uploaded]);
    updateVerificationPhotoPreview(form);
  }catch(error){showErrors(form,[error?.message||'Не удалось загрузить фото проверки.'])}
  finally{input.value='';input.disabled=false}
}
async function removeVerificationPhoto(button){
  const form=button.closest('#quoteForm');if(!form)return;
  const photos=parsePhotoList(form.elements.verificationPhotos?.value),index=Number(button.dataset.verificationPhotoRemove)||0,removed=String(photos[index]||'');
  photos.splice(index,1);form.elements.verificationPhotos.value=JSON.stringify(photos);updateVerificationPhotoPreview(form);
  if(removed)await deleteCatalogPhoto(removed);
}
function vehicleVerificationView(q,compact=false){
  const v=normalizeVehicleVerification(q),photos=v.photos||[];
  if(!v.lotNumber&&!v.vin&&!photos.length&&!v.history&&!v.reportUrl)return'';
  const tone=v.result==='Одобрен к покупке'?'good':v.result==='Не рекомендован'?'warn':'';
  return `<div class="auto-verification-card ${compact?'compact':''}">
    <div class="auto-verification-head"><div><span class="auto-eyebrow">ДОСЬЕ ПРОВЕРКИ</span><h4>${esc(v.lotNumber||'Лот не указан')} · ${esc(v.vin||'VIN не указан')}</h4></div><span class="auto-status ${tone}">${esc(v.result||'Не проверено')}</span></div>
    <div class="auto-verification-meta"><span><b>Год / пробег</b>${v.year||'—'} · ${v.mileage?new Intl.NumberFormat('ru-RU').format(v.mileage)+' км':'—'}</span><span><b>Повреждения</b>${esc(v.damage||'—')}</span><span><b>Проверено</b>${dateRu(v.checkedAt)}</span></div>
    ${v.history?`<p>${esc(v.history)}</p>`:''}
    ${v.reportUrl?`<a class="auto-verification-report" href="${esc(v.reportUrl)}" target="_blank" rel="noopener noreferrer">Открыть отчёт проверки →</a>`:''}
    ${photos.length?`<div class="auto-verification-gallery">${photos.map(src=>`<a href="${esc(src)}" target="_blank" rel="noopener noreferrer"><img src="${esc(src)}" alt="Фото автомобиля до покупки"></a>`).join('')}</div>`:''}
  </div>`;
}


let leads=parse(localStorage,KEYS.leads,null)||[];
let quotes=parse(localStorage,KEYS.quotes,null)||[];
let orders=parse(localStorage,KEYS.orders,null)||[];
let notes=parse(localStorage,KEYS.notes,{});
const storedCatalog=parse(localStorage,KEYS.catalog,null);
let cars=Array.isArray(storedCatalog)&&storedCatalog.length?storedCatalog.map(car=>({...car,active:car.active!==false})):defaultCars.map(car=>({...car}));
leads=leads.map(x=>({...x,origin:String(x.origin||''),yearFrom:x.yearFrom||'',yearTo:x.yearTo||'',mileageMax:x.mileageMax||'',engine:x.engine||'Не важно',drive:x.drive||'Не важно',damage:x.damage||'Минимальные',deliveryCity:x.deliveryCity||'',deposit:Number(x.deposit)||0,depositDate:x.depositDate||'',paymentMethod:x.paymentMethod||''}));
quotes=quotes.map(x=>{const origin=String(x.origin||'').trim()||(Number(x.auction)>0?'США':'Грузия');return{...x,origin,transportMode:x.transportMode||defaultTransportMode(origin),version:Number(x.version)||1,validUntil:x.tariffVersion===AWG_GEORGIA_TARIFF_VERSION?(x.validUntil||''):(x.validUntil||addDays(today,7)),verification:normalizeVehicleVerification(x)}});
orders=orders.map(x=>{const rawPayments=normalizePayments(x),origin=String(x.origin||'').trim()||(x.lot?'США':'Уточняется'),lead=leads.find(l=>l.id===x.leadId),quote=quotes.filter(q=>q.leadId===x.leadId).sort((a,b)=>(b.version||1)-(a.version||1))[0],riskType=x.riskType||(x.risk==='Нет'?'Нет':RISK_TYPES.includes(x.risk)?x.risk:'Другое'),riskNote=x.riskNote||(riskType==='Другое'?x.risk:'');let paymentPlan=Array.isArray(x.paymentPlan)?x.paymentPlan:[],paymentPlanNeedsReview=Boolean(x.paymentPlanNeedsReview);if(origin==='США'&&quote&&paymentPlan.length!==4){const range=auctionDepositRange(x.total||quote.total),knownDeposit=Number(lead?.deposit)||0,deposit=knownDeposit||Math.round((range.min+range.max)/2);paymentPlan=buildUsPaymentPlan({...quote,origin,total:Number(x.total)||Number(quote.total)||0},deposit,{needsReview:!knownDeposit});paymentPlanNeedsReview=!knownDeposit;}const payments=paymentPlan.length?migratePaymentsToPlan(rawPayments,paymentPlan):rawPayments;return{...x,origin,transportMode:x.transportMode||defaultTransportMode(origin),paymentPlan,paymentPlanNeedsReview,payments,paid:paymentsTotal(payments),riskType,riskNote}});
const saveAll=()=>{persist(KEYS.leads,leads);persist(KEYS.quotes,quotes);persist(KEYS.orders,orders);persist(KEYS.notes,notes);persist(KEYS.catalog,cars)};
const noteEntry=value=>({id:'NOTE-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),at:new Date().toISOString(),text:value});
const entityErrorText=error=>error?.code==='catalog_car_binding_required'
  ?'Не удалось сохранить выбранный автомобиль. Закройте форму, обновите Mini App и повторно нажмите «Получить расчёт» в карточке машины.'
  :error?.code==='catalog_car_not_available'
    ?'Выбранный автомобиль больше не доступен в каталоге. Обновите Mini App и откройте другую карточку.'
  :error?.code==='telegram_auth_required'
  ?'Авторизация не подтверждена. Обновите страницу и войдите через VK ID ещё раз.'
  :error?.code==='origin_forbidden'
    ?'Запрос отклонён проверкой безопасности. Обновите страницу и попробуйте снова.'
    :error?.code==='entity_conflict'
      ?'Данные изменились в другом окне. Карточка обновлена с сервера — повторите действие.'
  :Array.isArray(error?.data?.details)&&error.data.details.length?error.data.details.join(' ')
  :'Не удалось сохранить изменения. Проверьте данные и повторите.';
const leadDeleteErrorText=error=>error?.code==='entity_conflict'
  ?'Карточка изменилась в другом окне. Закройте окно удаления и попробуйте ещё раз.'
  :error?.code==='lead_not_found'
    ?'Заявка уже удалена.'
    :'Не удалось удалить заявку. Данные не были удалены — повторите действие.';
async function commitEntities(operations,form=null){
  if(!window.__AUTO_SALE_ENTITY_BATCH__)return{ok:true,localOnly:true};
  try{return await window.__AUTO_SALE_ENTITY_BATCH__(operations)}
  catch(error){if(form)showErrors(form,[entityErrorText(error)]);else console.warn('AUTO SALE entity action rejected',error);return null}
}
function reloadFromCache(){
  leads=parse(localStorage,KEYS.leads,[])||[];
  quotes=parse(localStorage,KEYS.quotes,[])||[];
  orders=parse(localStorage,KEYS.orders,[])||[];
  notes=parse(localStorage,KEYS.notes,{})||{};
  const nextCars=parse(localStorage,KEYS.catalog,[]);
  if(Array.isArray(nextCars))cars=nextCars;
}
saveAll();

let access=window.__AUTO_SALE_ACCESS__||{role:'admin',authenticated:false,member:{name:'Test staff'},testHarnessFallback:true};
let hasAdminAccess=access.role==='admin';
const roleLabels={client:'Клиент',manager:'Работа',owner:'Аналитика'};
const roleIcons={client:'user',manager:'briefcase',owner:'chart'};
const nav={client:[['home','Главная','home'],['catalog','Авто','car'],['orders','Мои заказы','clipboard'],['about','Как работаем','route']],manager:[['work','Работа','dashboard'],['leads','Лиды','users'],['quotes','Расчёты','calculator'],['catalogAdmin','Каталог','car'],['shipping','Логистика','truck']],owner:[['overview','Обзор','dashboard'],['pipeline','Продажи','chart'],['finance','Финансы','wallet'],['ordersAdmin','Заказы','clipboard']]};
function uiIcon(name){const icons={
home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-5h5v5"/>',
car:'<path d="m5 11 1.8-4h10.4L19 11"/><path d="M4 11h16v6H4z"/><path d="M6.5 17v2M17.5 17v2"/><circle cx="7.5" cy="14" r="1"/><circle cx="16.5" cy="14" r="1"/>',
clipboard:'<path d="M9 5h6"/><path d="M9 3h6v4H9z"/><path d="M7 5H5v16h14V5h-2"/><path d="m8 13 2 2 5-5"/>',
route:'<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3"/>',
dashboard:'<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
calculator:'<path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01"/>',
truck:'<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
wallet:'<path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6z"/><path d="M4 6V4h12v2M16 12h4"/><circle cx="16" cy="12" r=".8"/>',
user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
briefcase:'<path d="M4 7h16v12H4z"/><path d="M9 7V4h6v3M4 12h16M10 12v2h4v-2"/>',
crown:'<path d="m4 8 4 4 4-7 4 7 4-4-2 10H6z"/><path d="M7 21h10"/>'
};return '<svg class="auto-ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(icons[name]||icons.home)+'</svg>'}
const savedRole=sessionStorage.getItem(KEYS.role);
const initialRole=access.testHarnessFallback?(nav[savedRole]?savedRole:'client'):(hasAdminAccess&&['manager','owner'].includes(savedRole)?savedRole:(hasAdminAccess?'manager':'client'));
const state={role:initialRole,route:'home',query:'',brand:'all',origin:'all',budget:'all',leadQuery:'',leadStatus:'all',leadSource:'all',leadManager:'all',orderQuery:'',orderStage:'all',orderManager:'all',orderRisk:'all',modal:null};
state.route=nav[state.role][0][0];
function refreshRuntimeFromServer(){
  // A live customer can open a catalog request before the initial /state returns.
  // Never discard its exact car ID or already typed fields when the response arrives.
  const request=root.querySelector('#requestForm');
  const clientRequest=state.role==='client'&&state.modal?.type==='request'&&state.modal.managerMode!==true
    &&request?.elements.managerMode?.value==='0';
  const pendingModal=clientRequest?{...state.modal}:null;
  const pendingValues=clientRequest?Object.fromEntries(new FormData(request).entries()):null;
  reloadFromCache();
  access=window.__AUTO_SALE_ACCESS__||access;
  hasAdminAccess=access.role==='admin';
  const saved=sessionStorage.getItem(KEYS.role);
  const nextRole=hasAdminAccess&&['manager','owner'].includes(saved)?saved:(hasAdminAccess?'manager':'client');
  if(!hasAdminAccess||state.role==='client')state.role=nextRole;
  if(!nav[state.role]?.some(([id])=>id===state.route))state.route=nav[state.role][0][0];
  state.modal=pendingModal&&state.role==='client'?pendingModal:null;
  render();
  if(pendingValues&&state.modal===pendingModal){
    const form=root.querySelector('#requestForm');
    if(form){
      // Restore only editable customer fields. Catalog ID and specs must always come
      // from the selected immutable modal context and the reloaded catalog.
      const editable=pendingModal.carId
        ?['name','contact','damage','deliveryCity','note']
        :['name','contact','model','origin','ageRange','engine','drive','damage','deliveryCity','note'];
      for(const key of editable){
        const field=form.elements[key];
        if(field&&pendingValues[key]!==undefined&&pendingValues[key]!=='')field.value=pendingValues[key];
      }
      if(pendingModal.carId&&!cars.some(car=>car.id===pendingModal.carId&&car.active!==false))
        showErrors(form,['Выбранная карточка больше не доступна. Закройте заявку и откройте актуальную карточку каталога.']);
    }
  }
}
window.addEventListener('auto-sale-server-synced',()=>queueMicrotask(refreshRuntimeFromServer));
const dashboard=()=>dashboardStats(leads,orders,quotes);
const finances=()=>financeStats(orders);
const taskDue=l=>l.nextAction&&l.nextAction<=today&&!['Сделка','Отказ'].includes(l.status);
const orderRisk=o=>(o.riskType||o.risk||'Нет')==='Нет'?'Нет':(o.riskNote||o.riskType||o.risk);
const statusClass=v=>/Отказ|риск|Документ|ожида|Новый|Черновик|уточ|Задерж/i.test(v||'')?'warn':/Сделка|Согласован|В пути|В море|Тамож|Выдача|Нет/i.test(v||'')?'good':'';
function brand(){return `<button class="auto-brand auto-brand-image" data-go="${nav[state.role][0][0]}" aria-label="АвтоМир Грузия — на главную"><img class="auto-brand-logo" src="./auto-sale-logo-automir-v5.webp?v=20260926-brand-v5" alt="" decoding="async"></button>`}
function shell(content){const d=dashboard(),f=finances();const switcher=hasAdminAccess?`<div class="auto-role-switch">${Object.entries(roleLabels).map(([id,label])=>`<button data-role="${id}" class="${state.role===id?'active':''}"><span class="auto-role-icon">${uiIcon(roleIcons[id])}</span><span>${label}</span></button>`).join('')}</div>`:'';return `<div class="auto-shell"><header class="auto-topbar">${brand()}${switcher}</header>${state.role!=='client'?`<div class="auto-role-strip"><span>Админ-доступ · ${state.role==='manager'?'операционная работа':'аналитика'}</span><b>${state.role==='manager'?`${d.activeLeads} активных лидов · ${d.risky} риска`:`${money(f.turnover)} оборот · ${d.conversion}% конверсия`}</b><small>${esc(access.member?.name||'Сотрудник')} · одинаковый уровень доступа для менеджеров и директора</small></div>`:''}<main class="auto-main">${content}</main><nav class="auto-bottom ${state.role==='manager'?'manager-five':''}">${nav[state.role].map(([id,label,ico])=>`<button data-go="${id}" class="${state.route===id?'active':''}"><strong class="auto-tab-icon">${uiIcon(ico)}</strong><span>${label}</span></button>`).join('')}</nav>${state.modal?modal():''}</div>`}

function hero(){
  return `<section class="auto-hero auto-hero-premium auto-hero-simple">
    <div class="auto-hero-copy">
      <h1>Автомобили<br>из <span>США</span> и <em>Грузии</em><br>с доставкой в Россию</h1>
      <p>Подбор и проверка лота, прозрачный расчёт, выкуп и доставка под ключ — со статусом заказа в приложении.</p>
      <div class="auto-actions auto-hero-actions"><button class="auto-btn ghost" data-go="catalog">Смотреть каталог</button><button class="auto-btn primary" data-open-request>Подобрать автомобиль <span aria-hidden="true">→</span></button></div>
    </div>
  </section>`
}
function purchaseWays(){return `<section class="auto-section auto-purchase-ways"><div class="auto-section-head"><div><span class="auto-eyebrow">ДВА СЦЕНАРИЯ</span><h2>Два способа купить автомобиль</h2></div><p>Сразу выбираем маршрут сделки — условия расчёта и логистики отличаются.</p></div><div class="auto-panel-grid"><button type="button" class="auto-panel auto-purchase-choice" data-purchase-origin="США" aria-label="Показать автомобили с аукционов США"><span class="auto-status good">Аукцион США</span><h3>Покупка на аукционе</h3><p class="auto-muted-copy">Вы выбираете лот, мы проверяем автомобиль и участвуем в торгах. Этот сценарий может дать более низкую конечную стоимость, но требует времени на океанскую логистику.</p></button><button type="button" class="auto-panel auto-purchase-choice" data-purchase-origin="Грузия" aria-label="Показать автомобили в Грузии"><span class="auto-status">Авто в Грузии</span><h3>Покупка автомобиля в Грузии</h3><p class="auto-muted-copy">Покупаем автомобиль, который уже находится в Грузии. Аукционного этапа и ожидания доставки из США нет.</p></button></div></section>`}
function process(){const steps=[['01','Запрос','Фиксируем требования и бюджет.'],['02','Подбор','Находим и проверяем подходящие лоты.'],['03','Расчёт','Согласуем полную стоимость и депозит.'],['04','Выкуп и доставка','Выкуп → перевозка → таможня → доставка.'],['05','Выдача','Документы, финальный расчёт и передача авто.']];return `<section class="auto-section auto-process-section"><div class="auto-section-head"><div><span class="auto-eyebrow">ПРОЦЕСС</span><h2>Каждый этап фиксируется в системе</h2></div><p>Следующий шаг доступен только когда заполнены данные предыдущего.</p></div><div class="auto-process">${steps.map(s=>`<article class="auto-step"><i>${s[0]}</i><b>${s[1]}</b><span>${s[2]}</span></article>`).join('')}</div></section>`}
function carCard(c){const origin=carOrigin(c),isUs=origin==='США',ended=auctionEnded(c),scenario=purchaseScenarioLabel(origin);return `<article class="auto-car${ended?' auction-ended':''}"><div class="auto-car-media"><img src="${c.image}" alt="${esc(c.brand+' '+c.model)}"><span class="auto-chip">${esc(c.tag||scenario)}</span></div><div class="auto-car-body"><div class="auto-car-top"><div><small>${c.year} · ${esc(scenario)}${isUs&&c.auction?` · ${esc(c.auction)}`:''}</small><h3>${esc(c.brand+' '+c.model)}</h3></div><div class="auto-price">${catalogPriceHtml(c)}</div></div>${isUs?`<div class="auto-auction-date${ended?' ended':''}"><span>${ended?'Аукцион завершён':'Дата аукциона&nbsp;'}</span><b>${esc(auctionDateText(c.auctionDate))}</b></div>`:`<div class="auto-auction-date"><span>Сценарий</span><b>Покупка в Грузии</b></div>`}<div class="auto-specs"><span>${esc(c.mileage||'—')}</span><span>${esc(c.engine||'—')}</span><span>${esc(c.drive||'—')}</span></div><div class="auto-card-actions"><button class="auto-btn primary auto-calc-btn" data-request-car="${c.id}" ${ended?'disabled aria-disabled="true" title="Аукцион завершён"':''}><span class="auto-calc-glint" aria-hidden="true"></span><span class="auto-calc-label">Рассчитать</span></button><button class="auto-btn ghost" data-detail="${c.id}">Подробнее</button></div></div></article>`}
function home(){const publicCars=sortedByAuction(cars.filter(c=>c.active!==false&&supportedClientOrigin(carOrigin(c))));return hero()+purchaseWays()+process()+`<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">КАТАЛОГ</span><h2>Автомобили в каталоге</h2></div><button class="auto-btn ghost" data-go="catalog">Весь каталог →</button></div><div class="auto-grid">${publicCars.slice(0,3).map(carCard).join('')}</div></section>`}
function filteredCars(){return sortedByAuction(cars.filter(c=>c.active!==false&&supportedClientOrigin(carOrigin(c))).filter(c=>{const q=state.query.toLowerCase().trim(),usd=Number(c.price)||0;return(!q||`${c.brand} ${c.model} ${c.year} ${c.engine} ${c.vin||''} ${carOrigin(c)}`.toLowerCase().includes(q))&&(state.brand==='all'||c.brand===state.brand)&&(state.origin==='all'||carOrigin(c)===state.origin)&&(state.budget==='all'||usd>0&&(state.budget==='35'&&usd<=35000||state.budget==='45'&&usd>35000&&usd<=45000||state.budget==='46'&&usd>45000))}))}
function catalog(){const active=cars.filter(c=>c.active!==false&&supportedClientOrigin(carOrigin(c))),rows=filteredCars(),brands=[...new Set(active.map(c=>c.brand))],origins=[...new Set(active.map(carOrigin))];return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">ДВА СЦЕНАРИЯ</span><h2>Варианты для заказа</h2></div><p>Аукцион США и автомобили в Грузии — два разных сценария покупки с разной логистикой.</p></div><div class="auto-filters"><input id="autoSearch" placeholder="Поиск: марка, модель, VIN…" value="${esc(state.query)}"><select id="brandFilter"><option value="all">Все марки</option>${brands.map(b=>`<option value="${esc(b)}" ${state.brand===b?'selected':''}>${esc(b)}</option>`).join('')}</select><select id="originFilter"><option value="all">Оба сценария</option>${origins.map(x=>`<option value="${esc(x)}" ${state.origin===x?'selected':''}>${esc(purchaseScenarioLabel(x))}</option>`).join('')}</select><select id="budgetFilter"><option value="all">Любой бюджет</option><option value="35" ${state.budget==='35'?'selected':''}>до $35 000</option><option value="45" ${state.budget==='45'?'selected':''}>$35–45 000</option><option value="46" ${state.budget==='46'?'selected':''}>от $45 000</option></select></div><div class="auto-grid">${rows.length?rows.map(carCard).join(''):`<div class="auto-empty">По заданным фильтрам вариантов нет.</div>`}</div></section>`}
function managerCatalog(){
  const rows=sortedByAuction(cars);
  return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">КАТАЛОГ</span><h2>Автомобили для клиентов</h2></div><button class="auto-btn primary" data-catalog-add>+ Добавить авто</button></div><article class="auto-panel"><div class="auto-data-table catalog"><div class="auto-data-head"><span>Автомобиль</span><span>Локация</span><span>Год</span><span>Цена</span><span>Аукцион</span><span>Дата аукциона</span><span>Публикация</span><span></span></div>${rows.map(c=>`<button class="auto-data-row" data-catalog-edit="${esc(c.id)}"><span><b>${esc(c.brand+' '+c.model)}</b><small>${esc(c.engine)} · ${esc(c.drive)}</small></span><span>${esc(carOrigin(c))}</span><span>${c.year||'—'}</span><span>${catalogPriceText(c)}</span><span>${esc(c.auction||'—')}</span><span>${esc(auctionDateText(c.auctionDate))}</span><span class="auto-status ${c.active===false?'warn':'good'}">${c.active===false?'Скрыто':'Опубликовано'}</span><span class="auto-row-action">→</span></button>`).join('')}</div></article></section>`;
}
function modalCatalogCar(car){
  const c=car||{id:'',brand:'',model:'',year:new Date().getFullYear(),origin:'',mileage:'',engine:'',drive:'',auction:'',auctionDate:'',price:0,delivery:'Срок по запросу',tag:'',image:'',interiorPhotos:[],otherPhotos:[],active:true};
  return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide"><div class="auto-modal-head"><div><span class="auto-eyebrow">${car?'РЕДАКТИРОВАНИЕ':'НОВЫЙ АВТОМОБИЛЬ'}</span><h2>${car?esc(c.brand+' '+c.model):'Добавить авто в каталог'}</h2></div><button class="auto-close" data-close>×</button></div><form class="auto-form" id="catalogCarForm"><input type="hidden" name="id" value="${esc(c.id)}"><label>Марка<input name="brand" required value="${esc(c.brand)}"></label><label>Модель<input name="model" required value="${esc(c.model)}"></label><label>Год выпуска<input name="year" required type="number" min="2000" max="2030" value="${Number(c.year)||new Date().getFullYear()}"></label><label>Сценарий покупки<select name="origin" required>${car?'':'<option value="" selected>Выберите США или Грузия</option>'}${managerOriginOptions(carOrigin(c)).map(x=>`<option value="${esc(x)}" ${carOrigin(c)===x?'selected':''}>${esc(x)}${CLIENT_ORIGINS.includes(x)?'':' · архив'}</option>`).join('')}</select></label><label>Пробег<input name="mileage" required value="${esc(c.mileage)}" placeholder="38 000 км"></label><label>Двигатель<input name="engine" required value="${esc(c.engine)}" placeholder="3.0 бензин"></label><label>Точный объём двигателя, см³<input name="engineCc" type="number" min="0" step="1" value="${Number(c.engineCc)||''}" placeholder="По ПТС/документам"></label><label>Мощность, метрические л.с.<input name="powerHp" type="number" min="0" step="any" value="${Number(c.powerHp)||''}" placeholder="По документам"></label><label>Месяц выпуска<input name="manufactureDate" type="month" value="${esc(c.manufactureDate||'')}"></label><label>Привод<select name="drive"><option value="" ${c.drive?'':'selected'}>Уточняется</option>${['AWD','4WD','FWD','RWD'].map(x=>`<option ${c.drive===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Аукцион / площадка<input name="auction" value="${esc(c.auction)}" placeholder="Если применимо"></label><label>Дата аукциона<input name="auctionDate" value="${esc(c.auctionDate||'')}" placeholder="ДД.ММ.ГГГГ" inputmode="numeric"></label><label>Цена под ключ, $<input name="price" type="number" min="0" step="100" value="${Number(c.price)||0}"></label><label>Цена до скидки, ₽<input name="priceBeforeDiscountRub" type="number" min="0" step="1000" value="${Number(c.priceBeforeDiscountRub)||0}"></label><label>Цена со скидкой / текущая, ₽<input name="priceRub" type="number" min="0" step="1000" value="${Number(c.priceRub)||0}"></label><label>Срок доставки<input name="delivery" required value="${esc(c.delivery)}"></label><label>Метка<input name="tag" value="${esc(c.tag)}" placeholder="Premium SUV"></label>${catalogPhotoEditor(c)}<label class="full director-check"><input name="active" type="checkbox" ${c.active===false?'':'checked'}> Показывать клиентам</label><div class="auto-form-actions catalog-actions">${car?`<button type="button" class="auto-btn danger" data-catalog-delete="${esc(c.id)}">Удалить автомобиль</button>`:''}<span class="catalog-actions-spacer"></span><button type="button" class="auto-btn ghost" data-close>Отмена</button><button type="submit" class="auto-btn primary">Сохранить автомобиль</button></div></form></div></div>`;
}
async function submitCatalogCar(form){
  const data=Object.fromEntries(new FormData(form).entries());
  const brand=String(data.brand||'').trim(),model=String(data.model||'').trim(),origin=String(data.origin||'').trim();
  const url=String(data.imageUrl||'').trim(),image=url||String(data.image||'').trim();
  const interiorPhotos=parsePhotoList(data.interiorPhotos),otherPhotos=parsePhotoList(data.otherPhotos);
  const requestedId=String(data.id||'').trim(),isNew=!requestedId,isPublished=Boolean(form.elements.active?.checked);
  const errors=[];if(!brand)errors.push('Укажите марку.');if(!model)errors.push('Укажите модель.');if(!image)errors.push('Добавьте главное фото автомобиля.');if((isNew||isPublished)&&!supportedClientOrigin(origin))errors.push('Для нового или публикуемого автомобиля выберите сценарий США или Грузия.');const beforeDiscount=Number(data.priceBeforeDiscountRub)||0,currentRub=Number(data.priceRub)||0;if(beforeDiscount>0&&currentRub>beforeDiscount)errors.push('Цена после скидки не может быть выше цены до скидки.');if(errors.length){showErrors(form,errors);return}
  let id=requestedId;if(!id)id=`CAR-${Date.now()}`;
  const existing=cars.find(x=>x.id===id)||{};
  const next={...existing,id,brand,model,year:Number(data.year)||new Date().getFullYear(),mileage:String(data.mileage||'').trim(),engine:String(data.engine||'').trim(),engineCc:Number(data.engineCc)||0,powerHp:Number(data.powerHp)||0,manufactureDate:String(data.manufactureDate||'').trim(),drive:String(data.drive||''),origin:origin||String(existing.origin||'Уточняется'),auction:String(data.auction||'').trim(),auctionDate:String(data.auctionDate||'').trim(),price:Number(data.price)||0,priceBeforeDiscountRub:beforeDiscount,priceAfterDiscountRub:beforeDiscount>currentRub&&currentRub>0?currentRub:0,priceRub:currentRub,delivery:String(data.delivery||'').trim()||'Срок по запросу',tag:String(data.tag||'').trim(),image,interiorPhotos,otherPhotos,active:form.elements.active.checked};
  const saved=window.__AUTO_SALE_ENTITY_BATCH__?await commitEntities([{resource:'catalog',operation:isNew?'create':'patch',id,input:next}],form):{ok:true,localOnly:true};if(!saved)return;
  const i=cars.findIndex(x=>x.id===id);if(i>=0)cars[i]=next;else cars.push(next);
  saveAll();state.modal=null;state.route='catalogAdmin';render();
}
async function deleteLeadAndApplication(id){
  const lead=leads.find(item=>item.id===id);
  if(!lead)return;
  const quoteIds=new Set(quotes.filter(item=>item.leadId===id).map(item=>item.id));
  const orderIds=new Set(orders.filter(item=>item.leadId===id).map(item=>item.id));
  if(!window.__AUTO_SALE_DELETE_LEAD__){
    state.modal={type:'deleteLead',id,error:'Удаление недоступно: серверная функция не загружена.'};
    render();
    return;
  }
  try{
    await window.__AUTO_SALE_DELETE_LEAD__(id);
  }catch(error){
    state.modal={type:'deleteLead',id,error:leadDeleteErrorText(error)};
    render();
    return;
  }
  leads=leads.filter(item=>item.id!==id);
  quotes=quotes.filter(item=>item.leadId!==id&&!quoteIds.has(item.id));
  orders=orders.filter(item=>item.leadId!==id&&!orderIds.has(item.id));
  if(notes&&typeof notes==='object')delete notes[id];
  saveAll();
  state.modal=null;
  render();
}

async function deleteCatalogCar(id){
  const car=cars.find(x=>x.id===id);if(!car)return;
  const ok=typeof confirm==='function'?confirm(`Удалить ${car.brand} ${car.model} из каталога? Это действие нельзя отменить.`):true;
  if(!ok)return;
  const photos=[car.image,...(Array.isArray(car.interiorPhotos)?car.interiorPhotos:[]),...(Array.isArray(car.otherPhotos)?car.otherPhotos:[])].filter(Boolean);
  const removed=window.__AUTO_SALE_ENTITY_BATCH__?await commitEntities([{resource:'catalog',operation:'delete',id}]):{ok:true,localOnly:true};if(!removed)return;
  cars=cars.filter(x=>x.id!==id);
  saveAll();state.modal=null;state.route='catalogAdmin';render();
  for(const url of photos)await deleteCatalogPhoto(url);
}

function timeline(stage){const idx=orderStageIndex(stage);return `<div class="auto-timeline auto-timeline-full">${ORDER_STAGES.map((s,i)=>`<span class="${i<=idx?'done':''}">${s}</span>`).join('')}</div>`}
function clientOrders(){const clientLeads=leads.filter(x=>x.clientCreated);const cards=clientLeads.map(lead=>{const order=orders.find(x=>x.leadId===lead.id),quote=quotes.filter(x=>x.leadId===lead.id).sort((a,b)=>b.version-a.version)[0],stage=clientStage(lead,order);return `<article class="auto-order-card" data-client-lead="${esc(lead.id)}" tabindex="0" role="button" aria-label="Открыть заказ ${esc(order?.model||lead.model||lead.id)}"><div class="auto-order-head"><div><h3>${esc(order?.model||lead.model)}</h3><small>${esc(lead.id)} · менеджер ${esc(lead.manager||'назначается')}</small></div><div class="auto-price"><b>${quote?.total?money(quote.total):Number(lead.estimatedCostRub)>0?rubMoney(lead.estimatedCostRub):lead.budget?`до ${money(lead.budget)}`:'по расчёту'}</b><span>${order?.stage||quote?.status||lead.status}</span></div></div>${timeline(stage)}<div class="auto-order-meta"><span><b>Следующий шаг</b>${order?`ETA ${dateRu(order.eta)}`:`${dateRu(lead.nextAction)} · ${esc(lead.status)}`}</span>${supportedClientOrigin(order?.origin||lead.origin)?`<span><b>Сценарий</b>${esc(purchaseScenarioLabel(order?.origin||lead.origin))}</span>`:''}<span><b>Параметры</b>${esc(catalogLeadSpecsText(lead))}</span></div>${quote?.origin==='США'&&quote.status!=='Черновик'?vehicleVerificationView(quote,true):''}${order?.paymentPlan?.length?`<div class="auto-client-payment-block"><h4>Оплата по этапам</h4>${paymentPlanView(order)}</div>`:''}<div class="auto-order-open-hint"><span>Открыть подробности</span><strong>→</strong></div></article>`}).join('');return `<section class="auto-section" data-client-orders><div class="auto-section-head"><div><span class="auto-eyebrow">МОИ ЗАКАЗЫ</span><h2>Заявки и статус поставки</h2></div><button class="auto-btn primary" data-open-request>Новый запрос</button></div>${cards||'<div class="auto-empty">Ваших заявок пока нет.</div>'}</section>`}
function about(){return purchaseWays()+process()+`<section class="auto-panel-grid"><article class="auto-panel"><h3>До выкупа</h3><p class="auto-muted-copy">До согласования лота клиент получает досье проверки: LOT, VIN, год, пробег, повреждения, фото до покупки, историю/отчёт и итог проверки. Заказ появляется только после согласования проверенного варианта и фиксации депозита.</p></article><article class="auto-panel"><h3>После выкупа</h3><p class="auto-muted-copy">LOT, VIN, ETA и локация ведутся в карточке заказа. Для аукциона США оплата разбита на 4 этапа: аванс 25–30%, расчёт после победы, логистика/легализация и платежи ФТС.</p></article></section>`}

function kpi(label,value,sub='',tone=''){return `<div class="auto-kpi ${tone}"><span>${label}</span><b>${value}</b>${sub?`<small>${sub}</small>`:''}</div>`}
function leadStatusBadge(l){return `<span class="auto-status ${statusClass(l.status)}">${esc(l.status)}</span>`}
function leadTable(rows){return `<div class="auto-data-table"><div class="auto-data-head"><span>Клиент / запрос</span><span>Бюджет</span><span>Источник</span><span>Менеджер</span><span>Статус</span><span></span></div>${rows.map(l=>`<button class="auto-data-row" data-lead="${l.id}"><span><b>${esc(l.name)}</b><small>${esc(l.model)}</small>${isCatalogVehicleLead(l)?`<small>${esc(catalogLeadSpecsText(l))}</small>`:''}</span><span>${l.budget?money(l.budget):Number(l.estimatedCostRub)>0?rubMoney(l.estimatedCostRub):'уточнить'}</span><span>${esc(l.source)}</span><span>${esc(l.manager)}</span>${leadStatusBadge(l)}<span class="auto-row-action">→</span></button>`).join('')}</div>`}
function managerWork(){const d=dashboard(),due=leads.filter(taskDue).slice(0,5),risky=orders.filter(o=>orderRisk(o)!=='Нет').slice(0,4),recent=[...leads].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5);return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">РАБОЧИЙ СТОЛ</span><h2>Сегодня у менеджера</h2></div><p>Следующие действия, расчёты, депозиты и логистика.</p></div><div class="auto-kpis auto-kpis-admin">${kpi('Активные лиды',d.activeLeads,`${d.newLeads} новых`)}${kpi('Просрочено / сегодня',due.length,'следующие действия',due.length?'alert':'')}${kpi('Расчёты открыты',d.openQuotes)}${kpi('Риски в логистике',risky.length,'требуют внимания',risky.length?'alert':'')}</div><div class="auto-panel-grid admin"><article class="auto-panel"><h3>Ближайшие действия</h3><div class="auto-stack">${due.map(l=>`<button class="auto-task" data-lead="${l.id}"><span class="auto-priority ${l.priority==='Высокий'?'high':''}">${esc(l.priority)}</span><div><b>${esc(l.name)} · ${esc(l.model)}</b><small>${esc(l.status)} · до ${dateRu(l.nextAction)}</small></div><strong>Открыть</strong></button>`).join('')||'<div class="auto-empty compact">Просроченных задач нет.</div>'}</div></article><article class="auto-panel"><h3>Риски поставок</h3><div class="auto-stack">${risky.map(o=>`<button class="auto-task" data-order="${o.id}"><span class="auto-priority high">!</span><div><b>${esc(o.model)}</b><small>${esc(orderRisk(o))} · ${esc(o.stage)}</small></div><strong>${esc(o.id)}</strong></button>`).join('')||'<div class="auto-empty compact">Рисков нет.</div>'}</div></article></div><article class="auto-panel"><div class="auto-panel-title"><h3>Последние обращения</h3><button class="auto-btn primary small" data-manager-new>+ Новый лид</button></div>${leadTable(recent)}</article></section>`}
function managerLeads(){const rows=filterLeads(leads,{query:state.leadQuery,status:state.leadStatus,source:state.leadSource,manager:state.leadManager});return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">CRM</span><h2>Лиды и клиенты</h2></div><button class="auto-btn primary" data-manager-new>+ Добавить лид</button></div><div class="auto-admin-filters"><input id="leadSearch" placeholder="Клиент, модель, контакт…" value="${esc(state.leadQuery)}"><select id="leadStatusFilter"><option value="all">Все статусы</option>${LEAD_STATUSES.map(x=>`<option ${state.leadStatus===x?'selected':''}>${x}</option>`).join('')}</select><select id="leadSourceFilter"><option value="all">Все источники</option>${SOURCE_OPTIONS.map(x=>`<option ${state.leadSource===x?'selected':''}>${x}</option>`).join('')}</select><select id="leadManagerFilter"><option value="all">Все менеджеры</option>${activeManagers().map(x=>`<option ${state.leadManager===x?'selected':''}>${x}</option>`).join('')}</select></div><article class="auto-panel">${rows.length?leadTable(rows):'<div class="auto-empty">Ничего не найдено.</div>'}</article></section>`}
function quoteBreakdown(q){
 const origin=q?.origin||'Уточняется',mode=q?.transportMode||defaultTransportMode(origin),rows=quoteCostRows(q);
 const duration=origin==='США'?'2,5–3,5 месяца':'5–10 дней';
 const context='<div class="auto-quote-context"><span>Сценарий: <b>'+esc(purchaseScenarioLabel(origin))+'</b></span><span>Перевозка: <b>'+esc(mode)+'</b></span>'+(v2Quote(q)?'<span>Курс ЦБ РФ: <b>'+esc(q.cbrRubRate)+' ₽/$ · '+esc(q.exchangeRateDate||'не указан')+'</b> (для расчёта +4%)</span>':(q?.tariffVersion===AWG_GEORGIA_TARIFF_VERSION?'<span>Курс: <b>'+esc(q.usdRubRate)+' ₽/$ · '+esc(q.exchangeRateDate||'не указан')+'</b></span>':''))+((!v2Quote(q)&&(q?.tariffVersion===AWG_TARIFF_VERSION||q?.tariffVersion===AWG_GEORGIA_TARIFF_VERSION))?'<span>Легализация с услугой: <b>'+money(awgPackageUsd(q))+'</b></span><span>Срок доставки: <b>'+duration+'</b></span>':'')+'</div>';
 const details='<div class="auto-quote-grid">'+rows.map(x=>'<span><b>'+esc(x.label)+'</b>'+(x.displayValue?esc(x.displayValue):(q?.tariffVersion===AWG_GEORGIA_TARIFF_VERSION?formatGeorgiaUsd(x.value):money(x.value)))+'</span>').join('')+'</div>';
 return context+details;
}
function managerQuotes(){return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">РАСЧЁТЫ</span><h2>Калькуляции клиентам</h2></div><button class="auto-btn primary" data-new-quote>+ Новый расчёт</button></div><div class="auto-quote-list">${[...quotes].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).map(q=>{const lead=leads.find(x=>x.id===q.leadId);let action='';if(q.status==='Черновик')action='<button class="auto-btn primary" data-quote-action="Отправлен" data-id="'+q.id+'">Отправить</button>';if(q.status==='Отправлен')action='<button class="auto-btn primary" data-quote-action="На согласовании" data-id="'+q.id+'">На согласовании</button>';if(q.status==='На согласовании')action='<button class="auto-btn primary" data-quote-action="Согласован" data-id="'+q.id+'">Согласовать</button>';if(['Согласован','Отказ'].includes(q.status))action='<button class="auto-btn ghost" data-clone-quote="'+q.id+'">Новая версия</button>';return `<article class="auto-quote-card"><div class="auto-quote-head"><div><span class="auto-status ${statusClass(q.status)}">${esc(q.status)}</span><h3>${esc(q.model)}</h3><small>${esc(lead?.name||q.leadId)} · v${q.version||1}${q.tariffVersion===AWG_GEORGIA_TARIFF_VERSION?'':' · действует до '+dateRu(q.validUntil)}</small></div><div class="auto-price"><b>${q.tariffVersion===AWG_GEORGIA_TARIFF_VERSION?formatGeorgiaUsd(q.total):money(q.total)}</b><span>${q.status==='Черновик'?'черновик · не окончательная цена':'предложение под ключ'}</span></div></div>${quoteBreakdown(q)}${q.origin==='США'?vehicleVerificationView(q,true):''}<div class="auto-card-actions admin"><button class="auto-btn ghost" data-quote="${q.id}">${q.status==='Согласован'?'Открыть':'Редактировать'}</button>${action}</div></article>`}).join('')}</div></section>`}
function orderProgress(o){const idx=orderStageIndex(o.stage),p=Math.round(idx/(ORDER_STAGES.length-1)*100);return `<div class="auto-progress"><div><i style="width:${p}%"></i></div><span>${p}%</span></div>`}
function orderTable(rows,owner=false){return `<div class="auto-data-table orders"><div class="auto-data-head"><span>Заказ / клиент</span><span>Этап</span><span>ETA</span><span>${owner?'Маржа':'Локация'}</span><span>Риск</span><span></span></div>${rows.map(o=>`<button class="auto-data-row" data-order="${o.id}"><span><b>${esc(o.id)} · ${esc(o.model)}</b><small>${esc(o.customer)} · lot ${esc(o.lot||'—')} · VIN ${esc(o.vin||'—')}</small></span><span><b>${esc(normalizeOrderStage(o.stage))}</b>${orderProgress(o)}</span><span>${dateRu(o.eta)}</span><span>${owner?money(o.total-o.cost):esc(o.location||'—')}</span><span class="auto-status ${orderRisk(o)==='Нет'?'good':'warn'}">${esc(orderRisk(o))}</span><span class="auto-row-action">→</span></button>`).join('')}</div>`}
function managerShipping(){const rows=filterOrders(orders.map(o=>({...o,risk:orderRisk(o)})),{query:state.orderQuery,stage:state.orderStage,manager:state.orderManager,risk:state.orderRisk});return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">ЛОГИСТИКА</span><h2>Автомобили и контрольные точки</h2></div><p>Этап меняется последовательно; критичные поля проверяются.</p></div><div class="auto-admin-filters three"><input id="orderSearch" placeholder="Заказ, VIN, lot, клиент…" value="${esc(state.orderQuery)}"><select id="orderStageFilter"><option value="all">Все этапы</option>${ORDER_STAGES.map(x=>`<option ${state.orderStage===x?'selected':''}>${x}</option>`).join('')}</select><select id="orderRiskFilter"><option value="all">Все риски</option><option value="risk" ${state.orderRisk==='risk'?'selected':''}>Только с риском</option><option value="safe" ${state.orderRisk==='safe'?'selected':''}>Без риска</option></select></div><article class="auto-panel">${rows.length?orderTable(rows):'<div class="auto-empty">Заказов по фильтру нет.</div>'}</article></section>`}
function funnelBars(){const values=funnelStats(leads,orders),max=Math.max(...values.map(x=>x.value),1);return `<div class="auto-pipeline">${values.map(x=>`<div class="auto-pipe"><span>${esc(x.label)}</span><div class="auto-bar"><i style="width:${Math.round(x.value/max*100)}%"></i></div><b>${x.value}</b></div>`).join('')}</div>`}
function ownerOverview(){const d=dashboard(),f=finances(),ms=managerStats(leads,orders),ss=sourceStats(leads,orders);return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">ПАНЕЛЬ ДИРЕКТОРА</span><h2>Бизнес одним экраном</h2></div><p>Директор контролирует, но не меняет операционную логистику.</p></div><div class="auto-kpis auto-kpis-admin">${kpi('Оборот',money(f.turnover))}${kpi('Валовая маржа',money(f.margin),`${f.marginPct}%`)}${kpi('К получению',money(f.outstanding),'по заказам',f.outstanding?'alert':'')}${kpi('Конверсия',`${d.conversion}%`,`${d.deals} сделок`)}</div><div class="auto-panel-grid admin"><article class="auto-panel"><h3>Воронка продаж</h3>${funnelBars()}</article><article class="auto-panel"><h3>Контроль</h3><div class="auto-alert-list">${orders.filter(o=>orderRisk(o)!=='Нет').map(o=>`<button data-order="${o.id}"><b>${esc(o.id)} · ${esc(orderRisk(o))}</b><span>${esc(o.model)} · ${esc(o.stage)}</span></button>`).join('')||'<div class="auto-empty compact">Критичных отклонений нет.</div>'}</div></article></div><div class="auto-panel-grid admin"><article class="auto-panel"><h3>Команда</h3><div class="auto-data-table mini">${ms.map(m=>`<div class="auto-data-row static"><span><b>${esc(m.manager)}</b><small>${m.active} активных</small></span><span>${m.deals} сделки</span><span>${money(m.revenue)}</span><span>${money(m.margin)}</span></div>`).join('')}</div></article><article class="auto-panel"><h3>Источники</h3><div class="auto-data-table mini">${ss.map(s=>`<div class="auto-data-row static"><span><b>${esc(s.source)}</b><small>${s.leads} лидов</small></span><span>${s.deals} сделки</span><span>${s.conversion}%</span></div>`).join('')}</div></article></div></section>`}
function channelResponsePanel(){
  const rows=channelResponseStats(leads);
  return `<article class="auto-panel"><h3>Первая реакция по каналам</h3><p class="auto-muted-copy">От получения заявки до первого изменения статуса менеджером. Ожидание свыше 30 минут выделено отдельно.</p><div class="auto-data-table mini">${rows.map(row=>`<div class="auto-data-row static"><span><b>${esc(row.channel)}</b><small>${row.measured} измерений · ${row.unmeasured} без отметок</small></span><span>${esc(responseTimeLabel(row.averageResponseMinutes))}</span><span>${row.waiting} без реакции<small>${row.waitingOverLimit} &gt; 30 мин</small></span></div>`).join('')||'<div class="auto-empty compact">Обращений пока нет.</div>'}</div>${rows.filter(row=>row.waiting).map(row=>`<div class="auto-stack"><b>${esc(row.channel)} · ожидают менеджера</b>${row.waitingLeadIds.slice(0,10).map(id=>{const lead=leads.find(item=>item.id===id);return `<button class="auto-btn ghost" data-lead="${esc(id)}">${esc(lead?.name||id)} · ${esc(lead?.model||'Заявка')}</button>`}).join('')}</div>`).join('')}</article>`;
}
function ownerPipeline(){const ss=sourceStats(leads,orders),ms=managerStats(leads,orders),lost=lostReasons(leads);return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">ПРОДАЖИ</span><h2>Воронка и качество лидов</h2></div></div><div class="auto-panel-grid admin"><article class="auto-panel"><h3>Воронка</h3>${funnelBars()}</article><article class="auto-panel"><h3>Источники</h3><div class="auto-data-table mini">${ss.map(s=>`<div class="auto-data-row static"><span><b>${esc(s.source)}</b><small>${s.leads} лидов</small></span><span>${s.deals}</span><span>${s.conversion}%</span></div>`).join('')}</div></article></div><div class="auto-panel-grid admin"><article class="auto-panel"><h3>Менеджеры</h3><div class="auto-data-table mini">${ms.map(m=>`<div class="auto-data-row static"><span><b>${esc(m.manager)}</b><small>${m.leads} лидов</small></span><span>${m.deals}</span><span>${money(m.revenue)}</span><span>${money(m.margin)}</span></div>`).join('')}</div></article><article class="auto-panel"><h3>Причины отказов</h3><div class="auto-stack">${lost.map(x=>`<div class="auto-reason"><b>${esc(x.reason)}</b><span>${x.count}</span></div>`).join('')||'<div class="auto-empty compact">Отказов нет.</div>'}</div></article></div>${channelResponsePanel()}</section>`}
function ownerFinance(){const f=finances();return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">ФИНАНСЫ</span><h2>Деньги по заказам</h2></div><p>Оплачено рассчитывается по журналу платежей.</p></div><div class="auto-kpis auto-kpis-admin">${kpi('Оборот',money(f.turnover))}${kpi('Себестоимость',money(f.cost))}${kpi('Маржа',money(f.margin),`${f.marginPct}%`)}${kpi('Дебиторка',money(f.outstanding),`${money(f.paid)} получено`,f.outstanding?'alert':'')}</div><article class="auto-panel"><div class="auto-data-table finance"><div class="auto-data-head"><span>Заказ</span><span>Цена</span><span>Себестоимость</span><span>Маржа</span><span>Оплачено</span><span>Остаток</span></div>${orders.map(o=>`<button class="auto-data-row" data-order="${o.id}"><span><b>${esc(o.id)}</b><small>${esc(o.model)}</small></span><span>${money(o.total)}</span><span>${money(o.cost)}</span><span class="auto-positive">${money(o.total-o.cost)}</span><span>${money(o.paid)}</span><span class="${o.total-o.paid?'auto-negative':''}">${money(Math.max(0,o.total-o.paid))}</span></button>`).join('')}</div></article></section>`}
function ownerOrders(){const rows=filterOrders(orders.map(o=>({...o,risk:orderRisk(o)})),{query:state.orderQuery,stage:state.orderStage,manager:state.orderManager,risk:state.orderRisk});return `<section class="auto-section"><div class="auto-section-head"><div><span class="auto-eyebrow">ЗАКАЗЫ</span><h2>Все сделки и автомобили</h2></div><p>Режим контроля без редактирования логистики.</p></div><div class="auto-admin-filters four"><input id="orderSearch" placeholder="Заказ, VIN, lot, клиент…" value="${esc(state.orderQuery)}"><select id="orderStageFilter"><option value="all">Все этапы</option>${ORDER_STAGES.map(x=>`<option ${state.orderStage===x?'selected':''}>${x}</option>`).join('')}</select><select id="orderManagerFilter"><option value="all">Все менеджеры</option>${activeManagers().map(x=>`<option ${state.orderManager===x?'selected':''}>${x}</option>`).join('')}</select><select id="orderRiskFilter"><option value="all">Все риски</option><option value="risk" ${state.orderRisk==='risk'?'selected':''}>С риском</option><option value="safe" ${state.orderRisk==='safe'?'selected':''}>Без риска</option></select></div><article class="auto-panel">${orderTable(rows,true)}</article></section>`}

function modalRequest(prefill='',managerMode=false,prefillOrigin=''){const selected=state.modal?.carId?cars.find(car=>car.id===state.modal.carId):null;if(managerMode)return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal"><div class="auto-modal-head"><div><span class="auto-eyebrow">НОВЫЙ ЛИД</span><h2>Добавить клиента в CRM</h2></div><button class="auto-close" data-close>×</button></div><form class="auto-form" id="requestForm"><input type="hidden" name="managerMode" value="1"><label>Имя клиента<input name="name" required></label><label>Контакт<input name="contact" required placeholder="Telegram / WhatsApp / телефон"></label><label>Интересующий автомобиль<input name="model" required value="${esc(prefill)}"></label><label>Сценарий покупки<select name="origin" required><option value="">Выберите США или Грузия</option>${managerOriginOptions(prefillOrigin).map(x=>`<option value="${esc(x)}" ${prefillOrigin===x?'selected':''}>${esc(x)}${CLIENT_ORIGINS.includes(x)?'':' · архив'}</option>`).join('')}</select></label><label>Бюджет, $<input name="budget" type="number" min="0" step="500"></label><label>Источник<select name="source">${SOURCE_OPTIONS.map(x=>`<option>${x}</option>`).join('')}</select></label><label>Ответственный${activeManagers().length?`<select name="manager" required><option value="">Выберите ответственного</option>${activeManagers().map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>`:`<input name="manager" required placeholder="Введите имя ответственного" autocomplete="name"><small class="auto-rule-hint">Список сотрудников пока пуст — имя можно указать вручную.</small>`}</label><label>Приоритет<select name="priority"><option>Средний</option><option>Высокий</option><option>Низкий</option></select></label><label>Следующее действие<input name="nextAction" type="date" value="${today}" required></label><label class="full">Комментарий<textarea name="note"></textarea></label><div class="auto-form-actions"><button type="button" class="auto-btn ghost" data-close>Закрыть</button><button class="auto-btn primary" type="submit">Создать лид</button></div></form></div></div>`;return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal"><div class="auto-modal-head"><div><span class="auto-eyebrow">ЗАЯВКА</span><h2>Подобрать автомобиль</h2><p class="auto-modal-sub">Только параметры автомобиля. CRM-поля заполняются автоматически.</p></div><button class="auto-close" data-close>×</button></div><form class="auto-form" id="requestForm"><input type="hidden" name="managerMode" value="0"><input type="hidden" name="carId" value="${esc(selected?.id||'')}"><input type="hidden" name="catalogIntent" value="${state.modal?.carId?'catalog':'general'}"><input type="hidden" name="catalogUsdRubRate" value="">${selected?`<p class="full auto-rule-hint" data-request-linked-car>Расчёт именно выбранного автомобиля · карточка №${esc(selected.id)}. Привязка выполняется автоматически.</p>` : ''}<label>Имя<input name="name" required></label><label>Контакт<input name="contact" required placeholder="VK / Telegram / WhatsApp"></label><label>Марка / модель<input name="model" required value="${esc(prefill)}"></label><label>Способ покупки<select name="origin" required><option value="">Выберите сценарий</option>${CLIENT_ORIGINS.map(x=>`<option value="${esc(x)}" ${prefillOrigin===x?'selected':''}>${esc(purchaseScenarioLabel(x))}</option>`).join('')}</select></label>${selected?`<label>Ориентировочная стоимость, ₽<input name="estimatedCostRub" type="number" min="0" step="1" value="${catalogPriceRub(selected)||''}" readonly></label><p class="full auto-rule-hint" id="catalogRequestPriceHint">Цена из выбранной карточки автомобиля. Бюджет в долларах рассчитывается по проверенному курсу.</p><label>Год выпуска<input name="year" type="number" min="1900" max="2100" value="${Number(selected.year)||''}"></label><label>Пробег<input name="mileage" value="${esc(selected.mileage||'')}"></label><label>Двигатель<input name="engine" value="${esc(selected.engine||'')}"></label><label>Привод<input name="drive" value="${esc(selected.drive||'')}"></label>`:`<label>Возраст<select name="ageRange" required><option value="">Выберите возраст</option>${['1–3 года','3–5 лет','5–10 лет','10+ лет'].map(v=>`<option value="${v}">${v}</option>`).join('')}</select></label><label>Двигатель<select name="engine"><option>Не важно</option><option>Бензин</option><option>Гибрид</option><option>Electric</option></select></label><label>Привод<select name="drive"><option>Не важно</option><option>AWD</option><option>FWD</option><option>RWD</option></select></label>`}<label>Повреждения<select name="damage"><option>Минимальные</option><option>Косметический ремонт допустим</option><option>Рассмотрю выгодный ремонт</option></select></label><label>Город получения<input name="deliveryCity" placeholder="Куда доставить автомобиль"></label><label class="full">Пожелания<textarea name="note" placeholder="Цвет, комплектация, важные опции…"></textarea></label><div class="auto-form-actions"><button type="button" class="auto-btn ghost" data-close>Закрыть</button><button class="auto-btn primary" type="submit">Отправить запрос</button></div></form></div></div>`}
function modalDetail(c){const ended=auctionEnded(c),gallery=[c.image,...(Array.isArray(c.interiorPhotos)?c.interiorPhotos:[]),...(Array.isArray(c.otherPhotos)?c.otherPhotos:[])].filter(Boolean);return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal"><div class="auto-modal-head"><div><span class="auto-eyebrow">${esc(purchaseScenarioLabel(carOrigin(c)))} · ${c.year}</span><h2>${esc(c.brand+' '+c.model)}</h2></div><button class="auto-close" data-close>×</button></div><div class="auto-car-media auto-detail-media"><img src="${c.image}" alt="${esc(c.model)}"></div>${gallery.length>1?`<div class="auto-detail-gallery">${gallery.map((src,i)=>`<img src="${esc(src)}" alt="${esc(c.model)} · фото ${i+1}">`).join('')}</div>`:''}<div class="auto-kpis auto-detail-kpis">${kpi('Ориентир',money(c.price))}${kpi('Пробег',c.mileage)}${kpi('Привод',c.drive)}${kpi('Срок',catalogDeliveryHint(c))}</div><div class="auto-actions"><button class="auto-btn primary auto-calc-btn" data-request-car="${c.id}" ${ended?'disabled aria-disabled="true" title="Аукцион завершён"':''}><span class="auto-calc-glint" aria-hidden="true"></span><span class="auto-calc-label">Получить расчёт</span></button><button class="auto-btn ghost" data-close>Закрыть</button></div></div></div>`}
function leadStatusOptions(lead,quote){const ctx={hasAgreedQuote:quote?.status==='Согласован',deposit:lead.deposit};return LEAD_STATUSES.filter(s=>s===lead.status||leadTransitionAllowed(lead.status,s,ctx)).map(s=>`<option ${lead.status===s?'selected':''}>${s}</option>`).join('')}
function modalLead(lead){const carMatch=catalogCarForLead(lead,cars),catalogCar=carMatch.car||null,displayLead=catalogCar?{...lead,carId:lead.carId||catalogCar.id,catalogVehicle:lead.catalogVehicle||catalogVehicleSnapshot(catalogCar),year:lead.year||catalogCar.year,mileage:lead.mileage||catalogCar.mileage,engine:lead.engine&&lead.engine!=='Не важно'?lead.engine:catalogCar.engine,drive:lead.drive&&lead.drive!=='Не важно'?lead.drive:catalogCar.drive,estimatedCostRub:lead.estimatedCostRub||catalogPriceRub(catalogCar)}:lead;const relatedQuote=quotes.filter(x=>x.leadId===lead.id).sort((a,b)=>b.version-a.version)[0],relatedOrder=orders.find(x=>x.leadId===lead.id),history=notes[lead.id]||[],eligibility=canCreateOrder({quote:relatedQuote,deposit:lead.deposit}),agreed=relatedQuote?.status==='Согласован',depositRange=relatedQuote?.origin==='США'?auctionDepositRange(relatedQuote.total):null;return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide"><div class="auto-modal-head"><div><span class="auto-eyebrow">${esc(lead.id)} · ${esc(lead.source)}</span><h2>${esc(lead.name)} · ${esc(lead.model)}</h2></div><button class="auto-close" data-close>×</button></div><div class="auto-modal-grid"><form class="auto-form auto-form-single" id="leadEditForm"><input type="hidden" name="id" value="${lead.id}"><label>Статус<select name="status" id="leadStatus">${leadStatusOptions(lead,relatedQuote)}</select></label><label>Менеджер<select name="manager">${activeManagers().map(x=>`<option ${lead.manager===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Имя клиента<input name="name" required value="${esc(lead.name)}"></label><label>Контакт<input name="contact" required value="${esc(lead.contact)}"></label><label>Автомобиль<input name="model" required value="${esc(lead.model)}"></label><label>Локация автомобиля<select name="origin">${managerOriginOptions(lead.origin||'Уточняется').map(x=>`<option value="${esc(x)}" ${(lead.origin||'Уточняется')===x?'selected':''}>${esc(x)}${CLIENT_ORIGINS.includes(x)?'':' · архив'}</option>`).join('')}</select></label>${catalogCar?`<input type="hidden" name="catalogCarId" value="${esc(catalogCar.id)}">`:lead.clientCreated?`<label class="full">Связать заявку с конкретным автомобилем<select name="catalogCarId"><option value="">Не выбран — нужен точный автомобиль</option>${cars.filter(c=>c.active!==false).map(c=>`<option value="${esc(c.id)}">${esc([c.brand,c.model,c.year].filter(Boolean).join(" · "))} · ${rubMoney(catalogPriceRub(c))}</option>`).join("")}</select><small>Если несколько одинаковых моделей — выберите именно исходную карточку, затем сохраните заявку.</small></label>`:``}<label>Бюджет, $<input name="budget" type="number" min="0" step="500" value="${Number(lead.budget)||0}"></label>${catalogCar?`<label>Курс для бюджета, ₽/$<input name="catalogUsdRubRate" type="number" min="0" step="0.0001" value="${Number(lead.catalogUsdRubRate)||''}"></label><p class="full auto-rule-hint" id="catalogLeadBudgetHint">${carMatch.matchedBy==='unique-name'?'Найдена единственная карточка каталога по точному названию. Подтвердите автомобиль и сохраните заявку. ':''}Стоимость ${rubMoney(catalogPriceRub(catalogCar))}. Бюджет рассчитывается с шагом $500; исходная цена остаётся неизменной.</p>`:``}<label>Источник<select name="source">${SOURCE_OPTIONS.map(x=>`<option ${lead.source===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Приоритет<select name="priority"><option ${lead.priority==='Высокий'?'selected':''}>Высокий</option><option ${lead.priority==='Средний'?'selected':''}>Средний</option><option ${lead.priority==='Низкий'?'selected':''}>Низкий</option></select></label><label>Следующее действие<input type="date" name="nextAction" value="${esc(lead.nextAction||today)}"></label>${renderCatalogLeadVehicle(displayLead,{escape:esc,money,rubMoney})}${!isCatalogVehicleLead(displayLead)&&lead.ageRange?`<div class="full auto-note">Предпочитаемый возраст: ${esc(lead.ageRange)}</div>`:''}${isCatalogVehicleLead(displayLead)?`<label>Год выпуска<input name="year" type="number" min="1900" max="2100" value="${esc(displayLead.year||displayLead.catalogVehicle?.year||'')}"></label><label>Пробег автомобиля<input name="mileage" value="${esc(displayLead.mileage||displayLead.catalogVehicle?.mileage||'')}"></label>`:`<label>Год от / до<div class="auto-inline-fields"><input name="yearFrom" type="number" min="2015" max="2026" value="${esc(lead.yearFrom)}"><input name="yearTo" type="number" min="2015" max="2026" value="${esc(lead.yearTo)}"></div></label><label>Макс. пробег, км<input name="mileageMax" type="number" min="0" value="${esc(lead.mileageMax)}"></label>`}${isCatalogVehicleLead(displayLead)?`<label>Двигатель<input name="engine" value="${esc(displayLead.engine||displayLead.catalogVehicle?.engine||'')}"></label>`:`<label>Двигатель<select name="engine">${['Не важно','Бензин','Гибрид','Electric'].map(x=>`<option ${lead.engine===x?'selected':''}>${x}</option>`).join('')}</select></label>`}${isCatalogVehicleLead(displayLead)?`<label>Привод<input name="drive" value="${esc(displayLead.drive||displayLead.catalogVehicle?.drive||'')}"></label>`:`<label>Привод<select name="drive">${['Не важно','AWD','FWD','RWD'].map(x=>`<option ${lead.drive===x?'selected':''}>${x}</option>`).join('')}</select></label>`}<label>Повреждения<select name="damage">${['Минимальные','Косметический ремонт допустим','Рассмотрю выгодный ремонт'].map(x=>`<option ${lead.damage===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Город получения<input name="deliveryCity" value="${esc(lead.deliveryCity)}"></label>${agreed&&!relatedOrder?`<label>${depositRange?'Аукционный аванс 25–30%, $':'Полученный депозит, $'}<input name="deposit" type="number" min="${depositRange?depositRange.min:0}" max="${depositRange?depositRange.max:relatedQuote.total}" step="100" value="${Number(lead.deposit)||0}">${depositRange?`<small class="auto-field-hint">Допустимо ${money(depositRange.min)}–${money(depositRange.max)} от согласованной стоимости.</small>`:''}</label><label>Дата депозита<input name="depositDate" type="date" value="${esc(lead.depositDate||today)}"></label><label>Способ оплаты<select name="paymentMethod"><option value="">Выберите</option>${PAYMENT_METHODS.map(x=>`<option ${lead.paymentMethod===x?'selected':''}>${x}</option>`).join('')}</select></label>`:`<input type="hidden" name="deposit" value="${Number(lead.deposit)||0}"><input type="hidden" name="depositDate" value="${esc(lead.depositDate)}"><input type="hidden" name="paymentMethod" value="${esc(lead.paymentMethod)}">`}<label class="full">Заметка<textarea name="note">${esc(lead.note||'')}</textarea></label><label class="full ${lead.status==='Отказ'?'':'auto-conditional-hidden'}" id="lostReasonField">Причина отказа<input name="lostReason" value="${esc(lead.lostReason||'')}"></label><div class="auto-form-actions"><button type="button" class="auto-btn danger" data-delete-lead="${esc(lead.id)}">Удалить заявку</button><button class="auto-btn primary" type="submit">Сохранить карточку</button></div></form><aside class="auto-side-panel"><h3>Контроль сделки</h3><div class="auto-related"><div><span>Расчёт</span><b>${relatedQuote?`${relatedQuote.id} · v${relatedQuote.version} · ${relatedQuote.status}`:'не создан'}</b></div><div><span>Депозит</span><b>${lead.deposit?money(lead.deposit):'не получен'}</b></div><div><span>Заказ</span><b>${relatedOrder?`${relatedOrder.id} · ${relatedOrder.stage}`:'не создан'}</b></div></div><div class="auto-side-actions"><button class="auto-btn ghost" data-create-quote="${lead.id}">${relatedQuote?'Открыть расчёт':'Создать расчёт'}</button>${relatedOrder?`<button class="auto-btn primary" data-order="${relatedOrder.id}">Открыть заказ</button>`:`<button class="auto-btn primary" data-convert-order="${lead.id}" ${eligibility.ok?'':'disabled'}>Создать заказ</button><small class="auto-rule-hint ${eligibility.ok?'good':''}">${eligibility.ok?(relatedQuote?.origin==='США'?'Расчёт согласован, аукционный аванс 25–30% зафиксирован.':'Расчёт согласован и депозит зафиксирован.'):esc(eligibility.reason)}</small>`}</div><h3>История</h3><div class="auto-history">${history.length?history.slice().reverse().map(x=>`<div><b>${dateTimeRu(x.at)}</b><span>${esc(x.text)}</span></div>`).join(''):'<span class="auto-muted">Изменений пока нет.</span>'}</div></aside></div></div></div>`}
function quoteAllowedStatuses(q){if(!q)return['Черновик','Отправлен'];const map={'Черновик':['Черновик','Отправлен'],'Отправлен':['Отправлен','На согласовании','Отказ'],'На согласовании':['На согласовании','Согласован','Отказ']};return map[q.status]||[q.status]}
function modalGeorgiaQuote(q,lead){
  const matchedCar=lead?catalogCarForLead(lead,cars).car:null;
  const prefillLead=lead&&matchedCar&&!lead.carId&&!lead.catalogVehicle?{...lead,carId:matchedCar.id,catalogVehicle:catalogVehicleSnapshot(matchedCar)}:lead;
  const linked=catalogCustomsForLead(prefillLead,cars,today),facts=linked.facts;
  const age=lead?.ageRange==='1–3 года'?'under3':lead?.ageRange==='3–5 лет'?'3to5':lead?.ageRange==='5–10 лет'||lead?.ageRange==='10+ лет'?'other':ageCategoryForYear(lead?.year,today);
  const preset=awgTariff('Грузия',age)||{};
  const base=q?georgiaDraftForEditing(q):{
    id:'',leadId:lead?.id||'',model:lead?.model||'',origin:'Грузия',
    version:1,status:'Черновик',tariffVersion:AWG_GEORGIA_TARIFF_VERSION,
    ageCategory:linked.car?(facts?.ageCategory||''):age,transportMode:'Самовывоз — Владикавказ',
    manufactureDate:facts?.manufactureDate||'',engineCc:facts?.engineCc||0,powerHp:facts?.powerHp||0,
    powerInput:facts?.powerHp||0,powerUnit:'ps',engineType:facts?.engineType||'',
    catalogSourceId:linked.car?.id||'',catalogVin:facts?.vin||'',catalogYear:facts?.year||'',
    catalogEngine:facts?.engineRaw||'',catalogMileage:facts?.mileage||'',
    lot:0,legalization:preset.legalization??4000,service:preset.service??1000,
    customsRub:0,recyclingRub:0,usdRubRate:0,exchangeRateDate:'',exchangeRateSource:'',
    internationalTransferPercent:3.5,publicComment:''
  };
  if(q&&['Согласован','Отказ'].includes(q.status))
    return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide">
    <div class="auto-modal-head"><div><span class="auto-eyebrow">${esc(q.id)} · v${q.version}</span><h2>${esc(q.model)}</h2><p>${esc(q.status)}</p></div><button class="auto-close" data-close>×</button></div>
    ${quoteBreakdown(q)}${q.publicComment?`<div class="auto-note"><b>Общедоступный комментарий</b><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(q.publicComment)}</p></div>`:""}<div class="auto-quote-total"><span>Итого по выбранному способу получения</span><b>${formatGeorgiaUsd(q.total)}</b></div>
    <div class="auto-actions"><button class="auto-btn primary" data-clone-quote="${esc(q.id)}">Создать новую версию</button><button class="auto-btn ghost" data-close>Закрыть</button></div></div></div>`;
  return georgiaQuoteForm(base,leads,quoteAllowedStatuses(q),esc,formatGeorgiaUsd);
}
function modalQuoteV2(q,lead,requestedOrigin=''){
  const requested=q?.origin||requestedOrigin||lead?.origin||'Грузия';
  const origin=['Грузия','США'].includes(requested)?requested:'Грузия';
  const linked=catalogCustomsForLead(lead,cars,today),facts=linked.facts;
  const age=lead?.ageRange==='1–3 года'?'under3':lead?.ageRange==='3–5 лет'?'3to5':ageCategoryForYear(lead?.year,today);
  const base=q||{
    id:'',version:1,status:'Черновик',leadId:lead?.id||'',model:lead?.model||'',
    origin,transportMode:modesV2(origin)[0],
    tariffVersion:AWG_QUOTE_V2_TARIFF,quoteSchema:AWG_QUOTE_V2_SCHEMA,
    ageCategory:facts?.ageCategory||age||'',
    manufactureDate:facts?.manufactureDate||'',engineCc:facts?.engineCc||0,
    powerHp:facts?.powerHp||0,powerUnit:'ps',engineType:facts?.engineType||'',importerType:'nat',
    catalogSourceId:linked.car?.id||'',catalogVin:facts?.vin||'',
    catalogYear:facts?.year||'',lot:0,turnkeyDeliveryUsd:0,
    sourceTurnkeyDeliveryRub:Number(linked.car?.turnkeyDeliveryRub)||0,
    customsAndRecyclingRub:Number(linked.car?.customsRub)||0,
    cbrRubRate:0,usdRubRate:0,exchangeRateSource:'cbr',exchangeRateDate:'',
    internationalTransferPercent:3.5,publicComment:'',verification:normalizeVehicleVerification({}),
    auction:0,inland:0,ocean:0,repair:0,partsCost:0
  };
  if(q&&['Согласован','Отказ'].includes(q.status)){
    return '<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide"><div class="auto-modal-head"><h2>'+esc(q.model)+'</h2><button class="auto-close" data-close>×</button></div>'+
      quoteBreakdown(q)+'<div class="auto-quote-total">Итого: '+formatGeorgiaUsd(q.total)+'</div>'+
      '<button class="auto-btn primary" data-clone-quote="'+esc(q.id)+'">Создать новую версию</button></div></div>';
  }
  return quoteV2Form(base,leads,quoteAllowedStatuses(q),esc,verificationPhotoEditor(base.verification));
}
function modalQuote(q,lead,requestedOrigin=''){if((!q||v2Quote(q))&&(!q||['Грузия','США'].includes(q.origin)))return modalQuoteV2(q,lead,requestedOrigin);if((q?.origin||requestedOrigin||lead?.origin)==='Грузия'&&(!q||q.tariffVersion===AWG_GEORGIA_TARIFF_VERSION||q.status==='Черновик'))return modalGeorgiaQuote(q,lead);const rawOrigin=q?.origin||requestedOrigin||lead?.origin||'',origin=supportedClientOrigin(rawOrigin)?rawOrigin:'',year=Number(lead?.year)||0,currentYear=new Date().getFullYear(),fromYear=ageCategoryForYear(year,today),ageChoice=lead?.ageRange==='1–3 года'?'under3':lead?.ageRange==='3–5 лет'?'3to5':fromYear,preset=awgTariff(origin,ageChoice),base=q?{origin,transportMode:q.transportMode||defaultTransportMode(origin),...q}:{id:'',leadId:lead?.id||'',model:lead?.model||'',origin,transportMode:defaultTransportMode(origin),tariffVersion:AWG_TARIFF_VERSION,ageCategory:ageChoice,lot:0,auction:0,inland:0,ocean:preset?.ocean||0,customs:0,repair:0,partsCost:0,cryptoFee:0,service:500,georgiaDelivery:0,legalization:preset?.legalization||0,recyclingFee:0,engineCc:0,powerHp:0,quoteSchema:QUOTE_AUDIT_SCHEMA,manufactureDate:'',engineType:'',importerType:'',priceSource:'',vehicleSourceUrl:'',invoiceUsd:0,customsSource:'',customsCheckedAt:'',usdRubRate:0,customsRub:0,recyclingRub:0,customsZeroReason:'',recyclingZeroReason:'',repairCountry:defaultRepairCountry(origin,ageChoice),partsCountry:defaultPartsCountry(origin,ageChoice),customsConfirmed:false,recyclingConfirmed:false,cryptoBaseConfirmed:false,repairReviewed:false,status:'Черновик',version:1,validUntil:addDays(today,7),verification:normalizeVehicleVerification({})};if(q&&['Согласован','Отказ'].includes(q.status))return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide"><div class="auto-modal-head"><div><span class="auto-eyebrow">${esc(q.id)} · v${q.version}</span><h2>${esc(q.model)}</h2><p class="auto-modal-sub">Зафиксированная версия · ${esc(q.status)}</p></div><button class="auto-close" data-close>×</button></div>${quoteBreakdown(base)}${vehicleVerificationView(base)}<div class="auto-quote-total"><span>Итого под ключ</span><b>${money(q.total)}</b><small>Действует до ${dateRu(q.validUntil)}</small></div><div class="auto-actions"><button class="auto-btn primary" data-clone-quote="${q.id}">Создать новую версию</button><button class="auto-btn ghost" data-close>Закрыть</button></div></div></div>`;return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide"><div class="auto-modal-head"><div><span class="auto-eyebrow">${base.id||'НОВЫЙ РАСЧЁТ'} · v${base.version}</span><h2>${esc(base.model||'Расчёт под ключ')}</h2></div><button class="auto-close" data-close>×</button></div><form class="auto-form" id="quoteForm"><input type="hidden" name="id" value="${esc(base.id)}"><input type="hidden" name="version" value="${base.version}"><label>Лид<select name="leadId" required>${leads.filter(x=>x.status!=='Отказ').map(x=>`<option value="${x.id}" ${base.leadId===x.id?'selected':''}>${x.id} · ${esc(x.name)} · ${esc(x.model)}</option>`).join('')}</select></label><label>Автомобиль<input name="model" required value="${esc(base.model)}"></label><label>Объём двигателя, см³<input name="engineCc" type="number" min="0" step="1" value="${Number(base.engineCc)||0}"></label><label><span class="auto-quote-power-heading">Мощность двигателя<select name="powerUnit" data-previous-unit="${normalizePowerUnit(base.powerUnit)}" aria-label="Единица мощности"><option value="ps" ${base.powerUnit!=='hp'?'selected':''}>л.с.</option><option value="hp" ${base.powerUnit==='hp'?'selected':''}>hp</option></select></span><input name="powerHp" type="number" min="0" step="any" value="${quotePowerInput(base)}"></label>${quoteVehicleFields(base,esc)}<label>Сценарий покупки<select name="origin" id="quoteOrigin"><option value="">Выберите сценарий</option>${CLIENT_ORIGINS.map(x=>`<option value="${esc(x)}" ${base.origin===x?'selected':''}>${esc(purchaseScenarioLabel(x))}</option>`).join('')}</select></label><label>Возраст для тарифного расчёта<select name="ageCategory" id="quoteAgeCategory"><option value="">Уточните возраст</option><option value="under3" ${base.ageCategory==='under3'?'selected':''}>До 3 лет</option><option value="3to5" ${base.ageCategory==='3to5'?'selected':''}>От 3 до 5 лет</option><option value="other" ${base.ageCategory==='other'?'selected':''}>Старше 5 лет — индивидуальный расчёт</option></select></label><input type="hidden" name="tariffVersion" value="${esc(base.tariffVersion||'')}"><input type="hidden" name="quoteSchema" value="${esc(base.quoteSchema||'')}"><label>Способ доставки<select name="transportMode">${TRANSPORT_MODES.map(x=>`<option value="${esc(x)}" ${base.transportMode===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label><label><span class="auto-quote-caption"><span data-quote-label="lot">${base.origin==='Грузия'?'Стоимость автомобиля в Грузии':'Стоимость лота'}</span>, $</span><input name="lot" type="number" min="0" step="50" value="${Number(base.lot)||0}"></label><label id="quoteAuctionField" class="${base.origin==='Грузия'?'auto-conditional-hidden':''}"><span class="auto-quote-caption">Сбор аукциона, $</span><input name="auction" type="number" min="0" step="50" value="${base.origin==='Грузия'?0:Number(base.auction)||0}"></label><label><span class="auto-quote-caption"><span data-quote-label="inland">${base.origin==='Грузия'?'Логистика по Грузии':'Доставка по США'}</span>, $</span><input name="inland" type="number" min="0" step="50" value="${Number(base.inland)||0}"></label><label><span class="auto-quote-caption"><span data-quote-label="ocean">${base.origin==='Грузия'?'Доставка из Грузии в Россию':'Логистика до Тбилиси и брокеры'}</span>, $</span><input name="ocean" type="number" min="0" step="50" value="${Number(base.ocean)||0}"></label>${[['customs','Таможня / оформление'],['repair','Ремонт / подготовка'],['partsCost','Запчасти (США до 3 лет)'],['service','Услуга компании']].map(([k,l])=>`<label>${l}, $<input name="${k}" type="number" min="0" step="50" value="${Number(base[k])||0}"></label>`).join('')}${[['georgiaDelivery','Доп. доставка по Грузии'],['legalization','Легализация'],['recyclingFee','Утильсбор']].map(([k,l])=>`<label>${l}, $<input name="${k}" type="number" min="0" step="1" value="${Number(base[k])||0}"></label>`).join('')}<label>Криптоперевод 3,5%, $<input name="cryptoFee" type="number" min="0" step="1" readonly value="${Number(base.cryptoFee)||0}"><small>Предварительно от суммы лота, сбора и доставки до порта США</small></label>${quoteCostAuditFields(base,esc)}${quoteCustomsFields(base,esc)}<div class="full auto-form-divider">Подтверждение предварительных расходов</div><label class="full"><input name="customsConfirmed" type="checkbox" ${base.customsConfirmed?'checked':''}> Таможенная оценка заполнена и проверена</label><label class="full"><input name="recyclingConfirmed" type="checkbox" ${base.recyclingConfirmed?'checked':''}> Утильсбор рассчитан и проверен</label><label class="full" id="quoteCryptoConfirmed"><input name="cryptoBaseConfirmed" type="checkbox" ${base.cryptoBaseConfirmed?'checked':''}> Подтверждаю базу для 3,5% криптоперевода</label><label class="full" id="quoteRepairReviewed"><input name="repairReviewed" type="checkbox" ${base.repairReviewed?'checked':''}> Ремонт и запчасти оценены (сумма предварительная после фото)</label><p class="full auto-rule-hint" id="quoteTariffWarning">Неподтверждённые расходы не позволяют отправить окончательный расчёт.</p><div class="auto-form-divider full">Досье проверки автомобиля</div><div class="auto-verification-hint full">Для аукциона США досье обязательно до согласования лота.</div><label>LOT / номер лота<input name="verificationLot" value="${esc(base.verification?.lotNumber||'')}"></label><label>VIN<input name="verificationVin" value="${esc(base.verification?.vin||'')}"></label><label>Год автомобиля<input name="verificationYear" type="number" min="1900" max="2030" value="${Number(base.verification?.year)||''}"></label><label>Пробег, км<input name="verificationMileage" type="number" min="0" step="1" value="${Number(base.verification?.mileage)||0}"></label><label class="full">Повреждения / состояние<textarea name="verificationDamage" placeholder="Опишите повреждения или укажите, что видимых повреждений нет">${esc(base.verification?.damage||'')}</textarea></label><label>Ссылка на отчёт проверки<input name="verificationReportUrl" type="url" value="${esc(base.verification?.reportUrl||'')}" placeholder="https://..."></label><label>Дата проверки<input name="verificationCheckedAt" type="date" value="${esc(base.verification?.checkedAt||today)}"></label><label class="full">История / краткое заключение<textarea name="verificationHistory" placeholder="Что проверено, история автомобиля, ключевые выводы">${esc(base.verification?.history||'')}</textarea></label><label>Итог проверки<select name="verificationResult">${VERIFICATION_RESULTS.map(x=>`<option value="${esc(x)}" ${(base.verification?.result||'Не проверено')===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>${verificationPhotoEditor(base.verification)}<label>Действует до<input name="validUntil" type="date" value="${esc(base.validUntil||addDays(today,7))}"></label><label>Статус<select name="status">${quoteAllowedStatuses(q).map(x=>`<option ${base.status===x?'selected':''}>${x}</option>`).join('')}</select></label><div class="auto-quote-total full"><span>${base.tariffVersion===AWG_TARIFF_VERSION?'Сумма заполненных статей (предварительно)':'Итого под ключ'}</span><b id="quoteTotal">${money(calculateQuote(base))}</b><small id="quoteCostPreview">себестоимость без услуги: ${money(quoteCost(base))}</small></div><div class="auto-form-actions"><button type="button" class="auto-btn ghost" data-close>Отмена</button><button type="submit" class="auto-btn primary">Сохранить расчёт</button></div></form></div></div>`}
const paymentStageLabel=(order,id)=>order.paymentPlan?.find(x=>x.id===id)?.title||'Платёж';
function paymentsList(order){return `<div class="auto-payment-list">${order.payments.length?order.payments.slice().reverse().map(p=>`<div><span><b>${esc(paymentStageLabel(order,p.paymentStage))}</b>${dateRu(p.date)} · ${esc(p.method)}</span><strong>${money(p.amount)}</strong>${p.note?`<small>${esc(p.note)}</small>`:''}</div>`).join(''):'<span class="auto-muted">Платежей нет.</span>'}</div>`}
function paymentPlanView(order){if(!order?.paymentPlan?.length)return'';return `<div class="auto-payment-plan">${order.paymentPlan.map((stage,i)=>{const s=paymentStageState(stage,order.payments);return `<div class="auto-payment-stage ${s.status==='Оплачено'?'done':s.status==='Частично'?'partial':''}"><i>${i+1}</i><span><b>${esc(stage.title.replace(/^\\d+\\.\\s*/,''))}</b><small>${esc(stage.due)}</small></span><strong>${money(stage.amount)}<small>оплачено ${money(s.paid)} · осталось ${money(s.remaining)}</small></strong><em>${esc(s.status)}</em></div>`}).join('')}</div>`}
function modalOrder(order){const lead=leads.find(x=>x.id===order.leadId),risk=order.riskType||'Нет',nextPay=nextPaymentStage(order.paymentPlan||[],order.payments||[]);if(state.role==='owner')return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide"><div class="auto-modal-head"><div><span class="auto-eyebrow">${esc(order.id)} · КОНТРОЛЬ</span><h2>${esc(order.model)}</h2><p class="auto-modal-sub">${esc(order.customer)} · ${esc(order.manager)}</p></div><button class="auto-close" data-close>×</button></div>${timeline(order.stage)}<div class="auto-order-meta"><span><b>LOT / VIN</b>${esc(order.lot||'—')} · ${esc(order.vin||'—')}</span><span><b>Локация / ETA</b>${esc(order.location||'—')} · ${dateRu(order.eta)}</span><span><b>Риск</b>${esc(orderRisk(order))}</span><span><b>Оплачено</b>${money(order.paid)} из ${money(order.total)}</span></div>${order.paymentPlan?.length?`<h3>4 этапа оплаты</h3>${paymentPlanView(order)}${order.paymentPlanNeedsReview?'<div class="auto-note">План перенесён из существующего заказа. Суммы этапов нужно сверить с клиентским расчётом.</div>':''}`:''}<h3>История платежей</h3>${paymentsList(order)}<div class="auto-actions"><button class="auto-btn ghost" data-close>Закрыть</button></div></div></div>`;const next=nextOrderStage(order.stage),allowed=[order.stage,...(next!==order.stage?[next]:[])];return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide"><div class="auto-modal-head"><div><span class="auto-eyebrow">${esc(order.id)} · LOT ${esc(order.lot||'—')}</span><h2>${esc(order.model)}</h2><p class="auto-modal-sub">${esc(order.customer)} · ${esc(order.manager)} · VIN ${esc(order.vin||'—')}</p></div><button class="auto-close" data-close>×</button></div>${timeline(order.stage)}<div class="auto-modal-grid"><form class="auto-form auto-form-single" id="orderForm"><input type="hidden" name="id" value="${order.id}"><label>Этап<select name="stage">${allowed.map(x=>`<option ${order.stage===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Менеджер<select name="manager">${activeManagers().map(x=>`<option ${order.manager===x?'selected':''}>${x}</option>`).join('')}</select></label><label>LOT<input name="lot" value="${esc(order.lot||'')}"></label><label>VIN<input name="vin" value="${esc(order.vin||'')}"></label><label>ETA<input type="date" name="eta" value="${esc(order.eta||'')}"></label><label>Текущая локация<input name="location" value="${esc(order.location||'')}"></label><label>Риск<select name="riskType" id="riskType">${RISK_TYPES.map(x=>`<option ${risk===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="${risk==='Нет'?'auto-conditional-hidden':''}" id="riskNoteField">Описание риска<input name="riskNote" value="${esc(order.riskNote||'')}"></label><div class="auto-form-divider full">${order.paymentPlan?.length?'Новый платёж · 4 этапа':'Новый платёж'}</div>${order.paymentPlan?.length?`<label>Этап оплаты<select name="paymentStage" id="paymentStage" ${nextPay?'':'disabled'}>${order.paymentPlan.map(stage=>{const s=paymentStageState(stage,order.payments),enabled=nextPay?.id===stage.id;return `<option value="${stage.id}" ${enabled?'selected':''} ${enabled?'':'disabled'}>${esc(stage.title)} · осталось ${money(s.remaining)}</option>`}).join('')}</select></label>`:''}<label>Сумма, $<input name="paymentAmount" type="number" min="0" max="${nextPay?nextPay.remaining:Math.max(0,order.total-order.paid)}" step="100" value="0" ${order.paymentPlan?.length&&!nextPay?'disabled':''}></label><label>Дата<input name="paymentDate" type="date" value="${today}"></label><label>Способ<select name="paymentMethod">${PAYMENT_METHODS.map(x=>`<option>${x}</option>`).join('')}</select></label><label>Комментарий<input name="paymentNote" placeholder="${order.paymentPlan?.length?'Комментарий к этапу оплаты':'Депозит, доплата…'}"></label><div class="auto-form-actions"><button class="auto-btn primary" type="submit">Сохранить заказ</button></div></form><aside class="auto-side-panel"><h3>Финансы заказа</h3><div class="auto-related"><div><span>Цена клиенту</span><b>${money(order.total)}</b></div><div><span>Себестоимость</span><b>${money(order.cost)}</b></div><div><span>Оплачено</span><b>${money(order.paid)}</b></div><div><span>Остаток</span><b class="${order.total-order.paid?'auto-negative':''}">${money(Math.max(0,order.total-order.paid))}</b></div></div>${order.paymentPlan?.length?`<h3>4 этапа оплаты</h3>${paymentPlanView(order)}${order.paymentPlanNeedsReview?'<div class="auto-note">План мигрирован из прежнего заказа — проверьте суммы этапов.</div>':''}`:''}<h3>Платежи</h3>${paymentsList(order)}<div class="auto-side-actions">${next!==order.stage?`<button class="auto-btn ghost" data-order-next="${order.id}">Проверить и перейти: ${esc(next)}</button>`:''}${lead?`<button class="auto-btn ghost" data-lead="${lead.id}">Карточка клиента</button>`:''}</div></aside></div></div></div>`}
function modalDeleteLead(lead,error=''){
  if(!lead)return'';
  const relatedQuotes=quotes.filter(item=>item.leadId===lead.id);
  const relatedOrders=orders.filter(item=>item.leadId===lead.id);
  const paymentCount=relatedOrders.reduce((sum,order)=>sum+(Array.isArray(order.payments)?order.payments.length:0),0);
  const relatedNotes=Array.isArray(notes?.[lead.id])?notes[lead.id].length:0;
  const extras=[
    relatedQuotes.length?`${relatedQuotes.length} расчёт(а/ов)`:'',
    relatedOrders.length?`${relatedOrders.length} заказ(а/ов)`:'',
    paymentCount?`${paymentCount} платёж(а/ей)`:'',
    relatedNotes?`${relatedNotes} заметок`:''
  ].filter(Boolean);
  return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal"><div class="auto-modal-head"><div><span class="auto-eyebrow">УДАЛЕНИЕ ЗАЯВКИ</span><h2>Удалить ${esc(lead.name)}?</h2><p class="auto-modal-sub">Лид ${esc(lead.id)} · ${esc(lead.model||'без автомобиля')}</p></div><button class="auto-close" data-close>×</button></div><div class="auto-note auto-note-danger"><b>Это действие нельзя отменить.</b><span>Заявка будет полностью удалена из CRM${extras.length?`, вместе с: ${esc(extras.join(', '))}`:''}. Клиентская Telegram-привязка этой заявки также будет удалена.</span></div>${error?`<div class="auto-form-errors"><p>${esc(error)}</p></div>`:''}<div class="auto-form-actions"><button type="button" class="auto-btn ghost" data-close>Отмена</button><button type="button" class="auto-btn danger" data-delete-lead-confirm="${esc(lead.id)}">Удалить безвозвратно</button></div></div></div>`;
}

function modal(){const m=state.modal;if(!m)return'';if(m.type==='request')return modalRequest(m.prefill||'',!!m.managerMode,m.origin||'');if(m.type==='detail')return modalDetail(cars.find(x=>x.id===m.id));if(m.type==='catalogCar')return modalCatalogCar(cars.find(x=>x.id===m.id));if(m.type==='lead')return modalLead(leads.find(x=>x.id===m.id));if(m.type==='deleteLead')return modalDeleteLead(leads.find(x=>x.id===m.id),m.error||'');if(m.type==='quote'){const q=quotes.find(x=>x.id===m.id),lead=leads.find(x=>x.id===(q?.leadId||m.leadId));return modalQuote(q,lead,m.origin||'')}if(m.type==='order')return modalOrder(orders.find(x=>x.id===m.id));return''}
function page(){if(state.role==='client')return state.route==='catalog'?catalog():state.route==='orders'?clientOrders():state.route==='about'?about():home();if(state.role==='manager')return state.route==='leads'?managerLeads():state.route==='quotes'?managerQuotes():state.route==='catalogAdmin'?managerCatalog():state.route==='shipping'?managerShipping():managerWork();return state.route==='pipeline'?ownerPipeline():state.route==='finance'?ownerFinance():state.route==='ordersAdmin'?ownerOrders():ownerOverview()}
async function hydrateCatalogLeadBudget(){
  const form=root.querySelector('#leadEditForm'),hint=form?.querySelector('#catalogLeadBudgetHint');
  const lead=state.modal?.type==='lead'?leads.find(x=>x.id===state.modal.id):null;
  if(!form||!hint||!lead)return;
  const car=catalogCarForLead(lead,cars).car;
  if(!car)return;
  const budget=form.elements.budget,rateField=form.elements.catalogUsdRubRate;
  if(!rateField||!budget)return;
  if(Number(lead.catalogUsdRubRate)>0){
    const amount=catalogBudgetUsd(car,lead.catalogUsdRubRate);
    if(Number(budget.value)===0&&amount>0)budget.value=String(amount);
    return;
  }
  try{
    const {rate,date}=await catalogRubPerUsd();
    if(!form.isConnected||root.querySelector('#leadEditForm')!==form)return;
    if(!Number(rateField.value))rateField.value=String(rate);
    if(!budget.dataset.manuallyEdited&&Number(budget.value)===0){
      const amount=catalogBudgetUsd(car,Number(rateField.value));
      if(amount>0)budget.value=String(amount);
    }
    hint.textContent='Цена карточки: '+rubMoney(catalogPriceRub(car))+' · курс ЦБ РФ '+date+': '+rate+' ₽/$ · бюджет округлён до $500.';
  }catch{if(form.isConnected)hint.textContent='Цена карточки: '+rubMoney(catalogPriceRub(car))+'. Укажите курс ₽/$ вручную, чтобы рассчитать бюджет с шагом $500.'}
}
async function hydrateCatalogRequestRate(){
  const form=root.querySelector('#requestForm'),field=form?.elements.catalogUsdRubRate;
  if(!field||!form?.elements.carId?.value)return;
  try{
    const {rate,date}=await catalogRubPerUsd();
    if(!form.isConnected)return;
    field.value=String(rate);
    const hint=form.querySelector('#catalogRequestPriceHint');
    if(hint)hint.textContent='Цена из каталога · курс ЦБ РФ на '+date+': '+rate+' ₽/$, бюджет с шагом $500.';
  }catch{const hint=form.querySelector('#catalogRequestPriceHint');if(hint)hint.textContent='Цена сохранится в рублях. Курс доллара менеджер сможет указать в заявке.'}
}
function render(){root.innerHTML=shell(page());if(state.role==='client')window.__AUTO_SALE_RENDER_VK_MESSAGES_HINT__?.();void hydrateCatalogLeadBudget();void hydrateCatalogRequestRate()}
function focusAfterRender(id){render();queueMicrotask(()=>{const el=document.getElementById(id);if(el){el.focus();if('selectionStart'in el){const n=el.value.length;el.setSelectionRange(n,n)}}})}
function syncQuoteCurrency(form,changed){
 if(!form)return;
 if(changed==='customs'&&form.elements.customsRub)form.elements.customsRub.value='0';
 if(changed==='recyclingFee'&&form.elements.recyclingRub)form.elements.recyclingRub.value='0';
 const rate=Number(form.elements.usdRubRate?.value)||0;
 if(rate>0)for(const [ruble,dollar] of [['customsRub','customs'],['recyclingRub','recyclingFee']]){
   const rub=Number(form.elements[ruble]?.value)||0;
   if(rub>0&&form.elements[dollar])form.elements[dollar].value=String(rubToUsd(rub,rate));
 }
 if(['usdRubRate','customsRub','recyclingRub','customs','recyclingFee'].includes(changed)){
   if(form.elements.customsConfirmed)form.elements.customsConfirmed.checked=false;
   if(form.elements.recyclingConfirmed)form.elements.recyclingConfirmed.checked=false;
 }
}
function updateQuotePreview(form){
  if(!form)return;
  if(form.dataset.georgiaQuote==='true'){
    const data=Object.fromEntries(new FormData(form).entries());
    const amounts=georgiaQuoteAmounts(data);
    const total=calculateQuote(amounts);
    const cost=form.querySelector('#quoteCostPreview');
    if(cost)cost.textContent=Number(data.usdRubRate)>0&&data.exchangeRateDate?'Курс: '+data.usdRubRate+' ₽/$ · дата '+data.exchangeRateDate:'Для полного итога укажите курс и дату';
    const node=form.querySelector('#quoteTotal');if(node)node.textContent=formatGeorgiaUsd(total);
    return;
  }
  const origin=form.elements.origin?.value||'',data=Object.fromEntries(new FormData(form).entries());
  if(form.elements.cryptoFee&&data.tariffVersion===AWG_TARIFF_VERSION){
    const fee=awgCryptoFee({...data,origin});
    form.elements.cryptoFee.value=String(fee);data.cryptoFee=fee;
  }
  const total=form.querySelector('#quoteTotal');
  if(total)total.textContent=money(calculateQuote(data));
  const cost=form.querySelector('#quoteCostPreview');if(cost)cost.textContent='себестоимость без услуги: '+money(quoteCost(data));
  const tks=form.querySelector('#quoteTksParameters');if(tks){const params=tksParameters({...data,powerHp:toMetricHorsepower(data.powerHp,data.powerUnit)});tks.textContent='Для ТКС: стоимость '+params.cost+' USD · объём '+params.volume+' см³ · мощность '+params.power+' л.с. · возраст '+(data.ageCategory==='under3'?'до 3 лет':data.ageCategory==='3to5'?'3–5 лет':'уточнить')+'. Значения необходимо проверить в ТКС вручную.';}
  for(const [key,reason] of [['customs','customsZeroReason'],['recyclingFee','recyclingZeroReason']]){const node=form.elements[reason]?.closest('label');if(node)node.classList.toggle('auto-conditional-hidden',Number(form.elements[key]?.value)>0)}
  const ageHint=form.querySelector('#quoteAgeHint');if(ageHint&&form.elements.manufactureDate?.value)ageHint.textContent=ageCategoryForMonth(form.elements.manufactureDate.value,today)?'Возраст определён автоматически по месяцу выпуска (проверьте дату для пограничного срока).':'Возраст попадает на границу 3 или 5 лет, уточните точный день выпуска и выберите категорию вручную.';
  const warning=form.querySelector('#quoteTariffWarning');
  if(warning){
    const reviewed={...data,customsConfirmed:!!form.elements.customsConfirmed?.checked,recyclingConfirmed:!!form.elements.recyclingConfirmed?.checked,cryptoBaseConfirmed:!!form.elements.cryptoBaseConfirmed?.checked,repairReviewed:!!form.elements.repairReviewed?.checked};
    const pending=awgPendingItems(reviewed);
    warning.textContent=pending.length?'Предварительный расчёт. До отправки подтвердите: '+pending.join(', ')+'.':'Статьи проверены менеджером. Таможенная стоимость и ремонт остаются оценкой до окончательного подтверждения.';
  }
}
function syncQuoteScenario(form){
  if(!form)return;
  const origin=form.elements.origin?.value||'',age=form.elements.ageCategory?.value||'',georgia=origin==='Грузия';
  const tariff=awgTariff(origin,age);
  if(form.elements.tariffVersion?.value===AWG_TARIFF_VERSION){
    if(form.elements.service)form.elements.service.value='500';
    if(form.elements.legalization)form.elements.legalization.value=String(origin==='Грузия'?4500:(tariff?.legalization||0));
    if(form.elements.ocean)form.elements.ocean.value=String(tariff?.ocean||0);
    if(form.elements.customsConfirmed)form.elements.customsConfirmed.checked=false;
    if(form.elements.recyclingConfirmed)form.elements.recyclingConfirmed.checked=false;
    if(form.elements.cryptoBaseConfirmed)form.elements.cryptoBaseConfirmed.checked=false;
    if(form.elements.repairReviewed)form.elements.repairReviewed.checked=false;
  }
  const invoiceField=form.querySelector('#quoteInvoiceField');if(invoiceField)invoiceField.classList.toggle('auto-conditional-hidden',!(origin==='США'&&age==='under3'));
  if(form.elements.repairCountry)form.elements.repairCountry.value=defaultRepairCountry(origin,age);
  if(form.elements.partsCountry)form.elements.partsCountry.value=defaultPartsCountry(origin,age);
  const auctionField=form.querySelector('#quoteAuctionField');
  if(auctionField)auctionField.classList.toggle('auto-conditional-hidden',georgia);
  if(georgia&&form.elements.auction)form.elements.auction.value='0';
  for(const id of ['quoteCryptoConfirmed','quoteRepairReviewed']){
    const node=form.querySelector('#'+id);if(node)node.classList.toggle('auto-conditional-hidden',georgia);
  }
  const hint=form.querySelector('#quoteLogisticsHint');if(hint)hint.textContent=georgia?'Логистика по Грузии — местная доставка. Доп. доставка по Грузии — только отдельная услуга, не включайте один и тот же маршрут дважды. Доставка до РФ — отдельная статья. Срок ориентировочно 5–10 дней.':'Логистика до Тбилиси и брокеры — ориентир $3 100–3 600 (по умолчанию $3 350), уточняется менеджером. Доставка по США до порта указана отдельно. Срок ориентировочно 2,5–3,5 месяца.';
  const labels={lot:georgia?'Стоимость автомобиля в Грузии':'Стоимость лота',inland:georgia?'Логистика по Грузии':'Доставка по США',ocean:georgia?'Доставка из Грузии в Россию':'Логистика до Тбилиси с брокерами'};
  for(const [key,value] of Object.entries(labels)){const el=form.querySelector('[data-quote-label="'+key+'"]');if(el)el.textContent=value}
  if(form.elements.transportMode&&origin)form.elements.transportMode.value=defaultTransportMode(origin);
  updateQuotePreview(form);
}

async function quoteAction(id,status){
  const current=quotes.find(x=>x.id===id);if(!current)return;
  const allowed=quoteAllowedStatuses(current);if(!allowed.includes(status))return;
  const nextQuote={...current,status,updatedAt:new Date().toISOString()};
  if(status==='Отправлен'&&!nextQuote.sentAt)nextQuote.sentAt=nextQuote.updatedAt;
  if(status==='Согласован')nextQuote.agreedAt=nextQuote.updatedAt;
  const errors=validateQuote(nextQuote);if(errors.length){state.modal={type:'quote',id:current.id};render();queueMicrotask(()=>showErrors(root.querySelector('#quoteForm'),errors));return}
  const lead=leads.find(x=>x.id===current.leadId),nextLead=lead?{...lead}:null;
  if(nextLead&&status!=='Отказ'&&!['Сделка','Отказ'].includes(nextLead.status))nextLead.status=status==='Черновик'?'Расчёт':'Ожидает клиента';
  const note=noteEntry('Расчёт '+current.id+' → '+status+'.');
  const operations=[{resource:'quote',operation:'patch',id,input:nextQuote}];
  if(nextLead)operations.push({resource:'lead',operation:'patch',id:nextLead.id,input:nextLead},{resource:'note',operation:'create',leadId:nextLead.id,input:note});
  const saved=window.__AUTO_SALE_ENTITY_BATCH__?await commitEntities(operations):{ok:true,localOnly:true};if(!saved)return;
  Object.assign(current,nextQuote);if(lead&&nextLead)Object.assign(lead,nextLead);
  if(nextLead){notes[nextLead.id]=notes[nextLead.id]||[];notes[nextLead.id].push(note)}
  saveAll();render();
}
async function cloneQuote(id){
  const old=quotes.find(x=>x.id===id);if(!old)return;
  const q={...old,id:nextId('Q',quotes),version:(old.version||1)+1,status:'Черновик',validUntil:old.tariffVersion===AWG_GEORGIA_TARIFF_VERSION?'':addDays(today,7),updatedAt:new Date().toISOString(),revisionOf:old.id};
  // A new version of a historical Georgia quote adopts current Georgia tariffs
  // without mutating the immutable original quote.
  if(old.origin==='Грузия'&&old.tariffVersion!==AWG_GEORGIA_TARIFF_VERSION){
    Object.assign(q,{tariffVersion:AWG_GEORGIA_TARIFF_VERSION,quoteSchema:'awg-quote-georgia-2026-10-21',legalization:4000,service:1000,
      customsRub:0,recyclingRub:0,usdRubRate:0,exchangeRateDate:'',internationalTransferPercent:3.5,
      comment:'',exchangeRateSource:'',transportMode:'Самовывоз — Владикавказ',validUntil:''});
    Object.assign(q,georgiaQuoteAmounts(q));
    q.total=calculateQuote(q);
  }
  delete q.sentAt;delete q.agreedAt;
  const saved=window.__AUTO_SALE_ENTITY_BATCH__?await commitEntities([{resource:'quote',operation:'create',id:q.id,input:q}]):{ok:true,localOnly:true};if(!saved)return;
  quotes.push(q);saveAll();state.modal={type:'quote',id:q.id};render();
}
async function convertLeadToOrder(leadId){
  const lead=leads.find(x=>x.id===leadId);if(!lead)return;
  const existing=orders.find(x=>x.leadId===leadId);if(existing){state.modal={type:'order',id:existing.id};render();return}
  const q=quotes.filter(x=>x.leadId===leadId).sort((a,b)=>b.version-a.version)[0],eligibility=canCreateOrder({quote:q,deposit:lead.deposit});
  if(!eligibility.ok){state.modal={type:'lead',id:leadId};render();return}
  const paymentPlan=q.origin==='США'?buildUsPaymentPlan(q,lead.deposit):[],payments=lead.deposit?[{id:'PAY-1',amount:Number(lead.deposit),date:lead.depositDate||today,method:lead.paymentMethod||'Банк',paymentStage:paymentPlan.length?'auction_deposit':'',note:paymentPlan.length?'Аукционный аванс до торгов':'Депозит до создания заказа'}]:[];
  const order={id:nextId('O',orders),leadId:lead.id,customer:lead.name,model:q.model,origin:q.origin||lead.origin||'Уточняется',transportMode:q.transportMode||defaultTransportMode(q.origin||lead.origin||'Уточняется'),manager:lead.manager,source:lead.source,total:q.total,cost:quoteCost(q),paid:paymentsTotal(payments),payments,paymentPlan,paymentPlanNeedsReview:false,stage:'Выкуп',eta:'',lot:q.verification?.lotNumber||'',vin:q.verification?.vin||'',location:'',riskType:'Нет',riskNote:'',risk:'Нет',updatedAt:new Date().toISOString()};
  const nextLead={...lead,status:'Сделка'},note=noteEntry('После согласования расчёта и депозита создан заказ '+order.id+'.');
  const saved=window.__AUTO_SALE_ENTITY_BATCH__?await commitEntities([{resource:'order',operation:'create',id:order.id,input:order},{resource:'lead',operation:'patch',id:lead.id,input:nextLead},{resource:'note',operation:'create',leadId:lead.id,input:note}]):{ok:true,localOnly:true};if(!saved)return;
  orders.push(order);Object.assign(lead,nextLead);notes[lead.id]=notes[lead.id]||[];notes[lead.id].push(note);
  saveAll();state.modal={type:'order',id:order.id};render();
}

root.addEventListener('click',async event=>{const t=event.target.closest('button,[data-modal-bg]');if(!t)return;if(t.dataset.verificationPhotoRemove!==undefined){await removeVerificationPhoto(t);return}if(t.dataset.catalogPhotoRemove){await removeCatalogPhoto(t);return}if(t.dataset.modalBg!==undefined&&event.target===t){state.modal=null;render();return}if(t.dataset.close!==undefined){state.modal=null;render();return}if(t.dataset.role){if(!hasAdminAccess&&t.dataset.role!=='client')return;state.role=t.dataset.role;sessionStorage.setItem(KEYS.role,state.role);state.route=nav[state.role][0][0];state.modal=null;render();if(state.role==='owner')void window.__AUTO_SALE_REFRESH_STATE__?.();return}if(t.dataset.purchaseOrigin){state.origin=t.dataset.purchaseOrigin;state.route='catalog';state.modal=null;render();return}if(t.dataset.go){state.route=t.dataset.go;state.modal=null;render();return}if(t.dataset.openRequest!==undefined){state.modal={type:'request',prefill:'',managerMode:false};render();return}if(t.dataset.managerNew!==undefined){state.modal={type:'request',prefill:'',managerMode:true};render();return}if(t.dataset.catalogAdd!==undefined){state.modal={type:'catalogCar',id:''};render();return}if(t.dataset.deleteLeadConfirm){await deleteLeadAndApplication(t.dataset.deleteLeadConfirm);return}if(t.dataset.deleteLead){state.modal={type:'deleteLead',id:t.dataset.deleteLead};render();return}if(t.dataset.catalogDelete){await deleteCatalogCar(t.dataset.catalogDelete);return}if(t.dataset.catalogEdit){state.modal={type:'catalogCar',id:t.dataset.catalogEdit};render();return}if(t.dataset.requestCar){const c=cars.find(x=>x.id===t.dataset.requestCar);if(!c||auctionEnded(c))return;state.modal={type:'request',prefill:`${c.brand} ${c.model}`,origin:carOrigin(c),carId:c.id,managerMode:false};render();return}if(t.dataset.detail){state.modal={type:'detail',id:t.dataset.detail};render();return}if(t.dataset.lead){state.modal={type:'lead',id:t.dataset.lead};render();return}if(t.dataset.quote){state.modal={type:'quote',id:t.dataset.quote};render();return}if(t.dataset.order){state.modal={type:'order',id:t.dataset.order};render();return}if(t.dataset.newQuote!==undefined){const lead=leads.find(x=>!['Отказ','Сделка'].includes(x.status));state.modal={type:'quote',leadId:lead?.id||''};render();return}if(t.dataset.createQuote){const existing=quotes.filter(x=>x.leadId===t.dataset.createQuote).sort((a,b)=>b.version-a.version)[0];state.modal={type:'quote',id:existing?.id||'',leadId:t.dataset.createQuote};render();return}if(t.dataset.convertOrder&&!t.disabled){await convertLeadToOrder(t.dataset.convertOrder);return}if(t.dataset.quoteAction){await quoteAction(t.dataset.id,t.dataset.quoteAction);return}if(t.dataset.cloneQuote){await cloneQuote(t.dataset.cloneQuote);return}if(t.dataset.orderNext){const order=orders.find(x=>x.id===t.dataset.orderNext);if(!order)return;const form=root.querySelector('#orderForm'),next=nextOrderStage(order.stage);if(!form)return;form.elements.stage.value=next;const data=Object.fromEntries(new FormData(form).entries()),errors=validateOrderUpdate(data,order.stage,[order.stage,next]);if(errors.length){showErrors(form,errors);return}await submitOrder(form);return}});
root.addEventListener('change',async event=>{const t=event.target;if(t.dataset.verificationPhotoUpload!==undefined){await handleVerificationPhotoUpload(t);return}if(t.dataset.catalogPhotoUpload){await handleCatalogPhotoUpload(t);return}if(t.name==='imageUrl'&&t.closest('#catalogCarForm')&&t.value.trim()){t.closest('#catalogCarForm').elements.image.value=t.value.trim();updateCatalogPhotoPreviews(t.closest('#catalogCarForm'));return}if(t.id==='brandFilter'){state.brand=t.value;render()}if(t.id==='originFilter'){state.origin=t.value;render()}if(t.id==='budgetFilter'){state.budget=t.value;render()}if(t.id==='leadStatusFilter'){state.leadStatus=t.value;render()}if(t.id==='leadSourceFilter'){state.leadSource=t.value;render()}if(t.id==='leadManagerFilter'){state.leadManager=t.value;render()}if(t.id==='orderStageFilter'){state.orderStage=t.value;render()}if(t.id==='orderManagerFilter'){state.orderManager=t.value;render()}if(t.id==='orderRiskFilter'){state.orderRisk=t.value;render()}if(t.id==='leadStatus'){const field=root.querySelector('#lostReasonField');if(field)field.classList.toggle('auto-conditional-hidden',t.value!=='Отказ')}if(t.id==='riskType'){const field=root.querySelector('#riskNoteField');if(field)field.classList.toggle('auto-conditional-hidden',t.value==='Нет')}if(t.name==='leadId'&&t.closest('#quoteForm[data-georgia-quote="true"]')&&!t.closest('#quoteForm').elements.id.value){state.modal={type:'quote',leadId:t.value,origin:'Грузия'};render();return}
if(t.name==='manufactureDate'&&t.closest('#quoteForm')){const form=t.closest('#quoteForm'),category=ageCategoryForMonth(t.value,today);if(form.elements.ageCategory)form.elements.ageCategory.value=['under3','3to5'].includes(category)?category:'';if(form.dataset.georgiaQuote==='true'){updateQuotePreview(form);return;}syncQuoteScenario(form)}if(t.id==='quoteOrigin'&&!t.closest('#quoteForm')?.elements.id?.value&&((t.value==='Грузия'&&t.closest('#quoteForm')?.dataset.georgiaQuote!=='true')||(t.value==='США'&&t.closest('#quoteForm')?.dataset.georgiaQuote==='true'))){state.modal={type:'quote',leadId:t.closest('#quoteForm')?.elements.leadId?.value||'',origin:t.value};render();return}if(t.name==='transportMode'&&t.closest('#quoteForm[data-georgia-quote="true"]')){const form=t.closest('#quoteForm'),turnkey=t.value==='Доставка под ключ';form.querySelector('#quoteTurnkeyDeliveryField')?.classList.toggle('auto-conditional-hidden',!turnkey);if(!turnkey&&form.elements.turnkeyDeliveryUsd)form.elements.turnkeyDeliveryUsd.value='0';updateQuotePreview(form);return;}if(t.id==='quoteOrigin'||t.id==='quoteAgeCategory'){syncQuoteScenario(t.closest('#quoteForm'))}if(t.name==='powerUnit'&&t.closest('#quoteForm')){const input=t.closest('#quoteForm').elements.powerHp;if(input)input.value=convertPowerInput(input.value,t.dataset.previousUnit,t.value);t.dataset.previousUnit=normalizePowerUnit(t.value);updateQuotePreview(t.closest('#quoteForm'));return}if(t.closest('#quoteForm')&&['customsConfirmed','recyclingConfirmed','cryptoBaseConfirmed','repairReviewed'].includes(t.name))updateQuotePreview(t.closest('#quoteForm'))});
root.addEventListener('input',event=>{const t=event.target;if(t.closest?.('#leadEditForm')&&t.name==='budget')t.dataset.manuallyEdited='1';if(t.closest?.('#leadEditForm')&&t.name==='catalogUsdRubRate'){const form=t.closest('#leadEditForm'),lead=leads.find(x=>x.id===form.elements.id.value),car=catalogCarForLead(lead,cars).car;const amount=catalogBudgetUsd(car,Number(t.value));if(amount>0&&!form.elements.budget.dataset.manuallyEdited)form.elements.budget.value=String(amount);const hint=form.querySelector('#catalogLeadBudgetHint');if(hint)hint.textContent=amount>0?'Бюджет по цене автомобиля и выбранному курсу: '+money(amount)+' (шаг $500).':'Введите положительный курс для расчёта.';return}if(t.closest?.('#quoteForm[data-georgia-quote="true"]')){updateQuotePreview(t.closest('#quoteForm'));return;}if(t.id==='autoSearch'){state.query=t.value;focusAfterRender('autoSearch')}if(t.id==='leadSearch'){state.leadQuery=t.value;focusAfterRender('leadSearch')}if(t.id==='orderSearch'){state.orderQuery=t.value;focusAfterRender('orderSearch')}if(t.closest('#quoteForm')&&['usdRubRate','customsRub','recyclingRub','customs','recyclingFee'].includes(t.name))syncQuoteCurrency(t.closest('#quoteForm'),t.name);
if(t.closest('#quoteForm')&&['engineCc','powerHp','invoiceUsd','manufactureDate','engineType','importerType','priceSource','customsSource'].includes(t.name))updateQuotePreview(t.closest('#quoteForm'));
if(t.closest('#quoteForm')&&['lot','auction','inland','ocean','customs','repair','partsCost','service','georgiaDelivery','legalization','recyclingFee','usdRubRate','customsRub','recyclingRub'].includes(t.name)){
  const form=t.closest('#quoteForm');
  if(['lot','auction','inland'].includes(t.name)&&form.elements.cryptoBaseConfirmed)form.elements.cryptoBaseConfirmed.checked=false;
  if(t.name==='customs'&&form.elements.customsConfirmed)form.elements.customsConfirmed.checked=false;
  if(t.name==='recyclingFee'&&form.elements.recyclingConfirmed)form.elements.recyclingConfirmed.checked=false;
  if(['repair','partsCost'].includes(t.name)&&form.elements.repairReviewed)form.elements.repairReviewed.checked=false;
  updateQuotePreview(form);
}});
root.addEventListener('submit',async event=>{event.preventDefault();const form=event.target,formId=form?.getAttribute?.('id')||'';if(formId==='requestForm')await submitRequest(form);if(formId==='leadEditForm')await submitLead(form);if(formId==='quoteForm')await submitQuote(form);if(formId==='orderForm')await submitOrder(form);if(formId==='catalogCarForm')await submitCatalogCar(form)});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.modal){state.modal=null;render()}});

async function submitRequest(form){
  const data=Object.fromEntries(new FormData(form).entries()),managerMode=data.managerMode==='1',errors=managerMode?validateManagerLead(data):validateClientRequest(data);
  const managerIdentity=managerMode?managerTelegramIdentity(data.manager,parse(localStorage,KEYS.team,[])):null;
  if(managerMode&&!supportedClientOrigin(data.origin))errors.push('Выберите сценарий США или Грузия.');
  if(!managerMode&&state.modal?.carId&&(data.catalogIntent!=='catalog'||!data.carId||state.modal.carId!==data.carId))
    errors.push('Связь с выбранным автомобилем потеряна. Откройте карточку каталога заново.');
  if(!managerMode&&data.catalogIntent==='catalog'&&!state.modal?.carId)
    errors.push('Невозможно подтвердить выбранную карточку автомобиля. Откройте её повторно.');
  if(!managerMode&&data.catalogIntent==='catalog'&&!cars.some(car=>car.id===data.carId&&car.active!==false))errors.push('Автомобиль больше не доступен в каталоге. Откройте его заново.');
  if(!managerMode&&data.catalogIntent!=='catalog'&&data.carId)errors.push('Нельзя изменить источник заявки. Откройте нужную карточку автомобиля.');
  if(errors.length){showErrors(form,[...new Set(errors)]);return}
  const selectedCar=!managerMode&&data.carId?cars.find(car=>car.id===data.carId):null;
  const submitButton=form.querySelector('button[type="submit"]');
  if(submitButton?.disabled)return;
  const originalText=submitButton?.textContent||'Отправить запрос';
  if(submitButton){submitButton.disabled=true;submitButton.textContent='Отправляем заявку…';submitButton.setAttribute('aria-busy','true')}
  try{
  const budgetRate=Number(data.catalogUsdRubRate)||0;
  const catalogBudget=selectedCar?catalogBudgetUsd(selectedCar,budgetRate):0;
  const lead={id:managerMode?nextId('L',leads):distributedId('L'),clientBuildSha:document.querySelector('meta[name="auto-sale-static-release"]')?.content?.match(/\/releases\/([a-f0-9]{40})\//)?.[1]||'',name:data.name.trim(),contact:data.contact.trim(),model:selectedCar?[selectedCar.brand,selectedCar.model].filter(Boolean).join(' '):data.model.trim(),origin:selectedCar?carOrigin(selectedCar):String(data.origin||''),budget:managerMode?Number(data.budget)||0:catalogBudget,catalogUsdRubRate:managerMode?0:budgetRate,carId:selectedCar?.id||'',catalogRequest:!!(!managerMode&&selectedCar),catalogVehicle:catalogVehicleSnapshot(selectedCar),estimatedCostRub:selectedCar?catalogPriceRub(selectedCar):Number(data.estimatedCostRub)||0,year:selectedCar?String(selectedCar.year||''):data.year||'',mileage:selectedCar?String(selectedCar.mileage||''):data.mileage||'',ageRange:data.ageRange||'',source:managerMode?data.source:'Mini App',manager:managerMode?data.manager:activeManagers()[0]||'',status:'Новый',priority:managerMode?data.priority:'Средний',createdAt:new Date().toISOString(),nextAction:managerMode?data.nextAction:today,note:data.note||'',clientCreated:!managerMode,yearFrom:managerMode?'':data.yearFrom||'',yearTo:managerMode?'':data.yearTo||'',mileageMax:managerMode?'':data.mileageMax||'',engine:managerMode?'Не важно':selectedCar?String(selectedCar.engine||''):data.engine||'Не важно',drive:managerMode?'Не важно':selectedCar?String(selectedCar.drive||''):data.drive||'Не важно',damage:managerMode?'Минимальные':data.damage||'Минимальные',deliveryCity:managerMode?'':data.deliveryCity||'',deposit:0,depositDate:'',paymentMethod:'',managerTelegramUsername:managerMode?String(managerIdentity?.username||''):String(data.managerTelegram||'').trim().replace(/^@/,''),managerTelegramUserId:managerMode?String(managerIdentity?.id||''):'',managerTelegramName:managerMode?String(managerIdentity?.name||data.manager||''):''};
  const note=noteEntry('Лид создан.');
    if(!managerMode&&typeof window.__AUTO_SALE_ENSURE_VK_MESSAGES__==='function'){
      try{await window.__AUTO_SALE_ENSURE_VK_MESSAGES__()}catch{window.__AUTO_SALE_VK_MESSAGES_STATE__={status:'unavailable'}}
    }
    const saved=window.__AUTO_SALE_ENTITY_BATCH__?await commitEntities([{resource:'lead',operation:'create',id:lead.id,input:lead},{resource:'note',operation:'create',leadId:lead.id,input:note}],form):{ok:true,localOnly:true};
    if(!saved){
      const problem=form.querySelector('.auto-form-error');
      if(problem){
        problem.setAttribute('role','alert');
        problem.scrollIntoView?.({block:'center',behavior:'smooth'});
      }
      return;
    }
    leads.push(lead);notes[lead.id]=[note];saveAll();
    state.modal=null;state.role=managerMode?'manager':'client';state.route=managerMode?'leads':'orders';sessionStorage.setItem(KEYS.role,state.role);render();
  }finally{
    if(submitButton?.isConnected){submitButton.disabled=false;submitButton.textContent=originalText;submitButton.removeAttribute('aria-busy')}
  }
}
async function submitLead(form){
  const data=Object.fromEntries(new FormData(form).entries()),lead=leads.find(x=>x.id===data.id);if(!lead)return;
  const managerIdentity=managerTelegramIdentity(data.manager,parse(localStorage,KEYS.team,[]));
  const q=quotes.filter(x=>x.leadId===lead.id).sort((a,b)=>b.version-a.version)[0],ctx={hasAgreedQuote:q?.status==='Согласован',deposit:Number(data.deposit)||0},errors=validateLeadUpdate(data,lead,ctx);
  if(Number(data.deposit)>0&&(!data.depositDate||!data.paymentMethod))errors.push('Для депозита укажите дату и способ оплаты.');
  if(Number(data.yearFrom)&&Number(data.yearTo)&&Number(data.yearFrom)>Number(data.yearTo))errors.push('Проверьте диапазон годов.');
  if(errors.length){showErrors(form,errors);return}
  const carMatch=catalogCarForLead(lead,cars),selectedManualCar=data.catalogCarId?cars.find(c=>c.id===data.catalogCarId):null,linkedCar=selectedManualCar||carMatch.car||null;
  const rate=Number(data.catalogUsdRubRate)||Number(lead.catalogUsdRubRate)||0;
  const resolvedBudget=linkedCar&&rate>0&&Number(data.budget)===0?catalogBudgetUsd(linkedCar,rate):Number(data.budget)||0;
  const nextLead={...lead,carId:lead.carId||linkedCar?.id||'',catalogVehicle:lead.catalogVehicle||catalogVehicleSnapshot(linkedCar),estimatedCostRub:lead.estimatedCostRub||catalogPriceRub(linkedCar),catalogUsdRubRate:rate,status:data.status,manager:data.manager,name:data.name.trim(),contact:data.contact.trim(),model:data.model.trim(),year:data.year!==undefined?String(data.year).trim():(lead.year||String(linkedCar?.year||'')),mileage:data.mileage!==undefined?String(data.mileage).trim():(lead.mileage||String(linkedCar?.mileage||'')),origin:String(data.origin||lead.origin||'Уточняется'),budget:resolvedBudget,source:data.source,priority:data.priority,nextAction:data.nextAction,yearFrom:data.yearFrom,yearTo:data.yearTo,mileageMax:data.mileageMax,engine:data.engine&&data.engine!=='Не важно'?data.engine:(linkedCar?.engine||data.engine),drive:data.drive&&data.drive!=='Не важно'?data.drive:(linkedCar?.drive||data.drive),damage:data.damage,deliveryCity:data.deliveryCity,deposit:Number(data.deposit)||0,depositDate:data.depositDate||'',paymentMethod:data.paymentMethod||'',note:data.note||'',lostReason:data.status==='Отказ'?data.lostReason:'',managerTelegramUsername:String(managerIdentity?.username||lead.managerTelegramUsername||''),managerTelegramUserId:String(managerIdentity?.id||((String(lead.manager||'')===String(data.manager||''))?lead.managerTelegramUserId:'')||''),managerTelegramName:String(managerIdentity?.name||data.manager||'')};
  const note=noteEntry('Карточка обновлена: '+nextLead.status+', менеджер '+nextLead.manager+(nextLead.deposit?', депозит '+money(nextLead.deposit):'')+'.');
  const saved=window.__AUTO_SALE_ENTITY_BATCH__?await commitEntities([{resource:'lead',operation:'patch',id:lead.id,input:nextLead},{resource:'note',operation:'create',leadId:lead.id,input:note}],form):{ok:true,localOnly:true};if(!saved)return;
  Object.assign(lead,nextLead);notes[lead.id]=notes[lead.id]||[];notes[lead.id].push(note);saveAll();state.modal={type:'lead',id:lead.id};render();
}
async function submitQuote(form){
  const data=Object.fromEntries(new FormData(form).entries()),lead=leads.find(x=>x.id===data.leadId);if(!lead)return;
  const verification=normalizeVehicleVerification(data);const existing=quotes.find(x=>x.id===data.id);
  if(existing&&!quoteAllowedStatuses(existing).includes(data.status)){showErrors(form,['Недопустимый переход статуса расчёта.']);return}
  const origin=data.origin||lead.origin||'',usdRubRate=Number(data.usdRubRate)||0,customsUsd=Number(data.customsRub)>0&&usdRubRate>0?rubToUsd(data.customsRub,usdRubRate):Number(data.customs)||0,recyclingUsd=Number(data.recyclingRub)>0&&usdRubRate>0?rubToUsd(data.recyclingRub,usdRubRate):Number(data.recyclingFee)||0,numbers={lot:Number(data.lot)||0,auction:origin==='США'?Number(data.auction)||0:0,inland:Number(data.inland)||0,ocean:Number(data.ocean)||0,customs:customsUsd,repair:Number(data.repair)||0,partsCost:Number(data.partsCost)||0,cryptoFee:origin==='США'&&data.tariffVersion===AWG_TARIFF_VERSION?awgCryptoFee({...data,origin}):Number(data.cryptoFee)||0,service:Number(data.service)||0,georgiaDelivery:Number(data.georgiaDelivery)||0,legalization:Number(data.legalization)||0,recyclingFee:recyclingUsd};
  if(origin==='Грузия'&&data.tariffVersion===AWG_GEORGIA_TARIFF_VERSION)Object.assign(numbers,georgiaQuoteAmounts(data));
  const extras={...(origin==='Грузия'&&data.tariffVersion===AWG_GEORGIA_TARIFF_VERSION?{exchangeRateDate:data.exchangeRateDate||'',exchangeRateSource:data.exchangeRateSource||'',publicComment:String(data.publicComment||'').trim().slice(0,3000),
    catalogSourceId:String(data.catalogSourceId||existing?.catalogSourceId||''),catalogVin:String(data.catalogVin||existing?.catalogVin||''),
    catalogYear:String(data.catalogYear||existing?.catalogYear||''),catalogEngine:String(data.catalogEngine||existing?.catalogEngine||''),
    catalogMileage:String(data.catalogMileage||existing?.catalogMileage||''),internationalTransferPercent:data.internationalTransferPercent===''?NaN:Number(data.internationalTransferPercent)}:{}),tariffVersion:data.tariffVersion||existing?.tariffVersion||'',ageCategory:data.ageCategory||'',engineCc:Number(data.engineCc)||0,powerHp:toMetricHorsepower(data.powerHp,data.powerUnit),powerInput:Number(data.powerHp)||0,powerUnit:normalizePowerUnit(data.powerUnit),quoteSchema:data.quoteSchema||existing?.quoteSchema||'',manufactureDate:data.manufactureDate||'',engineType:data.engineType||'',importerType:data.importerType||'',priceSource:data.priceSource||'',vehicleSourceUrl:String(data.vehicleSourceUrl||'').trim(),invoiceUsd:Number(data.invoiceUsd)||0,customsSource:data.customsSource||'',customsCheckedAt:data.customsCheckedAt||'',usdRubRate,customsRub:Number(data.customsRub)||0,recyclingRub:Number(data.recyclingRub)||0,customsZeroReason:String(data.customsZeroReason||'').trim(),recyclingZeroReason:String(data.recyclingZeroReason||'').trim(),repairCountry:data.repairCountry||defaultRepairCountry(origin,data.ageCategory),partsCountry:data.partsCountry||defaultPartsCountry(origin,data.ageCategory),customsConfirmed:!!form.elements.customsConfirmed?.checked,recyclingConfirmed:!!form.elements.recyclingConfirmed?.checked,cryptoBaseConfirmed:!!form.elements.cryptoBaseConfirmed?.checked,repairReviewed:!!form.elements.repairReviewed?.checked};
  const errors=validateQuote({...data,...numbers,...extras,verification});if(errors.length){showErrors(form,errors);return}
  const q=existing?{...existing}:{id:nextId('Q',quotes),leadId:lead.id,version:Number(data.version)||1};
  Object.assign(q,{leadId:lead.id,model:data.model.trim(),origin,transportMode:data.transportMode||defaultTransportMode(origin),...numbers,...extras,total:calculateQuote(numbers),verification,status:data.status,validUntil:origin==='Грузия'&&data.tariffVersion===AWG_GEORGIA_TARIFF_VERSION?'':data.validUntil,updatedAt:new Date().toISOString()});
  if(data.status==='Отправлен'&&!q.sentAt)q.sentAt=q.updatedAt;if(data.status==='Согласован')q.agreedAt=q.updatedAt;
  const nextLead={...lead};if(!['Сделка','Отказ'].includes(nextLead.status))nextLead.status=data.status==='Черновик'?'Расчёт':'Ожидает клиента';nextLead.model=q.model;nextLead.origin=q.origin;
  const note=noteEntry('Расчёт '+q.id+' v'+q.version+': '+money(q.total)+', статус «'+q.status+'».');
  const saved=window.__AUTO_SALE_ENTITY_BATCH__?await commitEntities([{resource:'quote',operation:existing?'patch':'create',id:q.id,input:q},{resource:'lead',operation:'patch',id:lead.id,input:nextLead},{resource:'note',operation:'create',leadId:lead.id,input:note}],form):{ok:true,localOnly:true};if(!saved)return;
  if(existing)Object.assign(existing,q);else quotes.push(q);Object.assign(lead,nextLead);notes[lead.id]=notes[lead.id]||[];notes[lead.id].push(note);saveAll();
  state.modal=null;state.role='manager';state.route='quotes';sessionStorage.setItem(KEYS.role,'manager');render();
}
async function submitOrder(form){
  const data=Object.fromEntries(new FormData(form).entries()),order=orders.find(x=>x.id===data.id);if(!order)return;
  const nextStage=nextOrderStage(order.stage),allowed=[order.stage,...(nextStage!==order.stage?[nextStage]:[])],errors=validateOrderUpdate(data,order.stage,allowed);
  const amount=Number(data.paymentAmount)||0,remaining=Math.max(0,order.total-order.paid);
  if(amount>remaining)errors.push('Платёж больше остатка по заказу.');
  if(amount>0&&order.paymentPlan?.length)errors.push(...validatePaymentStageEntry({plan:order.paymentPlan,payments:order.payments,stageId:data.paymentStage,amount}));
  if(errors.length){showErrors(form,[...new Set(errors)]);return}
  const patch={stage:data.stage,manager:data.manager,lot:data.lot.trim(),vin:data.vin.trim(),eta:data.eta,location:data.location.trim(),riskType:data.riskType,riskNote:data.riskType==='Нет'?'':data.riskNote.trim(),risk:data.riskType==='Нет'?'Нет':(data.riskNote.trim()||data.riskType),updatedAt:new Date().toISOString()};
  const operations=[{resource:'order',operation:'patch',id:order.id,input:patch}];
  let payment=null;if(amount>0){payment={id:nextPaymentId(order.payments),amount,date:data.paymentDate,method:data.paymentMethod,paymentStage:order.paymentPlan?.length?data.paymentStage:'',note:data.paymentNote||''};operations.push({resource:'payment',operation:'create',orderId:order.id,input:payment})}
  const lead=leads.find(x=>x.id===order.leadId),nextLead=lead?{...lead,manager:patch.manager,status:'Сделка'}:null;if(nextLead)operations.push({resource:'lead',operation:'patch',id:nextLead.id,input:nextLead});
  const saved=window.__AUTO_SALE_ENTITY_BATCH__?await commitEntities(operations,form):{ok:true,localOnly:true};if(!saved)return;
  Object.assign(order,patch);if(payment){order.payments.push(payment);order.paid=paymentsTotal(order.payments)}if(lead&&nextLead)Object.assign(lead,nextLead);
  saveAll();state.modal={type:'order',id:order.id};render();
}
window.addEventListener('auto-sale-entity-conflict',()=>{reloadFromCache();render()});
window.addEventListener('auto-sale-client-decision',()=>{
  quotes=parse(localStorage,KEYS.quotes,[])||[];
  notes=parse(localStorage,KEYS.notes,{})||{};
  render();
});
render();

function openManagerNotification(target,resolved){
  if(access.authenticated!==true||access.role!=='admin'||!hasAdminAccess||!resolved?.leadId)return false;
  if(!leads.some(item=>item.id===resolved.leadId))return false;
  let nextRoute='leads',nextModal={type:'lead',id:resolved.leadId};
  if(target?.type==='quote'){
    const quote=quotes.find(item=>item.id===resolved.quoteId&&item.leadId===resolved.leadId);
    if(!quote||quote.status==='Черновик')return false;
    nextRoute='quotes';nextModal={type:'quote',id:quote.id};
  }else if(target?.type==='order'){
    const order=orders.find(item=>item.id===resolved.orderId&&item.leadId===resolved.leadId);
    if(!order)return false;
    nextRoute='shipping';nextModal={type:'order',id:order.id};
  }else if(target?.type!=='lead')return false;
  state.role='manager';
  state.route=nextRoute;
  state.modal=nextModal;
  sessionStorage.setItem(KEYS.role,'manager');
  render();
  return true;
}
window.__AUTO_SALE_OPEN_MANAGER_NOTIFICATION__=openManagerNotification;

window.addEventListener('auto-sale-open-client-orders',()=>{if(state.role==='client'){state.route='orders';state.modal=null;render()}});
