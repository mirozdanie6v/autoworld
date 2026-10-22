import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogLeadCreationGuard,CATALOG_REQUEST_CLIENT_VERSION} from '../server/auto-sale-catalog-request-guard.mjs';
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
