import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {telegramEmojiPriceRub,verifiedSourceRubPrice} from '../scripts/catalog-price-extract.mjs';
import {planCatalogPriceRepairs} from '../scripts/catalog-price-reconciliation.mjs';

const raw=JSON.parse(readFileSync(new URL('../data/autoworld-georgia-recent/cars.json',import.meta.url),'utf8'));
const byId=Object.fromEntries(raw.map(x=>[String(x.sourcePostId),x]));

test('every vehicle in September captured captions has a verified source price',()=>{
  assert.equal(raw.length,29);
  for(const post of raw){
    const found=verifiedSourceRubPrice(post);
    assert.ok(found.priceRub>=100000,'price missing in post '+post.sourcePostId);
  }
  assert.equal(telegramEmojiPriceRub(byId['3533'].rawText),1790000);
  assert.equal(telegramEmojiPriceRub(byId['3543'].rawText),2250000);
  assert.equal(telegramEmojiPriceRub(byId['3569'].rawText),2160000);
  assert.equal(telegramEmojiPriceRub(byId['3685'].rawText),2080000);
  assert.equal(telegramEmojiPriceRub(byId['3747'].rawText),2070000);
  assert.equal(telegramEmojiPriceRub(byId['3577'].rawText),2100000);
});
test('emoji amount is not a discount, turnkey estimate or an invented bid',()=>{
  assert.equal(verifiedSourceRubPrice(byId['3561']).priceRub,2550000,
    'the 2.72 million turnkey quote must not displace 2.55 million source price');
  const single={rawText:'Toyota RAV4 2022\nЦена: 2 300 000 ₽'};
  assert.equal(verifiedSourceRubPrice(single).priceRub,2300000);
  assert.equal(verifiedSourceRubPrice({rawText:'Toyota RAV4 2022\nЦена в России (с ремонтом) 2 800 000 ₽'}).priceRub,0);
  assert.equal(verifiedSourceRubPrice({rawText:'Toyota 2022\nПробег 2 300 000 км\nКурс 87'}).priceRub,0);
  assert.equal(verifiedSourceRubPrice({rawText:'Toyota 2022\n✨ 2️⃣ 🤩 1️⃣ 0️⃣ 🔤 🔤 🔤\nЦена 2 400 000 руб'}).reason,'ambiguous_source_prices');
  assert.equal(telegramEmojiPriceRub('✨ 1⃣ 🤩 9⃣ 3⃣ 🔤 🔤 🔤'),1930000);
});
test('old missing prices can be selectively repaired without touching other fields',()=>{
  const live=[
    {id:'AWG-3533',source:'AutoWorld_Georgia',sourcePostId:'3533',priceRub:0,active:false,vin:'ABC'},
    {id:'AWG-3543',source:'AutoWorld_Georgia',sourcePostId:'3543',priceRub:2100000,active:true},
    {id:'AWG-3553',source:'AutoWorld_Georgia',sourcePostId:'3553',priceRub:2290000,active:true},
    {id:'AWG-3569',source:'AutoWorld_Georgia',sourcePostId:'3569',priceRub:0,active:true},
    {id:'AWG-9999',source:'AutoWorld_Georgia',sourcePostId:'9999',priceRub:0,active:true}
  ];
  const {items,audit}=planCatalogPriceRepairs(live,raw,[]);
  assert.deepEqual(items.map(x=>x.sourcePostId),['3533','3569']);
  assert.deepEqual(items.map(x=>x.priceRub),[1790000,2160000]);
  assert.deepEqual(Object.keys(items[0]).sort(),['id','priceRub','sourcePostId','sourcePriceMethod','sourceUrl'].sort());
  assert.equal(audit.positivePriceConflicts.length,1);
  assert.equal(audit.missingSources.length,1);
  assert.equal(audit.verifiedExistingCount,1);
  assert.ok(!Object.hasOwn(items[0],'active'),'manual visibility must not be touched');
});
test('Python scraper and JavaScript reconciler decode the same emoji price',()=>{
  const python=String.raw`import re,json,sys
from pathlib import Path
source=Path('scripts/scrape-autoworld-georgia.py').read_text('utf8')
start=source.index('KEYCAP_PRICE_DIGIT =')
end=source.index(chr(10)+'def parse_title(',start)
ns={'re':re}
exec(source[start:end],ns)
posts=json.load(sys.stdin)
print(json.dumps([[p['sourcePostId'],ns['parse_discount_rub'](p['rawText'])] for p in posts]))
`;
  const results=JSON.parse(execFileSync('python3',['-c',python],{
    cwd:new URL('..',import.meta.url),input:JSON.stringify(raw),encoding:'utf8'
  }));
  assert.equal(results.length,29);
  for(const [id,rub] of results)
    assert.equal(rub,telegramEmojiPriceRub(byId[id].rawText),'price parser divergence '+id);
});
