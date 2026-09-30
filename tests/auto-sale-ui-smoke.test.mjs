import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('../public/auto-sale-app-v3.mjs',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const bootstrap=await readFile(new URL('../public/auto-sale-bootstrap.mjs',import.meta.url),'utf8');
const css=await readFile(new URL('../public/auto-sale-admin.css',import.meta.url),'utf8');
const responsive=await readFile(new URL('../public/auto-sale-responsive.css',import.meta.url),'utf8');
const mobileAdmin=await readFile(new URL('../public/auto-sale-mobile-admin.css',import.meta.url),'utf8');
const core=await readFile(new URL('../public/auto-sale-core.mjs',import.meta.url),'utf8');
const details=await readFile(new URL('../public/auto-sale-car-details.mjs',import.meta.url),'utf8');
const clientCss=await readFile(new URL('../public/auto-sale.css',import.meta.url),'utf8');
const team=await readFile(new URL('../public/auto-sale-director-team.mjs',import.meta.url),'utf8');
const businessRules=await readFile(new URL('../public/auto-sale-business-rules.mjs',import.meta.url),'utf8');

test('entry page boots the current v3 AUTO SALE chain',()=>{
  assert.match(html,/auto-sale-bootstrap\.mjs/);
  assert.match(bootstrap,/await import\('\.\/auto-sale-app-v3\.mjs(?:\?[^']+)?'\)/);
  assert.match(bootstrap,/await import\('\.\/auto-sale-ui-business-guard\.mjs(?:\?[^']+)?'\)/);
  assert.match(bootstrap,/await import\('\.\/auto-sale-telegram\.mjs/);
  assert.match(bootstrap,/await import\('\.\/auto-sale-telegram-id\.mjs/);
});

test('all three roles and every operational route are rendered by v3',()=>{
  for(const token of ['client','manager','owner','work','leads','quotes','shipping','overview','pipeline','finance','ordersAdmin']) assert.ok(app.includes(token),token);
});

test('every core rendered business action has a click handler',()=>{
  const pairs=[
    ['data-role','dataset.role'],['data-go','dataset.go'],['data-close','dataset.close'],['data-modal-bg','dataset.modalBg'],
    ['data-open-request','dataset.openRequest'],['data-manager-new','dataset.managerNew'],['data-request-car','dataset.requestCar'],['data-detail','dataset.detail'],
    ['data-lead','dataset.lead'],['data-quote','dataset.quote'],['data-order','dataset.order'],['data-new-quote','dataset.newQuote'],
    ['data-create-quote','dataset.createQuote'],['data-convert-order','dataset.convertOrder'],['data-quote-action','dataset.quoteAction'],
    ['data-clone-quote','dataset.cloneQuote'],['data-order-next','dataset.orderNext']
  ];
  for(const [markup,handler] of pairs){assert.ok(app.includes(markup),markup);assert.ok(app.includes(handler),handler)}
});

test('manager scenarios include lead edit quote conversion payments and logistics update',()=>{
  for(const token of ['leadEditForm','quoteForm','data-convert-order','orderForm','data-order-next','paymentAmount','riskType','submitLead','submitQuote','submitOrder']) assert.ok(app.includes(token),token);
});

test('director panels include funnel finance team sources and read-only risk controls',()=>{
  for(const token of ['ownerOverview','ownerPipeline','ownerFinance','ownerOrders','managerStats','sourceStats','financeStats','КОНТРОЛЬ']) assert.ok(app.includes(token),token);
});

test('client request and order-tracking scenarios remain available',()=>{
  for(const token of ['requestForm','clientOrders','data-request-car','data-open-request','timeline']) assert.ok(app.includes(token),token);
});

test('admin stylesheet includes responsive table and modal layouts',()=>{
  for(const token of ['auto-admin-filters','auto-data-table','auto-modal-grid','auto-timeline-full','@media(max-width:620px)']) assert.ok(css.includes(token),token);
});

test('mobile shell keeps role and bottom navigation inside narrow viewports',()=>{
  for(const token of ['@media(max-width:720px)','grid-template-columns:repeat(3,minmax(0,1fr))','grid-template-columns:repeat(4,minmax(0,1fr))','min-width:0','100dvh']) assert.ok(responsive.includes(token),token);
});

test('manager and director tables collapse into mobile cards instead of wide scroll tables',()=>{
  for(const token of ['.auto-data-head{display:none!important}','min-width:0!important','content:\'Себестоимость\'','content:\'ETA\'','.auto-data-table.finance','.auto-data-table.orders']) assert.ok(mobileAdmin.includes(token),token);
});

test('very narrow screens and landscape phones have dedicated fallbacks',()=>{
  for(const token of ['@media(max-width:380px)','@media(max-width:340px)','orientation:landscape']) assert.ok(responsive.includes(token),token);
});

test('active production bundle contains no demo business or catalog fallback data',()=>{
  for(const token of ['L-101','Q-501','O-2301','bmw-x5-22','tesla-y-23','images.unsplash.com','Демо-данные'])assert.equal(app.includes(token)||core.includes(token),false,token);
  for(const token of ['TM-DMITRY','TM-ANNA','TM-MAKSIM'])assert.equal(team.includes(token),false,token);
  assert.doesNotMatch(details,/пример автомобиля|bmw-x5-22|tesla-y-23/);
  assert.match(app,/const defaultCars=\[\]/);
  assert.match(core,/export const seedLeads = \(\) => \[\]/);
});

test('empty production state stays empty instead of restoring seeded data',async()=>{
  const mod=await import('../public/auto-sale-core.mjs?no-demo-smoke');
  assert.deepEqual(mod.seedLeads(),[]);
  assert.deepEqual(mod.seedQuotes(),[]);
  assert.deepEqual(mod.seedOrders(),[]);
});

test('entry page never renders a literal backslash-n artifact',()=>{
  assert.equal(html.includes('\\n  <!-- compatibility marker'),false);
});

test('catalog auction date label keeps explicit visible spacing before value',()=>{
  assert.match(app,/ended\?'Аукцион завершён':'Дата аукциона&nbsp;'/);
  assert.match(app,/<b>\$\{esc\(auctionDateText\(c\.auctionDate\)\)\}<\/b>/);
});

test('completed auctions are marked and cannot request a calculation',()=>{
  assert.match(app,/const auctionEnded=car=>/);
  assert.match(app,/Аукцион завершён/);
  assert.match(app,/disabled aria-disabled="true" title="Аукцион завершён"/);
  assert.match(app,/if\(!c\|\|auctionEnded\(c\)\)return/);
  assert.match(details,/auctionEnded=car=>/);
  assert.match(details,/request\.disabled\|\|!car\|\|auctionEnded\(car\)/);
  assert.match(clientCss,/\.auto-auction-date\.ended/);
  assert.match(clientCss,/\.auto-btn\.primary:disabled/);
});

test('catalog and quote UI support USA and Georgia without forcing sea delivery',()=>{
  assert.match(app,/const CLIENT_ORIGINS=\['США','Грузия'\]/);
  assert.match(app,/id="originFilter"/);
  assert.match(app,/Логистика по Грузии/);
  assert.match(app,/Доставка по США/);
  assert.match(app,/Морская перевозка/);
  assert.match(app,/TRANSPORT_MODES=\['Море','Автовоз','Не требуется','Другое'\]/);
  assert.match(app,/Автомобили<br>из <span>США<\/span> и <em>Грузии<\/em><br>с доставкой в Россию/);
  assert.doesNotMatch(app,/auto-market-route|Поставка автомобилей из США и Грузии в Россию/);
  assert.doesNotMatch(app,/Доставка США|Аукцион → порт → море → таможня/);
  assert.match(core,/Подготовка к отправке/);
  assert.match(core,/В пути/);
});

test('client detail exposes vehicle location',()=>{
  assert.match(details,/Локация автомобиля/);
  assert.doesNotMatch(details,/аукционному лоту до покупки/);
});

test('client business path exposes only canonical USA auction and Georgia purchase scenarios',()=>{
  assert.match(app,/const CLIENT_ORIGINS=\['США','Грузия'\]/);
  assert.match(app,/Аукцион США/);
  assert.match(app,/Авто в Грузии/);
  assert.match(app,/Способ покупки<select name="origin" required>/);
  assert.match(app,/supportedClientOrigin\(carOrigin\(c\)\)/);
  assert.doesNotMatch(app,/REQUEST_ORIGIN_OPTIONS/);
  assert.doesNotMatch(app,/\['США','Грузия','Корея','Европа'/);
});

test('quote UI separates USA auction costs from Georgia purchase costs',()=>{
  assert.match(app,/id="quoteOrigin"/);
  assert.match(app,/quoteAuctionField/);
  assert.match(app,/Стоимость автомобиля в Грузии/);
  assert.match(app,/Доставка по США/);
  assert.match(app,/Доставка из Грузии в Россию/);
  assert.match(app,/origin==='США'\?Number\(data\.auction\)\|\|0:0/);
});

test('USA orders expose the four promised payment stages',()=>{
  for(const token of ['auction_deposit','auction_balance','logistics_legalization','customs_fts','Аукционный аванс','Автомобиль + аукционные сборы','Логистика и легализация','Таможенные платежи ФТС'])assert.ok(businessRules.includes(token),token);
  assert.match(app,/paymentPlanView/);
  assert.match(app,/auctionDepositRange/);
  assert.match(app,/validatePaymentStageEntry/);
});

test('USA quote approval exposes the promised verification dossier',()=>{
  for(const token of ['VERIFICATION_RESULTS','normalizeVehicleVerification','validateVehicleVerification','LOT / номер лота','VIN','Фото до покупки','История / краткое заключение','Одобрен к покупке'])assert.ok(app.includes(token)||businessRules.includes(token),token);
  assert.match(app,/vehicleVerificationView/);
  assert.match(app,/data-verification-photo-upload/);
  assert.match(app,/verificationReportUrl/);
  assert.match(app,/verificationCheckedAt/);
  assert.match(clientCss,/auto-verification-card/);
});

test('client canon contains only USA and Georgia and legacy values cannot create new published catalog records',()=>{
  assert.match(app,/const CLIENT_ORIGINS=\['США','Грузия'\]/);
  assert.doesNotMatch(app,/const ORIGIN_OPTIONS=/);
  assert.match(app,/managerOriginOptions=current=>\[\.\.\.new Set\(\[\.\.\.\(current&&!CLIENT_ORIGINS\.includes\(current\)\?\[current\]:\[\]\),\.\.\.CLIENT_ORIGINS\]\)\]/);
  assert.match(app,/Для нового или публикуемого автомобиля выберите сценарий США или Грузия\./);
  assert.match(app,/managerMode&&!supportedClientOrigin\(data\.origin\)/);
  assert.doesNotMatch(app,/Корея|Европа/);
});

test('client canon does not publish unverified partner market-share or brand-exclusion claims',()=>{
  for(const token of ['Кавказус','Глобал авто импорт','80% всего автомобильного мира','никаких совместных производств','Китайщины'])assert.equal(app.includes(token),false,token);
  assert.doesNotMatch(app,/ALLOWED_BRANDS|BLOCKED_BRANDS|BRAND_WHITELIST|BRAND_BLACKLIST/);
});

test('car detail module exports a defined runtime API',()=>{
  assert.doesNotMatch(details,/__AUTO_SALE_CAR_DETAILS__=carDetails/);
  assert.match(details,/__AUTO_SALE_CAR_DETAILS__=\{open:openDetail,close:closeDetail,currentCar,currentGallery,setSliderIndex\}/);
});

test('bootstrap has no whole-state writer and refreshes on entity conflicts',()=>{
  assert.doesNotMatch(bootstrap,/legacyAutosync|__AUTO_SALE_FLUSH__|rebaseAutoSaleState/);
  assert.doesNotMatch(bootstrap,/method:'PUT'/);
  assert.match(bootstrap,/response\.status===409&&data\.error==='entity_conflict'/);
  assert.match(bootstrap,/await pullInitialState\(\)/);
  assert.match(bootstrap,/auto-sale-entity-conflict/);
});

test('approved brand logo and favicon are wired',()=>{
  assert.match(html,/favicon-64\.webp/);
  assert.match(app,/auto-sale-logo-automir-v5\.webp/);
  assert.match(clientCss,/\.auto-brand-logo/);
  assert.match(responsive,/\.auto-brand-image\{[^}]*display:block;width:100%;max-width:none/);
});

