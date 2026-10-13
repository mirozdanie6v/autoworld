import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {fixtureBackup} from './fixtures/migration-backup.mjs';
import {createRecoveryBackup,validateRecoveryBackup,encryptRecoveryBackup,decryptRecoveryBackup} from '../server/migration-backup.mjs';



test('recovery preserves state, row versions, admin bindings and sent notification records',()=>{
  const backup=fixtureBackup(),report=validateRecoveryBackup(backup);
  assert.equal(report.revision,10);
  assert.equal(report.counts.leads,1);
  assert.equal(report.adminBindings,1);
  assert.equal(report.outbox,1);
  const key=randomBytes(32).toString('base64'),encrypted=encryptRecoveryBackup(backup,key);
  assert.ok(!JSON.stringify(encrypted).includes('@client'));
  assert.deepEqual(decryptRecoveryBackup(encrypted,key),backup);
});
test('corrupted state and incorrect decryption key cannot be restored',()=>{
  const backup=fixtureBackup();backup.snapshot.rows.leads[0].payload.name='changed';
  assert.throws(()=>validateRecoveryBackup(backup),/checksum/);
  const encrypted=encryptRecoveryBackup(fixtureBackup(),randomBytes(32).toString('base64'));
  assert.throws(()=>decryptRecoveryBackup(encrypted,randomBytes(32).toString('base64')));
});
test('an incomplete or empty production export is refused',()=>{
  const backup=fixtureBackup();delete backup.snapshot.rows.catalog;
  assert.throws(()=>createRecoveryBackup(backup,{source:{namespace:'AWG'}}));
  assert.throws(()=>createRecoveryBackup({snapshot:{meta:{sourceRevision:10,schemaVersion:1},rows:Object.fromEntries(['leads','quotes','orders','payments','notes','team','catalog','telegramBindings'].map(x=>[x,[]]))},adminAccess:[],outbox:[]},{source:{namespace:'AWG'}}),/empty_production/);
});
