// Cheap catalog motion scheduler. Heavy v25 glass styling stays intact:
// 2 blurred animation fields run only when a card is visible and scrolling is idle.
export function startAutoCalcScrollPerformance({
  doc=document,win=window,IntersectionObserverImpl=win.IntersectionObserver,
  MutationObserverImpl=win.MutationObserver
}={}){
  if(!doc?.documentElement||!IntersectionObserverImpl||!MutationObserverImpl)return null;
  const root=doc.getElementById('app');
  if(!root)return null;
  const tracked=new Set();
  const visible=new Set();
  let stopped=false,scanning=false,idleTimer=null;

  function scan(){
    scanning=false;
    if(stopped)return;
    const current=new Set(root.querySelectorAll('.auto-car:has(.auto-card-actions .auto-calc-glint)'));
    for(const card of tracked){
      if(current.has(card))continue;
      observer.unobserve(card);
      card.classList.remove('auto-calc-inview');
      tracked.delete(card);
      visible.delete(card);
    }
    for(const card of current){
      if(tracked.has(card))continue;
      tracked.add(card);
      observer.observe(card);
    }
  }
  const observer=new IntersectionObserverImpl(entries=>{
    if(stopped)return;
    for(const {target,isIntersecting} of entries){
      if(!tracked.has(target))continue;
      target.classList.toggle('auto-calc-inview',isIntersecting);
      if(isIntersecting)visible.add(target);
      else visible.delete(target);
    }
  },{root:null,rootMargin:'0px',threshold:0});
  const changes=new MutationObserverImpl(()=>{
    if(scanning||stopped)return;
    scanning=true;
    win.requestAnimationFrame(scan);
  });
  changes.observe(root,{childList:true,subtree:true});
  // Scrolling should not trigger blur animation frames; no per-card scroll reads.
  function onScroll(){
    if(stopped)return;
    doc.documentElement.classList.add('auto-calc-is-scrolling');
    if(idleTimer!==null)win.clearTimeout(idleTimer);
    idleTimer=win.setTimeout(()=>{
      idleTimer=null;
      doc.documentElement.classList.remove('auto-calc-is-scrolling');
    },180);
  }
  win.addEventListener('scroll',onScroll,{capture:true,passive:true});
  doc.addEventListener('scroll',onScroll,{capture:true,passive:true});
  doc.documentElement.classList.add('auto-calc-perf-ready');
  scan();
  return {
    getStats:()=>({tracked:tracked.size,visible:visible.size,scrolling:doc.documentElement.classList.contains('auto-calc-is-scrolling')}),
    stop(){
      if(stopped)return;
      stopped=true;
      changes.disconnect();observer.disconnect();
      if(idleTimer!==null)win.clearTimeout(idleTimer);
      win.removeEventListener('scroll',onScroll,true);
      doc.removeEventListener('scroll',onScroll,true);
      for(const card of tracked)card.classList.remove('auto-calc-inview');
      tracked.clear();visible.clear();
      doc.documentElement.classList.remove('auto-calc-perf-ready','auto-calc-is-scrolling');
    }
  };
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
  window.__AUTO_SALE_CALC_SCROLL_PERF__=startAutoCalcScrollPerformance();
}
