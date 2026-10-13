import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresRuntimeStores} from '../server/postgres-runtime-store.mjs';
import {mutateAutoSaleEntity,addAutoSaleNote,addAutoSalePayment,deleteAutoSaleLeadCascade} from '../server/ydb-entity-commands.mjs';
import {autoSaleStateHash} from '../server/ydb-domain-migration.mjs';
import {validateRecoveryBackup} from '../server/migration-backup.mjs';
import {fixtureBackup} from './fixtures/migration-backup.mjs';
import {testDatabase} from './fixtures/postgres-test-db.mjs';
import {verifyPostgresRuntimeHttp} from './fixtures/runtime-http.mjs';

const url=process.env.AWG_TEST_DATABASE_URL;
test('PostgreSQL recovery and entity API integration',async t=>{
  const {createStores,finish}=await testDatabase(url);
  const stores=await createStores({ensureSchema:true});
  try{
    const backup=fixtureBackup();
    await stores.importBackup(backup);
    assert.equal(autoSaleStateHash(await stores.domainStore.loadState()),validateRecoveryBackup(backup).stateHash);
    assert.equal(await stores.domainStore.entityRowVersion('lead','L-1'),10);
    assert.equal((await stores.legacyStore.adminAccessList())[0].telegramUserId,'12345');
    assert.equal((await stores.legacyStore.notificationStatus(['9:sent']))[0].status,'sent');
    await assert.rejects(stores.importBackup(backup),/empty_database/);
    await t.test('two simultaneous edits cannot overwrite the same row version',async()=>{
      const edits=await Promise.all(['high','low'].map(priority=>mutateAutoSaleEntity({...stores,resource:'lead',operation:'patch',id:'L-1',expectedRowVersion:10,input:{priority}})));
      assert.deepEqual(edits.map(x=>x.status).sort(),[200,409]);
      assert.equal(await stores.domainStore.entityRowVersion('lead','L-1'),11);
      assert.equal(await stores.domainStore.entityRowVersion('catalog','CAR-1'),10);
    });
    await t.test('notes and payments update aggregate versions and survive a fresh connection',async()=>{
      const note=await addAutoSaleNote({...stores,leadId:'L-1',expectedRowVersion:11,input:{text:'A new note'}});
      assert.equal(note.status,201);
      const payment=await addAutoSalePayment({...stores,orderId:'O-1',expectedRowVersion:10,input:{id:'PAY-1',amount:250,date:'2026-10-13',method:'Банк'}});
      assert.equal(payment.status,201);
      const second=await createStores();
      try{const state=await second.domainStore.loadState();assert.equal(state.orders[0].paid,250);assert.equal(state.notes['L-1'][0].text,'A new note')}
      finally{await second.close()}
    });
    await t.test('concurrent notification workers lease each job once and never replay sent jobs',async()=>{
      await stores.legacyStore.enqueueNotifications([{id:'test:new',event:'test',target:'telegram_user',chatId:'23456'}]);
      const batches=await Promise.all([stores.legacyStore.pendingNotifications(),stores.legacyStore.pendingNotifications()]);
      assert.deepEqual(batches.flat().map(x=>x.id),['test:new']);
      await stores.legacyStore.markNotification('test:new',{ok:true,messageId:'43'});
      assert.deepEqual(await stores.legacyStore.pendingNotifications(),[]);
      await stores.legacyStore.enqueueNotifications([{id:'test:new',event:'test'}]);
      assert.equal((await stores.legacyStore.notificationStatus(['test:new']))[0].status,'sent');
    });
    await t.test('administrator identities cannot be reassigned by username or Telegram ID',async()=>{
      assert.equal((await stores.legacyStore.claimAdminAccess('flyer_flyer','99999')).error,'admin_username_already_claimed');
      assert.equal((await stores.legacyStore.claimAdminAccess('other','12345')).error,'admin_user_already_claimed');
    });
    await t.test('a failed notification insert rolls back both entity rows and revision',async()=>{
      const previous=await stores.domainStore.loadState(),next=structuredClone(previous);
      next.catalog[0].price=1;
      await assert.rejects(stores.legacyStore.commitDomainState(previous,next,{expectedRevision:previous.revision,notifications:[{}]}),/notification_id_required/);
      assert.equal(autoSaleStateHash(await stores.domainStore.loadState()),autoSaleStateHash(previous));
      assert.equal((await stores.domainStore.migrationMeta()).sourceRevision,previous.revision);
    });
    await t.test('HTTP runtime uses PostgreSQL, isolates VK clients and delivers through controlled Telegram/VK providers',{skip:!url},async()=>{
      await verifyPostgresRuntimeHttp(url);
    });
    await t.test('cascade deletion preserves team, catalog and durable notification history',async()=>{
      const version=await stores.domainStore.entityRowVersion('lead','L-1');
      const result=await deleteAutoSaleLeadCascade({...stores,id:'L-1',expectedRowVersion:version});
      assert.equal(result.status,200);
      const state=await stores.domainStore.loadState();
      assert.equal(state.leads.length,0);assert.equal(state.orders.length,0);assert.deepEqual(state.notes,{});
      assert.equal(state.team.length,1);assert.equal(state.catalog.length,1);
      assert.equal((await stores.legacyStore.notificationStatus(['9:sent']))[0].status,'sent');
    });
  }finally{await stores.close();await finish()}
});
