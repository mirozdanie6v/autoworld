import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRows,mergeNotes,rebaseAutoSaleState} from '../public/auto-sale-sync-merge.mjs';

const base=()=>({
  revision:10,initialized:true,
  leads:[
    {id:'L-1',name:'A',status:'Новый',manager:'Manager A'},
    {id:'L-2',name:'B',status:'Новый',manager:'Manager B'}
  ],
  quotes:[],orders:[],notes:{'L-1':[{text:'base'}]},team:[],catalog:[]
});

test('concurrent edits to different records are both preserved',()=>{
  const baseline=base();
  const server=structuredClone(baseline);
  server.revision=11;
  server.leads[0].status='В работе';
  const local=structuredClone(baseline);
  local.leads[1].status='В работе';
  const merged=rebaseAutoSaleState(server,baseline,local);
  assert.equal(merged.revision,11);
  assert.equal(merged.leads.find(x=>x.id==='L-1').status,'В работе');
  assert.equal(merged.leads.find(x=>x.id==='L-2').status,'В работе');
});

test('local edit wins only for the record changed locally',()=>{
  const baseline=base();
  const server=structuredClone(baseline);
  server.revision=12;
  server.leads[0].manager='Server Manager';
  server.leads[1].manager='Server B';
  const local=structuredClone(baseline);
  local.leads[0].manager='Local Manager';
  const merged=rebaseAutoSaleState(server,baseline,local);
  assert.equal(merged.leads.find(x=>x.id==='L-1').manager,'Local Manager');
  assert.equal(merged.leads.find(x=>x.id==='L-2').manager,'Server B');
});

test('local deletions and server additions survive the rebase correctly',()=>{
  const baseline=base();
  const server=structuredClone(baseline);
  server.revision=13;
  server.leads.push({id:'L-3',name:'C',status:'Новый'});
  const local=structuredClone(baseline);
  local.leads=local.leads.filter(x=>x.id!=='L-2');
  const merged=rebaseAutoSaleState(server,baseline,local);
  assert.equal(merged.leads.some(x=>x.id==='L-2'),false);
  assert.equal(merged.leads.some(x=>x.id==='L-3'),true);
});

test('notes merge preserves unrelated server history and local note changes',()=>{
  const baseline=base();
  const server=structuredClone(baseline);
  server.revision=14;
  server.notes['L-2']=[{text:'server note'}];
  const local=structuredClone(baseline);
  local.notes['L-1']=[...local.notes['L-1'],{text:'local note'}];
  const mergedNotes=mergeNotes(server.notes,baseline.notes,local.notes);
  assert.deepEqual(mergedNotes['L-2'],[{text:'server note'}]);
  assert.equal(mergedNotes['L-1'].at(-1).text,'local note');
});

test('row merge keeps server order and appends local additions',()=>{
  const server=[{id:'A',v:1},{id:'B',v:2}];
  const baseline=[{id:'A',v:1},{id:'B',v:1}];
  const local=[{id:'A',v:1},{id:'B',v:3},{id:'C',v:4}];
  assert.deepEqual(mergeRows(server,baseline,local).map(x=>[x.id,x.v]),[['A',1],['B',3],['C',4]]);
});
