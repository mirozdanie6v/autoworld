import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {MetadataCredentialsProvider} from '@ydbjs/auth/metadata';
import {Uint64} from '@ydbjs/value/primitive';

const TABLE='auto_sale_visitor_events_v1';
// Own YDB database only. Never write into the application's business-domain database.
export async function createVisitorAnalyticsStore({connectionString,credentialsProvider=new MetadataCredentialsProvider()}){
  if(!connectionString)throw new Error('visitor_analytics_ydb_required');
  const driver=new Driver(connectionString,{credentialsProvider});
  await driver.ready();
  const sql=query(driver);
  try{
    await sql`CREATE TABLE IF NOT EXISTS auto_sale_visitor_events_v1 (
      event_day Utf8 NOT NULL,
      event_id Utf8 NOT NULL,
      event_at Utf8 NOT NULL,
      event_epoch Uint64 NOT NULL,
      session_id Utf8 NOT NULL,
      event_type Utf8 NOT NULL,
      car_id Utf8 NOT NULL,
      source_channel Utf8 NOT NULL,
      PRIMARY KEY (event_day, event_id)
    ) WITH (TTL = Interval("P30D") ON event_epoch AS SECONDS)`;
  }catch(error){await driver.destroy?.();throw error;}
  return{
    async writeEvents(events){
      for(const event of events){
        const epoch=new Uint64(BigInt(Math.floor(Date.parse(event.eventAt)/1000)));
        await sql`UPSERT INTO auto_sale_visitor_events_v1
          (event_day,event_id,event_at,event_epoch,session_id,event_type,car_id,source_channel)
          VALUES (${event.eventDay},${event.eventId},${event.eventAt},${epoch},${event.sessionId},${event.type},${event.carId},${event.source})`;
      }
      return{written:events.length};
    },
    async listEvents(days=7){
      const cutoff=new Date(Date.now()-Math.min(Math.max(days,1),30)*86400000).toISOString().slice(0,10);
      const [rows]=await sql`SELECT event_day,event_id,event_at,session_id,event_type,car_id,source_channel
        FROM auto_sale_visitor_events_v1 WHERE event_day >= ${cutoff}
        ORDER BY event_day DESC,event_id DESC LIMIT 10000`
        .isolation('onlineReadOnly',{allowInconsistentReads:true}).idempotent(true).timeout(7000);
      return(rows||[]).map(r=>({
        eventAt:String(r.event_at||''),sessionId:String(r.session_id||''),
        type:String(r.event_type||''),carId:String(r.car_id||''),source:String(r.source_channel||'')
      }));
    },
    async close(){await driver.destroy?.();}
  };
}
