/**
 * Scroll-to-top control for AutoWorld web, VK and Telegram Mini Apps.
 * Lives outside #app so role/navigation rerenders never duplicate it.
 */
export function initializeScrollTop(win=window,doc=document){
  if(!win||!doc?.body)return null;
  const existing=doc.getElementById('autoScrollTop');
  if(existing)return existing;

  const button=doc.createElement('button');
  button.type='button';
  button.id='autoScrollTop';
  button.className='auto-scroll-top';
  button.setAttribute('aria-label','Прокрутить наверх');
  button.setAttribute('title','Наверх');
  button.setAttribute('aria-hidden','true');
  button.tabIndex=-1;
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 12 6-6 6 6"/><path d="M12 6v12"/></svg>';
  doc.body.appendChild(button);

  const scrollPosition=()=>Math.max(0,
    Number(win.scrollY)||0,
    Number(doc.scrollingElement?.scrollTop)||0,
    Number(doc.documentElement?.scrollTop)||0,
    Number(doc.body?.scrollTop)||0
  );
  const update=()=>{
    const visible=scrollPosition()>420;
    button.classList.toggle('is-visible',visible);
    button.setAttribute('aria-hidden',String(!visible));
    button.tabIndex=visible?0:-1;
  };
  button.addEventListener('click',()=>{
    const reduced=Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    try{win.scrollTo({top:0,behavior:reduced?'instant':'smooth'})}
    catch{
      const root=doc.scrollingElement||doc.documentElement;
      if(root)root.scrollTop=0;
    }
    button.blur();
  });
  win.addEventListener('scroll',update,{passive:true});
  win.addEventListener('resize',update,{passive:true});
  update();
  return button;
}

if(typeof window!=='undefined'&&typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>initializeScrollTop(),{once:true});
  else initializeScrollTop();
}
