// Optional YDB adapter for Stage A. Deliberately not imported by the live server.
// Caller supplies a YDB query tag; no credentials, connections or migrations are
// opened implicitly. Only use with a physically isolated test YDB database.
import {Uint64} from '@ydbjs/value/primitive';

export const ADS_ATTRIBUTION_TABLES=[
  'awg_ads_campaigns',
  'awg_ads_subjects',
  'awg_ads_events'
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
        return {recorded:true};
      });
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
        return {recorded:true};
      });
    },
    async eraseSubjects({subjectKeys,maxEventsPerSubject=1000}={}){
      if(!Array.isArray(subjectKeys)||subjectKeys.length<1||subjectKeys.length>3
        ||subjectKeys.some(k=>typeof k!=='string'||!/^[a-f0-9]{64}$/.test(k))
        ||!Number.isInteger(maxEventsPerSubject)||maxEventsPerSubject<1||maxEventsPerSubject>5000){
        throw new Error('invalid_ads_erasure_request');
      }
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        let deletedSubjects=0,deletedEvents=0;
        for(const subjectKey of subjectKeys){
          const [eventRows]=await tx`
            SELECT event_id FROM awg_ads_events
            WHERE subject_key=${subjectKey}
            LIMIT ${new Uint64(BigInt(maxEventsPerSubject+1))}
          `;
          if(eventRows.length>maxEventsPerSubject)throw new Error('ads_erasure_event_limit_exceeded');
          const [subjectRows]=await tx`SELECT subject_key FROM awg_ads_subjects WHERE subject_key=${subjectKey}`;
          for(const item of eventRows){
            await tx`DELETE FROM awg_ads_events WHERE event_id=${String(item.event_id)}`;
            deletedEvents++;
          }
          await tx`DELETE FROM awg_ads_subjects WHERE subject_key=${subjectKey}`;
          if(subjectRows.length)deletedSubjects++;
        }
        return {deletedSubjects,deletedEvents};
      });
    },
    async purgeExpired({eventCutoff,subjectCutoff,batchSize=100,cursor=''}={}){
      if(typeof eventCutoff!=='string'||!Number.isFinite(Date.parse(eventCutoff))
        ||typeof subjectCutoff!=='string'||!Number.isFinite(Date.parse(subjectCutoff))
        ||!Number.isInteger(batchSize)||batchSize<1||batchSize>500
        ||typeof cursor!=='string'||cursor.length>120){
        throw new Error('invalid_ads_purge_request');
      }
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [eventRows]=await tx`
          SELECT event_id FROM awg_ads_events
          WHERE occurred_at < ${eventCutoff}
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
        for(const item of expiredEvents){
          await tx`DELETE FROM awg_ads_events WHERE event_id=${String(item.event_id)}`;
        }
        for(const subject of subjectRows.slice(0,batchSize)){
          const key=String(subject.subject_key);
          const first=toTouch(subject.first_touch);
          const last=toTouch(subject.last_touch);
          if(String(subject.updated_at)<subjectCutoff){
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
