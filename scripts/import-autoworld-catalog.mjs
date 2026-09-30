import {readFile,writeFile} from 'node:fs/promises';

const SOURCE_PATH=process.env.SOURCE_PATH||'data/autoworld-georgia-recent/cars.json';
const OUTPUT_PATH=process.env.OUTPUT_PATH||'data/autoworld-georgia-recent/catalog-import.json';
const AUDIT_PATH=process.env.AUDIT_PATH||OUTPUT_PATH.replace(/\.json$/,'-audit.json');
const STATE_URL=process.env.AUTO_SALE_STATE_URL||'https://auto-sale-demo.viiversion.com/api/auto-sale/state';
const DRY_RUN=/^(1|true|yes)$/i.test(String(process.env.DRY_RUN||''));
const REPLACE_SOURCE_ALL=/^(1|true|yes)$/i.test(String(process.env.REPLACE_SOURCE_ALL||''));
const ONLY_POST_IDS=new Set(String(process.env.ONLY_POST_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
const ALLOW_NO_VIN_POST_IDS=new Set(['3723','3290','3310','3262','3282','3357','3373','3893']);
const allowNoVin=source=>ALLOW_NO_VIN_POST_IDS.has(String(source?.sourcePostId||''));

const clean=value=>String(value??'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
const unique=list=>[...new Set((Array.isArray(list)?list:[]).filter(Boolean))];

function titleFromRaw(raw){
  const lines=String(raw||'').split(/\r?\n/).map(clean).filter(Boolean);
  const joined=[];
  for(let i=0;i<lines.length;i++){
    for(let n=1;n<=3&&i+n<=lines.length;n++)joined.push(lines.slice(i,i+n).join(' '));
  }
  for(const candidate of joined){
    const m=candidate.match(/([A-Za-zА-Яа-я][A-Za-zА-Яа-я0-9()+. ]{1,60}?)\s+(20\d{2}|\d{2})\s*[-–—]\s*(20\d{2}|\d{2})\s*г?\.?/i);
    if(m){
      const name=clean(m[1]);
      const parts=name.split(/\s+/);
      const y1=Number(m[2].length===2?'20'+m[2]:m[2]);
      const y2=Number(m[3].length===2?'20'+m[3]:m[3]);
      if(parts.length>=2&&y1>=2000&&y2>=y1&&y2<=2030){
        return{title:`${name} ${y1}–${y2}`,brand:parts[0],model:`${parts.slice(1).join(' ')} ${y1}–${y2}`,year:y2};
      }
    }
  }
  for(const candidate of joined){
    const m=candidate.match(/([A-Za-zА-Яа-я][A-Za-zА-Яа-я0-9()\-+. ]{1,60}?)\s+(0?[1-9]|1[0-2])\/(20\d{2}|\d{2})\s*г?\.?/i);
    if(m){
      let name=clean(m[1]).replace(/^.*?[🌟*]\s*/u,'').replace(/\bSou\s+l\b/i,'Soul');
      name=name.replace(/^(?:на|до)\s+\d{1,2}[./]\d{1,2}\s+/i,'');
      const parts=name.split(/\s+/);
      if(parts.length>=2){
        const year=Number(m[3].length===2?'20'+m[3]:m[3]);
        return{title:`${name} ${m[2]}/${year}`,brand:parts[0],model:parts.slice(1).join(' '),year};
      }
    }
  }
  for(const candidate of joined){
    const m=candidate.match(/([A-Za-zА-Яа-я][A-Za-zА-Яа-я0-9()\-+. ]{1,60}?)\s+(20\d{2})\s*г?\.?/i);
    if(m){
      let name=clean(m[1]).replace(/\bSou\s+l\b/i,'Soul');
      const parts=name.split(/\s+/);
      if(parts.length>=2)return{title:`${name} ${m[2]}`,brand:parts[0],model:parts.slice(1).join(' '),year:Number(m[2])};
    }
  }
  return{title:'',brand:'',model:'',year:0};
}

function field(raw,label,pattern){
  const text=String(raw||'');
  const re=pattern||new RegExp(label+'[\\s:–—-]*([^\\n]+)','i');
  const m=text.match(re);
  return clean(m?.[1]||'').replace(/^[🔺🔹♦️]+/u,'').trim();
}

function normalizeDrive(value,raw){
  const text=(clean(value)+' '+String(raw||'')).toUpperCase().replace(/АWD/g,'AWD');
  if(/\b4WD\b/.test(text))return'4WD';
  if(/\bAWD\b/.test(text)||/ПОЛН/.test(text))return'AWD';
  if(/\bRWD\b/.test(text)||/ЗАДН/.test(text))return'RWD';
  if(/\bFWD\b/.test(text)||/ПЕРЕДН/.test(text))return'FWD';
  return clean(value)||'FWD';
}

function extractMileage(car){
  const raw=String(car.rawText||'');
  const m=raw.match(/Пробег[\s\S]{0,80}?(\d[\d\s]*(?:ml|mi|км|km))/i);
  const value=clean(m?.[1]||car.mileage||'').replace(/\s+/g,' ');
  const n=value.match(/(\d[\d\s]*)\s*(ml|mi|км|km)/i);
  if(!n)return value;
  const amount=Number(n[1].replace(/\D/g,''))||0;
  const unit=/^(ml|mi)$/i.test(n[2])?'mi':'км';
  return amount?new Intl.NumberFormat('ru-RU').format(amount)+' '+unit:value;
}

function extractBid(car){
  if(Number(car.estimatedBidUsd)>0)return Number(car.estimatedBidUsd);
  const raw=String(car.rawText||'');
  const m=raw.match(/\+\s*-\s*([0-9][0-9\s]{3,6})[\s\S]{0,80}\(расч[её]тная ставка\)/i);
  return m?Number(m[1].replace(/\D/g,''))||0:0;
}

function extractPromoPriceRub(source){
  if(Number(source?.priceAfterDiscountRub)>0)return Number(source.priceAfterDiscountRub);
  const raw=String(source?.rawText||'');
  const m=raw.match(/([0-9])️⃣\s*\n\s*🤩\s*\n\s*([0-9])️⃣\s*\n\s*([0-9])️⃣\s*\n\s*🔤\s*\n\s*🔤\s*\n\s*🔤/u);
  return m?Number(`${m[1]}${m[2]}${m[3]}`)*10_000:0;
}
function sourceRubPrices(source){
  const rawVisible=Number(source?.priceBeforeDiscountRub)||Number(source?.priceRub)||0;
  const promo=extractPromoPriceRub(source);
  if(rawVisible>0&&promo>0&&rawVisible>promo){
    return{priceBeforeDiscountRub:rawVisible,priceAfterDiscountRub:promo,priceRub:promo};
  }
  const current=promo||Number(source?.priceRub)||0;
  return{priceBeforeDiscountRub:Number(source?.priceBeforeDiscountRub)||0,priceAfterDiscountRub:promo||0,priceRub:current};
}

const BRAND_MAP=new Map([
  ['KIA','Kia'],['HYUNDAI','Hyundai'],['TOYOTA','Toyota'],['NISSAN','Nissan'],
  ['HONDA','Honda'],['FORD','Ford'],['AUDI','Audi'],['ACURA','Acura'],
  ['VW','Volkswagen'],['MB','Mercedes-Benz'],['MERSEDES','Mercedes-Benz']
]);

function canonicalVehicleName(brand,model,rawTitle,vin){
  let b=clean(brand),m=clean(model),title=clean(rawTitle),v=clean(vin).toUpperCase();
  const mapped=BRAND_MAP.get(b.toUpperCase());
  if(mapped)b=mapped;

  if(/^пришел$/i.test(b)&&/SUBARU\s+Crosstrek/i.test(title)){b='Subaru';m='Crosstrek'}
  if(/^Trailblazer$/i.test(b)&&/^KL79/i.test(v)){b='Chevrolet';m='Trailblazer'}
  if(/^Eclipse$/i.test(b)&&/^JA4/i.test(v)){b='Mitsubishi';m='Eclipse Cross'}
  if(/^X1$/i.test(b)&&/^WBX/i.test(v)){b='BMW';m=('X1 '+m).trim()}
  if(/^GLB$/i.test(b)&&/^W1N/i.test(v)){b='Mercedes-Benz';m=('GLB '+m).trim()}
  if(/^Range$/i.test(b)&&/^SAL/i.test(v)){b='Land Rover';m=('Range '+m).trim()}

  const exactModel=new Map([
    ['ELANTRA','Elantra'],['SOUL','Soul']
  ]);
  if(exactModel.has(m))m=exactModel.get(m);
  return{brand:b,model:m};
}

function sourceQualityReason(source){
  const title=titleFromRaw(source.rawText);
  const vin=clean(source.vin).toUpperCase();
  const photos=unique(source.photos).filter(url=>/^https:\/\/storage\.yandexcloud\.net\//i.test(url));
  if(vin ? vin.length!==17 : !allowNoVin(source))return'invalid_or_missing_vin';
  if(!title.brand||!title.model)return'missing_vehicle_title';
  if(Number(title.year)<2000||Number(title.year)>2030)return'invalid_year';
  if(!photos.length)return'missing_recovered_photos';
  return'';
}


function buildBodyType(brand,model){
  const key=`${clean(brand)} ${clean(model)}`.toLowerCase();

  if(/(?:f-?150|f350|super duty|ram 1500|ram 2500|sierra 1500|tundra|tacoma|canyon|santa cruz)/i.test(key))return'Пикап';
  if(/(?:gle coupe|cayenne coupe|\bx6\b)/i.test(key))return'SUV-купе';
  if(/(?:228|gran coupe)/i.test(key))return'4-дверное купе';
  if(/prius/i.test(key))return'Лифтбек';
  if(/(?:k4|forte|elantra|sentra|corolla|jetta|tlx|\ba6\b|\ba3\b|330|530|amg c63)/i.test(key))return'Седан';
  if(/(?:impreza|astra)/i.test(key))return'Компактный автомобиль';
  if(/soul/i.test(key))return'Компактный кроссовер';
  if(/(?:trailblazer|trax|envista|rogue|qashqai|hr-v|h-rv|cr-v|crosstrek|seltos|venue|kona|t-cross|tucson|sportage|gle|glc|glb|gla|\bx1\b|\bx2\b|\bx3\b|\bx7\b|q5|q7|macan|cayenne|atlas|tiguan|evoque|kicks|eclipse|encore|ecosport)/i.test(key))return'Кроссовер / SUV';

  return'Легковой автомобиль';
}

function buildBestFor(car){
  const brand=clean(car.brand),model=clean(car.model),name=`${brand} ${model}`;
  const key=name.toLowerCase();
  const facts=[
    Number(car.year)>0?`${car.year} год`:'',
    clean(car.drive)&&!/^[—-]+$/.test(clean(car.drive))?`привод ${clean(car.drive)}`:'',
    clean(car.engine)&&!/уточняется|^[-—]$/i.test(clean(car.engine))?`двигатель ${clean(car.engine)}`:'',
    clean(car.trim)?`комплектация ${clean(car.trim)}`:'',
    clean(car.mileage)&&!/уточняется|н\/д|^[-—]$/i.test(clean(car.mileage))?`пробег ${clean(car.mileage)}`:''
  ].filter(Boolean);

  let use='Сбалансированный вариант для повседневных поездок и загородных маршрутов.';
  if(/(?:f-?150|f350|super duty|ram 1500|ram 2500|sierra|tundra|tacoma|canyon|santa cruz)/i.test(key)){
    use='Практичный вариант для тех, кому нужны возможности пикапа, уверенная тяга и универсальность для работы и поездок за город.';
  }else if(/(?:gle|glb|gla|x1|x2|x3|x6|x7|q5|q7|macan|cayenne|atlas|tiguan|evoque|trailblazer|envista|rogue|qashqai|hr-v|h-rv|trax|crosstrek|seltos|venue|kona|cr-v|kicks|eclipse|encore|ecosport)/i.test(key)){
    use=/(?:porsche|bmw|mercedes|audi|land rover)/i.test(key)
      ?'Подойдёт тем, кому нужен комфортный премиальный кроссовер или SUV для города, трассы и дальних поездок.'
      :'Подойдёт для ежедневной городской эксплуатации, семейных поездок и выездов за город.';
  }else if(/prius/i.test(key)){
    use='Рациональный вариант для ежедневной эксплуатации, города и тех, кому важны экономичность и практичность.';
  }else if(/(?:amg|228|330|530|tlx|a6|a3|k4|forte|elantra|sentra|corolla|jetta|impreza)/i.test(key)){
    use=/(?:amg|bmw|audi|acura)/i.test(key)
      ?'Подойдёт тем, кто ищет комфортный автомобиль для города и трассы с акцентом на динамику и оснащение.'
      :'Практичный вариант для ежедневных поездок, города и трассы с понятными эксплуатационными расходами.';
  }else if(/soul/i.test(key)){
    use='Компактный и практичный вариант для города, ежедневных поездок и тех, кому важен удобный салон при небольших габаритах.';
  }
  return facts.length?`${name}: ${facts.join(', ')}. ${use}`:`${name}. ${use}`;
}

function inferOrigin(source){
  const explicit=clean(source?.origin);
  if(explicit)return explicit;
  const raw=String(source?.rawText||'');
  if(/КОРЕ[ЯИ]/i.test(raw))return'Корея';
  if(/ЕВРОП/i.test(raw))return'Европа';
  if(/ПРИМЕР\s+РАСЧ[ЕЁ]ТА\s+США\s*\/\s*ГРУЗ/i.test(raw))return'США / Грузия';
  if(clean(source?.auctionDate)||clean(source?.lot)||/\bТОРГИ\b|BUY\s*NOW|РАСЧ[ЕЁ]ТНАЯ\s+СТАВКА/i.test(raw))return'США';
  return'Грузия';
}

function normalizeCar(source){
  const title=titleFromRaw(source.rawText);
  const rawBrand=clean(title.brand||source.brand);
  const rawModel=clean(title.model||source.model).replace(/\bSou\s+l\b/i,'Soul');
  const year=Number(title.year||source.year)||0;
  const vin=clean(source.vin).toUpperCase();
  const photos=unique(source.photos).filter(url=>/^https:\/\/storage\.yandexcloud\.net\//i.test(url));
  const names=canonicalVehicleName(rawBrand,rawModel,title.title||source.title,vin);
  const brand=names.brand,model=names.model;
  if((vin ? vin.length!==17 : !allowNoVin(source))||!brand||!model||year<2000||year>2030||!photos.length)return null;

  const engine=clean(source.engine)||field(source.rawText,'Двигатель');
  const transmission=clean(source.transmission)||field(source.rawText,'Коробка');
  const interior=clean(source.interior)||field(source.rawText,'Салон');
  const raw=String(source.rawText||'');
  const sourceDamage=clean(source.damage).replace(/^[\"']+|[\"'…]+$/g,'').trim();
  const damage=/без повреждений/i.test(raw)?'без повреждений':(sourceDamage.length>1?sourceDamage:field(raw,'Повреждения?').replace(/^[\"']+|[\"'…]+$/g,'').trim());
  const sourceSafety=clean(source.safety).replace(/^[\"']+|[\"']+$/g,'').trim();
  const safetyText=sourceSafety||(/Безопасность[\s\S]{0,50}?завод/i.test(raw)?'завод':field(raw,'Безопасность').replace(/^[\"']+|[\"']+$/g,'').trim());
  const trim=clean(source.trim)||field(source.rawText,'комплектация');
  const bid=extractBid(source);
  const prices=sourceRubPrices(source);
  const priceRub=prices.priceRub;
  const customsRub=Number(source.customsRub)||0;
  const drive=normalizeDrive(source.drive,source.rawText);
  const highlights=[
    trim&&`Комплектация: ${trim}`,
    vin&&`VIN: ${vin}`,
    source.lot&&`Лот: ${clean(source.lot)}`,
    source.calculationDate&&`Расчёт источника: ${clean(source.calculationDate)}`,
    Array.isArray(source.vins)&&source.vins.length&&`VIN в источнике: ${source.vins.map(clean).filter(Boolean).join(' · ')}`
  ].filter(Boolean);
  const safety=[
    safetyText&&`Безопасность: ${safetyText.replace(/^["']|["']$/g,'')}`,
    damage&&`Повреждения: ${damage.replace(/^["']|["']$/g,'')}`
  ].filter(Boolean);

  return{
    id:`AWG-${source.sourcePostId}`,
    brand,
    model,
    year,
    body:buildBodyType(brand,model),
    origin:inferOrigin(source),
    mileage:extractMileage(source)||'Пробег уточняется',
    engine:engine||'Двигатель уточняется',
    drive,
    auction:'AutoWorld Georgia',
    price:0,
    priceBeforeDiscountRub:prices.priceBeforeDiscountRub,
    priceAfterDiscountRub:prices.priceAfterDiscountRub,
    priceRub,
    estimatedBidUsd:bid,
    delivery:'Срок по запросу',
    tag:trim||'AutoWorld',
    image:photos[0],
    interiorPhotos:[],
    otherPhotos:photos.slice(1,7),
    active:true,
    source:'AutoWorld_Georgia',
    sourcePostId:String(source.sourcePostId||''),
    sourceUrl:clean(source.sourceUrl),
    publishedAt:clean(source.publishedAt),
    vin,
    trim,
    transmission,
    interior,
    damage,
    safety,
    auctionDate:clean(source.auctionDate),
    customsRub,
    lot:clean(source.lot),
    calculationDate:clean(source.calculationDate),
    rawSourceTitle:title.title||clean(source.title),
    power:Number(source.powerHp)>0?`${Number(source.powerHp)} л.с.`:'—',
    seats:interior||'—',
    efficiency:clean(source.consumption)||'—',
    highlights,
    bestFor:buildBestFor({brand,model,year,drive,engine,trim,mileage:extractMileage(source),powerHp:source.powerHp,interior})
  };
}

function dedupe(list){
  const byKey=new Map();
  for(const car of list){
    if(!car)continue;
    const vin=clean(car.vin).toUpperCase();
    const key=vin?`vin:${vin}`:`id:${car.id}`;
    const before=byKey.get(key);
    if(!before||Number(car.sourcePostId)>Number(before.sourcePostId))byKey.set(key,car);
  }
  return[...byKey.values()].sort((a,b)=>Number(b.sourcePostId)-Number(a.sourcePostId));
}

async function fetchState(){
  const r=await fetch(STATE_URL,{headers:{accept:'application/json'}});
  if(!r.ok)throw new Error(`state_read_failed_${r.status}`);
  return r.json();
}

async function putState(state,catalog){
  const payload={
    baseRevision:Number(state.revision)||0,
    leads:state.leads||[],quotes:state.quotes||[],orders:state.orders||[],
    notes:state.notes||{},team:state.team||[],catalog
  };
  return fetch(STATE_URL,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
}

async function main(){
  const sourceAll=JSON.parse(await readFile(SOURCE_PATH,'utf8'));
  const source=ONLY_POST_IDS.size?sourceAll.filter(item=>ONLY_POST_IDS.has(String(item.sourcePostId||''))):sourceAll;
  if(ONLY_POST_IDS.size&&source.length!==ONLY_POST_IDS.size)throw new Error(`selected_source_count_mismatch_${source.length}_of_${ONLY_POST_IDS.size}`);
  const normalizedRows=source.map(item=>({source:item,car:normalizeCar(item)}));
  const imported=dedupe(normalizedRows.map(x=>x.car));
  if(!imported.length)throw new Error('no_valid_imported_cars');
  await writeFile(OUTPUT_PATH,JSON.stringify(imported,null,2)+'\n','utf8');

  const candidates=normalizedRows.filter(x=>x.car).map(x=>x.car);
  const brandCounts={};
  for(const car of imported)brandCounts[car.brand]=(brandCounts[car.brand]||0)+1;
  const vinGroups={};
  for(const car of candidates)(vinGroups[car.vin]??=[]).push(car.sourcePostId);
  const duplicateVins=Object.entries(vinGroups).filter(([,posts])=>posts.length>1).map(([vin,posts])=>({vin,posts}));
  const skipped=normalizedRows.filter(x=>!x.car).map(x=>({
    sourcePostId:String(x.source.sourcePostId||''),
    sourceUrl:clean(x.source.sourceUrl),
    title:titleFromRaw(x.source.rawText).title||clean(x.source.title),
    vin:clean(x.source.vin),
    reason:sourceQualityReason(x.source)
  }));
  const originCounts={};
  for(const car of imported)originCounts[car.origin]=(originCounts[car.origin]||0)+1;
  const audit={
    sourceCount:source.length,
    candidateCount:candidates.length,
    normalizedCount:imported.length,
    skippedInvalidCount:skipped.length,
    duplicateVinCount:candidates.length-imported.length,
    excludedTotal:source.length-imported.length,
    pricedRub:imported.filter(x=>Number(x.priceRub)>0).length,
    discountedRub:imported.filter(x=>Number(x.priceBeforeDiscountRub)>Number(x.priceRub)&&Number(x.priceRub)>0).length,
    pricedBid:imported.filter(x=>Number(x.estimatedBidUsd)>0).length,
    noPrice:imported.filter(x=>!Number(x.priceRub)&&!Number(x.estimatedBidUsd)).length,
    withPhotos:imported.filter(x=>x.image).length,
    originCounts,
    brandCounts,
    duplicateVins,
    skipped
  };
  await writeFile(AUDIT_PATH,JSON.stringify(audit,null,2)+'\n','utf8');
  console.log('AUTOWORLD_NORMALIZE_OK',JSON.stringify(audit));
  if(DRY_RUN)return;

  for(let attempt=0;attempt<8;attempt++){
    const state=await fetchState();
    const importedIds=new Set(imported.map(x=>x.id));
    const importedVins=new Set(imported.map(x=>clean(x.vin).toUpperCase()).filter(Boolean));
    const existing=(state.catalog||[]).filter(car=>{
      if(REPLACE_SOURCE_ALL&&String(car.source||'')==='AutoWorld_Georgia')return false;
      const existingVin=clean(car.vin).toUpperCase();
      return !importedIds.has(String(car.id||'')) &&
        !(String(car.source||'')==='AutoWorld_Georgia'&&existingVin&&importedVins.has(existingVin));
    });
    const catalog=[...existing,...imported];
    const response=await putState(state,catalog);
    if(response.ok){
      const data=await response.json();
      console.log('AUTOWORLD_CATALOG_IMPORT_OK',JSON.stringify({
        imported:imported.length,
        previousCatalog:(state.catalog||[]).length,
        catalog:catalog.length,
        revision:data.revision
      }));
      return;
    }
    const body=await response.text();
    if(response.status!==409)throw new Error(`state_write_failed_${response.status}_${body.slice(0,500)}`);
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('state_write_conflict_exhausted');
}

main().catch(error=>{console.error(error);process.exit(1)});
