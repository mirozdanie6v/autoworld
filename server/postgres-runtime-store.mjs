import pg from 'pg';
import {buildDomainDiff,summarizeDomainDiff} from './ydb-domain-dual-write.mjs';
import {domainRowsToLegacyState} from './ydb-domain-migration.mjs';
import {validateRecoveryBackup} from './migration-backup.mjs';

const {Pool}=pg;
const kinds=['leads','quotes','orders','payments','notes','team','catalog','telegramBindings'];
const resources={lead:'leads',quote:'quotes',order:'orders',team:'team',catalog:'catalog'};
const empty=()=>({initialized:false,leads:[],quotes:[],orders:[],notes:{},team:[],catalog:[]});
const owner=(kind,row)=>String(kind==='payments'?row.orderId:kind==='notes'?row.leadId:kind==='telegramBindings'?row.subjectType:'');
const rowId=(kind,row)=>String(kind==='telegramBindings'?row.subjectId:row.id);
const identity=row=>({username:row.username,telegramUserId:row.telegram_user_id,linkedAt:row.linked_at,lastSeenAt:row.last_seen_at});

export const POSTGRES_RUNTIME_SCHEMA=`
CREATE TABLE IF NOT EXISTS awg_domain_meta (
  id integer PRIMARY KEY CHECK(id=1), source_revision bigint NOT NULL CHECK(source_revision>=0),
  schema_version integer NOT NULL, migration_status text NOT NULL, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS awg_domain_rows (
  kind text NOT NULL CHECK(kind IN ('leads','quotes','orders','payments','notes','team','catalog','telegramBindings')),
  owner_id text NOT NULL DEFAULT '', id text NOT NULL CHECK(id<>''), row_version bigint NOT NULL CHECK(row_version>=0),
  sort_order bigint NOT NULL DEFAULT 0, document jsonb NOT NULL,
  PRIMARY KEY(kind,owner_id,id)
);
CREATE TABLE IF NOT EXISTS awg_compat_state (id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS awg_admin_access (
  username text PRIMARY KEY, telegram_user_id text NOT NULL UNIQUE, linked_at text NOT NULL, last_seen_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS awg_notification_outbox (
  id text PRIMARY KEY, status text NOT NULL, payload jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0,
  next_attempt_at text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL,
  last_error text NOT NULL DEFAULT '', message_id text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS awg_outbox_due ON awg_notification_outbox(next_attempt_at,created_at,id)
  WHERE status IN ('pending','retry','processing');
`;

export async function createPostgresRuntimeStores({databaseUrl,pool:suppliedPool,ensureSchema=false}={}){
  if(!suppliedPool&&!databaseUrl)throw new Error('DATABASE_URL is required');
  const pool=suppliedPool||new Pool({connectionString:databaseUrl,max:8,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,statement_timeout:15000});
  if(!suppliedPool)pool.on('error',error=>console.error('AUTO SALE PostgreSQL pool error',error.code||'connection_error'));
  let closed=false;
  async function transaction(run,begin='BEGIN'){
    const db=await pool.connect();
    try{
      await db.query(begin);
      const result=await run(db);
      await db.query('COMMIT');
      return result;
    }catch(error){
      try{await db.query('ROLLBACK')}catch(rollbackError){console.error('PostgreSQL rollback failed',rollbackError.code||'rollback_error')}
      throw error;
    }finally{db.release()}
  }
  if(ensureSchema){
    await transaction(async db=>{
      await db.query(POSTGRES_RUNTIME_SCHEMA);
      await db.query('INSERT INTO awg_domain_meta VALUES(1,0,1,$1,$2) ON CONFLICT(id) DO NOTHING',['empty',new Date().toISOString()]);
      await db.query('INSERT INTO awg_compat_state VALUES(1,0,$1) ON CONFLICT(id) DO NOTHING',[empty()]);
    });
  }
  function decodeSnapshot(result){
    const row=result.rows[0];
    if(!row)throw Object.assign(new Error('normalized_state_meta_missing'),{statusCode:503});
    const rows=Object.fromEntries(kinds.map(kind=>[kind,[]]));
    for(const item of row.documents||[]){
      rows[item.kind].push({...item.document,rowVersion:Number(item.row_version)});
    }
    return{meta:{sourceRevision:Number(row.source_revision),compatRevision:Number(row.source_revision),schemaVersion:row.schema_version,migrationStatus:row.migration_status,updatedAt:row.updated_at},rows};
  }
  async function snapshot(db=pool){
    // One statement keeps metadata, rows and row versions in the same MVCC snapshot.
    return decodeSnapshot(await db.query(`SELECT m.*,COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'kind',r.kind,'document',r.document,'row_version',r.row_version) ORDER BY r.sort_order,r.id)
      FROM awg_domain_rows r),'[]'::jsonb) AS documents FROM awg_domain_meta m WHERE m.id=1`));
  }
  const stateOf=s=>domainRowsToLegacyState(s.rows,{revision:s.meta.sourceRevision,initialized:kinds.some(kind=>s.rows[kind].length>0)});
  async function loadState(){return stateOf(await snapshot())}
  async function applyRows(db,kind,rows,revision,{preserveVersions=false}={}){
    for(const row of rows){
      const id=rowId(kind,row),ownerId=owner(kind,row);
      if(!id||((kind==='payments'||kind==='notes'||kind==='telegramBindings')&&!ownerId))throw new Error('domain_row_identity_required');
      const version=preserveVersions?Number(row.rowVersion??revision):revision;
      if(!Number.isSafeInteger(version)||version<0)throw new Error('invalid_row_version');
      await db.query(`INSERT INTO awg_domain_rows(kind,owner_id,id,row_version,sort_order,document) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(kind,owner_id,id) DO UPDATE SET row_version=EXCLUDED.row_version,sort_order=EXCLUDED.sort_order,document=EXCLUDED.document`,
      [kind,ownerId,id,version,Number(row.sortOrder)||0,{...row,rowVersion:version}]);
    }
  }
  async function queue(db,items,status='pending',lease=0){
    const now=new Date().toISOString(),next=new Date(Date.now()+lease).toISOString();
    for(const item of items){
      const id=String(item.id||'').trim();if(!id)throw new Error('notification_id_required');
      await db.query(`INSERT INTO awg_notification_outbox(id,status,payload,attempts,next_attempt_at,created_at,updated_at)
        VALUES($1,$2,$3,0,$4,$5,$5) ON CONFLICT(id) DO NOTHING`,[id,status,item,next,now]);
    }
    return items.map(item=>String(item.id));
  }
  async function commitDomainState(previous,next,{expectedRevision=null,notifications=[]}={}){
    return transaction(async db=>{
      const locked=await db.query('SELECT source_revision FROM awg_domain_meta WHERE id=1 FOR UPDATE');
      if(!locked.rows.length)return{status:503,data:{error:'normalized_state_meta_missing'}};
      const current=Number(locked.rows[0].source_revision);
      if(expectedRevision===null||!Number.isSafeInteger(Number(expectedRevision)))throw new Error('expected_revision_required');
      if(Number(expectedRevision)!==current)return{status:409,data:{error:'revision_conflict',currentRevision:current}};
      // Diff against the locked database state, never a caller-supplied stale snapshot.
      const stored=stateOf(await snapshot(db)),revision=current+1;
      const diff=buildDomainDiff(stored,{...next,revision});
      for(const kind of kinds){
        for(const row of diff.changes[kind].deletes)await db.query('DELETE FROM awg_domain_rows WHERE kind=$1 AND owner_id=$2 AND id=$3',[kind,owner(kind,row),rowId(kind,row)]);
        await applyRows(db,kind,diff.changes[kind].upserts,revision);
      }
      const at=new Date().toISOString();
      await db.query('UPDATE awg_domain_meta SET source_revision=$1,migration_status=$2,updated_at=$3 WHERE id=1',[revision,'postgres-authoritative',at]);
      await db.query('UPDATE awg_compat_state SET revision=$1,payload=$2 WHERE id=1',[revision,{...empty(),...next,revision,initialized:true}]);
      await queue(db,notifications,'processing',60000);
      return{status:200,data:{ok:true,revision,normalizedAuthoritative:true,domainDiff:summarizeDomainDiff(diff),notifications:{queued:notifications.length,ids:notifications.map(x=>x.id)}}};
    });
  }
  async function replaceState(next,options){return commitDomainState(null,next,options)}
  async function claimNotifications({limit=50,ids=null,lease=120000}={}){
    return transaction(async db=>{
      const now=new Date().toISOString();
      const wanted=ids?[...new Set(ids.map(String))].slice(0,50):null;
      const result=await db.query(`SELECT * FROM awg_notification_outbox
        WHERE status IN ('pending','retry','processing') AND next_attempt_at<=$1 AND ($2::text[] IS NULL OR id=ANY($2))
        ORDER BY created_at,id LIMIT $3 FOR UPDATE SKIP LOCKED`,[now,wanted,Math.min(100,Math.max(1,Number(limit)||50))]);
      const expiry=new Date(Date.now()+lease).toISOString();
      for(const row of result.rows)await db.query('UPDATE awg_notification_outbox SET status=$1,next_attempt_at=$2 WHERE id=$3',['processing',expiry,row.id]);
      return result.rows.map(row=>({...row.payload,id:row.id,status:row.status,attempts:row.attempts}));
    });
  }
  const notificationView=row=>({id:row.id,status:row.status,event:row.payload.event,target:row.payload.target,leadId:row.payload.leadId,
    quoteId:row.payload.quoteId,orderId:row.payload.orderId,paymentId:row.payload.paymentId,messageId:row.message_id,error:row.last_error,attempts:row.attempts});
  async function notificationStatus(ids=[]){return(await pool.query('SELECT * FROM awg_notification_outbox WHERE id=ANY($1::text[])',[ids.map(String)])).rows.map(notificationView)}
  async function markNotification(id,{ok,messageId='',error='',attempts=0,permanent=false}={}){
    const count=(Number(attempts)||0)+1,delay=Math.min(3600,Math.max(5,5*2**Math.min(count-1,8)));
    const now=new Date().toISOString(),next=new Date(Date.now()+delay*1000).toISOString();
    await pool.query(`UPDATE awg_notification_outbox SET status=$1,attempts=$2,next_attempt_at=$3,updated_at=$4,last_error=$5,message_id=$6 WHERE id=$7`,
      [ok?'sent':permanent||count>=8?'dead':'retry',count,ok||permanent?now:next,now,String(error),String(messageId),String(id)]);
  }
  async function adminAccessList(){return(await pool.query('SELECT * FROM awg_admin_access ORDER BY username')).rows.map(identity)}
  async function adminAccessByUserId(id){const row=(await pool.query('SELECT * FROM awg_admin_access WHERE telegram_user_id=$1',[String(id||'').trim()])).rows[0];return row?identity(row):null}
  async function adminAccessByUsername(username){const row=(await pool.query('SELECT * FROM awg_admin_access WHERE username=$1',[String(username||'').trim().replace(/^@/,'').toLowerCase()])).rows[0];return row?identity(row):null}
  async function claimAdminAccess(username,userId){
    const name=String(username||'').trim().replace(/^@/,'').toLowerCase(),id=String(userId||'').trim();
    if(!name||!/^\d+$/.test(id))return{ok:false,error:'admin_identity_required'};
    return transaction(async db=>{
      // The meta lock also serializes first claims before an identity row exists.
      await db.query('SELECT id FROM awg_domain_meta WHERE id=1 FOR UPDATE');
      const records=(await db.query('SELECT * FROM awg_admin_access WHERE username=$1 OR telegram_user_id=$2',[name,id])).rows;
      if(records.some(row=>row.username===name&&row.telegram_user_id!==id))return{ok:false,error:'admin_username_already_claimed'};
      if(records.some(row=>row.telegram_user_id===id&&row.username!==name))return{ok:false,error:'admin_user_already_claimed'};
      const now=new Date().toISOString(),linkedAt=records.find(row=>row.username===name)?.linked_at||now;
      await db.query('INSERT INTO awg_admin_access VALUES($1,$2,$3,$4) ON CONFLICT(username) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at',[name,id,linkedAt,now]);
      return{ok:true,username:name,telegramUserId:id,linkedAt};
    });
  }
  async function importBackup(backup){
    validateRecoveryBackup(backup);
    return transaction(async db=>{
      const meta=(await db.query('SELECT * FROM awg_domain_meta WHERE id=1 FOR UPDATE')).rows[0];
      const count=Number((await db.query('SELECT count(*) AS n FROM awg_domain_rows')).rows[0].n);
      const controls=Number((await db.query('SELECT (SELECT count(*) FROM awg_admin_access)+(SELECT count(*) FROM awg_notification_outbox) AS n')).rows[0].n);
      if(!meta||Number(meta.source_revision)!==0||count||controls)throw new Error('restore_requires_empty_database');
      const revision=Number(backup.snapshot.meta.sourceRevision);
      for(const kind of kinds)await applyRows(db,kind,backup.snapshot.rows[kind]||[],revision,{preserveVersions:true});
      await db.query('UPDATE awg_domain_meta SET source_revision=$1,migration_status=$2,updated_at=$3 WHERE id=1',[revision,'restored-from-ydb',new Date().toISOString()]);
      const restored=stateOf(backup.snapshot);
      await db.query('UPDATE awg_compat_state SET revision=$1,payload=$2 WHERE id=1',[revision,restored]);
      for(const pin of backup.adminAccess||[])await db.query('INSERT INTO awg_admin_access VALUES($1,$2,$3,$4)',[pin.username,pin.telegramUserId,pin.linkedAt,pin.lastSeenAt]);
      for(const row of backup.outbox||[])await db.query('INSERT INTO awg_notification_outbox VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [row.id,row.status,row.payload,row.attempts,row.nextAttemptAt,row.createdAt,row.updatedAt,row.lastError||'',row.messageId||'']);
      return{revision,counts:Object.fromEntries(kinds.map(kind=>[kind,(backup.snapshot.rows[kind]||[]).length]))};
    });
  }
  async function close(){if(!closed){closed=true;await pool.end()}}
  const legacyStore={loadState,replaceState,commitDomainState,
    enqueueNotifications:items=>transaction(db=>queue(db,items)),pendingNotifications:limit=>claimNotifications({limit}),
    pendingNotificationsByIds:ids=>claimNotifications({ids,lease:60000}),markNotification,notificationStatus,
    notificationStats:async()=>Object.fromEntries((await pool.query('SELECT status,count(*) AS n FROM awg_notification_outbox GROUP BY status')).rows.map(row=>[row.status,Number(row.n)])),
    notificationStatusByRevision:async revision=>(await pool.query('SELECT * FROM awg_notification_outbox WHERE starts_with(id,$1)',[`${Math.max(0,Number(revision)||0)}:`])).rows.map(notificationView),
    recentBotCommandRecipients:async(limit=50)=>(await pool.query(`SELECT * FROM awg_notification_outbox WHERE payload->>'event'='bot_command_reply'
      AND payload->>'target'='telegram_user' AND payload->>'chatId' ~ '^[0-9]+$' ORDER BY created_at DESC LIMIT $1`,[Math.min(100,Math.max(1,Number(limit)||50))])).rows.map(row=>({...notificationView(row),chatId:row.payload.chatId,createdAt:row.created_at})),
    adminAccessByUserId,adminAccessByUsername,adminAccessList,claimAdminAccess,ping:async()=>{await pool.query('SELECT 1');return true},close,domainDualWriteEnabled:false};
  const domainStore={loadState,loadAuthoritativeSnapshot:snapshot,loadRows:async()=>(await snapshot()).rows,
    loadReadSnapshot:async()=>{const s=await snapshot();return{...s,legacy:stateOf(s)}},migrationMeta:async()=>(await snapshot()).meta,
    schemaVersion:async()=>(await snapshot()).meta.schemaVersion,
    entityRowVersion:async(resource,id)=>{const kind=resources[resource];if(!kind)throw new Error('unsupported_entity_resource');
      const row=(await pool.query('SELECT row_version FROM awg_domain_rows WHERE kind=$1 AND owner_id=$2 AND id=$3',[kind,'',String(id)])).rows[0];return row?Number(row.row_version):null},
    counts:async()=>{const s=await snapshot();return Object.fromEntries(kinds.map(kind=>[kind,s.rows[kind].length]))},close};
  return{legacyStore,domainStore,importBackup,close};
}
