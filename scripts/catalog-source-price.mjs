import {extractLegacyTurnkeySource} from './catalog-legacy-turnkey.mjs';
// Read the listing's verified RUB prices, never infer one from model years,
// exchange rates, customs costs, engine displacement or bid estimates.
// The Telegram channel writes prices as keycaps + 🤩 decimal + 🔤 zeroes.
const KEYCAP=/^([0-9])\uFE0F?\u20E3$/u;
const ZERO='🔤';
const DELIMITER='🤩';
const STOP=/^(?:🔹|🔸|🔺|📜|🛡|🔎|🐎|💨|комплектация|Пробег|Двигатель)/iu;

export function decodeChannelEmojiPrice(raw=''){
  const lines=String(raw||'').split(/\r?\n/u).map(x=>x.trim()).filter(Boolean);
  for(let i=0;i<Math.min(lines.length,70);i++){
    if(!/^(?:✨|💰|💸)$/u.test(lines[i]))continue;
    const tokens=[];
    for(let j=i+1;j<Math.min(lines.length,i+13);j++){
      const line=lines[j].replace(/^[* ]+|[* ]+$/g,'').trim();
      if(!line)continue;
      if(STOP.test(line))break;
      if(line===DELIMITER){tokens.push('.');continue;}
      if(line===ZERO){tokens.push('0');continue;}
      const k=line.match(KEYCAP);
      if(k){tokens.push(k[1]);continue;}
      break;
    }
    const pos=tokens.indexOf('.');
    if(pos<1||pos>2||tokens.indexOf('.',pos+1)>=0)continue;
    const whole=tokens.slice(0,pos).join(''),fraction=tokens.slice(pos+1).join('');
    if(!/^\d{1,2}$/.test(whole)||!/^\d{2,5}$/.test(fraction))continue;
    const amount=Math.round(Number(whole+'.'+fraction)*1_000_000);
    if(amount>=100_000&&amount<=200_000_000)return amount;
  }
  return 0;
}

export function rubAmount(value=''){
  const raw=String(value||'').replace(/\u00a0/g,' ');
  let m=raw.match(/(?<!\d)(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:млн\.?|миллион(?:а|ов)?)/iu);
  if(m)return Math.round(Number(m[1].replace(',','.'))*1_000_000);
  m=raw.match(/(?<!\d)(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:тыс\.?|тысяч(?:а|и)?)/iu);
  if(m)return Math.round(Number(m[1].replace(',','.'))*1_000);
  m=raw.match(/(?<!\d)(\d{1,3}(?:[ \u00a0]\d{3})+|\d{6,9})\s*(?:₽|руб(?:лей|\.)?)/iu);
  return m?Number(m[1].replace(/[^\d]/g,'')):0;
}
const TURNKEY=/цен[аы]\s+в\s+россии|стоимост[ьи]\s+автомобиля\s+под\s+ключ|с\s+ремонтом\s+под\s*🔧/iu;
const PRIMARY=/^(?:\+[-+ ]*)?(?:цена|стоимость\s+автомобиля|цена\s+авто)(?=\s|[:–—-]|$)/iu;
const DISCOUNT=/скидк|цен[аыу]\s+сниж|цен[аыу]\s+со\s+скидк|акци[яию]|горячая\s+цена/iu;

export function extractSourcePrices(raw=''){
  const text=String(raw||'');
  const legacy=extractLegacyTurnkeySource(text);
  const emoji=decodeChannelEmojiPrice(text);
  const lines=text.split(/\r?\n/u).map(x=>x.trim()).filter(Boolean);
  let turnkey=0,primary=0,turnkeyContext=false;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    // Labels may be split across 2–6 Telegram lines: "Цена"/"в России"/
    // "(с ремонтом)"/"под"/"🔧"/"+- 2.6 млн. руб.".
    const block=lines.slice(i,Math.min(i+7,lines.length)).join(' ');
    if(TURNKEY.test(block.slice(0,120))&&/цен[аы]\s+в\s+россии|стоимост[ьи]\s+автомобиля\s+под\s+ключ/iu.test(block)){
      const amount=rubAmount(block);
      if(amount>0){turnkey=turnkey||amount;turnkeyContext=true;}
    }
    const sourceLabel=PRIMARY.test(line)||
      (DISCOUNT.test(line)&&/цен[аы]\s*[:–—-]/iu.test(line));
    if(sourceLabel&&!TURNKEY.test(block.slice(0,120))){
      const amount=rubAmount(line);
      if(amount>0)primary=primary||amount;
    }
  }
  // A turnkey headline is NOT the primary car price. The encoded sticker is.
  // Generic ruble figures may be customs, legalization, total, or rates.
  // Accept a plain figure only when explicitly tagged as the vehicle price.
  const discounted=Boolean(DISCOUNT.test(text));
  const priceRub=emoji||primary;
  // An old '1.92–2.23 млн' range is displayed FROM 1.92m; the
  // generic rubAmount parser otherwise grabs 2.23m at the end of the range.
  const turnkeyRub=legacy?.minRub||turnkey||0;
  const discountPriceRub=discounted&&emoji&&primary&&primary>emoji?emoji:0;
  const priceBeforeDiscountRub=discountPriceRub?primary:0;
  return {
    priceRub:discountPriceRub||priceRub,
    priceBeforeDiscountRub,
    priceAfterDiscountRub:discountPriceRub,
    discountExplicit:Boolean(discountPriceRub),
    russiaTurnkeyRub:turnkeyRub,
    russiaTurnkeyMaxRub:legacy?.maxRub||0,
    russiaTurnkeyKind:legacy?.kind||'',
    usaTurnkeyRub:legacy?.usaRub||0,
    georgiaTurnkeyRub:legacy?.georgiaRub||0,
    turnkeyDeliveryRub:turnkeyRub>priceRub&&priceRub>0?turnkeyRub-priceRub:0,
    turnkeyDeliverySource:turnkeyRub>priceRub&&priceRub>0?'source_russia_with_repair_difference':'',
    priceEvidence:emoji?'channel_emoji':primary?'source_label':legacy?.minRub?'russia_turnkey_only':'unresolved'
  };
}
