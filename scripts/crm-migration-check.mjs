// Rehearses the additive upgrade in memory. Never connects to a live database.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {restoredDatabase} from './lib/crm-recovery.mjs';
import {readBackupInput} from './lib/crm-backup.mjs';
const backup=process.argv[2];
if(backup&&!backup.endsWith('.sql'))throw Error('Supply a D1 SQL export file.');
const db=backup?restoredDatabase(new TextDecoder('utf-8',{fatal:true}).decode(await readBackupInput(backup))):new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
if(!backup){
  for(const name of ['0001_create_jobs_table.sql','0002_create_job_notes_table.sql','0003_add_completed_at.sql','0015_crm.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  db.prepare("INSERT INTO crm_tickets(id,reference,submission_key,name,email,subject,follow_up_at,created_at,updated_at,last_inbound_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('migration-fixture','NC-0123456789ABCDEF','migration-fixture','Synthetic customer','test@example.com','Migration rehearsal','2026-09-15T23:30:00Z','2026-09-15T12:00:00Z','2026-09-15T12:00:00Z','2026-09-15T12:00:00Z');
  db.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,created_at,updated_at) VALUES(?,?,'inbound',?,?,?,?)").run('migration-message','migration-fixture','test@example.com','Preserve the complete original message.','2026-09-15T12:00:00Z','2026-09-15T12:00:00Z');
}
const hasTable=name=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
const pending=[];
for(const [table,flag,file] of [['crm_accounts','workspace_schema','0016_crm_workspace.sql'],['crm_sync_items','reliability_schema','0017_crm_reliability.sql']]){
  const installed=db.prepare('SELECT value FROM crm_state WHERE key=?').get(flag)?.value==='1';
  if(hasTable(table)!==installed)throw Error('An incomplete migration needs review before rehearsal: '+file);
  if(!installed)pending.push(file);
}
const taskFlag=db.prepare("SELECT value FROM crm_state WHERE key='task_dates_schema'").get()?.value==='1';
const taskSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='crm_tasks'").get()?.sql||'';
const taskDatesInstalled=taskFlag||(!/due_date\s+TEXT\s+NOT\s+NULL/i.test(taskSql)&&taskSql.includes('crm_tasks'));
if(!taskDatesInstalled)pending.push('0018_crm_undated_tasks.sql');
const savedViewsFlag=db.prepare("SELECT value FROM crm_state WHERE key='saved_views_schema'").get()?.value==='1';
if(hasTable('crm_saved_views')!==savedViewsFlag)throw Error('An incomplete migration needs review before rehearsal: 0019_crm_saved_views.sql');
if(!savedViewsFlag)pending.push('0019_crm_saved_views.sql');
const tagsFlag=db.prepare("SELECT value FROM crm_state WHERE key='tags_schema'").get()?.value==='1';
const tagsInstalled=['crm_accounts','crm_contacts','crm_opportunities','crm_tickets'].every(name=>db.prepare(`PRAGMA table_info("${name}")`).all().some(column=>column.name==='tags'));
if(tagsInstalled!==tagsFlag)throw Error('An incomplete migration needs review before rehearsal: 0020_crm_tags.sql');
if(!tagsFlag)pending.push('0020_crm_tags.sql');
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0,'Existing foreign-key errors must be resolved before migration.');
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
function fingerprint(name,columns){const hash=createHash('sha256');let count=0;for(const row of db.prepare(`SELECT ${columns.map(c=>'"'+c.replaceAll('"','""')+'"').join(',')} FROM "${name.replaceAll('"','""')}" ORDER BY 1`).iterate()){hash.update(JSON.stringify(row));count++;}return {count,digest:hash.digest('hex')};}
const before=tables.map(({name})=>{const columns=db.prepare(`PRAGMA table_info("${name.replaceAll('"','""')}")`).all().map(c=>c.name);return {name,columns,...fingerprint(name,columns)};});
db.exec('BEGIN');
try{
  for(const file of pending)db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  for(const table of before){if(table.name==='crm_state')continue;const after=fingerprint(table.name,table.columns);assert.equal(after.count,table.count,table.name+' row count changed');assert.equal(after.digest,table.digest,table.name+' original data changed');}
  if(!backup)assert.equal(db.prepare("SELECT due_date FROM crm_tasks WHERE ticket_id='migration-fixture'").get().due_date,'2026-09-16');
  assert.equal(db.prepare("SELECT value FROM crm_state WHERE key='workspace_schema'").get().value,'1');
  assert.equal(db.prepare("SELECT value FROM crm_state WHERE key='reliability_schema'").get().value,'1');
  assert.equal(db.prepare("SELECT value FROM crm_state WHERE key='task_dates_schema'").get().value,'1');
  assert.equal(db.prepare("SELECT value FROM crm_state WHERE key='saved_views_schema'").get().value,'1');
  assert.equal(db.prepare("SELECT value FROM crm_state WHERE key='tags_schema'").get().value,'1');
  const newTables=db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count;
  db.exec('ROLLBACK');
  for(const table of before)assert.deepEqual(fingerprint(table.name,table.columns),{count:table.count,digest:table.digest},'Rollback did not preserve '+table.name);
  console.log(JSON.stringify({result:'passed',source:backup?'provided SQL export':'synthetic legacy database',migrations:pending,checks:['integrity','foreign keys','legacy row counts','legacy contents',...(!backup?['UK follow-up date migration']:[]),'transaction rollback'],original_tables:before.length,upgraded_tables:newTables},null,2));
}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
