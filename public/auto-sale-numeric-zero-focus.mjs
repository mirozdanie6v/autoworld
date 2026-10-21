// Uniform editing behavior for zero-valued numeric form controls throughout AWG.
// Delegated listeners cover dynamically rendered manager, client, catalog and quote forms.
// Focusing a numeric zero is not an edit: restore it if the user leaves without typing.
const INSTALLED=new WeakSet();
const ZERO_VALUE=/^0(?:\.0+)?$/;

export function isEditableZeroField(element){
  if(!element||element.tagName!=='INPUT'||element.disabled||element.readOnly)return false;
  const numeric=element.type==='number'||(element.type==='text'&&['decimal','numeric'].includes(element.inputMode));
  return numeric&&ZERO_VALUE.test(String(element.value||'').trim());
}

export function installNumericZeroFocus(doc=document){
  if(!doc||INSTALLED.has(doc))return;
  INSTALLED.add(doc);
  const cleared=new WeakMap();

  const clear=element=>{
    if(!isEditableZeroField(element))return;
    cleared.set(element,{original:element.value,edited:false});
    element.value='';
  };
  doc.addEventListener('focusin',event=>clear(event.target),true);
  // Handles taps on already-focused controls whose value was reset by another UI handler.
  doc.addEventListener('click',event=>{
    const element=event.target;
    if(element===doc.activeElement)clear(element);
  },true);
  doc.addEventListener('input',event=>{
    const record=cleared.get(event.target);
    if(record)record.edited=true;
  },true);
  doc.addEventListener('focusout',event=>{
    const element=event.target,record=cleared.get(element);
    if(!record)return;
    cleared.delete(element);
    if(!record.edited&&element.value===''&&!element.disabled&&!element.readOnly)element.value=record.original;
  },true);
}
