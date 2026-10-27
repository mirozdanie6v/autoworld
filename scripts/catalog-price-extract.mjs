// AutoWorld Georgia Telegram prices can be encoded as text emoji.
// 1️⃣ 🤩 7️⃣ 9️⃣ 🔤 🔤 🔤 = 1,790,000 RUB. 🔤 is zero;
// both [1️⃣] and [1⃣] keycap forms are accepted.
const DIGIT='(?:[0-9]\uFE0F?\u20E3|🔤)';
const EMOJI_PRICE_RE=new RegExp('('+DIGIT+')\\s*🤩\\s*('+DIGIT+')\\s*('+DIGIT+')\\s*🔤\\s*🔤\\s*🔤','gu');
const PRICE_LABEL=/(?:^|\n)\s*(?:(?:цена|стоимость)\s*(?:автомобиля|авто)?|за\s+автомобиль)\s*[:—–-]?/iu;
const MONEY_RUB=/(\d+(?:[.,]\d+)?)\s*(?:млн(?:\.|а)?|миллион\w*)|(\d{1,3}(?:[ \u00a0]\d{3})+|\d{6,9})\s*(?:₽|руб(?:лей|ля|\.)?)/iu;
function decimalMoneyRub(value){const match=String(value||'').match(MONEY_RUB);if(!match)return 0;
  return match[1]?Math.round(Number(match[1].replace(',','.'))*1000000):Number(match[2].replace(/\D/g,''));}
function tokenDigit(token){return token==='🔤'?0:Number(token.match(/[0-9]/)?.[0]);}
export function telegramEmojiPriceRub(raw=''){
  const s=String(raw||'');let match,prices=[];
  EMOJI_PRICE_RE.lastIndex=0;
  while((match=EMOJI_PRICE_RE.exec(s))!==null){
    const figures=match.slice(1,4).map(tokenDigit);
    const value=(figures[0]*100+figures[1]*10+figures[2])*10000;
    if(Number.isSafeInteger(value)&&value>=100000&&value<=100000000)prices.push({value,index:match.index});
  }
  const unique=[...new Set(prices.map(x=>x.value))];
  return unique.length===1?unique[0]:0;
}
export function explicitSourcePriceRub(raw=''){
  const lines=String(raw||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    if(/цен[аыу]\s+в\s+россии|с\s+ремонтом|таможн|утиль|доставк|легализ/iu.test(lines[i]))continue;
    if(PRICE_LABEL.test('\n'+lines[i])){
      const onLine=decimalMoneyRub(lines[i]);if(onLine>0)return onLine;
      const next=decimalMoneyRub(lines[i+1]||'');if(next>0)return next;
    }
  }
  for(const line of lines){
    if(/цен[аыу]\s+в\s+россии|с\s+ремонтом|таможн|утиль|доставк|легализ/iu.test(line))continue;
    const price=decimalMoneyRub(line);if(price>0)return price;
  }
  return 0;
}
export function verifiedSourceRubPrice(post={}){
  const fromEmoji=telegramEmojiPriceRub(post.rawText);
  const fromPlain=explicitSourcePriceRub(post.rawText);
  // Source conflicts without explicit discount require human review.
  const discounted=/скидк|цен[аыу]\s+сниж|цен[аыу]\s+со\s+скидк|акци[яию]/iu.test(String(post.rawText||''));
  if(fromEmoji&&fromPlain&&fromEmoji!==fromPlain&&!discounted)
    return {priceRub:0,reason:'ambiguous_source_prices',emojiRub:fromEmoji,plainRub:fromPlain};
  const rub=fromEmoji&&fromPlain&&discounted?Math.min(fromEmoji,fromPlain):fromEmoji||fromPlain;
  if(rub>0)return {priceRub:rub,method:fromEmoji?'telegram_emoji':'explicit_rub'};
  const sourcePrice=Number(post.priceRub)||0;
  // Metadata may be reused only for a known nonempty source post.
  if(sourcePrice>0&&String(post.rawText||'').trim())return {priceRub:sourcePrice,method:'source_metadata'};
  return {priceRub:0,reason:'source_price_unresolved'};
}
