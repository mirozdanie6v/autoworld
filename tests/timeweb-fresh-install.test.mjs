import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './fixtures/postgres-test-db.mjs';
import {FRESH_CONFIRM,initializeFreshAwg} from '../scripts/init-awg-timeweb-fresh.mjs';

test('fresh PostgreSQL initialization seeds only the three managers and cannot run twice',async()=>{
  const {createStores,finish}=await testDatabase();
  const stores=await createStores({ensureSchema:true});
  const opts={stagingHost:'timeweb-staging.viiversion.com',confirmation:FRESH_CONFIRM};
  try{
    await assert.rejects(initializeFreshAwg(stores,{...opts,confirmation:'invalid'}),/confirmation/);
    const result=await initializeFreshAwg(stores,opts);
    assert.equal(result.ok,true);
    assert.deepEqual(result.managers,['Дмитрий','Алексей','Иван']);
    assert.equal(result.revision,1);
    const state=await stores.domainStore.loadState();
    assert.equal(state.initialized,true);
    assert.equal(state.team.length,3);
    assert.equal(state.catalog.length,0);
    assert.equal(state.leads.length,0);
    await assert.rejects(initializeFreshAwg(stores,opts),/nonempty_database/);
  }finally{await stores.close();await finish()}
});
