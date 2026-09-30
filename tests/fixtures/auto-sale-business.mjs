const clone=value=>JSON.parse(JSON.stringify(value));

const LEADS=[
  {id:'L-101',name:'Алексей',contact:'@alexey_car',model:'BMW X5 2021–2023',budget:50000,source:'Telegram',manager:'Дмитрий',status:'Расчёт',priority:'Высокий',createdAt:'2026-09-09T09:20:00Z',nextAction:'2026-09-12',note:'Нужен xDrive40i, светлый салон, без силовых повреждений.'},
  {id:'L-102',name:'Мария',contact:'+7 999 222-41-18',model:'Tesla Model Y Long Range',budget:42000,source:'Instagram',manager:'Анна',status:'Ожидает клиента',priority:'Средний',createdAt:'2026-09-09T13:05:00Z',nextAction:'2026-09-12',note:'Согласовать цвет и максимальный пробег.'},
  {id:'L-103',name:'Игорь',contact:'@igor_rav',model:'Toyota RAV4 XLE',budget:34000,source:'Сайт',manager:'Дмитрий',status:'В работе',priority:'Средний',createdAt:'2026-09-10T06:45:00Z',nextAction:'2026-09-13',note:'Важно уложиться в бюджет под ключ.'},
  {id:'L-104',name:'Олег',contact:'+7 911 620-18-05',model:'Lexus RX 350 F Sport',budget:46000,source:'Рекомендации',manager:'Максим',status:'Сделка',priority:'Высокий',createdAt:'2026-09-05T15:10:00Z',nextAction:'2026-09-12',note:'Лот выкуплен, передан в логистику.'},
  {id:'L-105',name:'Наталья',contact:'@natali_usa',model:'Mercedes-Benz GLE 350',budget:55000,source:'Telegram',manager:'Анна',status:'Расчёт',priority:'Высокий',createdAt:'2026-09-11T03:40:00Z',nextAction:'2026-09-12',note:'Только чистая история и минимальные повреждения.'},
  {id:'L-106',name:'Сергей',contact:'+7 921 370-00-91',model:'Ford Mustang Mach-E',budget:36000,source:'WhatsApp',manager:'Максим',status:'Новый',priority:'Средний',createdAt:'2026-09-11T12:15:00Z',nextAction:'2026-09-12',note:'Интересует AWD и батарея без замечаний.'},
  {id:'L-107',name:'Роман',contact:'@roman_auto',model:'BMW X3 / Audi Q5',budget:39000,source:'Instagram',manager:'Дмитрий',status:'Отказ',priority:'Низкий',createdAt:'2026-09-03T07:00:00Z',nextAction:'2026-09-08',note:'Отложил покупку на ноябрь.',lostReason:'Отложил покупку'},
  {id:'L-108',name:'Елена',contact:'+7 903 888-24-61',model:'Tesla Model 3',budget:30000,source:'Сайт',manager:'Анна',status:'В работе',priority:'Средний',createdAt:'2026-09-11T15:30:00Z',nextAction:'2026-09-13',note:'Нужен белый салон, год от 2022.'}
];

const QUOTES=[
  {id:'Q-501',leadId:'L-101',model:'BMW X5 xDrive40i 2022',lot:31400,auction:1200,inland:900,ocean:2800,customs:7200,repair:1800,service:1500,total:46800,status:'Отправлен',version:1,validUntil:'2026-09-18',updatedAt:'2026-09-11T11:30:00Z'},
  {id:'Q-502',leadId:'L-102',model:'Tesla Model Y Long Range 2023',lot:27200,auction:1100,inland:700,ocean:2500,customs:6000,repair:700,service:1500,total:39700,status:'На согласовании',version:1,validUntil:'2026-09-18',updatedAt:'2026-09-11T10:05:00Z'},
  {id:'Q-503',leadId:'L-103',model:'Toyota RAV4 XLE Premium 2022',lot:21100,auction:900,inland:800,ocean:2300,customs:5200,repair:0,service:1500,total:31800,status:'Черновик',version:1,validUntil:'2026-09-18',updatedAt:'2026-09-11T16:40:00Z'},
  {id:'Q-504',leadId:'L-104',model:'Lexus RX 350 F Sport 2022',lot:30200,auction:1200,inland:950,ocean:2700,customs:6500,repair:750,service:1500,total:43800,status:'Согласован',version:1,validUntil:'2026-09-18',updatedAt:'2026-09-06T08:00:00Z'},
  {id:'Q-505',leadId:'L-105',model:'Mercedes-Benz GLE 350 4MATIC 2021',lot:35400,auction:1300,inland:1100,ocean:2900,customs:7600,repair:2300,service:1500,total:52100,status:'Отправлен',version:1,validUntil:'2026-09-18',updatedAt:'2026-09-11T14:00:00Z'}
];

const ORDERS=[
  {id:'O-2301',leadId:'L-101',customer:'Алексей',model:'BMW X5 xDrive40i 2022',manager:'Дмитрий',source:'Telegram',total:46800,cost:44200,paid:35000,stage:'В море',eta:'2026-10-18',lot:'482913',vin:'5UXCR6C0XN9***318',location:'Atlantic Ocean',risk:'Нет',updatedAt:'2026-09-11T12:00:00Z'},
  {id:'O-2302',leadId:'L-102',customer:'Мария',model:'Tesla Model Y Long Range 2023',manager:'Анна',source:'Instagram',total:39700,cost:37300,paid:22000,stage:'Порт США',eta:'2026-10-22',lot:'195044',vin:'7SAYGDEE5PF***741',location:'Long Beach, CA',risk:'Ожидает судно',updatedAt:'2026-09-11T09:00:00Z'},
  {id:'O-2303',leadId:'L-104',customer:'Олег',model:'Lexus RX 350 F Sport 2022',manager:'Максим',source:'Рекомендации',total:43800,cost:41000,paid:43800,stage:'Таможня',eta:'2026-09-20',lot:'773240',vin:'2T2HZMDA8NC***552',location:'Таможенный терминал',risk:'Документы',updatedAt:'2026-09-11T07:30:00Z'},
  {id:'O-2304',leadId:'L-103',customer:'Игорь',model:'Toyota RAV4 XLE Premium 2022',manager:'Дмитрий',source:'Сайт',total:31800,cost:29800,paid:12000,stage:'Выкуп',eta:'2026-10-29',lot:'663501',vin:'2T3P1RFV6NC***406',location:'Copart, New Jersey',risk:'Нет',updatedAt:'2026-09-11T17:20:00Z'}
];

const TEAM=[
  {id:'TM-DMITRY',name:'Дмитрий',role:'Менеджер',phone:'',telegram:'',active:true,planDeals:4,note:''},
  {id:'TM-ANNA',name:'Анна',role:'Менеджер',phone:'',telegram:'',active:true,planDeals:4,note:''},
  {id:'TM-MAKSIM',name:'Максим',role:'Менеджер',phone:'',telegram:'',active:true,planDeals:4,note:''}
];

const CATALOG=[
  {id:'TEST-BMW-X5',brand:'BMW',model:'X5 xDrive40i',year:2022,mileage:'38 000 км',engine:'3.0 бензин',drive:'AWD',auction:'Copart',price:46800,delivery:'8–11 недель',tag:'Test',image:'https://example.com/bmw-x5.jpg',active:true},
  {id:'TEST-RAV4',brand:'Toyota',model:'RAV4 XLE Premium',year:2022,mileage:'42 000 км',engine:'2.5 бензин',drive:'AWD',auction:'Copart',price:31800,delivery:'8–12 недель',tag:'Test',image:'https://example.com/rav4.jpg',active:true}
];

export const seedLeads=()=>clone(LEADS);
export const seedQuotes=()=>clone(QUOTES);
export const seedOrders=()=>clone(ORDERS);
export const seedTeam=()=>clone(TEAM);
export const seedCatalog=()=>clone(CATALOG);

export function seedBusinessStorage(storage,{catalog=true,team=true}={}){
  storage.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads()));
  storage.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
  storage.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  storage.setItem('auto-sale-notes-v2','{}');
  if(team)storage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  if(catalog)storage.setItem('auto-sale-catalog-v1',JSON.stringify(seedCatalog()));
}
