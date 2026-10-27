// Lightweight, server-gated Telegram Mini App telemetry.
// Never send campaign/ad identifiers, identity or tokens from browser state.
export function startAdsTelemetry({authHeaders,fetchImpl,root}={}){
  if(typeof authHeaders!=='function'||typeof fetchImpl!=='function'
    ||!root||typeof root.addEventListener!=='function'){
    throw new Error('invalid_ads_telemetry_dependencies');
  }
  let stopped=false;
  const post=async(eventType,carId)=>{
    if(stopped)return;
    const body=eventType==='vehicle_view'?{eventType,carId}:{eventType};
    try{
      await fetchImpl('/api/auto-sale/ads/event',{
        method:'POST',
        headers:authHeaders({'content-type':'application/json'}),
        cache:'no-store',
        body:JSON.stringify(body)
      });
    }catch{
      // Analytics is best-effort, never interrupts an AutoWorld interaction.
    }
  };
  const click=event=>{
    const target=event.target?.closest?.('[data-detail]');
    const carId=target?.dataset?.detail;
    if(typeof carId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(carId)){
      void post('vehicle_view',carId);
    }
  };
  root.addEventListener('click',click,true);
  void post('miniapp_open');
  return ()=>{stopped=true;root.removeEventListener('click',click,true);};
}
