// Legacy Telegram publications state a Russia-with-repair estimate rather than
// the car purchase price. Preserve that price basis and any range/route split.
// Never silently relabel it as the underlying car purchase price.
export function extractLegacyTurnkeySource(raw='') {
  const s=String(raw||'').replace(/\s+/gu,' ').trim();
  if(/Пример расч[её]та США\s*\/\s*Грузия/iu.test(s)){
    const route=flag=>{
      const mark=flag==='США'?'🇺🇸':'🇬🇪';
      const begin=s.indexOf(mark);
      if(begin<0)return 0;
      const section=s.slice(begin,begin+150);
      const m=section.match(/🇷🇺\s*(\d{1,3}(?:[ \u00a0]\d{3}){2})\s*🇷🇺/u);
      return m?Number(m[1].replace(/\D/gu,'')):0;
    };
    const usa=route('США'),georgia=route('Грузия');
    if(!(usa>0&&georgia>0))return null;
    return {minRub:Math.min(usa,georgia),maxRub:Math.max(usa,georgia),
      kind:'route_comparison',usaRub:usa,georgiaRub:georgia};
  }
  const m=s.match(/Цена\s+в\s+России\s+под\s*🔧\s*:\s*(?:🪙\s*)?([^🇷🇺#]{1,110})/iu);
  if(!m)return null;
  const value=m[1].trim();
  const range=value.match(/(\d{1,2}(?:[.,]\d{1,3})?)\s*[-–—]\s*(\d{1,2}(?:[.,]\d{1,3})?)\s*млн/iu);
  if(range){
    const lo=Math.round(Number(range[1].replace(',','.'))*1e6);
    const hi=Math.round(Number(range[2].replace(',','.'))*1e6);
    return lo>0&&hi>=lo?{minRub:lo,maxRub:hi,kind:'turnkey_range',usaRub:0,georgiaRub:0}:null;
  }
  const keycap=value.match(/([0-9])\uFE0F?\u20E3\s*🔣\s*([0-9])\uFE0F?\u20E3\s*([0-9])\uFE0F?\u20E3\s*млн/iu);
  if(keycap){
    const val=Math.round((Number(keycap[1])+Number(keycap[2])/10+Number(keycap[3])/100)*1e6);
    return {minRub:val,maxRub:0,kind:'turnkey_single',usaRub:0,georgiaRub:0};
  }
  const mln=value.match(/(\d{1,2}(?:[.,]\d{1,3})?)\s*млн/iu);
  if(mln){
    const val=Math.round(Number(mln[1].replace(',','.'))*1e6);
    return {minRub:val,maxRub:0,kind:'turnkey_single',usaRub:0,georgiaRub:0};
  }
  const plain=value.match(/\b(\d{1,3}(?:[ \u00a0]\d{3}){2})\b/u);
  if(plain){
    const val=Number(plain[1].replace(/\D/gu,''));
    return {minRub:val,maxRub:0,kind:'turnkey_single',usaRub:0,georgiaRub:0};
  }
  return null;
}
