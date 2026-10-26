// Optional YDB adapter for Stage A. Deliberately not imported by the live server.
// Caller supplies a YDB query tag; no credentials, connections or migrations are
// opened implicitly. Only use with a physically isolated test YDB database.

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
    async recordTouch({eventId,subjectKey,touch}){
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [already]=await tx`SELECT event_id FROM awg_ads_events WHERE event_id=${eventId}`;
        if(already.length)return {recorded:false};
        const [rows]=await tx`SELECT first_touch,last_touch FROM awg_ads_subjects WHERE subject_key=${subjectKey}`;
        const existing=rows[0];
        const originalFirst=existing?toTouch(existing.first_touch):null;
        const originalLast=existing?toTouch(existing.last_touch):null;
        const first=originalFirst&&originalFirst.timestamp<=touch.timestamp?originalFirst:touch;
        const last=originalLast&&originalLast.timestamp>touch.timestamp?originalLast:touch;
        await tx`
          UPSERT INTO awg_ads_subjects (subject_key,first_touch,last_touch,updated_at)
          VALUES (${subjectKey},${JSON.stringify(first)},${JSON.stringify(last)},${touch.timestamp})
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
        const [existing]=await tx`SELECT event_id FROM awg_ads_events WHERE event_id=${event.eventId}`;
        if(existing.length)return {recorded:false};
        await tx`
          UPSERT INTO awg_ads_events
            (event_id,subject_key,event_type,campaign_id,ad_id,creative_id,occurred_at)
          VALUES
            (${event.eventId},${event.subjectKey},${event.eventType},
             ${event.campaignId},${event.adId},${event.creativeId},${event.occurredAt})
        `;
        return {recorded:true};
      });
    }
  };
}
