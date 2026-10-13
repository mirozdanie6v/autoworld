import {createPostgresRuntimeStores} from '../../server/postgres-runtime-store.mjs';

export async function testDatabase(url){
  if(url)return{createStores:(options={})=>createPostgresRuntimeStores({databaseUrl:url,...options}),finish:async()=>{}};
  // Local SQL verification uses PostgreSQL's WASM engine; CI supplies a real multi-connection PostgreSQL service.
  const {PGlite}=await import('@electric-sql/pglite');
  const db=new PGlite();
  await db.waitReady;
  let last=Promise.resolve();
  async function connect(){
    const before=last;
    let unlock;
    last=new Promise(resolve=>{unlock=resolve});
    await before;
    let released=false;
    return{
      query:async(sql,params=[])=>sql.includes('CREATE TABLE')?(await db.exec(sql)).at(-1):db.query(sql,params),
      release:()=>{if(!released){released=true;unlock()}}
    };
  }
  const pool={connect,query:async(sql,params)=>{const client=await connect();try{return await client.query(sql,params)}finally{client.release()}},end:async()=>{}};
  return{createStores:(options={})=>createPostgresRuntimeStores({pool,...options}),finish:()=>db.close()};
}
