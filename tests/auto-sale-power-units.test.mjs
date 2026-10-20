import test from 'node:test';
import assert from 'node:assert/strict';
import {HP_TO_PS, normalizePowerUnit, toMetricHorsepower, fromMetricHorsepower, convertPowerInput, quotePowerInput} from '../public/auto-sale-power-units.mjs';
import {readFileSync} from 'node:fs';

test('200 hp is 202.773933 metric PS and legacy field stays metric', () => {
  assert.ok(Math.abs(toMetricHorsepower(200, 'hp') - 200 * HP_TO_PS) < 1e-9);
  assert.equal(toMetricHorsepower(200, 'ps'), 200);
  assert.equal(normalizePowerUnit(undefined), 'ps');
  assert.equal(normalizePowerUnit('hp'), 'hp');
});
test('switching units changes the displayed number but not physical power', () => {
  for (const unit of ['hp', 'ps']) {
    const before = 200;
    const other = unit === 'hp' ? 'ps' : 'hp';
    const afterSwitch = convertPowerInput(before, unit, other);
    assert.notEqual(Number(afterSwitch), before);
    assert.ok(Math.abs(toMetricHorsepower(afterSwitch, other) - toMetricHorsepower(before, unit)) < 0.000001);
    assert.ok(Math.abs(Number(convertPowerInput(afterSwitch, other, unit)) - before) < 0.000001);
  }
  assert.equal(convertPowerInput('', 'ps', 'hp'), '');
  assert.equal(convertPowerInput('100', 'hp', 'hp'), '100');
});
test('new records reopen with exact original power and unit; old records use PS', () => {
  assert.equal(quotePowerInput({powerInput:200,powerHp:toMetricHorsepower(200,'hp'),powerUnit:'hp'}), 200);
  assert.equal(quotePowerInput({powerHp:210}), 210);
  assert.ok(Math.abs(quotePowerInput({powerHp:toMetricHorsepower(200,'hp'),powerUnit:'hp'})-200) < 0.000001);
});
test('manager quote preserves field labels and switches without an API request', () => {
  const app=readFileSync(new URL('../public/auto-sale-app-v3.mjs',import.meta.url),'utf8');
  assert.match(app,/\['service','Услуга компании'\]/);
  assert.match(app,/\['legalization','Легализация \$500'\]/);
  assert.match(app,/name="powerUnit"/);
  assert.match(app,/convertPowerInput\(input.value,t.dataset.previousUnit,t.value\)/);
  assert.match(app,/powerHp:toMetricHorsepower\(data.powerHp,data.powerUnit\)/);
  assert.match(app,/powerInput:Number\(data.powerHp\)\|\|0/);
});
