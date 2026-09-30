const money=value=>'$'+new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(Number(value)||0);
const rubMoney=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(value)||0)+' ₽';
const detailPrice=car=>Number(car?.price)>0?`от ${money(car.price)}`:Number(car?.priceRub)>0?rubMoney(car.priceRub):Number(car?.estimatedBidUsd)>0?`ставка ≈ ${money(car.estimatedBidUsd)}`:'по расчёту';
const detailOldPriceRub=car=>{const before=Number(car?.priceBeforeDiscountRub)||0,current=Number(car?.priceRub)||0;return before>current&&current>0?before:0};
const detailPriceHtml=car=>{const old=detailOldPriceRub(car);return `${old?`<s class="auto-detail-price-old">${rubMoney(old)}</s>`:''}<strong class="auto-detail-price-current">${detailPrice(car)}</strong>${old?'<span class="auto-detail-price-label">цена со скидкой</span>':''}`};
const auctionDateText=car=>String(car?.auctionDate||'').trim()||'уточняется';
const auctionDateTime=value=>{const raw=String(value||'').trim();if(!raw)return null;const m=raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);if(m){const t=Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]));return Number.isNaN(t)?null:t}const t=Date.parse(raw);return Number.isNaN(t)?null:t};
const auctionToday=()=>{const d=new Date();return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())};
const auctionEnded=car=>{const t=auctionDateTime(car?.auctionDate);return t!==null&&t<auctionToday()};
const detailHighlights=car=>(Array.isArray(car?.highlights)?car.highlights:[]).filter(item=>!/^Торги\s*:/i.test(String(item||'').trim()));
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const managedCar=id=>{try{const value=JSON.parse(localStorage.getItem('auto-sale-catalog-v1')||'null');return Array.isArray(value)?value.find(car=>car.id===id)||null:null}catch{return null}};
const currentPhoto=car=>managedCar(car.id)?.image||'';
const currentGallery=car=>{
  const managed=managedCar(car.id);
  const photos=[currentPhoto(car),...(Array.isArray(managed?.interiorPhotos)?managed.interiorPhotos:[]),...(Array.isArray(managed?.otherPhotos)?managed.otherPhotos:[])].filter(Boolean);
  return [...new Set(photos)];
};
const currentCar=id=>{
  const managed=managedCar(id);
  if(!managed)return null;
  return {
    body:'Автомобиль из каталога',
    power:'—',
    engine:managed?.engine||'—',
    transmission:'—',
    drive:managed?.drive||'—',
    seats:'—',
    efficiency:'—',
    highlights:[],
    safety:[],
    bestFor:'Точные характеристики конкретного автомобиля подтверждаются по VIN и данным лота.',
    ...(managed||{})
  };
};

function list(items){const rows=Array.isArray(items)?items:[];return rows.length?`<ul class="auto-car-detail-list">${rows.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'<p class="auto-car-detail-empty">Данные уточняются по конкретному лоту.</p>'}
function spec(label,value){return `<div class="auto-car-detail-spec"><span>${esc(label)}</span><b>${esc(value||'—')}</b></div>`}
function renderSlider(car){
  const gallery=currentGallery(car);
  if(!gallery.length)return'';
  return `<div class="auto-car-slider" data-car-slider data-index="0">
    <div class="auto-car-slider-viewport" data-car-slider-viewport>
      <div class="auto-car-slider-track" data-car-slider-track>
        ${gallery.map((src,i)=>`<div class="auto-car-slide" data-car-slide="${i}" aria-hidden="${i?'true':'false'}"><img src="${esc(src)}" alt="${esc(car.brand+' '+car.model)} · фото ${i+1}" draggable="false"></div>`).join('')}
      </div>
      ${gallery.length>1?`<button class="auto-car-slider-arrow prev" type="button" data-car-slide-prev aria-label="Предыдущее фото">‹</button><button class="auto-car-slider-arrow next" type="button" data-car-slide-next aria-label="Следующее фото">›</button><div class="auto-car-slider-count" data-car-slide-count>1 / ${gallery.length}</div>`:''}
    </div>
    ${gallery.length>1?`<div class="auto-car-slider-thumbs" aria-label="Фотографии автомобиля">${gallery.map((src,i)=>`<button type="button" class="${i?'':'active'}" data-car-slide-thumb="${i}" aria-label="Показать фото ${i+1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>`:''}
  </div>`;
}
function setSliderIndex(slider,nextIndex){
  if(!slider)return;
  const slides=[...slider.querySelectorAll('[data-car-slide]')];
  if(!slides.length)return;
  const index=(Number(nextIndex)+slides.length)%slides.length;
  slider.dataset.index=String(index);
  const track=slider.querySelector('[data-car-slider-track]');
  if(track)track.style.transform=`translate3d(-${index*100}%,0,0)`;
  slides.forEach((slide,i)=>slide.setAttribute('aria-hidden',i===index?'false':'true'));
  slider.querySelectorAll('[data-car-slide-thumb]').forEach((button,i)=>button.classList.toggle('active',i===index));
  const count=slider.querySelector('[data-car-slide-count]');if(count)count.textContent=`${index+1} / ${slides.length}`;
}

function closeDetail(){document.querySelector('.auto-car-detail-bg')?.remove();document.body.classList.remove('auto-car-detail-open')}

function openDetail(id){
  const car=currentCar(id);if(!car)return;
  const ended=auctionEnded(car);
  closeDetail();
  document.body.insertAdjacentHTML('beforeend',`<div class="auto-car-detail-bg" data-car-detail-bg><div class="auto-modal auto-modal-wide auto-car-detail-modal" role="dialog" aria-modal="true" aria-labelledby="car-detail-title"><div class="auto-modal-head"><div><span class="auto-eyebrow">${esc(car.auction)} · ${car.year} · карточка каталога</span><h2 id="car-detail-title">${esc(car.brand+' '+car.model)}</h2><div class="auto-modal-sub auto-detail-price-line">${detailPriceHtml(car)}<span class="auto-detail-price-delivery">· ${esc(car.delivery||'срок уточняется')}</span></div></div><button class="auto-close" type="button" data-car-detail-close aria-label="Закрыть">×</button></div>${renderSlider(car)}<div class="auto-car-detail-primary">${spec('Кузов',car.body)}${spec('Год выпуска',car.year)}${spec('Локация автомобиля',car.origin||'Уточняется')}${spec('Аукцион',car.auction)}${spec(ended?'Аукцион завершён':'Дата аукциона',auctionDateText(car))}${spec('Пробег',car.mileage)}${spec('Двигатель',car.engine)}${spec('Мощность',car.power)}${spec('Коробка',car.transmission)}${spec('Привод',car.drive)}${spec('Салон',car.seats)}${spec('Расход / запас хода',car.efficiency)}</div><div class="auto-car-detail-columns"><section><h3>Ключевое оснащение</h3>${list(detailHighlights(car))}</section><section><h3>Безопасность</h3>${list(car.safety)}</section></div><section class="auto-car-detail-best"><span>Кому подойдёт</span><p>${esc(car.bestFor)}</p></section><p class="auto-car-detail-note">Точная комплектация, состояние, история, пробег и опции конкретного автомобиля подтверждаются по VIN и данным источника до покупки.</p><div class="auto-actions"><button class="auto-btn primary" type="button" data-car-detail-request="${esc(car.id)}" ${ended?'disabled aria-disabled="true" title="Аукцион завершён"':''}>Получить расчёт</button><button class="auto-btn ghost" type="button" data-car-detail-close>Закрыть</button></div></div></div>`);
  document.body.classList.add('auto-car-detail-open');
  document.querySelector('.auto-car-detail-modal .auto-close')?.focus();
}

function cardId(card){return card?.dataset.extraCar||card?.querySelector('[data-detail]')?.dataset.detail||''}
function decorate(scope=document){
  for(const card of scope.querySelectorAll?.('.auto-car')||[]){
    const id=cardId(card),car=currentCar(id),media=card.querySelector('.auto-car-media');
    if(!car||!media||media.dataset.carPhotoDetail===id)continue;
    media.dataset.carPhotoDetail=id;media.setAttribute('role','button');media.tabIndex=0;media.setAttribute('aria-label',`Подробнее о ${car.brand} ${car.model}`);media.title='Открыть подробности';
  }
}

document.addEventListener('click',event=>{
  const close=event.target.closest('[data-car-detail-close]');if(close){closeDetail();return}
  if(event.target.matches('[data-car-detail-bg]')){closeDetail();return}
  const prev=event.target.closest('[data-car-slide-prev]');if(prev){const slider=prev.closest('[data-car-slider]');setSliderIndex(slider,Number(slider?.dataset.index||0)-1);return}
  const next=event.target.closest('[data-car-slide-next]');if(next){const slider=next.closest('[data-car-slider]');setSliderIndex(slider,Number(slider?.dataset.index||0)+1);return}
  const thumb=event.target.closest('[data-car-slide-thumb]');if(thumb){setSliderIndex(thumb.closest('[data-car-slider]'),Number(thumb.dataset.carSlideThumb));return}
  const request=event.target.closest('[data-car-detail-request]');if(request){const id=request.dataset.carDetailRequest,car=currentCar(id);if(request.disabled||!car||auctionEnded(car))return;closeDetail();const base=document.querySelector(`[data-request-car="${CSS.escape(id)}"]`);if(base){base.click();return}const extra=document.querySelector(`[data-extra-car="${CSS.escape(id)}"] [data-extra-model]`);extra?.click();return}
  const trigger=event.target.closest('[data-detail],[data-extra-detail],.auto-car .auto-car-media');if(!trigger)return;
  const card=trigger.closest('.auto-car'),id=trigger.dataset.detail||trigger.dataset.extraDetail||cardId(card);if(!currentCar(id))return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();openDetail(id);
},true);

let sliderTouchStartX=null;
document.addEventListener('touchstart',event=>{
  const viewport=event.target.closest?.('[data-car-slider-viewport]');if(!viewport)return;
  sliderTouchStartX=event.touches?.[0]?.clientX??null;
},{passive:true});
document.addEventListener('touchend',event=>{
  const viewport=event.target.closest?.('[data-car-slider-viewport]');if(!viewport||sliderTouchStartX===null)return;
  const endX=event.changedTouches?.[0]?.clientX??sliderTouchStartX;
  const delta=endX-sliderTouchStartX;sliderTouchStartX=null;
  if(Math.abs(delta)<45)return;
  const slider=viewport.closest('[data-car-slider]'),index=Number(slider?.dataset.index||0);
  setSliderIndex(slider,index+(delta<0?1:-1));
},{passive:true});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&document.querySelector('.auto-car-detail-bg')){closeDetail();return}
  if(!['Enter',' '].includes(event.key))return;const media=event.target.closest?.('[data-car-photo-detail]');if(!media)return;event.preventDefault();openDetail(media.dataset.carPhotoDetail);
});

window.__AUTO_SALE_CAR_DETAILS__={open:openDetail,close:closeDetail,currentCar,currentGallery,setSliderIndex};
decorate();
const root=document.getElementById('app');if(root){let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;decorate(root)})}).observe(root,{childList:true,subtree:true})}
window.addEventListener('load',()=>decorate());
