import test from 'node:test';
import assert from 'node:assert/strict';
import { crmDatabase } from '../helpers/crm-db.mjs';
import { handleWorkspace } from '../../src/lib/crm-workspace.js';
import { handleEnquiry,handleCrmApi } from '../../src/lib/crm-api.js';
import { deliverCrmOutbox,syncZoho,mailText,trimQuotedReply } from '../../src/lib/crm-zoho.js';
import { runWorkspaceSchedule } from '../../src/lib/crm-commercial.js';
import { pence,quoteItems,revenue,nextRenewal,londonToday,plusDays } from '../../src/lib/crm-domain.js';
import {londonInput,londonInstant} from '../../src/lib/crm-dates.js';
import worker from '../../src/worker.js';
const origin='https://nc-digital.co.uk';
const uid=()=>crypto.randomUUID();
function env(t){return {JOBS_DB:crmDatabase(t),CRM_ENABLED:'true',ZOHO_REGION:'eu',ZOHO_ACCOUNT_ID:'123456',ZOHO_CLIENT_ID:'test',ZOHO_CLIENT_SECRET:'test',ZOHO_REFRESH_TOKEN:'test'};}
function req(route,body,originHeader=origin){return new Request(origin+route,{method:body?'POST':'GET',headers:{Origin:originHeader,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
const call=(e,path,body)=>handleWorkspace(req('/admin/crm/api/workspace/'+path,body),e,'nathan');
async function ok(response){const r=await response,v=await r.json();assert(r.ok,JSON.stringify(v));return v;}
let accountFixture=0;
async function account(e){accountFixture+=1;return ok(call(e,'accounts',{id:uid(),name:'Example Roofing',email:`owner-${accountFixture}@example.com`,phone:`07700 900 ${String(accountFixture).padStart(4,'0')}`,lifecycle:'prospect'}));}
async function opportunity(e,a){return ok(call(e,'opportunities',{id:uid(),account_id:a.id,title:'New website',value_pence:50000,stage_id:'new',next_action:'Discovery call',next_date:londonToday()}));}
async function capture(e){const input={name:'Customer',email:'owner@example.com',message:'Original form details',submission_key:uid()};await ok(handleEnquiry(req('/api/enquiries',input),e));return e.JOBS_DB.prepare('SELECT * FROM crm_tickets WHERE submission_key=?').bind(input.submission_key).first();}
function provider(t,handler){t.mock.method(globalThis,'fetch',async(url,options)=>String(url).includes('/oauth/')?Response.json({access_token:'test-token'}):handler(String(url),options));}

test('accounts, contacts, opportunity and tasks are linked; stale versions cannot overwrite',async t=>{
  const e=env(t),a=await account(e),o=await opportunity(e,a);
  const contact=await ok(call(e,'contacts',{id:uid(),account_id:a.id,name:'Alex',email:'alex@example.com'}));assert.equal(contact.account_id,a.id);
  const detail=await ok(call(e,'account?id='+a.id));assert.equal(detail.opportunities.length,1);assert.equal(detail.tasks.length,1);assert(detail.audit.some(item=>item.entity==='crm_opportunities'&&item.action==='created'));
  const task=detail.tasks[0];await ok(call(e,'tasks',{...task,status:'done'}));assert.equal((await call(e,'tasks',{...task,status:'done'})).status,409);
  assert.equal((await call(e,'opportunities',{...o,title:'Updated'})).status,400);
  const updated=await ok(call(e,'opportunities',{...o,title:'Updated',next_action:'Follow up',next_date:plusDays(londonToday(),7)}));assert.equal(updated.version,2);
  assert.equal((await call(e,'opportunities',{...o,title:'Stale'})).status,409);
});
test('loss requires a reason and won conversion records a customer without duplicating identity',async t=>{
  const e=env(t),a=await account(e),o=await opportunity(e,a);
  assert.equal((await call(e,'opportunities',{...o,stage_id:'lost'})).status,400);
  await ok(call(e,'opportunities',{...o,stage_id:'won'}));const detail=await ok(call(e,'account?id='+a.id));assert.equal(detail.account.lifecycle,'customer');assert.equal(detail.opportunities.length,1);assert(detail.tasks.every(t=>t.status!=='open'));
});
test('archive blocks active customer work, restores and records an audit trail',async t=>{
  const e=env(t),a=await account(e),o=await opportunity(e,a);
  assert.equal((await call(e,'archive',{entity:'accounts',id:a.id,version:a.version,restore:false})).status,409);
  await ok(call(e,'opportunities',{...o,stage_id:'lost',outcome_reason:'Timing'}));
  const archived=await ok(call(e,'archive',{entity:'accounts',id:a.id,version:a.version,restore:false}));assert(archived.archived_at);
  assert.equal((await ok(call(e,'list?entity=accounts'))).total,0);
  const restored=await ok(call(e,'archive',{entity:'accounts',id:a.id,version:archived.version,restore:true}));assert.equal(restored.archived_at,null);
  assert((await ok(call(e,'audit?id='+a.id))).items.some(a=>a.action==='restored'));
});
test('cross-customer links and invalid protocols/dates are rejected',async t=>{
  const e=env(t),a=await account(e),b=await account(e),c=await ok(call(e,'contacts',{id:uid(),account_id:b.id,name:'Someone',phone:'07700900000'}));
  assert.equal((await call(e,'opportunities',{id:uid(),account_id:a.id,contact_id:c.id,title:'Bad',next_action:'Call',next_date:londonToday()})).status,400);
  assert.equal((await call(e,'accounts',{id:uid(),name:'Unsafe',website:'javascript:alert(1)'})).status,400);
  assert.equal((await call(e,'tasks',{id:uid(),title:'Bad date',due_date:'2026-02-30'})).status,400);
});
test('account duplicates require an explicit separate-record confirmation',async t=>{
  const e=env(t),a=await ok(call(e,'accounts',{id:uid(),name:'Duplicate source',email:'duplicate@example.com',phone:'07700900999',website:'https://duplicate.example'}));
  const byEmail=await call(e,'accounts',{id:uid(),name:'Second record',email:a.email,phone:'07700900888'});assert.equal(byEmail.status,409);assert.match((await byEmail.json()).error,/Possible duplicate customer/);
  const byPhone=await call(e,'accounts',{id:uid(),name:'Third record',phone:a.phone});assert.equal(byPhone.status,409);
  const byWebsite=await call(e,'accounts',{id:uid(),name:'Fourth record',website:a.website});assert.equal(byWebsite.status,409);
  const separate=await ok(call(e,'accounts',{id:uid(),name:'Second record',email:a.email,allow_duplicate:true}));assert.equal(separate.email,a.email);
  const changed=await call(e,'accounts',{...a,email:separate.email});assert.equal(changed.status,409);
  await ok(call(e,'accounts',{...a,email:separate.email,allow_duplicate:true}));
});
test('contact duplicates are checked within the same customer and can be explicitly separated',async t=>{
  const e=env(t),a=await account(e),b=await account(e),c=await ok(call(e,'contacts',{id:uid(),account_id:a.id,name:'Primary contact',email:'person@example.com',phone:'07700900111'}));
  const duplicate=await call(e,'contacts',{id:uid(),account_id:a.id,name:'Second contact',email:c.email});assert.equal(duplicate.status,409);assert.match((await duplicate.json()).error,/Possible duplicate contact/);
  const separate=await ok(call(e,'contacts',{id:uid(),account_id:a.id,name:'Second contact',email:c.email,allow_duplicate:true}));assert.equal(separate.account_id,a.id);
  const otherCustomer=await ok(call(e,'contacts',{id:uid(),account_id:b.id,name:'Shared consultant',email:c.email}));assert.equal(otherCustomer.account_id,b.id);
});
test('enquiries can be archived and restored without losing their conversation',async t=>{
  const e=env(t),ticket=await capture(e);
  const archived=await ok(call(e,'archive',{entity:'tickets',id:ticket.id,version:ticket.version,restore:false}));assert(archived.archived_at);
  const hidden=await ok(handleCrmApi(req('/admin/crm/api/list?status=all'),e,'nathan'));assert.equal(hidden.tickets.some(item=>item.id===ticket.id),false);
  const visible=await ok(handleCrmApi(req('/admin/crm/api/list?status=all&archived=true'),e,'nathan'));assert(visible.tickets.some(item=>item.id===ticket.id));
  const restored=await ok(call(e,'archive',{entity:'tickets',id:ticket.id,version:archived.version,restore:true}));assert.equal(restored.archived_at,null);
  const detail=await ok(handleCrmApi(req('/admin/crm/api/ticket?id='+ticket.id),e,'nathan'));assert(detail.messages.some(message=>message.body==='Original form details'));
});
test('quote revisions preserve snapshots and cannot be altered after issue; acceptance creates onboarding',async t=>{
  const e=env(t),a=await account(e),o=await opportunity(e,a),q=await ok(call(e,'quotes',{id:uid(),account_id:a.id,opportunity_id:o.id,title:'Website',expires_on:plusDays(londonToday(),30),items:[{description:'Build',quantity:1,unit_pence:99900,vat_bps:2000},{description:'Hosting',quantity:1,unit_pence:2500,frequency:'monthly'}]}));
  assert.equal(q.total_pence,119880);
  const revised=await ok(call(e,'quotes',{...q,title:'Website v2',items:[{description:'Build',quantity:1,unit_pence:100000}]}));assert.equal(revised.revision,2);
  assert.equal((await e.JOBS_DB.prepare('SELECT COUNT(*) AS n FROM crm_quote_revisions WHERE quote_id=?').bind(q.id).first()).n,2);
  const sent=await ok(call(e,'quote-action',{id:q.id,version:revised.version,action:'sent_external',confirmed:true,note:'Sent PDF to customer'}));
  assert.equal((await call(e,'quotes',{...sent,items:[{description:'Changed',quantity:1,unit_pence:1}]})).status,409);
  assert.equal((await call(e,'quote-action',{id:q.id,version:sent.version,action:'accept'})).status,400);
  const accepted=await ok(call(e,'quote-action',{id:q.id,version:sent.version,action:'accept',confirmed:true,note:'Accepted by reply on this revision'}));assert(accepted.accepted_at);
  const d=await ok(call(e,'account?id='+a.id));assert.equal(d.account.lifecycle,'customer');assert(d.tasks.some(t=>t.kind==='onboarding'));assert.equal(d.opportunities[0].stage_id,'won');
});
test('service renewal reminders deduplicate; renewal and cancellation alter the correct commitments',async t=>{
  const e=env(t),a=await account(e),today=londonToday();
  const service=await ok(call(e,'services',{id:uid(),account_id:a.id,name:'Hosting',price_pence:25000,frequency:'annual',starts_on:today,renews_on:plusDays(today,14),status:'active'}));
  await runWorkspaceSchedule(e);await runWorkspaceSchedule(e);
  let d=await ok(call(e,'account?id='+a.id));assert.equal(d.tasks.filter(t=>t.kind==='renewal').length,1);assert.equal(d.revenue.arr_pence,25000);
  const renewed=await ok(call(e,'renew',{id:service.id,version:service.version}));assert.notEqual(renewed.renews_on,service.renews_on);
  const cancelled=await ok(call(e,'services',{...renewed,status:'cancelled',cancellation_reason:'Customer moved hosting'}));assert.equal(cancelled.status,'cancelled');
  d=await ok(call(e,'account?id='+a.id));assert.equal(d.revenue.mrr_pence,0);assert(d.tasks.every(t=>t.status!=='open'));
});
test('scheduled no-reply reminders appear after seven quiet days and deduplicate',async t=>{
  const e=env(t),a=await account(e),today=londonToday(),sentAt=plusDays(today,-7)+'T10:00:00.000Z',ticketId=uid();
  e.JOBS_DB.sqlite.prepare("INSERT INTO crm_tickets(id,reference,submission_key,name,email,subject,status,account_id,created_at,updated_at,last_inbound_at) VALUES(?,?,?,?,?,'Website','waiting',?,?,?,?)").run(ticketId,'NC-'+ticketId.replaceAll('-','').slice(0,16).toUpperCase(),uid(),'Quiet lead','quiet@example.com',a.id,sentAt,sentAt,sentAt);
  e.JOBS_DB.sqlite.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,delivery,created_at,updated_at) VALUES(?,?,'inbound',?,?,'received',?,?)").run(uid(),ticketId,'quiet@example.com','Initial enquiry',sentAt,sentAt);
  e.JOBS_DB.sqlite.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,delivery,created_at,updated_at) VALUES(?,?,'outbound',?,?,'sent',?,?)").run(uid(),ticketId,'nathan','Thanks for getting in touch',sentAt,sentAt);
  await runWorkspaceSchedule(e);
  let tasks=e.JOBS_DB.sqlite.prepare("SELECT * FROM crm_tasks WHERE ticket_id=? AND external_key LIKE 'auto-no-reply:%'").all(ticketId);assert.equal(tasks.length,1);assert.equal(tasks[0].due_date,today);assert.match(tasks[0].title,/No reply after 7 days/);
  assert.equal(e.JOBS_DB.sqlite.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE entity_id=?").get(tasks[0].id).n,1);
  await runWorkspaceSchedule(e);assert.equal(e.JOBS_DB.sqlite.prepare("SELECT COUNT(*) AS n FROM crm_tasks WHERE ticket_id=? AND external_key LIKE 'auto-no-reply:%'").get(ticketId).n,1);
  const repliedId=uid(),repliedAt=plusDays(today,-2)+'T10:00:00.000Z';
  e.JOBS_DB.sqlite.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,delivery,created_at,updated_at) VALUES(?,?,?,?,?,'received',?,?)").run(repliedId,ticketId,'inbound','quiet@example.com','A reply',repliedAt,repliedAt);
  const nextTicketId=uid();e.JOBS_DB.sqlite.prepare("INSERT INTO crm_tickets(id,reference,submission_key,name,email,subject,status,account_id,created_at,updated_at,last_inbound_at) VALUES(?,?,?,?,?,'Website','waiting',?,?,?,?)").run(nextTicketId,'NC-'+nextTicketId.replaceAll('-','').slice(0,16).toUpperCase(),uid(),'Active reply','active@example.com',a.id,sentAt,sentAt,sentAt);
  e.JOBS_DB.sqlite.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,delivery,created_at,updated_at) VALUES(?,?,'outbound',?,?,'sent',?,?)").run(uid(),nextTicketId,'nathan','Latest proposal',sentAt,sentAt);
  e.JOBS_DB.sqlite.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,delivery,created_at,updated_at) VALUES(?,?,'inbound',?,?,'received',?,?)").run(uid(),nextTicketId,'active@example.com','Reply before seven days',repliedAt,repliedAt);
  await runWorkspaceSchedule(e);assert.equal(e.JOBS_DB.sqlite.prepare("SELECT COUNT(*) AS n FROM crm_tasks WHERE ticket_id=? AND external_key LIKE 'auto-no-reply:%'").get(nextTicketId).n,0);
});
test('money arithmetic rounds tax once and never mixes one-off fees with MRR',()=>{
  assert.equal(pence('19.99'),1999);assert.throws(()=>pence('0.001'));
  assert.equal(quoteItems([{description:'Work',quantity:3,unit_pence:999,vat_bps:2000}])[0].tax_pence,599);
  const base={account_id:'one',starts_on:'2026-01-01',status:'active'};
  assert.deepEqual(revenue([{...base,price_pence:25000,frequency:'annual'},{...base,price_pence:10000,frequency:'monthly'},{...base,price_pence:99900,frequency:'once'}],'2026-09-15'),{mrr_pence:12083,arr_pence:145000,recurring_customers:1});
  assert.equal(nextRenewal('2028-02-29','annual'),'2029-02-28');assert.equal(nextRenewal('2026-01-31','monthly'),'2026-02-28');
});
test('drafts persist and a stale tab cannot overwrite them',async t=>{
  const e=env(t),request_key=uid(),draft=await ok(call(e,'draft',{key:'ticket:outbound',body:'Draft',request_key,version:0}));assert.equal(draft.version,1);
  assert.equal((await ok(call(e,'draft?key=ticket:outbound'))).body,'Draft');
  await ok(call(e,'draft',{key:'ticket:outbound',body:'Updated',request_key,version:1}));
  assert.equal((await call(e,'draft',{key:'ticket:outbound',body:'Stale',request_key,version:1})).status,409);
});
test('workspace APIs reject other roles and foreign-origin writes',async t=>{
  const e=env(t);assert.equal((await handleWorkspace(req('/admin/crm/api/workspace/today'),e,'ben')).status,403);
  assert.equal((await handleWorkspace(req('/admin/crm/api/workspace/accounts',{id:uid(),name:'Bad'},'https://evil.example'),e,'nathan')).status,403);
});
test('today view includes enquiry source and calculator quote context', async t => {
  const e=env(t),input={name:'Calculator lead',email:'calculator@example.com',subject:'Quote request',service:'Website cost calculator',from_page:'/website-cost-calculator/',lead_source:'website-cost-calculator',calculator_build_total:'£1099 inc. VAT',message:'Estimate requested',submission_key:uid()};
  await ok(handleEnquiry(req('/api/enquiries',input),e));
  const today=await ok(call(e,'today'));const enquiry=today.enquiries.find(item=>item.email==='calculator@example.com');
  assert.equal(enquiry.service,'Website cost calculator');
  assert.equal(JSON.parse(enquiry.metadata).calculator_build_total,'£1099 inc. VAT');
});
test('global search includes contacts and enquiries with useful record links', async t => {
  const e=env(t),accountId=uid(),contactId=uid(),submission_key=uid();
  await ok(call(e,'accounts',{id:accountId,name:'Search Company',email:'company-search@example.com'}));
  await ok(call(e,'contacts',{id:contactId,account_id:accountId,name:'Search Contact',email:'contact-search@example.com'}));
  const opportunity=await ok(call(e,'opportunities',{id:uid(),account_id:accountId,title:'Website opportunity',service:'Searchable service',source:'Partner referral',next_action:'Call prospect',next_date:londonToday()}));
  await ok(handleEnquiry(req('/api/enquiries',{name:'Search Lead',email:'lead-search@example.com',subject:'Calculator quote',service:'Website cost calculator',message:'Please send an estimate',submission_key}),e));
  const contactResults=await ok(call(e,'search?q=contact-search@example.com'));
  const contact=contactResults.items.find(item=>item.entity==='contacts');
  assert.equal(contact.title,'Search Contact');assert.equal(contact.related_id,accountId);
  const leadResults=await ok(call(e,'search?q=lead-search@example.com'));
  const lead=leadResults.items.find(item=>item.entity==='tickets');
  assert(lead);assert.equal(lead.title,'Search Lead');assert.equal(lead.detail,'Calculator quote');
  await ok(call(e,'activity',{id:uid(),account_id:accountId,kind:'note',body:'Private searchable requirement note'}));
  const noteResults=await ok(call(e,'search?q=searchable+requirement'));
  const note=noteResults.items.find(item=>item.entity==='notes');
  assert(note);assert.equal(note.title,'Search Company');assert.equal(note.related_id,accountId);
  const messageResults=await ok(call(e,'search?q=estimate'));
  const message=messageResults.items.find(item=>item.entity==='messages');
  assert(message);assert.equal(message.title,'Calculator quote');assert.equal(message.related_id,lead.id);
  const opportunityResults=await ok(call(e,'search?q=searchable+service'));
  const foundOpportunity=opportunityResults.items.find(item=>item.entity==='opportunities');
  assert(foundOpportunity);assert.equal(foundOpportunity.id,opportunity.id);assert.equal(foundOpportunity.detail,'Searchable service');
});
test('today view flags stale opportunities without a scheduled follow-up', async t => {
  const e=env(t),a=await account(e),o=await opportunity(e,a),old='2026-08-01T09:00:00.000Z';
  e.JOBS_DB.sqlite.prepare("UPDATE crm_tasks SET status='done',completed_at=?,updated_at=? WHERE opportunity_id=?").run(old,old,o.id);
  e.JOBS_DB.sqlite.prepare('UPDATE crm_opportunities SET updated_at=?,stage_changed_at=? WHERE id=?').run(old,old,o.id);
  const today=await ok(call(e,'today'));const stale=today.stale.find(item=>item.id===o.id);
  assert(stale);assert.equal(stale.account_name,a.name);assert.equal(stale.stage_name,'New opportunity');assert.equal(today.weighted_pipeline_pence,5000);
});
test('opportunity lists filter service, lead source and close date without changing other records', async t => {
  const e=env(t),a=await account(e),first=await ok(call(e,'opportunities',{id:uid(),account_id:a.id,title:'SEO opportunity',service:'SEO',source:'Referral',expected_close:'2026-10-01',next_action:'Call',next_date:londonToday(),value_pence:10000}));
  const second=await ok(call(e,'opportunities',{id:uid(),account_id:a.id,title:'Website opportunity',service:'Website design',source:'Website',expected_close:'2026-12-01',next_action:'Call',next_date:londonToday(),value_pence:20000}));
  const seo=await ok(call(e,'list?entity=opportunities&service=seo'));assert.equal(seo.total,1);assert.equal(seo.items[0].id,first.id);
  const referral=await ok(call(e,'list?entity=opportunities&source=ref'));assert.equal(referral.total,1);assert.equal(referral.items[0].id,first.id);
  const closing=await ok(call(e,'list?entity=opportunities&close_by=2026-10-31'));assert.equal(closing.total,1);assert.equal(closing.items[0].id,first.id);
  const highest=await ok(call(e,'list?entity=opportunities&sort=value'));assert.equal(highest.items[0].id,second.id);
  const customer=await ok(call(e,'list?entity=opportunities&account_id='+encodeURIComponent(a.id)));assert.equal(customer.total,2);assert(customer.items.some(item=>item.id===second.id));
  const all=await ok(call(e,'list?entity=opportunities'));assert.equal(all.items.some(item=>item.id===second.id),true);
 });
test('pipeline stages can be edited safely and leave an audit trail', async t => {
  const e=env(t),options=await ok(call(e,'options')),stage=options.stages.find(item=>item.id==='qualified'),other=options.stages.find(item=>item.id==='new');
  const saved=await ok(call(e,'stage',{id:stage.id,version:stage.version,name:'Discovery qualified',position:stage.position,probability:42}));
  assert.equal(saved.name,'Discovery qualified');assert.equal(saved.probability,42);assert.equal(saved.version,stage.version+1);
  const duplicate=await call(e,'stage',{id:saved.id,version:saved.version,name:other.name,position:saved.position,probability:saved.probability});assert.equal(duplicate.status,400);
  assert.equal((await call(e,'stage',{id:stage.id,version:stage.version,name:'Stale stage',position:stage.position,probability:20})).status,409);
  const audit=await ok(call(e,'audit?id='+stage.id));assert(audit.items.some(item=>item.entity==='crm_stages'&&item.action==='updated'));
 });
test('saved views persist validated filters and reject stale or unsafe changes',async t=>{
  const e=env(t),created=await ok(call(e,'saved-view',{entity:'tasks',name:'Open follow-ups',query:'status=open&kind=followup'}));
  assert.equal(created.entity,'tasks');assert.equal(created.query,'status=open&kind=followup');
  const options=await ok(call(e,'options'));assert(options.saved_views_ready);assert(options.saved_views.some(view=>view.id===created.id));
  const updated=await ok(call(e,'saved-view',{...created,query:'status=open&kind=call'}));assert.equal(updated.version,created.version+1);
  assert.equal((await call(e,'saved-view',{...created,name:'Stale'})).status,409);
  assert.equal((await call(e,'saved-view',{entity:'tasks',name:'Unsafe',query:'entity=crm_accounts'})).status,400);
  assert.equal((await call(e,'saved-view',{entity:'tasks',name:'Open follow-ups',query:'status=done'})).status,409);
  const audit=await ok(call(e,'audit?id='+created.id));assert(audit.items.some(item=>item.entity==='crm_saved_views'));
 });
test('task lists support bounded due-date ranges', async t => {
  const e=env(t),a=await account(e),today=londonToday();
  const earlier=await ok(call(e,'tasks',{id:uid(),account_id:a.id,title:'Earlier task',due_date:plusDays(today,-2),kind:'followup'}));
  const later=await ok(call(e,'tasks',{id:uid(),account_id:a.id,title:'Later task',due_date:plusDays(today,7),kind:'call'}));
  const range=await ok(call(e,'list?entity=tasks&due_from='+today+'&due='+plusDays(today,7)));assert.equal(range.total,1);assert.equal(range.items[0].id,later.id);
  const before=await ok(call(e,'list?entity=tasks&due='+today));assert(before.items.some(item=>item.id===earlier.id));
  const followups=await ok(call(e,'list?entity=tasks&kind=followup'));assert.equal(followups.total,1);assert.equal(followups.items[0].id,earlier.id);
  const undated=await ok(call(e,'tasks',{id:uid(),account_id:a.id,title:'Undated task',kind:'task'}));
  const missingDate=await ok(call(e,'list?entity=tasks&undated=true'));assert.equal(missingDate.total,1);assert.equal(missingDate.items[0].id,undated.id);
 });
test('bulk task completion is version checked and audited',async t=>{
  const e=env(t),a=await account(e),first=await ok(call(e,'tasks',{id:uid(),account_id:a.id,title:'Bulk one',kind:'followup'})),second=await ok(call(e,'tasks',{id:uid(),account_id:a.id,title:'Bulk two',kind:'call'}));
  const result=await ok(call(e,'bulk',{entity:'tasks',action:'complete',records:[{id:first.id,version:first.version},{id:second.id,version:second.version}]}));assert.equal(result.updated,2);
  const rows=await ok(call(e,'list?entity=tasks&status=done'));assert.equal(rows.total,2);
  assert.equal((await call(e,'bulk',{entity:'tasks',action:'complete',records:[{id:first.id,version:first.version}]})).status,409);
  const audit=await ok(call(e,'audit?id='+first.id));assert(audit.items.some(item=>item.action==='completed'));
 });
test('account lists filter by relationship without changing the default view', async t => {
  const e=env(t),prospect=await account(e),customer=await ok(call(e,'accounts',{id:uid(),name:'Active customer',email:'active-customer@example.com',lifecycle:'customer'}));
  const customers=await ok(call(e,'list?entity=accounts&lifecycle=customer'));assert.equal(customers.total,1);assert.equal(customers.items[0].id,customer.id);
  const prospects=await ok(call(e,'list?entity=accounts&lifecycle=prospect'));assert.equal(prospects.total,1);assert.equal(prospects.items[0].id,prospect.id);
  const all=await ok(call(e,'list?entity=accounts'));assert.equal(all.total,2);
 });
test('customer imports preview validation and commit idempotently',async t=>{
  const e=env(t),existing=await account(e),rows=[{name:'Imported Studio',email:'imported@example.com',website:'https://imported.example'},{name:'Bad row',email:'not-an-email'},{name:'Existing row',email:existing.email},{name:'Second imported',phone:'07700900999'},{name:'Duplicate in file',phone:'07700900999'}];
  const preview=await ok(call(e,'import-accounts',{mode:'preview',rows}));assert.equal(preview.ready,2);assert.equal(preview.invalid,1);assert.equal(preview.duplicates,2);assert.equal(preview.rows[1].status,'invalid');
  const requestKey=uid(),committed=await ok(call(e,'import-accounts',{mode:'commit',confirm:true,request_key:requestKey,rows}));assert.equal(committed.imported,2);assert.equal((await ok(call(e,'list?entity=accounts&q=Imported'))).total,2);
  const retry=await ok(call(e,'import-accounts',{mode:'commit',confirm:true,request_key:requestKey,rows}));assert.equal(retry.imported,0);assert.equal(retry.skipped,5);
 });
test('record tags are normalised, searchable and included in focused reports',async t=>{
  const e=env(t),today=londonToday();
  const a=await ok(call(e,'accounts',{id:uid(),name:'Tagged Studio',email:'tagged@example.com',tags:'Hosting, WordPress, hosting'}));
  assert.deepEqual(JSON.parse(a.tags),['Hosting','WordPress']);
  const c=await ok(call(e,'contacts',{id:uid(),account_id:a.id,name:'Tagged owner',email:'tagged-owner@example.com',tags:'High value'}));assert.deepEqual(JSON.parse(c.tags),['High value']);
  const o=await ok(call(e,'opportunities',{id:uid(),account_id:a.id,title:'Tagged build',tags:'WordPress,Referral',next_action:'Call',next_date:today,value_pence:125000}));
  assert.equal((await ok(call(e,'list?entity=accounts&tag=hosting'))).total,1);
  assert.equal((await ok(call(e,'list?entity=opportunities&tag=referral'))).items[0].id,o.id);
  const report=await ok(call(e,'reports?from='+today+'&to='+today));assert.equal(report.leads.count,0);assert.equal(report.opportunities.count,1);assert.equal(report.opportunities.open_value_pence,125000);assert(report.opportunities.by_stage.some(stage=>stage.label==='New opportunity'&&stage.value_pence===125000));
 });

test('reports use complete London dates across summer time and reject reversed ranges',async t=>{
  const e=env(t),a=await account(e);const o=await opportunity(e,a);
  for(const [stamp,expected] of [['2026-09-16T22:59:59.999Z',0],['2026-09-16T23:00:00.000Z',1],['2026-09-17T22:59:59.999Z',1],['2026-09-17T23:00:00.000Z',0]]){
    e.JOBS_DB.sqlite.prepare('UPDATE crm_opportunities SET created_at=? WHERE id=?').run(stamp,o.id);
    assert.equal((await ok(call(e,'reports?from=2026-09-17&to=2026-09-17'))).opportunities.count,expected,stamp);
  }
  assert.equal((await call(e,'reports?from=2026-09-18&to=2026-09-17')).status,400);
});
test('two queued replies include original context exactly once; no provider receipt stays unknown',async t=>{
  const e=env(t),ticket=await capture(e);e.JOBS_DB.sqlite.prepare("UPDATE crm_messages SET delivery='sent' WHERE kind IN ('notification','confirmation')").run();
  for(const body of ['First','Second'])await ok(handleCrmApi(req('/admin/crm/api/message',{id:ticket.id,body,kind:'outbound',request_key:uid()}),e,'nathan'));
  const payloads=[];provider(t,(_url,options)=>{payloads.push(JSON.parse(options.body));return Response.json({data:{messageId:String(1000+payloads.length)}});});
  await deliverCrmOutbox(e);assert.equal(payloads.filter(p=>p.content.includes('Your original message:')).length,1);assert(payloads[0].content.includes('Original form details'));
  await ok(handleCrmApi(req('/admin/crm/api/message',{id:ticket.id,body:'Third',kind:'outbound',request_key:uid()}),e,'nathan'));
  t.mock.method(globalThis,'fetch',async()=>Response.json({}));await deliverCrmOutbox(e);
  assert.equal((await e.JOBS_DB.prepare("SELECT delivery FROM crm_messages WHERE body='Third'").first()).delivery,'unknown');
});
test('incoming quote parsing retains genuine inline answers and full source',async t=>{
  const e=env(t),ticket=await capture(e),html='<p>My reply</p><p>On Monday someone wrote:</p><blockquote>Your question<p>My important inline answer</p></blockquote>';
  provider(t,(url)=>url.includes('/search?')?Response.json({data:[{subject:`[${ticket.reference}] Reply`,messageId:'1122',folderId:'33',fromAddress:ticket.email}]}):Response.json({data:{content:html}}));
  await syncZoho(e);const saved=await e.JOBS_DB.prepare("SELECT * FROM crm_messages WHERE provider_id='1122'").first();assert(saved.full_body.includes('My important inline answer'));assert.equal(saved.source_html,html);
  assert(mailText(html).includes('My important inline answer'));assert(trimQuotedReply('Budget\n> £500 is fine\nPlease call me').includes('Please call me'));
});
test('changed enquiry payload with the same key returns conflict',async t=>{
  const e=env(t),input={name:'Customer',email:'test@example.com',message:'One',submission_key:uid()};await ok(handleEnquiry(req('/api/enquiries',input),e));assert.equal((await handleEnquiry(req('/api/enquiries',{...input,message:'Two'}),e)).status,409);
});

test('quote outbox requires provider confirmation and keeps the issued customer snapshot',async t=>{
  const e=env(t),a=await account(e),ticket=await capture(e);
  await ok(call(e,'link',{ticket_id:ticket.id,version:ticket.version,account_id:a.id}));
  const q=await ok(call(e,'quotes',{id:uid(),account_id:a.id,ticket_id:ticket.id,title:'Agreed work',expires_on:plusDays(londonToday(),30),items:[{description:'Website',quantity:1,unit_pence:50000}]}));
  const queued=await ok(call(e,'quote-action',{id:q.id,version:q.version,action:'send'}));assert.equal(queued.status,'queued');
  assert.equal((await call(e,'quote-action',{id:q.id,version:queued.version,action:'accept',confirmed:true,note:'Yes'})).status,409);
  const payloads=[];provider(t,(_url,options)=>{payloads.push(JSON.parse(options.body));return Response.json({data:{messageId:String(3000+payloads.length)}});});
  await deliverCrmOutbox(e);const delivered=await ok(call(e,'record?entity=quotes&id='+q.id));assert.equal(delivered.status,'sent');assert(delivered.sent_at);assert(payloads.some(p=>p.content.includes(q.number)));
  await ok(call(e,'accounts',{...a,name:'Changed business name'}));assert.equal((await ok(call(e,'record?entity=quotes&id='+q.id))).snapshot.customer.name,a.name);
  assert((await ok(call(e,'account?id='+a.id))).tasks.some(task=>task.ticket_id===ticket.id));
});

test('manual lead retries compare all details, and new opportunity retries keep one next action',async t=>{
  const e=env(t),body={id:uid(),name:'Phone customer',phone:'07700900123',subject:'New lead',message:'Original requirements',due_date:londonToday()};
  await ok(call(e,'enquiries',body));await ok(call(e,'enquiries',body));assert.equal((await call(e,'enquiries',{...body,message:'Different requirements'})).status,409);
  const a=await account(e),input={id:uid(),account_id:a.id,title:'A website',next_action:'Call',next_date:londonToday()};await ok(call(e,'opportunities',input));await new Promise(r=>setTimeout(r,10));await ok(call(e,'opportunities',input));assert.equal((await ok(call(e,'account?id='+a.id))).tasks.length,1);
});

test('database guards block archived parents and cross-account linked records',async t=>{
  const e=env(t),a=await account(e),b=await account(e),o=await opportunity(e,a);
  assert.throws(()=>e.JOBS_DB.sqlite.prepare('UPDATE crm_accounts SET archived_at=? WHERE id=?').run(new Date().toISOString(),a.id),/crm_customer_has_open_work/);
  assert.throws(()=>e.JOBS_DB.sqlite.prepare('UPDATE crm_opportunities SET account_id=? WHERE id=?').run(b.id,o.id),/crm_linked_opportunity_cannot_move/);
  const archived=await ok(call(e,'archive',{entity:'accounts',id:b.id,version:b.version,restore:false}));
  assert.throws(()=>e.JOBS_DB.sqlite.prepare('UPDATE crm_tasks SET account_id=?').run(archived.id),/crm_relationship_mismatch|crm_parent_archived/);
});

test('London follow-up inputs handle BST/GMT and reject ambiguous or missing clock-change times',()=>{
  assert.equal(londonInput('2026-09-15T23:30:00Z'),'2026-09-16T00:30');
  assert.equal(londonInstant('2026-09-16T00:30'),'2026-09-15T23:30:00.000Z');
  assert.equal(londonInstant('2026-12-01T09:00'),'2026-12-01T09:00:00.000Z');
  assert.throws(()=>londonInstant('2026-03-29T01:30'),/skipped or repeated/);
  assert.throws(()=>londonInstant('2026-10-25T01:30'),/skipped or repeated/);
});

test('Worker protects CRM routes and enforces origin checks on authenticated jobs writes',async t=>{
  const e={...env(t),ADMIN_PASSWORD:'test-only-nathan',BEN_PASSWORD:'test-only-ben',ASSETS:{fetch:async()=>new Response('Admin page')}};
  const request=(path,user,password,foreign=false)=>new Request(origin+path,{method:path.includes('/jobs/api/')?'POST':'GET',headers:{...(user?{Authorization:'Basic '+btoa(user+':'+password)}:{}),Origin:foreign?'https://evil.example':origin,'Content-Type':'application/json'},...(path.includes('/jobs/api/')?{body:JSON.stringify({title:'Injected job'})}:{})});
  assert.equal((await worker.fetch(request('/admin/crm/api/workspace/today'),e)).status,401);
  assert.equal((await worker.fetch(request('/admin/crm/','ben','test-only-ben'),e)).status,401);
  assert.equal((await worker.fetch(request('/admin/crm/api/workspace/today','nathan','test-only-nathan'),e)).status,200);
  const page=await worker.fetch(request('/admin/crm/','nathan','test-only-nathan'),e);assert.equal(page.status,200);assert(page.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));assert.equal(page.headers.get('X-Frame-Options'),'DENY');
  assert.equal((await worker.fetch(request('/admin/jobs/api/create','nathan','test-only-nathan',true),e)).status,403);
  assert.equal((await e.JOBS_DB.prepare('SELECT COUNT(*) AS n FROM jobs').first()).n,0);
});
