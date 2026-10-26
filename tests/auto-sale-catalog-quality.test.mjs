import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {catalogListingQuality} from '../scripts/catalog-listing-quality.mjs';

const car={rawText:'Hyundai Elantra 12/2023; продаётся автомобиль',vin:'',brand:'Hyundai',model:'Elantra',year:2023,sourcePostId:'3733'};
const vin1='1HGCM82633A004352',vin2='JH4KA9650MC001234',vin3='WBA3A5C54DF355555';

test('valid single-vehicle listing without VIN is not rejected merely for missing VIN',()=>{
  assert.equal(catalogListingQuality(car),'');
  assert.equal(catalogListingQuality({...car,sourcePostId:'3893',rawText:'Mercedes-Benz GLA 01/2023'}),'');
  assert.equal(catalogListingQuality({...car,vin:vin1}),'');
  assert.equal(catalogListingQuality({...car,vin:vin1,rawText:'Honda Civic 2023 VIN '+vin1+' повтор '+vin1}),'');
});

test('aggregate listing with multiple VINs is rejected even when scraper chooses the first VIN',()=>{
  assert.equal(catalogListingQuality({...car,sourcePostId:'3893',vin:vin1,
    rawText:'Автомобили с VIN '+vin1+' '+vin2+' '+vin3}),'aggregate_or_multiple_vehicles');
  assert.equal(catalogListingQuality({...car,rawText:'Подборка автомобилей 2023'}),'aggregate_or_multiple_vehicles');
  assert.equal(catalogListingQuality({...car,rawText:'Несколько машин на продажу'}),'aggregate_or_multiple_vehicles');
});

test('missing source identity, year, title or malformed VIN are rejected independently',()=>{
  assert.equal(catalogListingQuality({...car,sourcePostId:''}),'missing_source_post_id');
  assert.equal(catalogListingQuality({...car,year:0}),'invalid_year');
  assert.equal(catalogListingQuality({...car,brand:''}),'missing_vehicle_title');
  assert.equal(catalogListingQuality({...car,vin:'TESTVIN'}),'invalid_vin');
});

test('scraper and normalizer use a classified vehicle gate without hardcoded post ID allowlists',()=>{
  const scraper=readFileSync(new URL('../scripts/scrape-autoworld-georgia.py',import.meta.url),'utf8');
  const normalizer=readFileSync(new URL('../scripts/import-autoworld-catalog.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(scraper,/ALLOW_NO_VIN_POST_IDS/);
  assert.doesNotMatch(normalizer,/ALLOW_NO_VIN_POST_IDS|allowNoVin/);
  assert.match(scraper,/if not is_single_vehicle_candidate\(car\):/);
  assert.match(normalizer,/catalogListingQuality\(/);
  assert.match(normalizer,/if\(car\.vin\)\(vinGroups\[car\.vin\]/);
});

test('production importer preserves manager deactivation on a matching ID or VIN replacement',()=>{
  const server=readFileSync(new URL('../server/yandex-server.mjs',import.meta.url),'utf8');
  assert.match(server,/active:exact\.active===false\?false:item\.active/);
  assert.match(server,/active:sameVin\.active===false\?false:item\.active/);
});


test('real source examples parse Hyundai, RAM, KIA, BMW and Volkswagen instead of pricing dates',()=>{
  const rows=JSON.parse(readFileSync(new URL('../data/autoworld-georgia-recent/cars.json',import.meta.url),'utf8'));
  const selected=rows.filter(item=>['3723','3733','3734','3735','3736','3828'].includes(String(item.sourcePostId)));
  assert.equal(selected.length,6);
  const python=String.raw`
import json, re, sys
with open('scripts/scrape-autoworld-georgia.py',encoding='utf8') as fp:
    source=fp.read()
start=source.index('def parse_title(text):')
end=source.index('\\n\\ndef ',start+10)
namespace={'re':re}
exec(source[start:end],namespace)
print(json.dumps([[row['sourcePostId'],*namespace['parse_title'](row['rawText'])[1:]] for row in json.load(sys.stdin)]))
`;
  const parsed=JSON.parse(execFileSync('python3',['-c',python],{
    cwd:new URL('..',import.meta.url),input:JSON.stringify(selected),encoding:'utf8'
  }));
  const byId=Object.fromEntries(parsed.map(([id,brand,model,year])=>[id,{brand,model,year}]));
  assert.deepEqual(byId['3723'],{brand:'Volkswagen',model:'T-Cross',year:2022});
  assert.deepEqual(byId['3733'],{brand:'Hyundai',model:'Elantra',year:2023});
  assert.deepEqual(byId['3734'],{brand:'RAM',model:'2500',year:2025});
  assert.deepEqual(byId['3735'],{brand:'KIA',model:'K4',year:2026});
  assert.deepEqual(byId['3736'],{brand:'BMW',model:'228',year:2025});
  assert.deepEqual(byId['3828'],{brand:'BMW',model:'228',year:2025});
});
