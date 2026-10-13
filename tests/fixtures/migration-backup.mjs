import {legacyStateToDomainRows} from '../../server/ydb-domain-migration.mjs';
import {createRecoveryBackup} from '../../server/migration-backup.mjs';

export function fixtureBackup(){
  const state={revision:10,initialized:true,leads:[{id:'L-1',name:'Client',contact:'@client',model:'BMW X5',status:'В работе',nextAction:'2026-10-14',source:'Mini App',manager:'Дмитрий'}],
    quotes:[],orders:[{id:'O-1',leadId:'L-1',model:'BMW X5',stage:'Выкуп',manager:'Дмитрий',riskType:'Нет',total:1000,cost:900,payments:[],paid:0}],notes:{},
    team:[{id:'TM-1',name:'Дмитрий',role:'Менеджер',active:true}],catalog:[{id:'CAR-1',brand:'BMW',model:'X5',price:45000,image:'https://example.com/x5.jpg',active:true}]};
  const rows=legacyStateToDomainRows(state);
  for(const kind of ['leads','quotes','orders','team','catalog'])for(const row of rows[kind])row.rowVersion=10;
  return createRecoveryBackup({snapshot:{meta:{sourceRevision:10,compatRevision:10,schemaVersion:1},rows},
    adminAccess:[{username:'flyer_flyer',telegramUserId:'12345',linkedAt:'2026-10-01T00:00:00.000Z',lastSeenAt:'2026-10-13T00:00:00.000Z'}],
    outbox:[{id:'9:sent',status:'sent',payload:{event:'bot_command_reply',target:'telegram_user',chatId:'23456'},attempts:1,nextAttemptAt:'2026-10-13T00:00:00.000Z',createdAt:'2026-10-13T00:00:00.000Z',updatedAt:'2026-10-13T00:00:00.000Z',lastError:'',messageId:'42'}]},
    {source:{namespace:'AWG',databaseId:'test'}});
}
