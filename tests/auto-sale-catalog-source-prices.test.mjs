import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {decodeChannelEmojiPrice,extractSourcePrices,rubAmount} from '../scripts/catalog-source-price.mjs';

const archive=JSON.parse(readFileSync(new URL('../data/autoworld-georgia-recent/cars.json',import.meta.url),'utf8'));
const byPost=new Map(archive.map(x=>[String(x.sourcePostId),x]));
const expected={
  '3533':[1790000,0],'3543':[2250000,0],'3553':[2290000,0],
  '3561':[2550000,2720000],'3569':[2160000,0],
  '3577':[2100000,0],'3586':[2150000,0],
  '3597':[2440000,2600000],'3607':[2630000,2800000],
  '3617':[2120000,0],'3637':[1970000,2150000],
  '3647':[6570000,6800000],'3657':[7170000,7400000],
  '3667':[2130000,0],'3677':[2460000,0],
  '3685':[2080000,0],'3695':[1950000,0],
  '3703':[2770000,2970000],'3723':[1930000,0],
  '3733':[1970000,0],'3734':[6570000,0],
  '3735':[2770000,0],'3736':[4130000,0],
  '3737':[2160000,0],'3747':[2070000,0],
  '3752':[2110000,0],'3828':[4130000,0]
};
test('27 archived channel keycap prices and independent Russia turnkey estimates',()=>{
  for(const [id,[price,turnkey]] of Object.entries(expected)){
    const row=byPost.get(id);
    assert.ok(row,'fixture missing channel post '+id);
    const result=extractSourcePrices(row.rawText);
    assert.equal(result.priceRub,price,'post '+id+' sticker price');
    assert.equal(result.russiaTurnkeyRub,turnkey,'post '+id+' turnkey');
    assert.equal(result.discountExplicit,false,id+' not a discount');
    assert.equal(result.turnkeyDeliveryRub,turnkey?turnkey-price:0,id+' delivery');
  }
});
test('strike-through only when source explicitly contains a real discount',()=>{
  const sample=byPost.get('3597').rawText;
  assert.equal(extractSourcePrices(sample).discountExplicit,false);
  const discount=extractSourcePrices('🌟\nKIA K4 05/2024\n✨\n2️⃣\n🤩\n4️⃣\n🔤\n🔤\n🔤\nскидка! Цена: 2.6 млн руб.');
  assert.equal(discount.priceRub,2400000);
  assert.equal(discount.priceBeforeDiscountRub,2600000);
  assert.equal(discount.priceAfterDiscountRub,2400000);
  assert.equal(discount.discountExplicit,true);
});
test('ignore header/engine/rate/customs numbers without sticker price evidence',()=>{
  assert.equal(extractSourcePrices('Hyundai Elantra 2024\nДвигатель: 2.0\nТаможня 650 тыс. руб.\nКурс ЦБ 87 руб.').priceRub,0);
  assert.equal(decodeChannelEmojiPrice('🤩\n🤩\nдо\n1⃣\n6⃣\n🤩'),0);
  assert.equal(rubAmount('+- 2.6 млн. руб.'),2600000);
  assert.equal(rubAmount('1 790 000 ₽'),1790000);
});
test('Python scraper matches JS decoder for archived source prices',()=>{
  const source=readFileSync(new URL('../scripts/scrape-autoworld-georgia.py',import.meta.url),'utf8');
  const python=[
    'import re, json, sys',
    'source=sys.stdin.read()',
    'start=source.index("def price_amount_rub(value):")',
    'end=source.index(chr(10)+"def parse_title(text):",start)',
    'ns={"re":re}',
    'exec(source[start:end],ns)',
    'for pid,raw in json.loads(sys.argv[1]):',
    '  prior,main,after=ns["parse_price_pair"](raw)',
    '  turnkey=ns["parse_russia_turnkey_rub"](raw)',
    '  print(json.dumps({"id":pid,"price":main,"turnkey":turnkey or 0}))'
  ].join('\n');
  const values=Object.keys(expected).map(id=>[id,byPost.get(id).rawText]);
  const result=execFileSync('python3',['-c',python,JSON.stringify(values)],{
    cwd:new URL('..',import.meta.url),input:source,encoding:'utf8',maxBuffer:2_000_000
  }).trim().split('\n').map(line=>JSON.parse(line));
  for(const row of result)assert.deepEqual([row.price,row.turnkey],expected[row.id],'Python '+row.id);
});


const history=JSON.parse(readFileSync(new URL('../data/autoworld-georgia/cars.json',import.meta.url),'utf8'));
const historicalPost=new Map(history.map(x=>[String(x.sourcePostId),x]));
const stickerPriceAfterLabel={
  '1353':4330000,'1834':4650000,'2285':1380000,'2385':1840000,
  '2406':2420000,'3161':2060000,'3980':1480000,'3990':1720000,'4000':1910000
};
test('historical sticker prices after ❗️ / old headline / padding are recoverable',()=>{
  for(const [postId,amount] of Object.entries(stickerPriceAfterLabel)){
    const car=historicalPost.get(postId);
    assert.ok(car,'archive missing '+postId);
    assert.equal(decodeChannelEmojiPrice(car.rawText),amount,postId);
    assert.equal(extractSourcePrices(car.rawText).priceRub,amount,postId);
  }
});
test('new price decoder stays conservative: no prices from marketing numbers or other emoji',()=>{
  const cases=[
    '🤩\n🤩\nдо\n1⃣\n6⃣\n🤩\n🌟\nKia K4 2023\nЦена доставки 500 тыс. руб.',
    '🌟\nBMW 530i 2024\n✨\n🔤\n🔤\n🔤\n🔤\n🔤\n🔤\nДвигатель 2.0',
    '🌟\nBMW 530i 2024\n✨\n4️⃣\n❤️\n6️⃣\n2️⃣\n👤\n👤\n👤',
    '🌟\nAudi Q5 2024\n✨\n2️⃣\n🤩\n6️⃣\nДвигатель: 2.0',
    '🌟\nAudi Q5 2024\n✨\n1️⃣\n🤩\n4️⃣\n❤️\n8️⃣'
  ];
  for(const raw of cases)assert.equal(decodeChannelEmojiPrice(raw),0,raw);
});
test('Python and JS recover pricing of recent missing-price posts and never use headline as current price',()=>{
  const python=[
    'import re, json, sys',
    'source=sys.stdin.read()',
    'start=source.index("def price_amount_rub(value):")',
    'end=source.index(chr(10)+"def parse_title(text):",start)',
    'ns={"re":re}',
    'exec(source[start:end],ns)',
    'for post_id,raw in json.loads(sys.argv[1]):',
    '  before,main,after=ns["parse_price_pair"](raw)',
    '  print(json.dumps({"postId":post_id,"price":main,"before":before}))'
  ].join('\n');
  const keys=['3980','3990','4000'];
  const input=keys.map(id=>[id,historicalPost.get(id).rawText]);
  const output=execFileSync('python3',['-c',python,JSON.stringify(input)],{
    cwd:new URL('..',import.meta.url),input:readFileSync(new URL('../scripts/scrape-autoworld-georgia.py',import.meta.url),'utf8'),
    encoding:'utf8'
  }).trim().split('\n').map(x=>JSON.parse(x));
  for(const row of output){
    assert.equal(row.price,stickerPriceAfterLabel[row.postId]);
    assert.equal(row.before,null,'old price headline is not a fake markdown discount');
  }
});

test('secondary Russia turnkey amounts are not misclassified as the primary car price',()=>{
  for(const postId of ['1157','1236','1246','3405']){
    const raw=historicalPost.get(postId).rawText;
    assert.equal(decodeChannelEmojiPrice(raw),0,postId);
  }
});
