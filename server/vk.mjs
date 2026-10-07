import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

const clean=value=>String(value??'').trim();
const enabledFlag=value=>/^(1|true|yes)$/i.test(clean(value));
const numeric=value=>/^\d+$/.test(clean(value))?clean(value):'';

function safeEqual(a,b){
  const left=Buffer.from(String(a||'')),right=Buffer.from(String(b||''));
  return left.length===right.length&&left.length>0&&timingSafeEqual(left,right);
}

function signedQuery(params){
  const entries=[...params.entries()]
    .filter(([key])=>key.startsWith('vk_'))
    .sort(([a],[b])=>a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

function randomIdFromKey(key){
  const digest=createHash('sha256').update(String(key||Date.now())).digest();
  return digest.readUInt32BE(0)&0x7fffffff;
}

export function createVkService({
  enabled=process.env.AUTO_SALE_VK_ENABLED,
  appId=process.env.AUTO_SALE_VK_APP_ID,
  appSecret=process.env.AUTO_SALE_VK_APP_SECRET,
  groupId=process.env.AUTO_SALE_VK_GROUP_ID,
  communityToken=process.env.AUTO_SALE_VK_COMMUNITY_TOKEN,
  apiVersion=process.env.AUTO_SALE_VK_API_VERSION||'5.199',
  apiBaseUrl=process.env.AUTO_SALE_VK_API_BASE_URL||'https://api.vk.com/method',
  fetchImpl=globalThis.fetch,
  now=()=>Date.now(),
  maxLaunchAgeSec=86400
}={}){
  const flag=enabledFlag(enabled);
  const vkAppId=numeric(appId);
  const secret=clean(appSecret);
  const vkGroupId=numeric(groupId);
  const token=clean(communityToken);
  const configured=Boolean(flag&&vkAppId&&secret);
  const messagingEnabled=Boolean(configured&&vkGroupId&&token&&fetchImpl);

  function validateLaunchParams(rawValue){
    if(!configured)return{ok:false,error:'vk_not_configured'};
    const raw=clean(rawValue).replace(/^\?/,'');
    if(!raw)return{ok:false,error:'vk_launch_params_required'};
    const params=new URLSearchParams(raw);
    const sign=clean(params.get('sign'));
    if(!sign)return{ok:false,error:'vk_sign_required'};
    const launchAppId=numeric(params.get('vk_app_id'));
    if(!launchAppId||launchAppId!==vkAppId)return{ok:false,error:'vk_app_id_invalid'};
    const userId=numeric(params.get('vk_user_id'));
    if(!userId)return{ok:false,error:'vk_user_required'};
    const ts=Number(params.get('vk_ts')||0);
    if(!Number.isFinite(ts)||ts<=0)return{ok:false,error:'vk_ts_required'};
    const nowSec=Math.floor(now()/1000);
    if(ts>nowSec+300||nowSec-ts>maxLaunchAgeSec)return{ok:false,error:'vk_launch_params_expired'};
    const expected=createHmac('sha256',secret).update(signedQuery(params)).digest('base64url');
    if(!safeEqual(sign,expected))return{ok:false,error:'vk_sign_invalid'};
    const user={id:userId,provider:'vk',username:'',first_name:'',last_name:''};
    return{
      ok:true,
      user,
      identity:{provider:'vk',id:userId,key:`vk:${userId}`},
      launch:{
        appId:launchAppId,
        userId,
        groupId:numeric(params.get('vk_group_id')),
        notificationsEnabled:params.get('vk_are_notifications_enabled')==='1',
        platform:clean(params.get('vk_platform')),
        language:clean(params.get('vk_language')),
        ts
      }
    };
  }

  async function send(userId,message,{idempotencyKey=''}={}){
    const peerId=numeric(userId),text=clean(message);
    if(!messagingEnabled){const error=new Error('vk_messaging_not_configured');error.statusCode=503;throw error}
    if(!peerId){const error=new Error('vk_user_id_required');error.statusCode=409;throw error}
    if(!text){const error=new Error('vk_message_required');error.statusCode=400;throw error}
    const body=new URLSearchParams({
      access_token:token,
      v:clean(apiVersion)||'5.199',
      peer_id:peerId,
      random_id:String(randomIdFromKey(idempotencyKey||`${peerId}:${text}`)),
      message:text
    });
    const response=await fetchImpl(`${clean(apiBaseUrl).replace(/\/$/,'')}/messages.send`,{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body:body.toString(),
      signal:AbortSignal.timeout(8000)
    });
    let data={};try{data=await response.json()}catch{}
    if(!response.ok||data?.error){
      const code=Number(data?.error?.error_code||0);
      const error=new Error(code===901?'vk_messages_not_allowed':'vk_api_error');
      error.statusCode=code===901?409:502;
      error.vkCode=code||null;
      error.vkDescription=clean(data?.error?.error_msg)||`HTTP ${response.status}`;
      error.permanent=code===901;
      throw error;
    }
    const messageId=typeof data?.response==='number'||typeof data?.response==='string'?String(data.response):clean(data?.response?.message_id);
    return{message_id:messageId||null};
  }

  return{
    enabled:configured,
    messagingEnabled,
    appId:vkAppId,
    groupId:vkGroupId,
    validateLaunchParams,
    send
  };
}
