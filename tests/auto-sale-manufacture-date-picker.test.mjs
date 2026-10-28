import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {
  manufactureDateParts,manufactureDaysInMonth,manufactureDateFromParts,
  manufactureDatePickerHtml,syncManufactureDatePicker
} from '../public/auto-sale-manufacture-date.mjs';

test('manufacture date uses three selectable parts, keeping only the canonical ISO value',()=>{
  const dom=new JSDOM('<form id="quoteForm">'+manufactureDatePickerHtml('2024-02-29')+'</form>');
  const form=dom.window.document.querySelector('#quoteForm');
  assert.equal(form.elements.manufactureYear.value,'2024');
  assert.equal(form.elements.manufactureMonth.value,'02');
  assert.equal(form.elements.manufactureDay.value,'29');
  assert.equal(form.elements.manufactureDate.value,'2024-02-29');
  assert.equal(form.elements.manufactureDate.type,'hidden');
  assert.equal(form.elements.manufactureDay.options.length,30); // placeholder + 29
  assert.match(form.innerHTML,/aria-label="Год выпуска"/);
  assert.match(form.innerHTML,/aria-label="Месяц выпуска"/);
  assert.match(form.innerHTML,/aria-label="День выпуска"/);
  dom.window.close();
});
test('month and year changes reset impossible day without inventing an invalid date',()=>{
  const dom=new JSDOM('<form id="quoteForm">'+manufactureDatePickerHtml('2024-01-31')+'</form>');
  const form=dom.window.document.querySelector('#quoteForm');
  form.elements.manufactureMonth.value='02';
  assert.equal(syncManufactureDatePicker(form),'');
  assert.equal(form.elements.manufactureDay.value,'');
  assert.equal(form.elements.manufactureDay.options.length,30);
  form.elements.manufactureDay.value='29';
  assert.equal(syncManufactureDatePicker(form),'2024-02-29');
  form.elements.manufactureYear.value='2025';
  assert.equal(syncManufactureDatePicker(form),'');
  assert.equal(form.elements.manufactureDay.options.length,29); // placeholder + 28
  form.elements.manufactureDay.value='28';
  assert.equal(syncManufactureDatePicker(form),'2025-02-28');
  dom.window.close();
});
test('date picker allows incomplete dates but never sends invented default days',()=>{
  const dom=new JSDOM('<form>'+manufactureDatePickerHtml('')+'</form>');
  const form=dom.window.document.querySelector('form');
  assert.equal(form.elements.manufactureDay.disabled,true);
  form.elements.manufactureYear.value='2026';
  assert.equal(syncManufactureDatePicker(form),'');
  assert.equal(form.elements.manufactureDate.value,'');
  form.elements.manufactureMonth.value='10';
  assert.equal(syncManufactureDatePicker(form),'');
  assert.equal(form.elements.manufactureDay.disabled,false);
  form.elements.manufactureDay.value='28';
  assert.equal(syncManufactureDatePicker(form),'2026-10-28');
  assert.equal(Object.fromEntries(new dom.window.FormData(form)).manufactureDate,'2026-10-28');
  dom.window.close();
});
test('correct leap year and impossible date parsing',()=>{
  assert.equal(manufactureDaysInMonth(2000,2),29);
  assert.equal(manufactureDaysInMonth(1900,2),28);
  assert.equal(manufactureDaysInMonth(2025,2),28);
  assert.equal(manufactureDateFromParts('2024','02','29'),'2024-02-29');
  assert.equal(manufactureDateFromParts('2025','02','29'),'');
  assert.deepEqual(manufactureDateParts('2025-02-30'),{year:'2025',month:'02',day:''});
  assert.deepEqual(manufactureDateParts('2023-13-01'),{year:'',month:'',day:''});
  assert.deepEqual(manufactureDateParts('2021-12'),{year:'2021',month:'12',day:''});
  assert.deepEqual(manufactureDateParts(''),{year:'',month:'',day:''});
});
