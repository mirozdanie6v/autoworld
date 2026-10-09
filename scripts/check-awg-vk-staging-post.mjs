const urls=['https://vk-test.awgcars.ru/api/auto-sale/entities/batch','https://vk-test.awgcars.ru/api/auto-sale/state'];
for(const url of urls){
  const opts=url.includes('/entities/')?{method:'POST',headers:{'content-type':'application/json','origin':'https://vk-test.awgcars.ru'},body:JSON.stringify({operations:[]})}:{method:'GET'};
  const res=await fetch(url,opts);
  let obj=await res.json().catch(()=>null);
  console.log(JSON.stringify({path:new URL(url).pathname,status:res.status,error:obj?.error||null,access:obj?._access?.role||null}));
  if(res.status!==200 && res.status!==401 && res.status!==403)process.exitCode=1;
}
