export const AUTO_SALE_MANAGERS=Object.freeze({
  'Дмитрий':{name:'Дмитрий',telegramUsername:'Flyer_Flyer'},
  'Алексей':{name:'Алексей',telegramUsername:'smit44744'},
  'Иван':{name:'Иван',telegramUsername:'Ivan_AWG'}
});

const clean=value=>String(value??'').trim();

export function managerDirectoryEntry(name){
  const exact=AUTO_SALE_MANAGERS[clean(name)];
  if(exact)return exact;
  const normalized=clean(name).toLowerCase();
  return Object.values(AUTO_SALE_MANAGERS).find(item=>{
    const canonical=item.name.toLowerCase();
    return canonical===normalized||normalized.startsWith(canonical+' ')||canonical.startsWith(normalized+' ');
  })||null;
}

export function managerTelegramUsername(name){
  return managerDirectoryEntry(name)?.telegramUsername||'';
}

export function managerTelegramContact(name){
  const username=managerTelegramUsername(name);
  return username?'@'+username:'';
}

export function managerTelegramIdentity(name,team=[]){
  const directory=managerDirectoryEntry(name);
  if(!directory)return{username:'',id:'',name:clean(name)};
  const row=(Array.isArray(team)?team:[]).find(item=>{
    const rowName=clean(item?.name).toLowerCase();
    const rowUsername=clean(item?.telegramUsername||item?.telegram).replace(/^@/,'').toLowerCase();
    return rowName===directory.name.toLowerCase()||rowUsername===directory.telegramUsername.toLowerCase();
  });
  return{
    username:directory.telegramUsername,
    id:/^\d+$/.test(clean(row?.telegramUserId))?clean(row.telegramUserId):'',
    name:directory.name
  };
}
