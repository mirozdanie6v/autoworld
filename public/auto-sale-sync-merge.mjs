const ARRAY_KEYS=['leads','quotes','orders','team','catalog'];

const clone=value=>{
  if(value===undefined)return undefined;
  if(typeof structuredClone==='function')return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const byId=rows=>new Map((Array.isArray(rows)?rows:[]).filter(x=>x&&x.id!==undefined&&x.id!==null).map(x=>[String(x.id),x]));

export function mergeRows(serverRows=[],baseRows=[],localRows=[]){
  const server=Array.isArray(serverRows)?serverRows:[];
  const base=Array.isArray(baseRows)?baseRows:[];
  const local=Array.isArray(localRows)?localRows:[];
  const baseMap=byId(base),localMap=byId(local),serverMap=byId(server);
  const changed=new Set([...baseMap.keys(),...localMap.keys()].filter(id=>{
    if(!localMap.has(id))return baseMap.has(id);
    if(!baseMap.has(id))return true;
    return !same(localMap.get(id),baseMap.get(id));
  }));
  for(const id of changed){
    if(localMap.has(id))serverMap.set(id,clone(localMap.get(id)));
    else serverMap.delete(id);
  }
  const order=[];
  for(const row of server){
    const id=String(row?.id??'');
    if(id&&serverMap.has(id)&&!order.includes(id))order.push(id);
  }
  for(const row of local){
    const id=String(row?.id??'');
    if(id&&serverMap.has(id)&&!order.includes(id))order.push(id);
  }
  return order.map(id=>serverMap.get(id));
}

export function mergeNotes(serverNotes={},baseNotes={},localNotes={}){
  const server={...(serverNotes&&typeof serverNotes==='object'?clone(serverNotes):{})};
  const base=baseNotes&&typeof baseNotes==='object'?baseNotes:{};
  const local=localNotes&&typeof localNotes==='object'?localNotes:{};
  const keys=new Set([...Object.keys(base),...Object.keys(local)]);
  for(const key of keys){
    if(Object.prototype.hasOwnProperty.call(local,key)){
      if(!Object.prototype.hasOwnProperty.call(base,key)||!same(local[key],base[key]))server[key]=clone(local[key]);
    }else if(Object.prototype.hasOwnProperty.call(base,key)){
      delete server[key];
    }
  }
  return server;
}

export function rebaseAutoSaleState(serverState={},baseState={},localState={}){
  const out={...clone(serverState)};
  for(const key of ARRAY_KEYS)out[key]=mergeRows(serverState?.[key],baseState?.[key],localState?.[key]);
  out.notes=mergeNotes(serverState?.notes,baseState?.notes,localState?.notes);
  out.initialized=true;
  out.revision=Number(serverState?.revision)||0;
  return out;
}

export function snapshotAutoSaleState(state={}){
  return {
    revision:Number(state?.revision)||0,
    initialized:Boolean(state?.initialized),
    leads:clone(state?.leads||[]),
    quotes:clone(state?.quotes||[]),
    orders:clone(state?.orders||[]),
    notes:clone(state?.notes||{}),
    team:clone(state?.team||[]),
    catalog:clone(state?.catalog||[])
  };
}
