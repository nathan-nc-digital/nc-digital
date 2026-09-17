import test from 'node:test';
import assert from 'node:assert/strict';
import {crmDatabase} from '../helpers/crm-db.mjs';
import {syncZoho} from '../../src/lib/crm-zoho.js';
import {handleWorkspace} from '../../src/lib/crm-workspace.js';
import {detail} from '../../src/lib/crm-api.js';
const at='2026-09-15T10:00:00.000Z';
function fixture(t){
  const db=crmDatabase(t);
  db.sqlite.prepare("INSERT INTO crm_tickets(id,reference,submission_key,name,email,subject,created_at,updated_at,last_inbound_at) VALUES('ticket-test-123456789','NC-0123456789ABCDEF','test','Test Customer','test@example.com','Website',?,?,?)").run(at,at,at);
  return {JOBS_DB:db,CRM_ENABLED:'true',ZOHO_REGION:'eu',ZOHO_ACCOUNT_ID:'123456',ZOHO_CLIENT_ID:'test',ZOHO_CLIENT_SECRET:'test',ZOHO_REFRESH_TOKEN:'test'};
}
const message=id=>({messageId:String(id),folderId:'1',subject:'[NC-0123456789ABCDEF] Website',fromAddress:'test@example.com',receivedTime:Date.now()-1000});
function provider(t,search,content){t.mock.method(globalThis,'fetch',async(url)=>String(url).includes('/oauth/')?Response.json({access_token:'test-token'}):String(url).includes('/messages/search?')?Response.json({data:search(new URL(url))}):content(String(url)));}
const call=(env,path,body)=>handleWorkspace(new Request('https://nc-digital.co.uk/admin/crm/api/workspace/'+path,{method:body?'POST':'GET',headers:{Origin:'https://nc-digital.co.uk','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,'nathan');

test('one failed import cannot block other replies; backoff, review and manual retry persist',async t=>{
  const e=fixture(t);let fail=true,calls=0;
  provider(t,()=>[message(100),message(101)],url=>{calls++;return url.includes('/100/')&&fail?Response.json({data:{} }):Response.json({data:{content:'A useful reply'}});});
  let result=await syncZoho(e);assert.equal(result.imported,1);assert.equal(result.failed,1);
  assert.equal(e.JOBS_DB.sqlite.prepare('SELECT status FROM crm_sync_items').get().status,'retry');
  await syncZoho(e);assert.equal(calls,2,'backoff must prevent an immediate content retry');
  for(let i=0;i<4;i++){e.JOBS_DB.sqlite.exec("UPDATE crm_sync_items SET next_attempt_at='2000-01-01'");await syncZoho(e);}
  assert.equal(e.JOBS_DB.sqlite.prepare('SELECT status,attempts FROM crm_sync_items').get().status,'needs_review');
  const health=await (await call(e,'health')).json();assert.equal(health.totals[0].count,1);assert.equal(health.imports[0].attempts,5);
  assert.equal((await call(e,'retry-import',{provider_id:'100'})).status,200);assert.equal((await call(e,'retry-import',{provider_id:'100'})).status,409);
  fail=false;result=await syncZoho(e);assert.equal(result.imported,1);assert.equal(result.pending,0);
  assert.equal(e.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_messages WHERE kind='inbound'").get().n,2);
  assert.equal(e.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='retry import'").get().n,1);
});
test('a run bounds content fetches and durable pending items survive pagination',async t=>{
  const e=fixture(t);provider(t,()=>Array.from({length:30},(_,i)=>message(200+i)),()=>Response.json({data:{content:'Reply'}}));
  const result=await syncZoho(e);assert.equal(result.imported,8);assert.equal(result.pending,22);assert.equal(result.more,true);
  assert.equal(e.JOBS_DB.sqlite.prepare("SELECT value FROM crm_state WHERE key='sync_start'").get().value,'31');
});
test('new replies are discovered while an older snapshot is being scanned',async t=>{
  const e=fixture(t),starts=[];
  e.JOBS_DB.sqlite.exec("INSERT INTO crm_state(key,value) VALUES('sync_start','31'),('sync_upper','1700000000000')");
  provider(t,url=>{starts.push(url.searchParams.get('start'));return url.searchParams.get('start')==='1'?[message(300)]:[];},()=>Response.json({data:{content:'Newest reply'}}));
  assert.equal((await syncZoho(e)).imported,1);assert.deepEqual(starts,['1','31']);
});
test('a reply closes an outstanding automatic no-reply reminder',async t=>{
  const e=fixture(t);
  e.JOBS_DB.sqlite.prepare("INSERT INTO crm_tasks(id,title,ticket_id,due_date,external_key,created_at,updated_at) VALUES('auto-task','No reply after 7 days: Test Customer','ticket-test-123456789','2026-09-15','auto-no-reply:ticket-test-123456789:2026-09-15',?,?)").run(at,at);
  provider(t,()=>[message(350)],()=>Response.json({data:{content:'A reply after the reminder'}}));
  assert.equal((await syncZoho(e)).imported,1);
  const task=e.JOBS_DB.sqlite.prepare("SELECT status,completed_at FROM crm_tasks WHERE id='auto-task'").get();assert.equal(task.status,'done');assert(task.completed_at);
});
test('saved imports still run when message discovery fails',async t=>{
  const e=fixture(t);
  e.JOBS_DB.sqlite.prepare("INSERT INTO crm_sync_items(provider_id,ticket_id,folder_id,sender_email,received_at,next_attempt_at,created_at,updated_at) VALUES('400','ticket-test-123456789','1','test@example.com',?,'2000-01-01',?,?)").run(at,at,at);
  provider(t,()=>null,()=>Response.json({data:{content:'Saved reply'}}));
  await assert.rejects(syncZoho(e));assert.equal(e.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_messages WHERE provider_id='400'").get().n,1);
});
test('unknown sends require evidence and an unchanged version; confirmation never sends or fabricates a provider receipt',async t=>{
  const e=fixture(t);t.mock.method(globalThis,'fetch',()=>{assert.fail('Manual confirmation must not contact the email provider');});
  e.JOBS_DB.sqlite.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,delivery,created_at,updated_at) VALUES('unknown-test-123456789','ticket-test-123456789','outbound','nathan','Test reply','unknown',?,?)").run(at,at);
  const body={id:'unknown-test-123456789',updated_at:at,confirmed:true,note:'Checked recipient and 10:00 sent message in Zoho.'};
  assert.equal((await call(e,'confirm-sent',{...body,confirmed:false})).status,400);
  assert.equal((await call(e,'confirm-sent',{...body,note:'yes'})).status,400);
  assert.equal((await call(e,'confirm-sent',{...body,updated_at:'old'})).status,409);
  e.JOBS_DB.sqlite.exec("UPDATE crm_tickets SET status='open',last_inbound_at='2026-09-15T11:00:00.000Z'");
  assert.equal((await call(e,'confirm-sent',body)).status,200);
  assert.equal(e.JOBS_DB.sqlite.prepare('SELECT status FROM crm_tickets').get().status,'open','a newer customer reply must remain open');
  assert.equal((await call(e,'confirm-sent',body)).status,409);
  const saved=(await detail(e.JOBS_DB,'ticket-test-123456789')).messages[0];assert.equal(saved.delivery,'sent');assert.equal(saved.provider_id,null);assert.equal(saved.delivery_confirmed_by,'nathan');assert.equal(saved.delivery_confirmation_note,body.note);
  assert.equal(e.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='manually confirmed sent'").get().n,1);
});
