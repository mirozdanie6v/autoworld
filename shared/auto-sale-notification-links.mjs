const TYPES=new Set(['lead','quote','order']);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);

export function notificationTarget(item={}){
  for(const [type,key] of [['order','orderId'],['quote','quoteId'],['lead','leadId']]){
    if(validId(item[key]))return{type,id:item[key]};
  }
  return null;
}

export function notificationHash(target){
  return TYPES.has(target?.type)&&validId(target?.id)
    ?`auto-mir/${target.type}/${encodeURIComponent(target.id)}`:'';
}

export function parseNotificationHash(value=''){
  const match=String(value).replace(/^#/,'').match(/^auto-mir\/(lead|quote|order)\/([^/]+)$/);
  if(!match)return null;
  try{
    const id=decodeURIComponent(match[2]);
    return validId(id)?{type:match[1],id}:null;
  }catch{return null}
}

// A link selects from the viewer-filtered state; it never grants access.
export function resolveNotificationTarget(target,state={},access={}){
  if(access.authenticated!==true||access.role!=='client'||!TYPES.has(target?.type))return null;
  const leads=Array.isArray(state.leads)?state.leads:[];
  if(target.type==='lead')return leads.some(lead=>lead.id===target.id)?{leadId:target.id}:null;
  const list=Array.isArray(state[target.type==='quote'?'quotes':'orders'])?state[target.type==='quote'?'quotes':'orders']:[];
  const item=list.find(row=>row.id===target.id);
  if(!item||!leads.some(lead=>lead.id===item.leadId))return null;
  if(target.type==='quote'&&item.status==='Черновик')return null;
  return{leadId:item.leadId,[target.type+'Id']:item.id};
}
