import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {crmDatabase} from '../helpers/crm-db.mjs';
import {databaseSnapshot,runCloudBackup} from '../../src/lib/crm-cloud-backup.js';
import {restoredDatabase} from '../../scripts/lib/crm-recovery.mjs';
import {handleWorkspace} from '../../src/lib/crm-workspace.js';
function database(t){const db=crmDatabase(t);db.batch=async statements=>{db.sqlite.exec('BEGIN');try{const result=statements.map(s=>({results:s.__sql?db.sqlite.prepare(s.__sql).all(...s.args):[]}));db.sqlite.exec('COMMIT');return result;}catch(e){db.sqlite.exec('ROLLBACK');throw e;}};const prepare=db.prepare.bind(db);db.prepare=sql=>Object.assign(prepare(sql),{__sql:sql});return db;}
test('cloud backup restores real schema, binary/text data, relationships and autoincrement state',async t=>{
  const db=database(t);db.sqlite.exec("CREATE TABLE backup_fixture(id INTEGER PRIMARY KEY AUTOINCREMENT, text_value TEXT, blob_value BLOB); INSERT INTO backup_fixture(id) VALUES(100); DELETE FROM backup_fixture;");
  db.sqlite.prepare('INSERT INTO backup_fixture(text_value,blob_value) VALUES(?,?)').run("Customer's £ value\0preserved",new Uint8Array([0,255,10]));
  db.sqlite.exec('UPDATE sqlite_sequence SET seq=200 WHERE name=\'backup_fixture\'');
  const backup=await databaseSnapshot(db),restored=restoredDatabase(backup.sql);t.after(()=>restored.close());
  assert.deepEqual(restored.prepare('SELECT * FROM backup_fixture').get(),db.sqlite.prepare('SELECT * FROM backup_fixture').get());
  assert.equal(restored.prepare("SELECT seq FROM sqlite_sequence WHERE name='backup_fixture'").get().seq,200);
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
  assert(backup.tables.some(x=>x.name==='crm_tickets'));assert.equal(backup.sha256.length,64);
});
test('daily backup confirms private object, avoids duplicates and exposes failed writes for retry',async t=>{
  const db=database(t),objects=new Map();let calls=0;
  const bucket={async put(key,body,options){calls++;objects.set(key,{body:await new Response(body).arrayBuffer(),customMetadata:options.customMetadata});},async head(key){return objects.get(key);}};
  await runCloudBackup({JOBS_DB:db,CRM_BACKUPS:bucket});await runCloudBackup({JOBS_DB:db,CRM_BACKUPS:bucket});assert.equal(calls,1);
  const snapshot=JSON.parse(gunzipSync(new Uint8Array([...objects.values()][0].body)));assert.equal(snapshot.format,'nc-digital-sql-v1');
  db.sqlite.exec("DELETE FROM crm_state WHERE key IN ('backup_last_attempt','backup_last_success')");bucket.put=async()=>{throw Error('private provider details');};
  await runCloudBackup({JOBS_DB:db,CRM_BACKUPS:bucket});assert(!db.sqlite.prepare("SELECT value FROM crm_state WHERE key='backup_last_success'").get());assert(!db.sqlite.prepare("SELECT value FROM crm_state WHERE key='backup_error'").get().value.includes('private provider'));
});

test('backup controls require Nathan and same-origin writes, and downloads are private',async t=>{
  const db=database(t),origin='https://nc-digital.co.uk',base=origin+'/admin/crm/api/workspace/';
  const env={JOBS_DB:db,CRM_BACKUPS:{async get(){return {body:new Uint8Array([1,2,3])};}}};
  db.sqlite.prepare('INSERT INTO crm_state(key,value) VALUES(?,?)').run('backup_last_key','daily/2026-09-17.json.gz');
  assert.equal((await handleWorkspace(new Request(base+'backup'),env,'ben')).status,403);
  const download=await handleWorkspace(new Request(base+'backup'),env,'nathan');assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'no-store, private');assert(download.headers.get('content-disposition').includes('attachment'));
  const external=new Request(base+'backup-now',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal((await handleWorkspace(external,env,'nathan')).status,403);
});
