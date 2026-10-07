import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTO_SALE_MANAGERS,canonicalAutoSaleTeam,managerTelegramUsername} from '../shared/auto-sale-manager-directory.mjs';

test('canonical production team contains the three current AutoWorld managers in routing order',()=>{
  const team=canonicalAutoSaleTeam();
  assert.deepEqual(team.map(item=>item.name),['Дмитрий','Алексей','Иван']);
  assert.deepEqual(team.map(item=>item.telegramUsername),['Flyer_Flyer','smit44744','Ivan_AWG']);
  assert.ok(team.every(item=>item.role==='Менеджер'&&item.active===true));
  assert.equal(team[0].id,'TM-DMITRY');
  assert.equal(managerTelegramUsername('Дмитрий'),'Flyer_Flyer');
  assert.equal(Object.keys(AUTO_SALE_MANAGERS).length,3);
});

test('canonical production team factory returns independent mutable rows',()=>{
  const first=canonicalAutoSaleTeam();
  first[0].name='changed';
  const second=canonicalAutoSaleTeam();
  assert.equal(second[0].name,'Дмитрий');
});
