import {pathToFileURL} from 'node:url';

export async function diagnoseTimeweb({token,fetchImpl=fetch}={}){
  if(!token)throw new Error('TIMEWEB_CLOUD_TOKEN is required');
  const endpoint='https://api.timeweb.cloud/api/v1';
  async function read(path){
    const response=await fetchImpl(endpoint+path,{
      headers:{authorization:'Bearer '+token,accept:'application/json'},
      signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)return {httpStatus:response.status};
    return {httpStatus:response.status,data:await response.json()};
  }
  const [list,finances,status,presets]=await Promise.all([
    read('/servers'),read('/account/finances'),read('/account/status'),read('/presets/servers')
  ]);
  const all=Array.isArray(list.data?.servers)?list.data.servers:[];
  const matching=all.filter(s=>s.name==='awg-timeweb-staging');
  const fs=finances.data?.finances||{};
  // Never write actual financial balance or account PII into public CI logs.
  const candidate=[fs.available_balance,fs.balance,fs.balance_rub,fs.current_balance]
    .find(value=>typeof value==='number'&&Number.isFinite(value));
  const sufficient=typeof candidate==='number'?candidate>=1500:null;
  const ps=Array.isArray(presets.data?.server_presets)?presets.data.server_presets:[];
  const p=ps.find(x=>Number(x.id)===2575);
  const summary={
    readonly:true,serverListHttp:list.httpStatus,stagingCount:matching.length,
    staging:matching.map(s=>({id:s.id,status:s.status,owned:s.comment==='VIIVERSION AWG isolated staging'})),
    existingServerCount:all.length,
    financeHttp:finances.httpStatus,balanceSufficientForBaseMonth:sufficient,
    accountHttp:status.httpStatus,accountStatus:status.data?.account?.status||status.data?.status?.status||'not-disclosed',
    presetHttp:presets.httpStatus,presetAvailable:!!p,
    preset:p?{id:p.id,cpu:p.cpu,ram:p.ram,disk:p.disk,price:p.price,location:p.location}:null
  };
  console.log('TIMEWEB_READONLY_DIAG '+JSON.stringify(summary));
  return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await diagnoseTimeweb({token:process.env.TIMEWEB_CLOUD_TOKEN});
}
