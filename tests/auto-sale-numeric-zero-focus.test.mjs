import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {isEditableZeroField,installNumericZeroFocus} from '../public/auto-sale-numeric-zero-focus.mjs';

const fixtures=[
  ['Клиент: цена автомобиля','requestForm','estimatedCostRub','0'],
  ['Менеджер: бюджет','leadEditForm','budget','0'],
  ['Каталог: цена, ₽','catalogCarForm','priceRub','0'],
  ['Каталог: цена, $','catalogCarForm','price','0'],
  ['Грузия: стоимость авто','quoteForm','lot','0'],
  ['Грузия: таможня РФ','quoteForm','customsRub','0'],
  ['Грузия: утильсбор РФ','quoteForm','recyclingRub','0'],
  ['Грузия: доставка под ключ','quoteForm','turnkeyDeliveryUsd','0.00'],
  ['США: аукционный сбор','quoteForm','auction','0'],
  ['США: перевозка','quoteForm','ocean','0'],
  ['Логистика: сумма платежа','orderForm','paymentAmount','0'],
  ['Логистика: внесённый депозит','leadEditForm','deposit','0'],
  ['Команда: числовой параметр','teamForm','someNumber','0']
];
function setup(){
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://awgcars.ru/'});
  installNumericZeroFocus(dom.window.document);
  return dom;
}

test('zero-on-focus is delegated across client, CRM, catalog, US/Georgia calculation and payments',()=>{
  const dom=setup(),doc=dom.window.document;
  for(const [label,formId,name,value] of fixtures){
    const form=doc.createElement('form');
    form.id=formId;
    const field=doc.createElement('input');
    field.type='number';field.name=name;field.value=value;
    form.append(field);doc.body.append(form);
    assert.equal(isEditableZeroField(field),true,label);
    field.focus();
    assert.equal(field.value,'',label+' focus');
    field.blur();
    assert.equal(field.value,value,label+' untouched blur restores original zero');
    form.remove();
  }
  dom.window.close();
});

test('typing replaces the zero rather than prefixing it, and deliberate deletion stays empty',()=>{
  const dom=setup(),doc=dom.window.document,el=doc.createElement('input');
  el.type='number';el.value='0';doc.body.append(el);
  el.focus();assert.equal(el.value,'');
  el.value='450000';
  el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  el.blur();assert.equal(el.value,'450000');

  el.value='0';el.focus();assert.equal(el.value,'');
  el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  el.blur();assert.equal(el.value,'','explicitly cleared field stays blank for validation');
  dom.window.close();
});

test('keep meaningful decimals and other user values unchanged',()=>{
  const dom=setup(),doc=dom.window.document;
  for(const value of ['0.5','0.01','1','4000','100000']){
    const el=doc.createElement('input');el.type='number';el.value=value;doc.body.append(el);
    el.focus();assert.equal(el.value,value);el.blur();el.remove();
  }
  dom.window.close();
});

test('do not change disabled, read-only, text identifiers, dates, hidden values or selects',()=>{
  const dom=setup(),doc=dom.window.document;
  const html='<input type="number" value="0" disabled><input type="number" value="0" readonly>'+
  '<input type="text" value="0"><input type="date" value=""><input type="hidden" value="0">'+
  '<select><option value="0" selected>0</option></select>';
  doc.body.innerHTML=html;
  const els=[...doc.querySelectorAll('input,select')];
  for(const el of els){doc.dispatchEvent(new dom.window.FocusEvent('focusin',{bubbles:true}));el.dispatchEvent(new dom.window.FocusEvent('focusin',{bubbles:true}));}
  assert.deepEqual(els.map(el=>el.value),['0','0','0','','0','0']);
  dom.window.close();
});

test('numeric or decimal inputmode text zero is cleared, mileage string and free text stay unchanged',()=>{
  const dom=setup(),doc=dom.window.document;
  for(const mode of ['numeric','decimal']){
    const el=doc.createElement('input');el.type='text';el.inputMode=mode;el.value='0';doc.body.append(el);
    el.focus();assert.equal(el.value,'');el.blur();assert.equal(el.value,'0');el.remove();
  }
  for(const value of ['0 км','010','0.5']){
    const el=doc.createElement('input');el.type='text';el.inputMode='numeric';el.value=value;doc.body.append(el);
    el.focus();assert.equal(el.value,value);el.blur();el.remove();
  }
  dom.window.close();
});

test('install is idempotent and dynamically inserted forms receive the same behavior',()=>{
  const dom=setup(),doc=dom.window.document;
  installNumericZeroFocus(doc);
  installNumericZeroFocus(doc);
  const form=doc.createElement('form'),el=doc.createElement('input');
  el.type='number';el.value='0';form.append(el);doc.body.append(form);
  el.focus();assert.equal(el.value,'');el.blur();assert.equal(el.value,'0');
  dom.window.close();
});
