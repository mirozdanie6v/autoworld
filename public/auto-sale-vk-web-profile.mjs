// Only a verified VK ID browser session can supply these details.
// Keep this module DOM-independent at import time so it can be tested in Node.
export function normalizeVkWebProfile(data){
  if(!data?.authenticated || !data.user) return null;
  const id=String(data.user.id||'').trim();
  if(!/^\d{1,20}$/.test(id))return null;
  const namePart=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,80);
  return {
    name:[namePart(data.user.firstName),namePart(data.user.lastName)].filter(Boolean).join(' '),
    contact:'https://vk.com/id'+id
  };
}

export function applyVkWebProfileToRequestForm(form,profile){
  if(!form||form.id!=='requestForm'||form.elements?.managerMode?.value!=='0'||!profile)return 0;
  let filled=0;
  for(const [fieldName,value] of Object.entries({name:profile.name,contact:profile.contact})){
    const field=form.elements?.namedItem?.(fieldName) || form.elements?.[fieldName];
    if(!field||!value||String(field.value||'').trim())continue;
    field.value=value;
    const EventClass=field.ownerDocument?.defaultView?.Event;
    if(EventClass){
      field.dispatchEvent(new EventClass('input',{bubbles:true}));
      field.dispatchEvent(new EventClass('change',{bubbles:true}));
    }
    filled++;
  }
  return filled;
}
