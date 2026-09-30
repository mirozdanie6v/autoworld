import {autoSaleStateHash,domainRowsToLegacyState} from './ydb-domain-migration.mjs';

function entityRowVersions(rows={}){
  const map={lead:{},quote:{},order:{},team:{},catalog:{}};
  for(const row of rows.leads||[])map.lead[String(row.id)]=Number(row.rowVersion)||0;
  for(const row of rows.quotes||[])map.quote[String(row.id)]=Number(row.rowVersion)||0;
  for(const row of rows.orders||[])map.order[String(row.id)]=Number(row.rowVersion)||0;
  for(const row of rows.team||[])map.team[String(row.id)]=Number(row.rowVersion)||0;
  for(const row of rows.catalog||[])map.catalog[String(row.id)]=Number(row.rowVersion)||0;
  return map;
}

function preserveLegacyEmptyNotes(normalized,legacy){
  const legacyNotes=legacy?.notes&&typeof legacy.notes==='object'?legacy.notes:{};
  normalized.notes=normalized.notes&&typeof normalized.notes==='object'?normalized.notes:{};
  for(const [leadId,notes] of Object.entries(legacyNotes)){
    if(Array.isArray(notes)&&notes.length===0&&!Object.prototype.hasOwnProperty.call(normalized.notes,leadId)){
      normalized.notes[leadId]=[];
    }
  }
  return normalized;
}

export async function readAutoSaleState({legacyStore,domainStore,mode='legacy',attempts=3,logger=console,authoritativeNormalized=false}){
  if(mode==='legacy')return{state:await legacyStore.loadState(),source:'legacy',fallback:false};

  if(mode==='normalized'&&authoritativeNormalized){
    if(typeof domainStore?.loadAuthoritativeSnapshot!=='function')throw new Error('normalized_authoritative_store_unavailable');
    const snapshot=await domainStore.loadAuthoritativeSnapshot();
    const revision=Number(snapshot.meta?.sourceRevision??snapshot.meta?.compatRevision)||0;
    const rows=snapshot.rows||{};
    const initialized=Boolean(
      (rows.leads||[]).length||
      (rows.quotes||[]).length||
      (rows.orders||[]).length||
      (rows.team||[]).length||
      (rows.catalog||[]).length
    );
    return{
      state:domainRowsToLegacyState(rows,{revision,initialized}),
      source:'normalized',
      fallback:false,
      authoritative:true,
      shadowVerified:false,
      rowVersions:entityRowVersions(rows)
    };
  }

  if(typeof domainStore?.loadReadSnapshot==='function'){
    try{
      const snapshot=await domainStore.loadReadSnapshot();
      const legacy=snapshot.legacy;
      const revision=Number(legacy?.revision)||0;
      const metaRevision=Number(snapshot.meta?.sourceRevision)||0;
      if(metaRevision!==revision){
        return{state:legacy,source:'legacy',fallback:true,reason:'revision_mismatch',rowVersions:entityRowVersions(snapshot.rows)};
      }
      const normalized=preserveLegacyEmptyNotes(
        domainRowsToLegacyState(snapshot.rows,{revision,initialized:Boolean(legacy.initialized)}),
        legacy
      );
      if(autoSaleStateHash(legacy)!==autoSaleStateHash(normalized)){
        logger.error?.('AUTO SALE normalized read parity mismatch',{revision});
        return{state:legacy,source:'legacy',fallback:true,reason:'parity_mismatch',rowVersions:entityRowVersions(snapshot.rows)};
      }
      const rowVersions=entityRowVersions(snapshot.rows);
      if(mode==='shadow')return{state:legacy,source:'legacy',fallback:false,shadowVerified:true,rowVersions};
      return{state:normalized,source:'normalized',fallback:false,shadowVerified:true,rowVersions};
    }catch(error){
      logger.error?.('AUTO SALE normalized snapshot read failed',String(error?.message||error));
      return{state:await legacyStore.loadState(),source:'legacy',fallback:true,reason:'snapshot_error'};
    }
  }

  let lastLegacy=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const before=await legacyStore.loadState();
      const metaBefore=await domainStore.migrationMeta();
      const rows=await domainStore.loadRows();
      const metaAfter=await domainStore.migrationMeta();
      const after=await legacyStore.loadState();
      lastLegacy=after;
      const revision=Number(after.revision)||0;
      const stable=Number(before.revision)===revision
        && Number(metaBefore?.sourceRevision)===revision
        && Number(metaAfter?.sourceRevision)===revision;
      if(!stable)continue;
      const normalized=preserveLegacyEmptyNotes(
        domainRowsToLegacyState(rows,{revision,initialized:Boolean(after.initialized)}),
        after
      );
      const parity=autoSaleStateHash(after)===autoSaleStateHash(normalized);
      if(!parity){
        logger.error?.('AUTO SALE normalized read parity mismatch',{revision});
        return{state:after,source:'legacy',fallback:true,reason:'parity_mismatch',rowVersions:entityRowVersions(rows)};
      }
      const rowVersions=entityRowVersions(rows);
      if(mode==='shadow')return{state:after,source:'legacy',fallback:false,shadowVerified:true,rowVersions};
      return{state:normalized,source:'normalized',fallback:false,shadowVerified:true,rowVersions};
    }catch(error){
      logger.error?.('AUTO SALE normalized read failed',String(error?.message||error));
      break;
    }
  }
  return{state:lastLegacy||await legacyStore.loadState(),source:'legacy',fallback:true,reason:'unstable_or_error'};
}
