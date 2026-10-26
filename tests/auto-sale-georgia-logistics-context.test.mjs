import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nextOrderStage,normalizeOrderStage} from '../public/auto-sale-core.mjs';

const guard=readFileSync(new URL('../public/auto-sale-ui-business-guard.mjs',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/auto-sale-app-v3.mjs',import.meta.url),'utf8');
const bootstrap=readFileSync(new URL('../public/auto-sale-bootstrap.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('logistics hints use canonical stages even when restoring older USA records',()=>{
  assert.equal(nextOrderStage('Выкуп'),'Подготовка к отправке');
  assert.equal(nextOrderStage('Порт США'),'В пути');
  assert.equal(normalizeOrderStage('В море'),'В пути');
  assert.match(guard,/const nextStage=nextOrderStage/);
  assert.doesNotMatch(guard,/['"]Порт США['"]|['"]В море['"]/);
});

test('Georgia logistics blockers never require an auction lot',()=>{
  assert.match(guard,/String\(order\.origin\|\|''\)==='США'/);
  assert.match(guard,/\['lot','номер лота'\]/);
  assert.match(guard,/\?\[\['lot'/);
  assert.match(guard,/\:\[\['vin','VIN'\]/);
  assert.match(guard,/ориентировочную дату доставки/);
  assert.doesNotMatch(guard,/заполните ETA/);
});

test('client journey explains road delivery from Georgia without US port or sea stages',()=>{
  assert.match(guard,/из Грузии/);
  assert.match(guard,/из США/);
  assert.match(guard,/messages\[normalizeOrderStage\(o.stage\)\]/);
  assert.match(app,/usOrder\?'LOT \/ VIN':'VIN'/);
  assert.match(app,/usOrder\?\x60<label>Номер лота/);
});

test('fresh bootstrap version is referenced by index and guard',()=>{
  assert.match(bootstrap,/auto-sale-ui-business-guard\.mjs\?v=20261026-georgia-stage-context-v1/);
  assert.match(html,/auto-sale-bootstrap\.mjs\?v=20261026-georgia-stage-context-v1/);
});
