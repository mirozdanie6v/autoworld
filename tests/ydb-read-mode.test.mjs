import test from 'node:test';
import assert from 'node:assert/strict';
import {readAutoSaleState} from '../server/ydb-read-mode.mjs';
import {legacyStateToDomainRows} from '../server/ydb-domain-migration.mjs';

function state(){
  return{
    revision:12,initialized:true,
    leads:[{id:'L-1',name:'A',contact:'@a',model:'BMW',status:'Новый',source:'Mini App'}],
    quotes:[],orders:[],notes:{'L-1':[]},team:[],catalog:[]
  };
}
function stores({legacy=state(),rows=legacyStateToDomainRows(legacy),metaRevision=legacy.revision}={}){
  return{
    legacyStore:{loadState:async()=>structuredClone(legacy)},
    domainStore:{
      migrationMeta:async()=>({sourceRevision:metaRevision,schemaVersion:1,migrationStatus:'dual-write'}),
      loadRows:async()=>structuredClone(rows)
    }
  };
}

test('normalized mode serves normalized snapshot when revision and hash match',async()=>{
  const s=stores();
  const read=await readAutoSaleState({...s,mode:'normalized'});
  assert.equal(read.source,'normalized');
  assert.equal(read.fallback,false);
  assert.equal(read.shadowVerified,true);
  assert.deepEqual(read.state,state());
});

test('shadow mode verifies normalized data but serves legacy snapshot',async()=>{
  const s=stores();
  const read=await readAutoSaleState({...s,mode:'shadow'});
  assert.equal(read.source,'legacy');
  assert.equal(read.fallback,false);
  assert.equal(read.shadowVerified,true);
  assert.deepEqual(read.state,state());
});

test('normalized mode falls back to legacy on parity mismatch',async()=>{
  const legacy=state();
  const rows=legacyStateToDomainRows(legacy);
  rows.leads[0].payload.status='В работе';
  const errors=[];
  const read=await readAutoSaleState({...stores({legacy,rows}),mode:'normalized',logger:{error:(...x)=>errors.push(x)}});
  assert.equal(read.source,'legacy');
  assert.equal(read.fallback,true);
  assert.equal(read.reason,'parity_mismatch');
  assert.deepEqual(read.state,legacy);
  assert.equal(errors.length,1);
});

test('normalized mode falls back when shadow revision is stale',async()=>{
  const legacy=state();
  const read=await readAutoSaleState({...stores({legacy,metaRevision:11}),mode:'normalized',attempts:2,logger:{error(){}}});
  assert.equal(read.source,'legacy');
  assert.equal(read.fallback,true);
  assert.equal(read.reason,'unstable_or_error');
  assert.deepEqual(read.state,legacy);
});

test('legacy mode does not touch normalized store',async()=>{
  let domainTouched=false;
  const legacy=state();
  const read=await readAutoSaleState({
    legacyStore:{loadState:async()=>structuredClone(legacy)},
    domainStore:{migrationMeta:async()=>{domainTouched=true;throw new Error('no')}},
    mode:'legacy'
  });
  assert.equal(domainTouched,false);
  assert.equal(read.source,'legacy');
  assert.deepEqual(read.state,legacy);
});
