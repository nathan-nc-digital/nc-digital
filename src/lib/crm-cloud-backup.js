import {acquireLock,releaseLock,stateGet,stateSet} from './crm.js';

const MAX_BYTES=32*1024*1024;
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const schemaSql="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name";
function literal(value){
  if(value===null)return 'NULL';
  if(typeof value==='number'){if(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))throw Error('Unsupported backup number');return String(value);}
  if(typeof value==='string')return value.includes('\0')?"CAST(X'"+Array.from(new TextEncoder().encode(value),b=>b.toString(16).padStart(2,'0')).join('')+"' AS TEXT)":"'"+value.replaceAll("'","''")+"'";
  if(Array.isArray(value)||value instanceof Uint8Array)return "X'"+Array.from(value,b=>{if(!Number.isInteger(b)||b<0||b>255)throw Error('Invalid blob');return b.toString(16).padStart(2,'0');}).join('')+"'";
  throw Error('Unsupported backup value');
}

// All table reads run in one D1 batch transaction: no mixed-time customer records.
export async function databaseSnapshot(db,at=new Date().toISOString()){
  const schema=(await db.prepare(schemaSql).all()).results;
  if(schema.some(s=>/CREATE VIRTUAL TABLE/i.test(s.sql)))throw Error('Virtual tables need native D1 export');
  const tables=schema.filter(s=>s.type==='table');
  if(!tables.some(t=>t.name==='crm_tickets')||tables.length>100)throw Error('Unexpected backup schema');
  const hasSequence=Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").first());
  const result=await db.batch([db.prepare(schemaSql),...tables.map(t=>db.prepare('SELECT * FROM '+quote(t.name))),...(hasSequence?[db.prepare('SELECT name,seq FROM sqlite_sequence')]:[])]);
  if(JSON.stringify(result[0].results)!==JSON.stringify(schema))throw Error('Schema changed during backup');
  const parts=['PRAGMA foreign_keys=OFF;','BEGIN TRANSACTION;',...tables.map(t=>t.sql+';')],counts=[];
  let bytes=parts.reduce((n,s)=>n+new TextEncoder().encode(s).length,0);
  for(let i=0;i<tables.length;i++){
    const rows=result[i+1].results;if(!Array.isArray(rows))throw Error('Incomplete backup response');
    counts.push({name:tables[i].name,rows:rows.length});
    for(const row of rows){const columns=Object.keys(row);const sql='INSERT INTO '+quote(tables[i].name)+'('+columns.map(quote).join(',')+') VALUES('+columns.map(c=>literal(row[c])).join(',')+');';bytes+=new TextEncoder().encode(sql).length;if(bytes>MAX_BYTES)throw Error('Backup exceeds safe size');parts.push(sql);}
  }
  if(hasSequence){parts.push('DELETE FROM sqlite_sequence;');for(const row of result.at(-1).results)parts.push('INSERT INTO sqlite_sequence(name,seq) VALUES('+literal(row.name)+','+literal(row.seq)+');');}
  parts.push(...schema.filter(s=>s.type!=='table').map(s=>s.sql+';'),'COMMIT;','PRAGMA foreign_keys=ON;');
  const sql=parts.join('\n'),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sql));
  return {format:'nc-digital-sql-v1',created_at:at,sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''),tables:counts,sql};
}

export async function runCloudBackup(env,{force=false}={}){
  if(!env.CRM_BACKUPS||!env.JOBS_DB)return;
  const db=env.JOBS_DB,at=new Date().toISOString(),day=at.slice(0,10);
  if(!force&&(await stateGet(db,'backup_last_success')).slice(0,10)===day)return;
  const attempted=await stateGet(db,'backup_last_attempt');
  if(attempted&&Date.now()-Date.parse(attempted)<(force?60000:3600000))return;
  const lock=await acquireLock(db,'backup_lock',600);if(!lock)return;
  let phase='snapshot';
  try{
    await stateSet(db,'backup_last_attempt',at);
    const snapshot=await databaseSnapshot(db,at),key='daily/'+day+'.json.gz';
    const body=new Blob([JSON.stringify(snapshot)]).stream().pipeThrough(new CompressionStream('gzip'));
    // R2 requires a known-length body; CompressionStream alone has no length.
    const compressed=await new Response(body).arrayBuffer();phase='storage';
    await env.CRM_BACKUPS.put(key,compressed,{httpMetadata:{contentType:'application/gzip'},customMetadata:{created_at:at,sha256:snapshot.sha256,format:snapshot.format}});
    phase='verification';
    const saved=await env.CRM_BACKUPS.head(key);if(!saved||saved.customMetadata?.sha256!==snapshot.sha256)throw Error('Backup verification failed');
    await stateSet(db,'backup_last_success',at);await stateSet(db,'backup_last_key',key);await stateSet(db,'backup_error','');
    console.log(JSON.stringify({event:'crm_backup_complete',tables:snapshot.tables.length}));
  }catch(error){
    const reason=/known length/i.test(error.message)?'body length':/too many/i.test(error.message)?'runtime limit':/schema/i.test(error.message)?'schema check':/authorization|not authorized/i.test(error.message)?'storage permission':error.name;
    await stateSet(db,'backup_error','The daily cloud backup failed during '+phase+' ('+reason+'). Check Cloudflare logs and retry.');
    console.error(JSON.stringify({event:'crm_backup_failed',phase,reason}));
  }finally{await releaseLock(db,'backup_lock',lock);}
}
