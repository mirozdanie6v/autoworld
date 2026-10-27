// Optional YDB adapter for Stage A. Deliberately not imported by the live server.
// Caller supplies a YDB query tag; no credentials, connections or migrations are
// opened implicitly. Only use with a physically isolated test YDB database.
import {Uint64} from '@ydbjs/value/primitive';

export const ADS_ATTRIBUTION_TABLES=[
  'awg_ads_campaigns',
  'awg_ads_subjects',
  'awg_ads_events',
  'awg_ads_events_by_subject',
  'awg_ads_touches_by_subject_time',
  'awg_ads_events_by_time',
  'awg_ads_erasure_blocks'
];

export async function ensureAdsAttributionSchema(sql,{target}={}){
  if(target!=='isolated-test-database')throw new Error('ads_schema_requires_isolated_test_database');
  if(typeof sql!=='function')throw new Error('ads_ydb_sql_required');
  await sql`
    CREATE TABLE IF NOT EXISTS awg_ads_campaigns (
      token_hash Utf8 NOT NULL,
      campaign_id Utf8 NOT NULL,
      ad_id Utf8 NOT NULL,
      creative_id Utf8 NOT NULL,
      source Utf8 NOT NULL,
      active Bool NOT NULL,
      created_at Utf8 NOT NULL,
      PRIMARY KEY (token_hash)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS awg_ads_subjects (
      subject_key Utf8 NOT NULL,
      first_touch Utf8 NOT NULL,
      last_touch Utf8 NOT NULL,
      updated_at Utf8 NOT NULL,
      PRIMARY KEY (subject_key)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS awg_ads_events (
      event_id Utf8 NOT NULL,
      subject_key Utf8 NOT NULL,
      event_type Utf8 NOT NULL,
      campaign_id Utf8 NOT NULL,
      ad_id Utf8 NOT NULL,
      creative_id Utf8 NOT NULL,
      occurred_at Utf8 NOT NULL,
      PRIMARY KEY (event_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS awg_ads_events_by_subject (
      subject_key Utf8 NOT NULL,
      event_id Utf8 NOT NULL,
      occurred_at Utf8 NOT NULL,
      PRIMARY KEY (subject_key,event_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS awg_ads_touches_by_subject_time (
      subject_key Utf8 NOT NULL,
      occurred_at Utf8 NOT NULL,
      event_id Utf8 NOT NULL,
      campaign_id Utf8 NOT NULL,
      ad_id Utf8 NOT NULL,
      creative_id Utf8 NOT NULL,
      PRIMARY KEY (subject_key,occurred_at,event_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS awg_ads_events_by_time (
      occurred_at Utf8 NOT NULL,
      event_id Utf8 NOT NULL,
      subject_key Utf8 NOT NULL,
      PRIMARY KEY (occurred_at,event_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS awg_ads_erasure_blocks (
      subject_key Utf8 NOT NULL,
      blocked_at Utf8 NOT NULL,
      PRIMARY KEY (subject_key)
    )
  `;
}

function fromJson(value){
  try{return JSON.parse(String(value))}catch{return null}
}
function toTouch(value){
  const touch=fromJson(value);
  return touch&&typeof touch==='object'?touch:null;
}
export function createYdbAdsAttributionRepository(sql){
  if(typeof sql!=='function'||typeof sql.begin!=='function')throw new Error('ads_ydb_transactional_sql_required');
  return {
    async createCampaign(campaign){
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [existing]=await tx`SELECT token_hash FROM awg_ads_campaigns WHERE token_hash=${campaign.tokenHash}`;
        if(existing.length)throw new Error('duplicate_ads_token_hash');
        await tx`
          UPSERT INTO awg_ads_campaigns
            (token_hash,campaign_id,ad_id,creative_id,source,active,created_at)
          VALUES
            (${campaign.tokenHash},${campaign.campaignId},${campaign.adId},${campaign.creativeId},
             ${campaign.source},${campaign.active},${campaign.createdAt})
        `;
      });
    },
    async findCampaignByTokenHash(tokenHash){
      const [rows]=await sql`
        SELECT campaign_id,ad_id,creative_id,active
        FROM awg_ads_campaigns
        WHERE token_hash=${tokenHash}
      `;
      if(!rows.length)return null;
      const row=rows[0];
      return {
        campaignId:String(row.campaign_id),
        adId:String(row.ad_id||''),
        creativeId:String(row.creative_id||''),
        active:row.active===true
      };
    },
    async setCampaignTokenActive({tokenHash,active}){
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [rows]=await tx`SELECT token_hash FROM awg_ads_campaigns WHERE token_hash=${tokenHash}`;
        if(!rows.length)return {updated:false};
        await tx`UPDATE awg_ads_campaigns SET active=${active} WHERE token_hash=${tokenHash}`;
        return {updated:true};
      });
    },
    async recordTouch({eventId,subjectKey,touch}){
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [blocked]=await tx`SELECT subject_key FROM awg_ads_erasure_blocks WHERE subject_key=${subjectKey}`;
        if(blocked.length)return {recorded:false,blocked:true};
        const [already]=await tx`SELECT event_id,subject_key FROM awg_ads_events WHERE event_id=${eventId}`;
        if(already.length){
          if(String(already[0].subject_key)!==subjectKey)throw new Error('ads_event_id_collision');
          return {recorded:false};
        }
        const [rows]=await tx`SELECT first_touch,last_touch FROM awg_ads_subjects WHERE subject_key=${subjectKey}`;
        const existing=rows[0];
        const originalFirst=existing?toTouch(existing.first_touch):null;
        const originalLast=existing?toTouch(existing.last_touch):null;
        const first=originalFirst&&originalFirst.timestamp<=touch.timestamp?originalFirst:touch;
        const last=originalLast&&originalLast.timestamp>touch.timestamp?originalLast:touch;
        await tx`
          UPSERT INTO awg_ads_subjects (subject_key,first_touch,last_touch,updated_at)
          VALUES (${subjectKey},${JSON.stringify(first)},${JSON.stringify(last)},${last.timestamp})
        `;
        await tx`
          UPSERT INTO awg_ads_events
            (event_id,subject_key,event_type,campaign_id,ad_id,creative_id,occurred_at)
          VALUES
            (${eventId},${subjectKey},${'bot_start'},${touch.campaignId},${touch.adId},
             ${touch.creativeId},${touch.timestamp})
        `;
        await tx`UPSERT INTO awg_ads_events_by_subject (subject_key,event_id,occurred_at)
          VALUES (${subjectKey},${eventId},${touch.timestamp})`;
        await tx`UPSERT INTO awg_ads_touches_by_subject_time
          (subject_key,occurred_at,event_id,campaign_id,ad_id,creative_id)
          VALUES (${subjectKey},${touch.timestamp},${eventId},
                  ${touch.campaignId},${touch.adId},${touch.creativeId})`;
        await tx`UPSERT INTO awg_ads_events_by_time (occurred_at,event_id,subject_key)
          VALUES (${touch.timestamp},${eventId},${subjectKey})`;
        return {recorded:true};
      });
    },
    // Recovery is strictly as-of a SERVER-OWNED CRM submission timestamp.
    // Rows are indexed by subject and UTC time; never use the current lastTouch
    // to attribute a historical lead. Reject incomplete histories.
    async listBotTouchesAt({subjectKey,asOf,limit=1000}={}){
      if(!/^[a-f0-9]{64}$/.test(subjectKey)
        ||typeof asOf!=='string'||!Number.isFinite(Date.parse(asOf))
        ||!Number.isInteger(limit)||limit<1||limit>1000)
        throw new Error('invalid_ads_historical_touch_query');
      const [rows]=await sql`
        SELECT subject_key,occurred_at,event_id,campaign_id,ad_id,creative_id
        FROM awg_ads_touches_by_subject_time
        WHERE subject_key=${subjectKey} AND occurred_at <= ${asOf}
        ORDER BY subject_key,occurred_at DESC,event_id DESC
        LIMIT ${new Uint64(BigInt(limit+1))}
      `;
      if(rows.length>limit)throw new Error('ads_historical_touch_limit_reached');
      return rows.map(row=>({
        campaignId:String(row.campaign_id),adId:String(row.ad_id||''),
        creativeId:String(row.creative_id||''),timestamp:String(row.occurred_at)
      }));
    },
    async readSubject(subjectKey){
      const [rows]=await sql`
        SELECT first_touch,last_touch FROM awg_ads_subjects WHERE subject_key=${subjectKey}
      `;
      if(!rows.length)return null;
      return {
        firstTouch:toTouch(rows[0].first_touch),
        lastTouch:toTouch(rows[0].last_touch)
      };
    },
    async recordEvent(event){
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [blocked]=await tx`SELECT subject_key FROM awg_ads_erasure_blocks WHERE subject_key=${event.subjectKey}`;
        if(blocked.length)return {recorded:false,blocked:true};
        const [existing]=await tx`SELECT subject_key,event_type FROM awg_ads_events WHERE event_id=${event.eventId}`;
        if(existing.length){
          if(String(existing[0].subject_key)!==event.subjectKey||String(existing[0].event_type)!==event.eventType){
            throw new Error('ads_event_id_collision');
          }
          return {recorded:false};
        }
        await tx`
          UPSERT INTO awg_ads_events
            (event_id,subject_key,event_type,campaign_id,ad_id,creative_id,occurred_at)
          VALUES
            (${event.eventId},${event.subjectKey},${event.eventType},
             ${event.campaignId},${event.adId},${event.creativeId},${event.occurredAt})
        `;
        await tx`UPSERT INTO awg_ads_events_by_subject (subject_key,event_id,occurred_at)
          VALUES (${event.subjectKey},${event.eventId},${event.occurredAt})`;
        await tx`UPSERT INTO awg_ads_events_by_time (occurred_at,event_id,subject_key)
          VALUES (${event.occurredAt},${event.eventId},${event.subjectKey})`;
        return {recorded:true};
      });
    },
    async eraseSubjects({subjectKeys,batchSize=50,blockedAt=new Date().toISOString()}={}){
      if(!Array.isArray(subjectKeys)||!subjectKeys.length||subjectKeys.length>3
        ||subjectKeys.some(k=>typeof k!=='string'||!/^[a-f0-9]{64}$/.test(k))
        ||!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw new Error('invalid_ads_erasure_request');
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        let deletedSubjects=0,deletedEvents=0,hasMore=false;
        for(const subjectKey of subjectKeys){
          // Durable suppression is committed before any reply to the caller.
          await tx`UPSERT INTO awg_ads_erasure_blocks (subject_key,blocked_at)
            VALUES (${subjectKey},${blockedAt})`;
          const [rows]=await tx`
            SELECT subject_key,event_id,occurred_at FROM awg_ads_events_by_subject
            WHERE subject_key=${subjectKey}
            ORDER BY subject_key,event_id
            LIMIT ${new Uint64(BigInt(batchSize+1))}
          `;
          if(rows.length>batchSize)hasMore=true;
          for(const row of rows.slice(0,batchSize)){
            const eventId=String(row.event_id),occurredAt=String(row.occurred_at);
            await tx`DELETE FROM awg_ads_events WHERE event_id=${eventId}`;
            await tx`DELETE FROM awg_ads_events_by_subject WHERE subject_key=${subjectKey} AND event_id=${eventId}`;
          await tx`DELETE FROM awg_ads_touches_by_subject_time WHERE
            subject_key=${subjectKey} AND occurred_at=${occurredAt} AND event_id=${eventId}`;
            await tx`DELETE FROM awg_ads_touches_by_subject_time WHERE
              subject_key=${subjectKey} AND occurred_at=${occurredAt} AND event_id=${eventId}`;
            await tx`DELETE FROM awg_ads_events_by_time WHERE occurred_at=${occurredAt} AND event_id=${eventId}`;
            deletedEvents++;
          }
          const [subjects]=await tx`SELECT subject_key FROM awg_ads_subjects WHERE subject_key=${subjectKey}`;
          if(subjects.length){
            await tx`DELETE FROM awg_ads_subjects WHERE subject_key=${subjectKey}`;
            deletedSubjects++;
          }
        }
        return {deletedSubjects,deletedEvents,hasMore};
      });
    },
    async purgeExpired({eventCutoff,subjectCutoff,batchSize=100,cursor=''}={}){
      if(typeof eventCutoff!=='string'||!Number.isFinite(Date.parse(eventCutoff))
        ||typeof subjectCutoff!=='string'||!Number.isFinite(Date.parse(subjectCutoff))
        ||!Number.isInteger(batchSize)||batchSize<1||batchSize>500
        ||typeof cursor!=='string'||cursor.length>120)throw new Error('invalid_ads_purge_request');
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [eventRows]=await tx`
          SELECT occurred_at,event_id,subject_key FROM awg_ads_events_by_time
          WHERE occurred_at < ${eventCutoff}
          ORDER BY occurred_at,event_id
          LIMIT ${new Uint64(BigInt(batchSize+1))}
        `;
        const [subjectRows]=await tx`
          SELECT subject_key,first_touch,last_touch,updated_at FROM awg_ads_subjects
          WHERE subject_key > ${cursor}
          ORDER BY subject_key
          LIMIT ${new Uint64(BigInt(batchSize+1))}
        `;
        const expiredEvents=eventRows.slice(0,batchSize);
        let deletedSubjects=0,compactedSubjects=0;
        for(const row of expiredEvents){
          const eventId=String(row.event_id),subjectKey=String(row.subject_key),occurredAt=String(row.occurred_at);
          await tx`DELETE FROM awg_ads_events WHERE event_id=${eventId}`;
          await tx`DELETE FROM awg_ads_events_by_subject WHERE subject_key=${subjectKey} AND event_id=${eventId}`;
          await tx`DELETE FROM awg_ads_events_by_time WHERE occurred_at=${occurredAt} AND event_id=${eventId}`;
        }
        for(const row of subjectRows.slice(0,batchSize)){
          const key=String(row.subject_key),first=toTouch(row.first_touch),last=toTouch(row.last_touch);
          if(String(row.updated_at)<subjectCutoff){
            await tx`DELETE FROM awg_ads_subjects WHERE subject_key=${key}`;
            deletedSubjects++;
          }else if(first&&last&&first.timestamp<subjectCutoff){
            await tx`UPDATE awg_ads_subjects SET first_touch=${JSON.stringify(last)} WHERE subject_key=${key}`;
            compactedSubjects++;
          }
        }
        return {
          deletedEvents:expiredEvents.length,deletedSubjects,compactedSubjects,
          hasMoreEvents:eventRows.length>batchSize,
          nextCursor:subjectRows.length>batchSize?String(subjectRows[batchSize-1].subject_key):null
        };
      });
    },
    async listEvents({cursor='',limit=250}={}){
      if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('invalid_ads_event_limit');
      // event_id is the PRIMARY KEY; use keyset pagination to avoid offset scans.
      const [rows]=await sql`
        SELECT event_id,subject_key,event_type,campaign_id,ad_id,creative_id,occurred_at
        FROM awg_ads_events
        WHERE event_id > ${cursor}
        ORDER BY event_id
        LIMIT ${new Uint64(BigInt(limit+1))}
      `;
      const events=rows.slice(0,limit).map(row=>({
        eventId:String(row.event_id),subjectKey:String(row.subject_key),
        eventType:String(row.event_type),campaignId:String(row.campaign_id),
        adId:String(row.ad_id||''),creativeId:String(row.creative_id||''),
        occurredAt:String(row.occurred_at)
      }));
      return {events,nextCursor:rows.length>limit?events.at(-1).eventId:null};
    }
  };
}
