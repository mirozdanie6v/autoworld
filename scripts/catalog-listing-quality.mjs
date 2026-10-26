// Consistent single-vehicle quality gate for catalog imports.
// VIN is optional; a source post, not an invented VIN, identifies a vehicle without one.
const VIN_RE=/\b[A-HJ-NPR-Z0-9]{17}\b/g;
const FULL_VIN=/^[A-HJ-NPR-Z0-9]{17}$/;
const MULTI_VEHICLE=/(?:^|[\s(])(?:несколько|множество|два|три|четыре|пять|2|3|4|5|подборка|каталог|прайс-лист)\s+(?:авто|автомобил[а-яё]*|машин[а-яё]*)(?=$|[\s.,!?:;])/iu;

export function catalogListingQuality({rawText='',vin='',brand='',model='',year=0,sourcePostId=''}={}){
  const raw=String(rawText||'');
  const normalizedVin=String(vin||'').trim().toUpperCase();
  const vins=new Set([...raw.toUpperCase().matchAll(VIN_RE)].map(hit=>hit[0]));
  if(normalizedVin&&!FULL_VIN.test(normalizedVin))return 'invalid_vin';
  if(normalizedVin)vins.add(normalizedVin);
  if(vins.size>1||MULTI_VEHICLE.test(raw))return 'aggregate_or_multiple_vehicles';
  if(!/^\d+$/.test(String(sourcePostId||'')))return 'missing_source_post_id';
  if(!String(brand||'').trim()||!String(model||'').trim())return 'missing_vehicle_title';
  if(!Number.isInteger(Number(year))||Number(year)<2000||Number(year)>2030)return 'invalid_year';
  return '';
}
