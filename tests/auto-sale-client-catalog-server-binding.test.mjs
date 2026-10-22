import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeClientOperations} from '../server/auto-sale-access.mjs';
import {validateLead} from '../server/auto-sale-rules.mjs';
import {catalogVehicleSnapshot} from '../public/auto-sale-catalog-lead.mjs';

const trail={id:'AWG-3950',brand:'Chevrolet',model:'Trax',origin:'Грузия',year:2023,
 mileage:'31 550 км',engine:'1,2l на 139HP',drive:'FWD',priceRub:1880000,
 vin:'VIN-TEST-3950',image:'https://example.org/3950.jpg',active:true};
const other={...trail,id:'AWG-3941',year:2022,priceRub:1770000};
const state={leads:[],quotes:[],catalog:[trail,other],initialized:true,revision:42};
const create=(input,user={id:'999999887',provider:'vk'})=>sanitizeClientOperations(state,[
 {resource:'lead',operation:'create',id:'L-NEW',input:{name:'Test Client',contact:'@test',model:'Chevrolet Trax',nextAction:'2026-10-22',...input}},
 {resource:'note',operation:'create',leadId:'L-NEW',input:{id:'N-NEW',text:'New lead'}}
],{id:user.id,username:'qa',first_name:'Test'},user);
const clientInput={carId:trail.id,catalogRequest:true,catalogVehicle:catalogVehicleSnapshot(trail),
 origin:'Грузия',model:'Chevrolet Trax',year:'2023',mileage:trail.mileage,engine:trail.engine,
 drive:trail.drive,estimatedCostRub:trail.priceRub,catalogUsdRubRate:100,budget:19000};

test('VK and Telegram signed client creates retain immutable catalog vehicle and real year/mileage',()=>{
 for(const provider of ['vk','telegram']){
  const result=create(clientInput,{provider,id:'999999887'});
  assert.equal(result.ok,true,JSON.stringify(result));
  const lead=result.operations[0].input;
  assert.equal(lead.catalogRequest,true);
  assert.equal(lead.carId,trail.id);
  assert.equal(lead.catalogVehicle.id,trail.id);
  assert.equal(lead.catalogVehicle.vin,trail.vin);
  assert.equal(lead.year,'2023');
  assert.equal(lead.mileage,trail.mileage);
  assert.equal(lead.engine,trail.engine);
  assert.equal(lead.drive,'FWD');
  assert.equal(lead.estimatedCostRub,1880000);
  assert.equal(lead.budget,19000);
  assert.equal(lead.clientProvider,provider);
  assert.deepEqual(validateLead(lead),[]);
  assert.equal(result.operations[1].resource,'note');
 }
});

test('server uses only canonical database catalog; it ignores fake client year, VIN, prices and model',()=>{
 const result=create({...clientInput,model:'Counterfeit model',origin:'США',year:'2010',
  mileage:'900000 км',engine:'replaced',drive:'AWD',estimatedCostRub:1,budget:200000,
  catalogVehicle:{id:trail.id,vin:'FAKE VIN',year:'2015',priceRub:1}});
 assert.equal(result.ok,true);
 const lead=result.operations[0].input;
 assert.equal(lead.model,'Chevrolet Trax');
 assert.equal(lead.origin,'Грузия');
 assert.equal(lead.year,'2023');
 assert.equal(lead.catalogVehicle.vin,trail.vin);
 assert.equal(lead.catalogVehicle.priceRub,trail.priceRub);
 assert.equal(lead.mileage,trail.mileage);
 assert.equal(lead.budget,19000);
});

test('distinct identical-model catalog listings retain the exact selected ID, never name-matched',()=>{
 const result=create({...clientInput,carId:other.id,catalogVehicle:{id:other.id},model:'Chevrolet Trax'});
 assert.equal(result.ok,true);
 const saved=result.operations[0].input;
 assert.equal(saved.carId,other.id);
 assert.equal(saved.catalogVehicle.id,other.id);
 assert.equal(saved.year,'2022');
 assert.equal(saved.estimatedCostRub,1770000);
});

test('client build provenance is bounded to hex release SHAs and marked as untrusted',()=>{
 const sha='a'.repeat(40);
 const good=create({...clientInput,clientBuildSha:sha});
 assert.equal(good.operations[0].input.clientBuildSha,sha);
 assert.equal(good.operations[0].input.catalogLinkVerifiedBy,'server-catalog-id-v1');
 const invalid=create({...clientInput,clientBuildSha:'untrusted-injected-value'});
 assert.equal(invalid.operations[0].input.clientBuildSha,'');
});

test('mismatched carId and snapshot ID is rejected instead of saving a general lead',()=>{
 assert.equal(create({...clientInput,catalogVehicle:{id:other.id}}).error,'catalog_car_binding_required');
 assert.equal(create({...clientInput,carId:'NOT-IN-CATALOG'}).error,'catalog_car_binding_required');
 assert.equal(create({...clientInput,carId:'NOT-IN-CATALOG',catalogVehicle:null}).error,'catalog_car_not_available');
});

test('legacy catalog request with exact carId but missing boolean and snapshot is reconstructed',()=>{
 const result=create({carId:trail.id,model:'Chevrolet Trax'});
 assert.equal(result.ok,true);
 const lead=result.operations[0].input;
 assert.equal(lead.catalogRequest,true);
 assert.equal(lead.carId,trail.id);
 assert.equal(lead.catalogVehicle.id,trail.id);
 assert.equal(lead.year,'2023');
 assert.equal(lead.mileage,trail.mileage);
});

test('stale client carrying exact catalog engine without ID is rejected, never silently downgraded',()=>{
 for(const input of [
  {catalogRequest:true,model:'Chevrolet Trax'},
  {engine:'1,2l на 139HP',model:'Chevrolet Trax'},
  {year:'2023',mileage:'31 550 км'},
  {estimatedCostRub:1880000}
 ])assert.equal(create(input).error,'catalog_car_binding_required');
});

test('generic general request continues to work without a car ID',()=>{
 const result=create({model:'Chevrolet Trax',origin:'Грузия',engine:'Бензин',
  drive:'FWD',ageRange:'3–5 лет',budget:30000});
 assert.equal(result.ok,true,JSON.stringify(result));
 const lead=result.operations[0].input;
 assert.equal(lead.catalogRequest,undefined);
 assert.equal(lead.carId,undefined);
 assert.equal(lead.model,'Chevrolet Trax');
 assert.equal(lead.budget,30000);
 assert.deepEqual(validateLead(lead),[]);
});

test('client cannot rewrite catalog-linked car/model/spec through lead patch',()=>{
 const linked={id:'L-LINKED',status:'Новый',catalogRequest:true,carId:trail.id,catalogVehicle:catalogVehicleSnapshot(trail),
  clientProvider:'vk',clientProviderUserId:'999999887'};
 const next={...state,leads:[linked]};
 const result=sanitizeClientOperations(next,[{resource:'lead',operation:'patch',id:linked.id,input:{
   model:'Another',origin:'США',engine:'Electric',drive:'AWD',budget:1,carId:other.id,
   catalogVehicle:catalogVehicleSnapshot(other),note:'Can deliver to Kazan',deliveryCity:'Казань'
 }}],{id:'999999887'},{provider:'vk',id:'999999887'});
 assert.equal(result.ok,true);
 assert.deepEqual(result.operations[0].input,{deliveryCity:'Казань',note:'Can deliver to Kazan'});
});

test('catalog car must still be published at the time of request',()=>{
 const disabled={...state,catalog:[{...trail,active:false}]};
 const result=sanitizeClientOperations(disabled,[{resource:'lead',operation:'create',id:'L-NEW',input:{...clientInput,name:'Buyer',contact:'@buyer'}}],
  {id:'999999887'},{provider:'vk',id:'999999887'});
 assert.equal(result.error,'catalog_car_not_available');
});
