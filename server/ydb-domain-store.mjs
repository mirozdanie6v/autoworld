import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {MetadataCredentialsProvider} from '@ydbjs/auth/metadata';
import {Uint64} from '@ydbjs/value/primitive';
import {domainRowsToLegacyState} from './ydb-domain-migration.mjs';

export const AUTO_SALE_DOMAIN_SCHEMA_VERSION=1;

export const AUTO_SALE_DOMAIN_TABLES=[
  'auto_sale_leads',
  'auto_sale_quotes',
  'auto_sale_orders',
  'auto_sale_payments',
  'auto_sale_notes',
  'auto_sale_team',
  'auto_sale_catalog',
  'auto_sale_telegram_bindings',
  'auto_sale_state_meta'
];

export async function ensureAutoSaleDomainSchema(sql){
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_schema_meta (
      component Utf8 NOT NULL,
      version Uint64 NOT NULL,
      updated_at Utf8 NOT NULL,
      PRIMARY KEY (component)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_state_meta (
      id Uint64 NOT NULL,
      compat_revision Uint64 NOT NULL,
      schema_version Uint64 NOT NULL,
      migration_status Utf8 NOT NULL,
      source_revision Uint64,
      updated_at Utf8 NOT NULL,
      PRIMARY KEY (id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_leads (
      id Utf8 NOT NULL,
      row_version Uint64 NOT NULL,
      sort_order Uint64 NOT NULL,
      status Utf8 NOT NULL,
      manager Utf8 NOT NULL,
      source Utf8 NOT NULL,
      client_created Bool NOT NULL,
      payload Utf8 NOT NULL,
      updated_at Utf8 NOT NULL,
      PRIMARY KEY (id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_quotes (
      id Utf8 NOT NULL,
      row_version Uint64 NOT NULL,
      sort_order Uint64 NOT NULL,
      lead_id Utf8 NOT NULL,
      status Utf8 NOT NULL,
      quote_version Uint64 NOT NULL,
      payload Utf8 NOT NULL,
      updated_at Utf8 NOT NULL,
      PRIMARY KEY (id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_orders (
      id Utf8 NOT NULL,
      row_version Uint64 NOT NULL,
      sort_order Uint64 NOT NULL,
      lead_id Utf8 NOT NULL,
      stage Utf8 NOT NULL,
      manager Utf8 NOT NULL,
      risk_type Utf8 NOT NULL,
      payload Utf8 NOT NULL,
      updated_at Utf8 NOT NULL,
      PRIMARY KEY (id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_payments (
      order_id Utf8 NOT NULL,
      id Utf8 NOT NULL,
      sort_order Uint64 NOT NULL,
      amount Double NOT NULL,
      payment_date Utf8 NOT NULL,
      method Utf8 NOT NULL,
      payload Utf8 NOT NULL,
      created_at Utf8 NOT NULL,
      PRIMARY KEY (order_id, id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_notes (
      lead_id Utf8 NOT NULL,
      id Utf8 NOT NULL,
      sort_order Uint64 NOT NULL,
      text Utf8 NOT NULL,
      payload Utf8 NOT NULL,
      created_at Utf8 NOT NULL,
      PRIMARY KEY (lead_id, id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_team (
      id Utf8 NOT NULL,
      row_version Uint64 NOT NULL,
      sort_order Uint64 NOT NULL,
      name Utf8 NOT NULL,
      role Utf8 NOT NULL,
      active Bool NOT NULL,
      payload Utf8 NOT NULL,
      updated_at Utf8 NOT NULL,
      PRIMARY KEY (id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_catalog (
      id Utf8 NOT NULL,
      row_version Uint64 NOT NULL,
      sort_order Uint64 NOT NULL,
      origin Utf8 NOT NULL,
      active Bool NOT NULL,
      auction_date Utf8 NOT NULL,
      payload Utf8 NOT NULL,
      updated_at Utf8 NOT NULL,
      PRIMARY KEY (id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auto_sale_telegram_bindings (
      subject_type Utf8 NOT NULL,
      subject_id Utf8 NOT NULL,
      telegram_user_id Utf8 NOT NULL,
      username Utf8 NOT NULL,
      first_name Utf8 NOT NULL,
      last_name Utf8 NOT NULL,
      linked_at Utf8 NOT NULL,
      updated_at Utf8 NOT NULL,
      PRIMARY KEY (subject_type, subject_id)
    )
  `;
  const component='auto-sale-domain';
  const version=new Uint64(BigInt(AUTO_SALE_DOMAIN_SCHEMA_VERSION));
  const now=new Date().toISOString();
  await sql`
    UPSERT INTO auto_sale_schema_meta (component, version, updated_at)
    VALUES (${component}, ${version}, ${now})
  `;
}

export async function createYdbDomainStore({
  connectionString,
  credentialsProvider=new MetadataCredentialsProvider(),
  ensureSchema=true
}){
  const driver=new Driver(connectionString,{credentialsProvider});
  await driver.ready();
  const sql=query(driver);
  const READ_ATTEMPTS=3;
  const READ_TIMEOUT_MS=7000;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function readQuery(makeQuery,label='domain-read'){
    let lastError=null;
    for(let attempt=1;attempt<=READ_ATTEMPTS;attempt++){
      try{
        return await makeQuery()
          .isolation('onlineReadOnly',{allowInconsistentReads:false})
          .idempotent(true)
          .timeout(READ_TIMEOUT_MS);
      }catch(error){
        lastError=error;
        if(attempt>=READ_ATTEMPTS)throw error;
        console.warn(`AUTO SALE YDB ${label} retry ${attempt}/${READ_ATTEMPTS}`,String(error?.message||error));
        await sleep(150*(2**(attempt-1)));
      }
    }
    throw lastError;
  }
  if(ensureSchema)await ensureAutoSaleDomainSchema(sql);

  async function schemaVersion(){
    const component='auto-sale-domain';
    const [rows]=await sql`
      SELECT version
      FROM auto_sale_schema_meta
      WHERE component = ${component}
    `;
    return Number(rows[0]?.version||0n);
  }

  const u64=value=>new Uint64(BigInt(Math.max(0,Number(value)||0)));
  const parsePayload=value=>{try{return JSON.parse(String(value||'{}'))}catch{return{}}};

  async function replaceSnapshot(rows,{sourceRevision=0,status='backfilled'}={}){
    const now=new Date().toISOString();
    const required=[
      ['lead',rows?.leads],['quote',rows?.quotes],['order',rows?.orders],
      ['payment',rows?.payments],['note',rows?.notes],['team member',rows?.team],
      ['catalog car',rows?.catalog]
    ];
    for(const [label,list] of required){
      for(const row of Array.isArray(list)?list:[]){
        if(!String(row?.id||'').trim())throw new Error(`normalized_${label.replace(/\s+/g,'_')}_id_required`);
      }
    }

    await sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
      const [paymentKeys]=await tx`SELECT order_id,id FROM auto_sale_payments`;
      for(const row of paymentKeys)await tx`DELETE FROM auto_sale_payments WHERE order_id=${String(row.order_id)} AND id=${String(row.id)}`;

      const [noteKeys]=await tx`SELECT lead_id,id FROM auto_sale_notes`;
      for(const row of noteKeys)await tx`DELETE FROM auto_sale_notes WHERE lead_id=${String(row.lead_id)} AND id=${String(row.id)}`;

      const [bindingKeys]=await tx`SELECT subject_type,subject_id FROM auto_sale_telegram_bindings`;
      for(const row of bindingKeys)await tx`DELETE FROM auto_sale_telegram_bindings WHERE subject_type=${String(row.subject_type)} AND subject_id=${String(row.subject_id)}`;

      const [quoteKeys]=await tx`SELECT id FROM auto_sale_quotes`;
      for(const row of quoteKeys)await tx`DELETE FROM auto_sale_quotes WHERE id=${String(row.id)}`;
      const [orderKeys]=await tx`SELECT id FROM auto_sale_orders`;
      for(const row of orderKeys)await tx`DELETE FROM auto_sale_orders WHERE id=${String(row.id)}`;
      const [leadKeys]=await tx`SELECT id FROM auto_sale_leads`;
      for(const row of leadKeys)await tx`DELETE FROM auto_sale_leads WHERE id=${String(row.id)}`;
      const [teamKeys]=await tx`SELECT id FROM auto_sale_team`;
      for(const row of teamKeys)await tx`DELETE FROM auto_sale_team WHERE id=${String(row.id)}`;
      const [catalogKeys]=await tx`SELECT id FROM auto_sale_catalog`;
      for(const row of catalogKeys)await tx`DELETE FROM auto_sale_catalog WHERE id=${String(row.id)}`;

      for(const row of rows.leads||[])await tx`
        UPSERT INTO auto_sale_leads (id,row_version,sort_order,status,manager,source,client_created,payload,updated_at)
        VALUES (${String(row.id)},${u64(row.rowVersion)},${u64(row.sortOrder)},${String(row.status||'')},${String(row.manager||'')},${String(row.source||'')},${Boolean(row.clientCreated)},${JSON.stringify(row.payload||{})},${String(row.updatedAt||'')})
      `;
      for(const row of rows.quotes||[])await tx`
        UPSERT INTO auto_sale_quotes (id,row_version,sort_order,lead_id,status,quote_version,payload,updated_at)
        VALUES (${String(row.id)},${u64(row.rowVersion)},${u64(row.sortOrder)},${String(row.leadId||'')},${String(row.status||'')},${u64(row.quoteVersion)},${JSON.stringify(row.payload||{})},${String(row.updatedAt||'')})
      `;
      for(const row of rows.orders||[])await tx`
        UPSERT INTO auto_sale_orders (id,row_version,sort_order,lead_id,stage,manager,risk_type,payload,updated_at)
        VALUES (${String(row.id)},${u64(row.rowVersion)},${u64(row.sortOrder)},${String(row.leadId||'')},${String(row.stage||'')},${String(row.manager||'')},${String(row.riskType||'')},${JSON.stringify(row.payload||{})},${String(row.updatedAt||'')})
      `;
      for(const row of rows.payments||[])await tx`
        UPSERT INTO auto_sale_payments (order_id,id,sort_order,amount,payment_date,method,payload,created_at)
        VALUES (${String(row.orderId||'')},${String(row.id)},${u64(row.sortOrder)},${Number(row.amount)||0},${String(row.paymentDate||'')},${String(row.method||'')},${JSON.stringify(row.payload||{})},${String(row.createdAt||'')})
      `;
      for(const row of rows.notes||[])await tx`
        UPSERT INTO auto_sale_notes (lead_id,id,sort_order,text,payload,created_at)
        VALUES (${String(row.leadId||'')},${String(row.id)},${u64(row.sortOrder)},${String(row.text||'')},${JSON.stringify(row.payload||{})},${String(row.createdAt||'')})
      `;
      for(const row of rows.team||[])await tx`
        UPSERT INTO auto_sale_team (id,row_version,sort_order,name,role,active,payload,updated_at)
        VALUES (${String(row.id)},${u64(row.rowVersion)},${u64(row.sortOrder)},${String(row.name||'')},${String(row.role||'')},${Boolean(row.active)},${JSON.stringify(row.payload||{})},${String(row.updatedAt||'')})
      `;
      for(const row of rows.catalog||[])await tx`
        UPSERT INTO auto_sale_catalog (id,row_version,sort_order,origin,active,auction_date,payload,updated_at)
        VALUES (${String(row.id)},${u64(row.rowVersion)},${u64(row.sortOrder)},${String(row.origin||'')},${Boolean(row.active)},${String(row.auctionDate||'')},${JSON.stringify(row.payload||{})},${String(row.updatedAt||'')})
      `;
      for(const row of rows.telegramBindings||[])await tx`
        UPSERT INTO auto_sale_telegram_bindings (subject_type,subject_id,telegram_user_id,username,first_name,last_name,linked_at,updated_at)
        VALUES (${String(row.subjectType||'')},${String(row.subjectId||'')},${String(row.telegramUserId||'')},${String(row.username||'')},${String(row.firstName||'')},${String(row.lastName||'')},${String(row.linkedAt||'')},${now})
      `;

      const metaId=u64(1),revision=u64(sourceRevision),schema=u64(AUTO_SALE_DOMAIN_SCHEMA_VERSION);
      await tx`
        UPSERT INTO auto_sale_state_meta (id,compat_revision,schema_version,migration_status,source_revision,updated_at)
        VALUES (${metaId},${revision},${schema},${String(status)},${revision},${now})
      `;
    });
  }

  const mapDomainSets=sets=>{
    const rows=index=>Array.isArray(sets?.[index])?sets[index]:[];
    return{
      leads:rows(0).map(row=>({id:String(row.id),rowVersion:Number(row.row_version||0n),sortOrder:Number(row.sort_order||0n),status:String(row.status||''),manager:String(row.manager||''),source:String(row.source||''),clientCreated:Boolean(row.client_created),payload:parsePayload(row.payload),updatedAt:String(row.updated_at||'')})),
      quotes:rows(1).map(row=>({id:String(row.id),rowVersion:Number(row.row_version||0n),sortOrder:Number(row.sort_order||0n),leadId:String(row.lead_id||''),status:String(row.status||''),quoteVersion:Number(row.quote_version||0n),payload:parsePayload(row.payload),updatedAt:String(row.updated_at||'')})),
      orders:rows(2).map(row=>({id:String(row.id),rowVersion:Number(row.row_version||0n),sortOrder:Number(row.sort_order||0n),leadId:String(row.lead_id||''),stage:String(row.stage||''),manager:String(row.manager||''),riskType:String(row.risk_type||''),payload:parsePayload(row.payload),updatedAt:String(row.updated_at||'')})),
      payments:rows(3).map(row=>({orderId:String(row.order_id||''),id:String(row.id),sortOrder:Number(row.sort_order||0n),amount:Number(row.amount)||0,paymentDate:String(row.payment_date||''),method:String(row.method||''),payload:parsePayload(row.payload),createdAt:String(row.created_at||'')})),
      notes:rows(4).map(row=>({leadId:String(row.lead_id||''),id:String(row.id),sortOrder:Number(row.sort_order||0n),text:String(row.text||''),payload:parsePayload(row.payload),createdAt:String(row.created_at||'')})),
      team:rows(5).map(row=>({id:String(row.id),rowVersion:Number(row.row_version||0n),sortOrder:Number(row.sort_order||0n),name:String(row.name||''),role:String(row.role||''),active:Boolean(row.active),payload:parsePayload(row.payload),updatedAt:String(row.updated_at||'')})),
      catalog:rows(6).map(row=>({id:String(row.id),rowVersion:Number(row.row_version||0n),sortOrder:Number(row.sort_order||0n),origin:String(row.origin||''),active:Boolean(row.active),auctionDate:String(row.auction_date||''),payload:parsePayload(row.payload),updatedAt:String(row.updated_at||'')})),
      telegramBindings:rows(7).map(row=>({subjectType:String(row.subject_type||''),subjectId:String(row.subject_id||''),telegramUserId:String(row.telegram_user_id||''),username:String(row.username||''),firstName:String(row.first_name||''),lastName:String(row.last_name||''),linkedAt:String(row.linked_at||''),updatedAt:String(row.updated_at||'')}))
    };
  };

  async function loadRows(){
    const sets=await sql`
      SELECT id,row_version,sort_order,status,manager,source,client_created,payload,updated_at FROM auto_sale_leads;
      SELECT id,row_version,sort_order,lead_id,status,quote_version,payload,updated_at FROM auto_sale_quotes;
      SELECT id,row_version,sort_order,lead_id,stage,manager,risk_type,payload,updated_at FROM auto_sale_orders;
      SELECT order_id,id,sort_order,amount,payment_date,method,payload,created_at FROM auto_sale_payments;
      SELECT lead_id,id,sort_order,text,payload,created_at FROM auto_sale_notes;
      SELECT id,row_version,sort_order,name,role,active,payload,updated_at FROM auto_sale_team;
      SELECT id,row_version,sort_order,origin,active,auction_date,payload,updated_at FROM auto_sale_catalog;
      SELECT subject_type,subject_id,telegram_user_id,username,first_name,last_name,linked_at,updated_at FROM auto_sale_telegram_bindings;
    `;
    return mapDomainSets(sets);
  }

  async function loadReadSnapshot(){
    const stateId=u64(1);
    const sets=await sql`
      SELECT revision,payload FROM auto_sale_state WHERE id=${stateId};
      SELECT compat_revision,schema_version,migration_status,source_revision,updated_at FROM auto_sale_state_meta WHERE id=${stateId};
      SELECT id,row_version,sort_order,status,manager,source,client_created,payload,updated_at FROM auto_sale_leads;
      SELECT id,row_version,sort_order,lead_id,status,quote_version,payload,updated_at FROM auto_sale_quotes;
      SELECT id,row_version,sort_order,lead_id,stage,manager,risk_type,payload,updated_at FROM auto_sale_orders;
      SELECT order_id,id,sort_order,amount,payment_date,method,payload,created_at FROM auto_sale_payments;
      SELECT lead_id,id,sort_order,text,payload,created_at FROM auto_sale_notes;
      SELECT id,row_version,sort_order,name,role,active,payload,updated_at FROM auto_sale_team;
      SELECT id,row_version,sort_order,origin,active,auction_date,payload,updated_at FROM auto_sale_catalog;
      SELECT subject_type,subject_id,telegram_user_id,username,first_name,last_name,linked_at,updated_at FROM auto_sale_telegram_bindings;
    `;
    const stateRow=sets?.[0]?.[0];
    const empty={initialized:false,leads:[],quotes:[],orders:[],notes:{},team:[],catalog:[]};
    let payload={...empty};
    try{payload={...empty,...JSON.parse(String(stateRow?.payload||'{}'))}}catch{}
    const legacy={...payload,revision:Number(stateRow?.revision||0n),initialized:Boolean(payload.initialized||payload.leads?.length)};
    const metaRow=sets?.[1]?.[0];
    const meta=metaRow?{
      compatRevision:Number(metaRow.compat_revision||0n),
      schemaVersion:Number(metaRow.schema_version||0n),
      migrationStatus:String(metaRow.migration_status||''),
      sourceRevision:Number(metaRow.source_revision||0n),
      updatedAt:String(metaRow.updated_at||'')
    }:null;
    return{legacy,meta,rows:mapDomainSets(sets.slice(2))};
  }

  async function loadAuthoritativeSnapshot(){
    const stateId=u64(1);
    const sets=await readQuery(()=>sql`
      SELECT compat_revision,schema_version,migration_status,source_revision,updated_at FROM auto_sale_state_meta WHERE id=${stateId};
      SELECT id,row_version,sort_order,status,manager,source,client_created,payload,updated_at FROM auto_sale_leads;
      SELECT id,row_version,sort_order,lead_id,status,quote_version,payload,updated_at FROM auto_sale_quotes;
      SELECT id,row_version,sort_order,lead_id,stage,manager,risk_type,payload,updated_at FROM auto_sale_orders;
      SELECT order_id,id,sort_order,amount,payment_date,method,payload,created_at FROM auto_sale_payments;
      SELECT lead_id,id,sort_order,text,payload,created_at FROM auto_sale_notes;
      SELECT id,row_version,sort_order,name,role,active,payload,updated_at FROM auto_sale_team;
      SELECT id,row_version,sort_order,origin,active,auction_date,payload,updated_at FROM auto_sale_catalog;
      SELECT subject_type,subject_id,telegram_user_id,username,first_name,last_name,linked_at,updated_at FROM auto_sale_telegram_bindings;
    `,'authoritative-snapshot');
    const metaRow=sets?.[0]?.[0];
    const meta=metaRow?{
      compatRevision:Number(metaRow.compat_revision||0n),
      schemaVersion:Number(metaRow.schema_version||0n),
      migrationStatus:String(metaRow.migration_status||''),
      sourceRevision:Number(metaRow.source_revision||0n),
      updatedAt:String(metaRow.updated_at||'')
    }:null;
    return{meta,rows:mapDomainSets(sets.slice(1))};
  }

  async function loadState(){
    const snapshot=await loadAuthoritativeSnapshot();
    const revision=Number(snapshot.meta?.sourceRevision??snapshot.meta?.compatRevision)||0;
    return domainRowsToLegacyState(snapshot.rows,{
      revision,
      initialized:Boolean(
        (snapshot.rows.leads||[]).length||
        (snapshot.rows.quotes||[]).length||
        (snapshot.rows.orders||[]).length||
        (snapshot.rows.team||[]).length||
        (snapshot.rows.catalog||[]).length
      )
    });
  }

  async function migrationMeta(){
    const id=u64(1);
    const [rows]=await sql`SELECT compat_revision,schema_version,migration_status,source_revision,updated_at FROM auto_sale_state_meta WHERE id=${id}`;
    const row=rows[0];
    return row?{
      compatRevision:Number(row.compat_revision||0n),
      schemaVersion:Number(row.schema_version||0n),
      migrationStatus:String(row.migration_status||''),
      sourceRevision:Number(row.source_revision||0n),
      updatedAt:String(row.updated_at||'')
    }:null;
  }

  async function entityRowVersion(resource,id){
    const key=String(id||'').trim();
    if(!key)return null;
    let rows=[];
    if(resource==='lead')[rows]=await sql`SELECT row_version FROM auto_sale_leads WHERE id=${key}`;
    else if(resource==='quote')[rows]=await sql`SELECT row_version FROM auto_sale_quotes WHERE id=${key}`;
    else if(resource==='order')[rows]=await sql`SELECT row_version FROM auto_sale_orders WHERE id=${key}`;
    else if(resource==='team')[rows]=await sql`SELECT row_version FROM auto_sale_team WHERE id=${key}`;
    else if(resource==='catalog')[rows]=await sql`SELECT row_version FROM auto_sale_catalog WHERE id=${key}`;
    else throw new Error('unsupported_entity_resource');
    return rows[0]?Number(rows[0].row_version||0n):null;
  }

  async function counts(){
    const result={};
    const queries=[
      ['auto_sale_leads',()=>sql`SELECT COUNT(*) AS count FROM auto_sale_leads`],
      ['auto_sale_quotes',()=>sql`SELECT COUNT(*) AS count FROM auto_sale_quotes`],
      ['auto_sale_orders',()=>sql`SELECT COUNT(*) AS count FROM auto_sale_orders`],
      ['auto_sale_payments',()=>sql`SELECT COUNT(*) AS count FROM auto_sale_payments`],
      ['auto_sale_notes',()=>sql`SELECT COUNT(*) AS count FROM auto_sale_notes`],
      ['auto_sale_team',()=>sql`SELECT COUNT(*) AS count FROM auto_sale_team`],
      ['auto_sale_catalog',()=>sql`SELECT COUNT(*) AS count FROM auto_sale_catalog`],
      ['auto_sale_telegram_bindings',()=>sql`SELECT COUNT(*) AS count FROM auto_sale_telegram_bindings`]
    ];
    for(const [name,run] of queries){
      const [rows]=await run();
      result[name]=Number(rows[0]?.count||0n);
    }
    return result;
  }

  async function close(){driver.close()}

  return{sql,schemaVersion,replaceSnapshot,loadRows,loadReadSnapshot,loadAuthoritativeSnapshot,loadState,migrationMeta,entityRowVersion,counts,close};
}
