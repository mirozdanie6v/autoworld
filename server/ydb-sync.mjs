import {leadTransitionAllowed,quoteTransitionAllowed,validateLead,validateOrder,validateQuote,validateVehicleVerification} from './auto-sale-rules.mjs';

const arr=v=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'):[];
const text=v=>String(v??'').trim();
const num=v=>Number(v)||0;
const same=(a,b)=>String(a??'')===String(b??'');
const sameJson=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const latestQuote=(quotes,leadId)=>quotes.filter(q=>text(q.leadId)===leadId).sort((a,b)=>num(b.version)-num(a.version))[0];
const bad=(error,data={})=>({status:400,data:{error,...data}});
const photoList=v=>Array.isArray(v)?v.filter(Boolean):[];
const validPhoto=value=>{
  const src=text(value);
  return /^https?:\/\//i.test(src)&&src.length<=4000;
};

export async function syncYdbState(store,input,{includePrevious=false,prepareNotifications=null}={}){
  const previous=await store.loadState();
  const current=Number(previous.revision)||0;
  const supplied=input?.baseRevision;
  if(supplied!==undefined&&supplied!==null&&Number(supplied)!==current){
    return{status:409,data:{error:'revision_conflict',currentRevision:current,state:previous}};
  }

  const leads=arr(input?.leads);
  const quotes=arr(input?.quotes);
  const orders=arr(input?.orders);
  const team=arr(input?.team);
  const catalog=arr(input?.catalog);
  const notes=input?.notes&&typeof input.notes==='object'?input.notes:{};
  const previousLeads=new Map(arr(previous.leads).map(x=>[text(x.id),x]));
  const previousQuotes=new Map(arr(previous.quotes).map(x=>[text(x.id),x]));
  const previousOrders=new Map(arr(previous.orders).map(x=>[text(x.id),x]));
  const initialized=Boolean(previous.initialized);

  for(const member of team){
    if(!text(member.id)||!text(member.name))return bad('invalid_team_member',{id:member.id||'',details:['Укажите имя сотрудника.']});
    if(!['Директор','Менеджер','Логист','Администратор'].includes(text(member.role)))return bad('invalid_team_role',{id:member.id,role:member.role});
  }

  const catalogIds=new Set();
  for(const car of catalog){
    const id=text(car.id);
    if(!id||!text(car.brand)||!text(car.model))return bad('invalid_catalog_car',{id,details:['Укажите ID, марку и модель автомобиля.']});
    if(catalogIds.has(id))return bad('duplicate_catalog_car',{id});
    catalogIds.add(id);
    if(!validPhoto(car.image))return bad('invalid_catalog_car',{id,details:['Укажите корректное главное фото автомобиля.']});
    const interior=photoList(car.interiorPhotos),other=photoList(car.otherPhotos);
    if(interior.length>4)return bad('invalid_catalog_photos',{id,details:['Допускается не более 4 фото салона.']});
    if(other.length>6)return bad('invalid_catalog_photos',{id,details:['Допускается не более 6 дополнительных фото.']});
    if([...interior,...other].some(src=>!validPhoto(src)))return bad('invalid_catalog_photos',{id,details:['Одно из фото имеет неподдерживаемый формат или слишком большой размер.']});
  }

  for(const lead of leads){
    const errors=validateLead(lead);
    if(errors.length)return bad('invalid_lead',{id:lead.id,details:errors});
    const before=previousLeads.get(text(lead.id));
    if(initialized&&before){
      const agreed=quotes.some(q=>text(q.leadId)===text(lead.id)&&text(q.status)==='Согласован');
      if(!leadTransitionAllowed(text(before.status),text(lead.status),{hasAgreedQuote:agreed,deposit:num(lead.deposit)})){
        return bad('invalid_lead_transition',{id:lead.id,from:before.status,to:lead.status});
      }
    }
  }

  for(const quote of quotes){
    const errors=validateQuote(quote);
    if(errors.length)return bad('invalid_quote',{id:quote.id,details:errors});
    const before=previousQuotes.get(text(quote.id));
    if(initialized&&before){
      if(!same(before.leadId,quote.leadId))return bad('quote_lead_locked',{id:quote.id});
      if(!quoteTransitionAllowed(text(before.status),text(quote.status))){
        return bad('invalid_quote_transition',{id:quote.id,from:before.status,to:quote.status});
      }
      if(text(before.status)!=='Согласован'&&text(quote.status)==='Согласован'&&text(quote.origin)==='США'){
        const verificationErrors=validateVehicleVerification(quote);
        if(verificationErrors.length)return bad('invalid_quote',{id:quote.id,details:verificationErrors});
      }
      if(['Согласован','Отказ'].includes(text(before.status))){
        for(const key of ['leadId','model','lot','auction','inland','ocean','customs','repair','service','total','version','validUntil']){
          if(!same(before[key],quote[key]))return bad('locked_quote_changed',{id:quote.id,field:key});
        }
        if(!sameJson(before.verification,quote.verification))return bad('locked_quote_changed',{id:quote.id,field:'verification'});
      }
    }else if(initialized&&!quoteTransitionAllowed('',text(quote.status))){
      return bad('invalid_initial_quote_status',{id:quote.id,status:quote.status});
    }
  }

  const seenLeadOrders=new Set();
  for(const order of orders){
    const leadId=text(order.leadId);
    if(seenLeadOrders.has(leadId))return bad('duplicate_order_for_lead',{leadId});
    seenLeadOrders.add(leadId);
    const before=previousOrders.get(text(order.id));
    const errors=validateOrder(order,initialized&&before?text(before.stage):'');
    if(errors.length)return bad('invalid_order',{id:order.id,details:errors});
    if(initialized&&before){
      for(const key of ['leadId','model','total','cost']){
        if(!same(before[key],order[key]))return bad('locked_order_field_changed',{id:order.id,field:key});
      }
    }else if(initialized){
      if(text(order.stage)!=='Выкуп')return bad('new_order_must_start_at_purchase',{id:order.id,stage:order.stage});
      const lead=leads.find(x=>text(x.id)===leadId);
      const quote=latestQuote(quotes,leadId);
      if(!lead||text(lead.status)!=='Сделка'||!quote||text(quote.status)!=='Согласован'||num(lead.deposit)<=0){
        return bad('order_prerequisites_missing',{id:order.id});
      }
      if(text(quote.origin)==='США'){
        const min=Math.ceil(num(quote.total)*.25),max=Math.floor(num(quote.total)*.30),plan=arr(order.paymentPlan);
        if(num(lead.deposit)<min||num(lead.deposit)>max)return bad('auction_deposit_out_of_range',{id:order.id,min,max});
        if(plan.length!==4)return bad('usa_payment_plan_required',{id:order.id});
      }
      if([...previousOrders.values()].some(x=>text(x.leadId)===leadId))return bad('duplicate_order_for_lead',{leadId});
    }
  }

  const nextState={initialized:true,leads,quotes,orders,notes,team,catalog};
  const notifications=prepareNotifications?await prepareNotifications(previous,nextState):[];
  const result=await store.replaceState(nextState,{expectedRevision:current,notifications});
  if(result.status===200&&prepareNotifications){
    result.data.notifications={queued:notifications.length,ids:notifications.map(x=>x.id)};
    result.data._notificationItems=notifications;
  }
  return includePrevious?{...result,previous}:result;
}
