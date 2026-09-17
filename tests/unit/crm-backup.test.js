import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sealBackup,openBackup,writeExclusive,readBackupInput} from '../../scripts/lib/crm-backup.mjs';
import {inspectSql} from '../../scripts/lib/crm-recovery.mjs';
import {mkdtemp,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sql=['0001_create_jobs_table.sql','0002_create_job_notes_table.sql','0003_add_completed_at.sql','0015_crm.sql','0016_crm_workspace.sql','0017_crm_reliability.sql','0018_crm_undated_tasks.sql','0019_crm_saved_views.sql'].map(f=>readFileSync('migrations/'+f,'utf8')).join('\n')+`
INSERT INTO crm_tickets(id,reference,submission_key,name,email,subject,created_at,updated_at,last_inbound_at) VALUES('backup-ticket','NC-0123456789ABCDEF','backup-test','Synthetic Customer','backup@example.com','Preserve this enquiry','2026-09-15','2026-09-15','2026-09-15');
INSERT INTO crm_messages(id,ticket_id,kind,author,body,full_body,created_at,updated_at) VALUES('backup-message','backup-ticket','inbound','backup@example.com','A short reply','The complete original conversation.','2026-09-15','2026-09-15');`;
const passphrase='A synthetic test backup passphrase';
test('encrypted backup authenticates a complete CRM schema and verifies restored rows',async()=>{
  const encrypted=await sealBackup(sql,passphrase);assert(!encrypted.includes(Buffer.from('CREATE TABLE')));
  const restored=await openBackup(encrypted,passphrase);assert.equal(restored.sql,sql);assert.equal(restored.metadata.integrity,'ok');assert(restored.metadata.tables.some(t=>t.name==='crm_sync_items'));assert.equal(restored.metadata.tables.find(t=>t.name==='crm_messages').rows,1);
  await assert.rejects(openBackup(encrypted,'A different test passphrase'),/verification failed/);
  const modified=Buffer.from(encrypted);modified[modified.length-10]^=1;await assert.rejects(openBackup(modified,passphrase),/verification failed/);
  await assert.rejects(sealBackup(sql,'short'),/16 and 1024/);
});
test('recovery rejects orphan data and SQL that could access external files',()=>{
  assert.throws(()=>inspectSql(sql+"\nINSERT INTO crm_messages(id,ticket_id,kind,author,body,created_at,updated_at) VALUES('orphan','missing','inbound','test','test','now','now');"));
  for(const suffix of ["ATTACH DATABASE ':memory:' AS other;","PRAGMA writable_schema=ON;","SELECT load_extension('unsafe');","CREATE VIRTUAL TABLE unsafe USING fts5(text);"])assert.throws(()=>inspectSql(sql+'\n'+suffix));
});
test('backup outputs cannot overwrite an existing file',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'nc-crm-backup-test-'));const file=join(directory,'test.nccrm');
  try{await writeExclusive(file,Buffer.from('original'));await assert.rejects(writeExclusive(file,Buffer.from('replacement')),/EEXIST/);assert.equal((await readBackupInput(file)).toString(),'original');}
  finally{await rm(file,{force:true});await rmdir(directory);}
});
