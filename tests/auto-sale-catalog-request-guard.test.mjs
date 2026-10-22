import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogLeadCreationGuard,CATALOG_REQUEST_CLIENT_VERSION} from '../server/auto-sale-catalog-request-guard.mjs';
import {syncYdbState} from '../server/ydb-sync.mjs';
const car={id:'AWG-3950',brand:'Chevrolet',model:'Trax',origin:'Грузия',year:2023,
 engine:'1,2l на 139HP',drive:'FWD',mileage:'40 000 км',active:true};
const general={id:'L-FRESH',clientCreated:true,model:'Chevrolet Trax',origin:'Грузия',
 engine:'Бензин',drive:'FWD',catalogRequest:false,carId:''};
test('stale old Mini App precise catalog engine cannot be saved as unlinked generic request',()=>{
 for(const c of [
 {...general,engine:car.engine},
 {...general,engine:car.engine,requestFlow:'general_request'},
 {...general,requestFlow:'catalog_card'},
 {...general,requestCarId:car.id},
 {...general,carId:car.id}
 ])assert.ok(catalogLeadCreationGuard(c,[car]),JSON.stringify(c));
});
test('valid selected car must be available, and catalog snapshot ID must match',()=>{
 const linked={...general,carId:car.id,catalogRequest:true,catalogVehicle:{id:car.id},engine:car.engine,
  requestFlow:'catalog_card',requestCarId:car.id,requestUiVersion:CATALOG_REQUEST_CLIENT_VERSION};
 assert.equal(catalogLeadCreationGuard(linked,[car]),null);
 assert.equal(catalogLeadCreationGuard({...linked,catalogVehicle:{id:'OTHER'}},[car]),'catalog_car_binding_required');
 assert.equal(catalogLeadCreationGuard({...linked,carId:'OTHER'},[car]),'catalog_car_binding_required');
 assert.equal(catalogLeadCreationGuard(linked,[]),'catalog_car_not_available');
 assert.equal(catalogLeadCreationGuard(linked,[{...car,active:false}]),'catalog_car_not_available');
});
test('generic selection with broad engine does not force-link car despite same model',()=>{
 assert.equal(catalogLeadCreationGuard(general,[car]),null);
 assert.equal(catalogLeadCreationGuard({...general,engine:'Гибрид'},[car]),null);
 assert.equal(catalogLeadCreationGuard({...general,model:'Другой автомобиль',engine:car.engine},[car]),null);
 assert.equal(catalogLeadCreationGuard({...general,origin:'США',engine:car.engine},[car]),null);
 assert.equal(catalogLeadCreationGuard({...general,clientCreated:false,engine:car.engine},[car]),null);
});
test('multiple same-model catalog candidates never auto-resolve an exact car id',()=>{
 assert.equal(catalogLeadCreationGuard({...general,engine:car.engine},[car,{...car,id:'AWG-3941'}]),'catalog_car_binding_missing');
});

test('YDB entity create denies the real Trax failure shape before any write',async()=>{
 let writes=0;
 const store={
  loadState:async()=>({initialized:true,revision:348,leads:[],quotes:[],orders:[],team:[],notes:{},catalog:[{...car,image:'https://example.com/trax.jpg'}]}),
  replaceState:async()=>{writes++;return{status:200,data:{ok:true}}}
 };
 const incomplete={...general,id:'L-NEW-TRAX',name:'Synthetic',contact:'@synthetic',status:'Новый',nextAction:'2026-10-22',
  engine:car.engine,createdAt:'2026-10-22T08:00:00Z'};
 const response=await syncYdbState(store,{
  baseRevision:348,leads:[incomplete],quotes:[],orders:[],notes:{},team:[],
  catalog:[{...car,image:'https://example.com/trax.jpg'}]
 });
 assert.equal(response.status,400);
 assert.equal(response.data.error,'catalog_car_binding_missing');
 assert.equal(writes,0,'never silently save unlinked old Mini App lead');
 const linked={...incomplete,catalogRequest:true,carId:car.id,catalogVehicle:{id:car.id},
  requestCarId:car.id,requestFlow:'catalog_card',requestUiVersion:CATALOG_REQUEST_CLIENT_VERSION};
 const ok=await syncYdbState(store,{
  baseRevision:348,leads:[linked],quotes:[],orders:[],notes:{},team:[],
  catalog:[{...car,image:'https://example.com/trax.jpg'}]
 });
 assert.equal(ok.status,200);assert.equal(writes,1);
});
