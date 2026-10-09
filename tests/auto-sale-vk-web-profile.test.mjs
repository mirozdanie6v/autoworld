import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {normalizeVkWebProfile,applyVkWebProfileToRequestForm} from '../public/auto-sale-vk-web-profile.mjs';

const profile=()=>normalizeVkWebProfile({authenticated:true,user:{id:'42',firstName:'Иван',lastName:'Петров'}});
function makeForm({managerMode='0',name='',contact=''}={}){
  const dom=new JSDOM('<form id="requestForm"><input name="managerMode" type="hidden"><input name="name"><input name="contact"><input name="model" value="Toyota Camry"></form>');
  const form=dom.window.document.getElementById('requestForm');
  form.elements.namedItem('managerMode').value=managerMode;
  form.elements.namedItem('name').value=name;
  form.elements.namedItem('contact').value=contact;
  return {dom,form};
}

test('validated VK ID profile supplies the full name and VK contact, not a fabricated phone number',()=>{
  assert.deepEqual(profile(),{name:'Иван Петров',contact:'https://vk.com/id42'});
  assert.equal(normalizeVkWebProfile({authenticated:true,user:{id:42,firstName:'Анна'}}).name,'Анна');
  assert.equal(normalizeVkWebProfile({authenticated:true,user:{id:42}}).name,'');
});

test('invalid or unauthenticated profile cannot populate lead fields',()=>{
  assert.equal(normalizeVkWebProfile({authenticated:false,user:{id:'42',firstName:'Evil'}}),null);
  assert.equal(normalizeVkWebProfile({authenticated:true,user:{id:'javascript:alert(1)',firstName:'Evil'}}),null);
  assert.equal(normalizeVkWebProfile({authenticated:true,user:{id:'42\n',firstName:'Evil'}}),null);
  assert.equal(normalizeVkWebProfile(null),null);
});

test('new VK web customer form fills only blank name/contact; fires input/change without affecting car selection',()=>{
  const {dom,form}=makeForm();
  let changes=0;
  form.elements.name.addEventListener('input',()=>changes++);
  form.elements.contact.addEventListener('input',()=>changes++);
  assert.equal(applyVkWebProfileToRequestForm(form,profile()),2);
  assert.equal(form.elements.name.value,'Иван Петров');
  assert.equal(form.elements.contact.value,'https://vk.com/id42');
  assert.equal(form.elements.model.value,'Toyota Camry');
  assert.equal(changes,2);
  assert.equal(applyVkWebProfileToRequestForm(form,profile()),0);
  dom.window.close();
});

test('recovered draft and manually edited name or alternative contact are never overwritten',()=>{
  const {dom,form}=makeForm({name:'Моё имя',contact:'@my_telegram'});
  assert.equal(applyVkWebProfileToRequestForm(form,profile()),0);
  assert.equal(form.elements.name.value,'Моё имя');
  assert.equal(form.elements.contact.value,'@my_telegram');
  form.elements.contact.value='';
  assert.equal(applyVkWebProfileToRequestForm(form,profile()),1);
  assert.equal(form.elements.name.value,'Моё имя');
  assert.equal(form.elements.contact.value,'https://vk.com/id42');
  dom.window.close();
});

test('manager-created CRM lead is not changed by customer VK profile',()=>{
  const {dom,form}=makeForm({managerMode:'1'});
  assert.equal(applyVkWebProfileToRequestForm(form,profile()),0);
  assert.equal(form.elements.name.value,'');
  assert.equal(form.elements.contact.value,'');
  dom.window.close();
});
