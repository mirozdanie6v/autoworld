// Surface HTML5 form constraints in the modal instead of allowing a silent no-op
// when mobile browsers suppress the submit event for an invalid field.
export function invalidRequestFields(form){
  if(!form||form.id!=='requestForm'||form.elements?.namedItem?.('managerMode')?.value!=='0')return [];
  return [...form.querySelectorAll('input,select,textarea')].filter(field=>!field.disabled&&field.type!=='hidden'&&field.willValidate&&!field.validity.valid);
}
export function highlightInvalidRequest(form){
  const invalid=invalidRequestFields(form);
  if(!invalid.length)return false;
  const names={name:'имя',contact:'контакт',model:'марку и модель',origin:'способ покупки',budget:'бюджет'};
  const first=invalid[0];
  const message=first.validity.valueMissing
    ?'Для отправки заявки укажите '+(names[first.name]||'обязательное поле')+'.'
    :first.validity.rangeUnderflow
      ?'Проверьте значение поля «'+(names[first.name]||first.name)+'»: минимум '+first.min+'.'
      :first.validity.stepMismatch
        ?'Проверьте шаг значения поля «'+(names[first.name]||first.name)+'».'
        :'Проверьте значение поля «'+(names[first.name]||first.name)+'».';
  let box=form.querySelector('[data-client-submit-feedback]');
  if(!box){
    box=form.ownerDocument.createElement('div');
    box.dataset.clientSubmitFeedback='invalid';
    box.className='auto-form-error full';
    box.setAttribute('role','alert');
    form.prepend(box);
  }
  box.textContent=message;
  first.classList.add('auto-field-blocked');
  const focus=()=>{try{first.focus({preventScroll:true})}catch{first.focus()}};
  focus();
  if(typeof first.scrollIntoView==='function')first.scrollIntoView({block:'center',behavior:'smooth'});
  return true;
}
if(typeof document!=='undefined'){
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('#requestForm button[type="submit"]');
    if(!button||button.disabled)return;
    const form=button.form;
    if(highlightInvalidRequest(form))event.preventDefault();
  },true);
  document.addEventListener('input',event=>{
    const form=event.target?.closest?.('#requestForm');
    if(!form)return;
    const notice=form.querySelector('[data-client-submit-feedback]');
    if(notice)notice.remove();
  },true);
}
