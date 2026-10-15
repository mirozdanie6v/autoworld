import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
import {prepareTimeweb} from './prepare-awg-timeweb.mjs';

const EXPECTED_PRESET_ID=2575;
const MAX_BASE_RUB=1500;

export function verifyApprovedTimewebPlan(plan){
  if(!plan||plan.name!=='awg-timeweb-staging'||plan.availabilityZone!=='spb-3'||
    Number(plan.presetId)!==EXPECTED_PRESET_ID||Number(plan.cpu)!==1||
    Number(plan.ramMb)!==2048||Number(plan.diskMb)!==30720||
    Number(plan.baseMonthlyPrice)<1||Number(plan.baseMonthlyPrice)>MAX_BASE_RUB){
    throw new Error('Timeweb staging plan differs from explicitly approved preset or price');
  }
  return true;
}

export async function provisionApprovedTimeweb({token,publicKey,fetchImpl}={}){
  if(!token)throw new Error('TIMEWEB_CLOUD_TOKEN is required');
  if(!publicKey)throw new Error('AWG_TIMEWEB_SSH_PUBLIC_KEY is required');
  const args={token,publicKey,maxPrice:MAX_BASE_RUB,expectedPresetId:EXPECTED_PRESET_ID,fetchImpl};
  // Preflight GET only: read Timeweb account, tariff and Ubuntu image. No charges.
  const before=await prepareTimeweb({...args,create:false});
  verifyApprovedTimewebPlan(before.plan);
  if(!before.ok)throw new Error('Timeweb preflight failed');
  console.log('TIMEWEB_AUTHORIZED_PREFLIGHT '+JSON.stringify({
    region:before.plan.availabilityZone,presetId:before.plan.presetId,
    baseMonthlyRUB:before.plan.baseMonthlyPrice,
    willCreate:!before.existingServerId
  }));
  // This is the single explicit billable operation. prepareTimeweb itself
  // rechecks existing owned server, keeps the approved preset and never retries POST.
  const result=await prepareTimeweb({...args,create:true});
  verifyApprovedTimewebPlan(result.plan);
  if(!result.ok||!(result.serverId||result.existingServerId)){
    throw new Error('Timeweb server was not confirmed; inspect account before retrying');
  }
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await provisionApprovedTimeweb({
    token:process.env.TIMEWEB_CLOUD_TOKEN,
    publicKey:process.env.AWG_TIMEWEB_SSH_PUBLIC_KEY
  });
  const output=process.env.AWG_TIMEWEB_PLAN_OUTPUT;
  if(output)await writeFile(output,JSON.stringify(result,null,2),{mode:0o600});
  console.log('TIMEWEB_PROVISION_RESULT '+JSON.stringify({
    ok:result.ok,created:result.created,serverId:result.serverId||result.existingServerId,
    status:result.status,availabilityZone:result.plan.availabilityZone,
    presetId:result.plan.presetId,baseMonthlyRUB:result.plan.baseMonthlyPrice,
    productionDnsChanged:false,productionWebhookChanged:false
  }));
}
