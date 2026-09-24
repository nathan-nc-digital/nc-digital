import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCrmApi, handleEnquiry } from '../../src/lib/crm-api.js';
import { mailText, trimQuotedReply, messageTicketReference, deliverCrmOutbox, syncZoho, runCrmSchedule, zohoClient, crmEmailHtml } from '../../src/lib/crm-zoho.js';
import { CRM_MAILBOX, limitedText, ticketSubject, customerSubject } from '../../src/lib/crm.js';
import { cachedZohoToken } from '../../src/lib/crm-token.js';
const origin = 'https://nc-digital.co.uk';
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_create_jobs_table.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0015_crm.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0016_crm_workspace.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0017_crm_reliability.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0018_crm_undated_tasks.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0019_crm_saved_views.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0020_crm_tags.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0021_crm_confirmation_kind.sql','utf8'));
  // The inbox list reports whether website review emails were opened, so it reads the audit tables too.
  for (const file of ['0008_website_audits.sql','0022_website_audit_share.sql','0023_website_audit_open_alerts.sql','0024_website_audit_rerun.sql','0010_analytics_reports.sql','0025_seo_clients.sql']) sqlite.exec(readFileSync('migrations/'+file,'utf8'));
  t.after(() => sqlite.close());
  const db = { sqlite, prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { args: [], bind(...args) { this.args = args; return this; }, async first() { return statement.get(...this.args) || null; }, async all() { return { results: statement.all(...this.args) }; }, async run() { const r = statement.run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return db;
}
function setup(t, zoho = false) { return { JOBS_DB: database(t), CRM_ENABLED: 'true', WEB3FORMS_ACCESS_KEY: 'test-notification-key', ...(zoho ? { ZOHO_REGION:'eu', ZOHO_ACCOUNT_ID:'123456789', ZOHO_CLIENT_ID:'test-client', ZOHO_CLIENT_SECRET:'test-secret', ZOHO_REFRESH_TOKEN:'test-refresh' } : {}) }; }
const request = (route, body, extra = {}) => new Request(origin + route, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type':'application/json', ...extra }, ...(body ? { body:JSON.stringify(body) } : {}) });
const admin = (env, route, body, role = 'nathan') => handleCrmApi(request('/admin/crm/api/' + route, body), env, role);
const input = (extra = {}) => ({ name:'Test Customer', email:'customer@example.com', subject:'New website enquiry', message:'Please help with my website.', from_page:'/contact/', service:'new-website', submission_key:crypto.randomUUID(), ...extra });
async function create(env, extra) { const data=input(extra); const response=await handleEnquiry(request('/api/enquiries',data),env); assert.equal(response.status,201,JSON.stringify(await response.json())); return env.JOBS_DB.prepare('SELECT * FROM crm_tickets WHERE submission_key=?').bind(data.submission_key).first(); }
async function ok(response) { const r=await response;const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data; }
function mockProvider(t, handler) { t.mock.method(globalThis,'fetch',async (url, options) => {
  assert.equal(options.redirect, 'manual');
  if (String(url).includes('/oauth/v2/token')) { assert.equal(new URL(url).hostname,'accounts.zoho.eu'); assert(!String(url).includes('test-secret')); return Response.json({access_token:'test-access'}); }
  if (String(url).includes('api.web3forms.com')) return Response.json({success:true});
  assert.equal(options.headers.Authorization,'Zoho-oauthtoken test-access');
  return handler(String(url), options);
}); }

test('Zoho token redirects are rejected without following them or exposing response data', async t => {
  const env = setup(t, true);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    if (String(url).includes('/oauth/v2/token')) return Response.json({ access_token: 'test-access' });
    return new Response('private-test-response', { status: 302, headers: { Location: 'https://untrusted.example/private-test-token' } });
  });
  const api = await zohoClient(env);
  await assert.rejects(api('/messages', { fromAddress: 'nathan@nc-digital.co.uk', toAddress: 'info@nc-digital.co.uk' }), error => error.publicMessage.includes('unexpected redirect') && !error.publicMessage.includes('private-test'));
  assert.equal(calls, 2);
});

test('CRM email HTML escapes message text and includes the NC Digital signature', () => {
  const html = crmEmailHtml('Hello <script>alert(1)</script>\n\nKind regards,\nNathan');
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert(!html.includes('<script>'));
  assert(html.includes('NC Digital'));
  assert(html.includes('Kind regards,<br>Nathan'));
  assert(html.includes('https://nc-digital.co.uk/images/email-signature.jpg'));
  assert(html.includes('width="500"'));
  assert(html.includes('max-width:500px'));
  assert(!html.includes('Web design, SEO &amp; digital growth'));
  const quoted = crmEmailHtml('Following up.', 'Their original <message>');
  assert(quoted.includes('Your original message:'));
  assert(quoted.includes('Their original &lt;message&gt;'));
});

test('Zoho access tokens are reused across clients and stored encrypted in D1', async t => {
  const env = setup(t, true);
  let calls = 0;
  const refresh = async () => { calls++; return { access_token: 'private-access-token', expires_in: 3600 }; };
  assert.equal(await cachedZohoToken(env, refresh), 'private-access-token');
  assert.equal(await cachedZohoToken({ ...env }, refresh), 'private-access-token');
  assert.equal(calls, 1);
  const stored = JSON.stringify(env.JOBS_DB.sqlite.prepare('SELECT * FROM crm_state').all());
  for (const secret of ['private-access-token', 'test-secret', 'test-refresh']) assert(!stored.includes(secret));
  assert.equal(env.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_state WHERE key='zoho_token_lock'").get().n, 0);
});

test('expired tokens and credential rotation refresh the encrypted cache', async t => {
  const env = setup(t, true);
  let calls = 0;
  const refresh = async () => ({ access_token: 'access-' + (++calls), expires_in: 3600 });
  const initial = Date.now();
  assert.equal(await cachedZohoToken(env, refresh), 'access-1');
  t.mock.method(Date, 'now', () => initial + 3600000);
  assert.equal(await cachedZohoToken(env, refresh), 'access-2');
  assert.equal(await cachedZohoToken({ ...env, ZOHO_REFRESH_TOKEN: 'rotated-refresh' }, refresh), 'access-3');
});

test('concurrent refreshes are co-ordinated and failed refreshes release the lock', async t => {
  const env = setup(t, true);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const refresh = async () => { calls++; entered(); await waiting; return { access_token: 'coordinated-token', expires_in: 3600 }; };
  const first = cachedZohoToken(env, refresh);
  await started;
  await assert.rejects(cachedZohoToken(env, refresh), error => error.status === 503);
  release();
  assert.equal(await first, 'coordinated-token');
  assert.equal(await cachedZohoToken(env, refresh), 'coordinated-token');
  assert.equal(calls, 1);
  env.JOBS_DB.sqlite.prepare("DELETE FROM crm_state WHERE key='zoho_access_token'").run();
  await assert.rejects(cachedZohoToken(env, async () => { throw Error('synthetic failure'); }));
  assert.equal(env.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_state WHERE key='zoho_token_lock'").get().n, 0);
});

test('tampered token cache is discarded and short-lived tokens are not cached', async t => {
  const env = setup(t, true);
  let calls = 0;
  const refresh = async () => ({ access_token: 'access-' + (++calls), expires_in: 3600 });
  await cachedZohoToken(env, refresh);
  const row = env.JOBS_DB.sqlite.prepare("SELECT value FROM crm_state WHERE key='zoho_access_token'").get();
  const envelope = JSON.parse(row.value); envelope.data = 'AAAA' + envelope.data.slice(4);
  env.JOBS_DB.sqlite.prepare("UPDATE crm_state SET value=? WHERE key='zoho_access_token'").run(JSON.stringify(envelope));
  assert.equal(await cachedZohoToken(env, refresh), 'access-2');
  env.JOBS_DB.sqlite.prepare("DELETE FROM crm_state WHERE key='zoho_access_token'").run();
  assert.equal(await cachedZohoToken(env, async () => ({ access_token: 'short-token', expires_in: 30 })), 'short-token');
  assert.equal(env.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_state WHERE key='zoho_access_token'").get().n, 0);
});

test('notification redirects stay unconfirmed and are not retried automatically', async t => {
  const env = setup(t, true);
  await create(env);
  env.JOBS_DB.sqlite.prepare("UPDATE crm_messages SET delivery='sent' WHERE kind='confirmation'").run();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    if (String(url).includes('/oauth/v2/token')) return Response.json({ access_token: 'test-access' });
    return new Response('private-test-response', { status: 307, headers: { Location: 'https://untrusted.example/' } });
  });
  await deliverCrmOutbox(env);
  await deliverCrmOutbox(env);
  const row = env.JOBS_DB.sqlite.prepare("SELECT delivery,error FROM crm_messages WHERE kind='notification'").get();
  assert.equal(row.delivery, 'unknown'); assert(!row.error.includes('private-test')); assert.equal(calls, 2);
});

test('form capture stores details, notification and confirmation atomically and deduplicates retries',async t=>{
  const env=setup(t),data=input({utm_source:'facebook',phone:'07123456789'});
  const first=await handleEnquiry(request('/api/enquiries',data),env);assert.equal(first.status,201);
  assert.equal((await handleEnquiry(request('/api/enquiries',data),env)).status,200);
  const rows=env.JOBS_DB.sqlite.prepare('SELECT * FROM crm_tickets').all();assert.equal(rows.length,1);assert.equal(rows[0].email,'customer@example.com');assert.equal(JSON.parse(rows[0].metadata).utm_source,'facebook');
  assert.equal(env.JOBS_DB.sqlite.prepare('SELECT COUNT(*) AS n FROM crm_messages').get().n,3);
  const confirmation=env.JOBS_DB.sqlite.prepare("SELECT * FROM crm_messages WHERE kind='confirmation'").get();
  assert.equal(confirmation.author,'system');assert.equal(confirmation.delivery,'queued');assert(confirmation.body.includes(rows[0].reference));assert(confirmation.body.includes('Test Customer'));
});
test('calculator captures its quote details as searchable lead metadata', async t => {
  const env = setup(t);
  const data = input({
    service: 'Website cost calculator',
    from_page: '/website-cost-calculator/',
    lead_source: 'website-cost-calculator',
    website_type: 'Website build — 5–10 pages',
    calculator_build_total: '£999 inc. VAT',
    calculator_hosting: 'Annual hosting & domain — £250/year inc. VAT',
    calculator_breakdown: '5–10 pages: £699 | Online shop: £500',
  });
  assert.equal((await handleEnquiry(request('/api/enquiries', data), env)).status, 201);
  const row = env.JOBS_DB.sqlite.prepare('SELECT metadata FROM crm_tickets WHERE submission_key=?').get(data.submission_key);
  assert.deepEqual(JSON.parse(row.metadata), {
    lead_source: 'website-cost-calculator',
    website_type: 'Website build — 5–10 pages',
    calculator_build_total: '£999 inc. VAT',
    calculator_hosting: 'Annual hosting & domain — £250/year inc. VAT',
    calculator_breakdown: '5–10 pages: £699 | Online shop: £500',
  });
});
test('disabled capture is explicit; foreign origins, injection addresses and oversized bodies are rejected',async t=>{
  const env=setup(t);assert.equal((await handleEnquiry(request('/api/enquiries',input(),{Origin:'https://evil.example'}),env)).status,403);
  assert.equal((await handleEnquiry(request('/api/enquiries',input({email:'a@b.com\r\nBcc: stolen@example.com'})),env)).status,400);
  assert.equal((await handleEnquiry(request('/api/enquiries',input({message:'a'.repeat(41000)})),env)).status,413);
  env.CRM_ENABLED='false';assert.equal((await handleEnquiry(request('/api/enquiries',input()),env)).status,503);
  assert.equal((await ok(handleEnquiry(request('/api/enquiries/config'),env))).enabled,false);
});
test('honeypot silently ignores bots; per-source submission rate is bounded',async t=>{
  const env=setup(t);await handleEnquiry(request('/api/enquiries',input({botcheck:'spam'})),env);assert.equal(env.JOBS_DB.sqlite.prepare('SELECT COUNT(*) n FROM crm_tickets').get().n,0);
  for(let i=0;i<5;i++)assert.equal((await handleEnquiry(request('/api/enquiries',input()),env)).status,201);
  assert.equal((await handleEnquiry(request('/api/enquiries',input()),env)).status,429);
});
test('CRM blocks other roles and cross-origin mutations and never returns credentials in setup',async t=>{
  const env=setup(t,true);assert.equal((await admin(env,'list',undefined,'ben')).status,403);
  assert.equal((await handleCrmApi(request('/admin/crm/api/sync',{}, {Origin:'https://evil.example'}),env,'nathan')).status,403);
  const data=await ok(admin(env,'setup'));assert.equal(data.mailbox,CRM_MAILBOX);assert.equal(data.configured,true);assert(!JSON.stringify(data).includes('test-secret'));assert(!JSON.stringify(data).includes('test-refresh'));
});
test('ticket updates use optimistic concurrency and produce private audit entries',async t=>{
  const env=setup(t),ticket=await create(env);const body={id:ticket.id,version:ticket.version,status:'open',priority:'high',assigned_to:'ben',lead_source:'whatsapp',lead_temperature:'hot',tags:'High value, WhatsApp',follow_up_at:'2026-09-10T09:00:00Z'};
  assert.equal((await admin(env,'update',body)).status,400,'New CRM assignments cannot go to a jobs-only user');
  env.JOBS_DB.sqlite.prepare("UPDATE crm_tickets SET assigned_to='ben' WHERE id=?").run(ticket.id); // Preserve existing legacy assignments when editing other fields.
  const data=await ok(admin(env,'update',body));assert.equal(data.ticket.assigned_to,'ben');assert.equal(data.ticket.priority,'high');assert.equal(JSON.parse(data.ticket.metadata).lead_source,'whatsapp');assert.equal(JSON.parse(data.ticket.metadata).lead_temperature,'hot');assert.deepEqual(JSON.parse(data.ticket.tags),['High value','WhatsApp']);assert(data.messages.some(m=>m.kind==='event'));
  assert.equal((await admin(env,'update',body)).status,409);
  const list=await ok(admin(env,'list?overdue=true&assigned=ben'));assert.equal(list.total,1);
  assert.equal((await ok(admin(env,'list?q=%27%20OR%201%3D1'))).total,0);
});
test('phone-only enquiries can add a validated email address for replies',async t=>{
  const env=setup(t),ticket=await create(env);
  env.JOBS_DB.sqlite.prepare("UPDATE crm_tickets SET email='' WHERE id=?").run(ticket.id);
  const fresh=env.JOBS_DB.sqlite.prepare('SELECT * FROM crm_tickets WHERE id=?').get(ticket.id);
  const body={id:ticket.id,version:fresh.version,email:'phone-contact@example.com',status:fresh.status,assigned_to:fresh.assigned_to,priority:fresh.priority,follow_up_at:fresh.follow_up_at};
  const saved=await ok(admin(env,'update',body));assert.equal(saved.ticket.email,'phone-contact@example.com');
  assert(saved.messages.some(m=>m.kind==='event'&&m.body.includes('Email: phone-contact@example.com')));
  assert.equal((await admin(env,'update',{...body,version:saved.ticket.version,email:'not-an-email'})).status,400);
});
test('notes stay private, replies require Zoho, and request keys prevent repeat queue entries',async t=>{
  const env=setup(t),ticket=await create(env),body={id:ticket.id,kind:'note',body:'Private pricing note',request_key:crypto.randomUUID()};
  await ok(admin(env,'message',body));await ok(admin(env,'message',body));assert.equal(env.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_messages WHERE kind='note'").get().n,1);
  assert.equal((await admin(env,'message',{...body,kind:'outbound',request_key:crypto.randomUUID()})).status,503);
});
test('converting a ticket creates one linked job and preserves the assigned person',async t=>{
  const env=setup(t),ticket=await create(env);const a=await ok(admin(env,'job',{id:ticket.id}));const b=await ok(admin(env,'job',{id:ticket.id}));assert.equal(a.job_id,b.job_id);assert.equal(env.JOBS_DB.sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);
  const job=env.JOBS_DB.sqlite.prepare('SELECT * FROM jobs').get();assert(job.notes.includes(ticket.reference));assert.equal(job.assigned_to,'nathan');
});
test('outbox sends as NC Digital from Nathan’s mailbox, uses fixed recipient and records provider confirmation',async t=>{
  const env=setup(t,true),ticket=await create(env);await ok(admin(env,'message',{id:ticket.id,kind:'outbound',body:'Thanks for getting in touch.',request_key:crypto.randomUUID()}));
  env.JOBS_DB.sqlite.prepare("UPDATE crm_messages SET delivery='sent' WHERE kind IN ('notification','confirmation')").run();
  let sends=0;mockProvider(t,(url,options)=>{sends++;assert(url.endsWith('/messages'));const payload=JSON.parse(options.body);assert.equal(payload.fromAddress,`NC Digital <${CRM_MAILBOX}>`);assert.equal(payload.toAddress,ticket.email);assert.equal(payload.mailFormat,'html');assert(payload.content.includes('NC Digital'));assert(payload.content.includes('Your original message:'));assert(payload.content.includes('Please help with my website.'));assert(payload.content.includes('Name: Test Customer'));assert(payload.content.includes('Service: new-website'));assert(payload.subject.includes(ticket.reference));return Response.json({status:{code:200},data:{messageId:'987654321'}});});
  await deliverCrmOutbox(env);await deliverCrmOutbox(env);assert.equal(sends,1);assert.equal(env.JOBS_DB.sqlite.prepare("SELECT delivery FROM crm_messages WHERE kind='outbound'").get().delivery,'sent');
});
test('customer emails use a plain subject that keeps the reference but drops form and ad-source wording',async t=>{
  const ticket={reference:'NC-0123456789ABCDEF',subject:'New website enquiry — websites from £170 + VAT (Meta)'};
  assert.equal(customerSubject(ticket),'Your enquiry to NC Digital [NC-0123456789ABCDEF]');
  assert.equal(customerSubject(ticket,{reply:true}),'Re: Your enquiry to NC Digital [NC-0123456789ABCDEF]');
  assert.equal(messageTicketReference(customerSubject(ticket)),ticket.reference);
  assert(!customerSubject(ticket).includes('£'));assert(!customerSubject(ticket).includes('(Meta)'));
  assert.equal(ticketSubject(ticket),'[NC-0123456789ABCDEF] New website enquiry — websites from £170 + VAT (Meta)');
  const env=setup(t,true),created=await create(env,{subject:'New website enquiry — websites from £170 + VAT (Meta)'});
  env.JOBS_DB.sqlite.prepare("UPDATE crm_messages SET delivery='sent' WHERE kind='confirmation'").run();
  const subjects={};mockProvider(t,(url,options)=>{const payload=JSON.parse(options.body);subjects[payload.toAddress===CRM_MAILBOX?'notification':'customer']=payload.subject;return Response.json({status:{code:200},data:{messageId:String(Object.keys(subjects).length)}});});
  await ok(admin(env,'message',{id:created.id,kind:'outbound',body:'Thanks for getting in touch.',request_key:crypto.randomUUID()}));
  await deliverCrmOutbox(env);await deliverCrmOutbox(env);
  assert.equal(subjects.notification,`New CRM enquiry [${created.reference}] New website enquiry — websites from £170 + VAT (Meta)`);
  assert.equal(subjects.customer,`Your enquiry to NC Digital [${created.reference}]`);
});
test('original form details are included only on the first CRM reply',async t=>{
  const env=setup(t,true),ticket=await create(env);env.JOBS_DB.sqlite.prepare("UPDATE crm_messages SET delivery='sent' WHERE kind IN ('notification','confirmation')").run();
  const payloads=[];mockProvider(t,(url,options)=>{payloads.push(JSON.parse(options.body));return Response.json({status:{code:200},data:{messageId:String(9000+payloads.length)}});});
  await ok(admin(env,'message',{id:ticket.id,kind:'outbound',body:'First reply',request_key:crypto.randomUUID()}));await deliverCrmOutbox(env);
  await ok(admin(env,'message',{id:ticket.id,kind:'outbound',body:'Second reply',request_key:crypto.randomUUID()}));await deliverCrmOutbox(env);
  assert.equal(payloads.length,2);assert(payloads[0].content.includes('Your original message:'));assert(payloads[0].content.includes('Name: Test Customer'));assert(!payloads[1].content.includes('Your original message:'));assert(!payloads[1].content.includes('Name: Test Customer'));
});
test('unconfirmed sends are not automatically repeated; explicit rejections can be retried',async t=>{
  const env=setup(t,true),ticket=await create(env);await ok(admin(env,'message',{id:ticket.id,kind:'outbound',body:'Hello',request_key:crypto.randomUUID()}));
  env.JOBS_DB.sqlite.prepare("UPDATE crm_messages SET delivery='sent' WHERE kind IN ('notification','confirmation')").run();
  let calls=0;mockProvider(t,()=>{calls++;throw Error('Network disconnected');});await deliverCrmOutbox(env);await deliverCrmOutbox(env);assert.equal(calls,1);
  const row=env.JOBS_DB.sqlite.prepare("SELECT * FROM crm_messages WHERE kind='outbound'").get();assert.equal(row.delivery,'unknown');assert.equal((await admin(env,'retry',{message_id:row.id})).status,409);
});
test('Zoho sync matches ticket token AND customer address, imports plain text and reopens a closed ticket',async t=>{
  const env=setup(t,true),ticket=await create(env);env.JOBS_DB.sqlite.prepare("UPDATE crm_tickets SET status='closed' WHERE id=?").run(ticket.id);
  mockProvider(t,(url)=>url.includes('/search?')?Response.json({data:[{subject:`Re: [${ticket.reference}] Website`,messageId:'1111',folderId:'2222',fromAddress:ticket.email,receivedTime:String(Date.now()),hasAttachment:'1'},{subject:`[${ticket.reference}] Spoof`,messageId:'9999',folderId:'2222',fromAddress:'other@example.com'}]}):Response.json({data:{content:'<p>Yes please</p><script>alert(1)</script><p>Next week?</p>'}}));
  assert.equal((await syncZoho(env)).imported,1);assert.equal((await syncZoho(env)).imported,0);
  const data=await ok(admin(env,'ticket?id='+ticket.id));assert.equal(data.ticket.status,'open');const reply=data.messages.find(m=>m.provider_id==='1111');assert(reply.body.includes('Yes please'));assert(!reply.body.includes('alert'));assert(reply.body.includes('attachments'));
});
test('later replies use Zoho reply endpoint with the received message ID',async t=>{
  const env=setup(t,true),ticket=await create(env);env.JOBS_DB.sqlite.prepare("UPDATE crm_messages SET provider_id='4444' WHERE kind='inbound'").run();
  env.JOBS_DB.sqlite.prepare("UPDATE crm_messages SET delivery='sent' WHERE kind IN ('notification','confirmation')").run();
  await ok(admin(env,'message',{id:ticket.id,kind:'outbound',body:'Following up.',request_key:crypto.randomUUID()}));
  const requests=[];mockProvider(t,(url,options)=>{requests.push({url,payload:JSON.parse(options.body)});return Response.json({status:{code:200},data:{messageId:'5555'}});});await deliverCrmOutbox(env);
  assert.equal(requests.length,1);assert(requests[0].url.endsWith('/messages/4444'));assert.equal(requests[0].payload.action,'reply');assert.equal(requests[0].payload.fromAddress,`NC Digital <${CRM_MAILBOX}>`);assert(requests[0].payload.content.includes('Your original message:'));assert(requests[0].payload.content.includes('Please help with my website.'));assert.equal(env.JOBS_DB.sqlite.prepare("SELECT delivery FROM crm_messages WHERE kind='outbound'").get().delivery,'sent');
});
test('the auto-confirmation is emailed to the customer and a later staff reply threads onto it',async t=>{
  const env=setup(t,true),ticket=await create(env);
  env.JOBS_DB.sqlite.prepare("UPDATE crm_messages SET delivery='sent' WHERE kind='notification'").run();
  const requests=[];mockProvider(t,(url,options)=>{requests.push({url,payload:JSON.parse(options.body)});return Response.json({status:{code:200},data:{messageId:String(6000+requests.length)}});});
  await deliverCrmOutbox(env);
  assert.equal(requests.length,1);assert.equal(requests[0].payload.toAddress,ticket.email);assert.equal(requests[0].payload.subject,`Your enquiry to NC Digital [${ticket.reference}]`);assert(!requests[0].payload.action);assert(requests[0].payload.content.includes('ticket has been opened'));assert(requests[0].payload.content.includes(ticket.reference));assert(requests[0].payload.content.includes('Your original message:'));
  const confirmation=env.JOBS_DB.sqlite.prepare("SELECT * FROM crm_messages WHERE kind='confirmation'").get();assert.equal(confirmation.delivery,'sent');assert.equal(confirmation.provider_id,'6001');

  await ok(admin(env,'message',{id:ticket.id,kind:'outbound',body:'Thanks for the details.',request_key:crypto.randomUUID()}));
  await deliverCrmOutbox(env);
  assert.equal(requests.length,2);assert(requests[1].url.endsWith('/messages/'+confirmation.provider_id));assert.equal(requests[1].payload.action,'reply');assert.equal(requests[1].payload.subject,`Re: Your enquiry to NC Digital [${ticket.reference}]`);
});
test('sync backlog progresses to next page and preserves cursor if the provider fails',async t=>{
  const env=setup(t,true);let fail=false;
  mockProvider(t,(url)=>{const parsed=new URL(url);if(fail)throw Error('Unavailable');assert.equal(parsed.searchParams.get('start'),'1');return Response.json({data:Array.from({length:30},(_,i)=>({subject:'Unrelated',messageId:String(i+1)}))});});
  const result=await syncZoho(env);assert.equal(result.more,true);assert.equal(env.JOBS_DB.sqlite.prepare("SELECT value FROM crm_state WHERE key='sync_start'").get().value,'31');
  fail=true;await assert.rejects(()=>syncZoho(env));assert.equal(env.JOBS_DB.sqlite.prepare("SELECT value FROM crm_state WHERE key='sync_start'").get().value,'31');assert.equal(env.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_state WHERE key='sync_lock'").get().n,0);
});
test('message text parsing never executes or retains active markup; reference matching is strict',()=>{
  assert.equal(mailText('<p>A &amp; B</p><style>evil</style><img src=x onerror=evil><p>Hello</p>'),'A & B\n\nHello');
  assert.equal(trimQuotedReply('Appreciate it brother\n\nSent from my iPhone\n\nOn 14 Sep 2026, at 15:52, nathan@nc-digital.co.uk wrote:\n\nyeah cus can help you no probs\n\nKind regards,\nNathan'),'Appreciate it brother\n\nSent from my iPhone');
  assert.equal(trimQuotedReply('New reply\n> older quoted line\n> another line'),'New reply\n> older quoted line\n> another line');
  assert.equal(messageTicketReference('[NC-1234]'),null);assert.equal(messageTicketReference('Re: [NC-0123456789ABCDEF]'),'NC-0123456789ABCDEF');
});
test('bounded reader rejects streams exceeding the limit without a content-length',async()=>{
  await assert.rejects(()=>limitedText(new Response('123456789'),5),/large/);
});
test('disabled schedule has no side effects',async t=>{let called=false;t.mock.method(globalThis,'fetch',async()=>{called=true;throw Error();});await runCrmSchedule({CRM_ENABLED:'false'});assert.equal(called,false);});

test('provider 5xx is unconfirmed rather than safe to retry',async t=>{
  const env=setup(t,true),ticket=await create(env);await ok(admin(env,'message',{id:ticket.id,kind:'outbound',body:'Hello',request_key:crypto.randomUUID()}));
  mockProvider(t,()=>Response.json({status:{code:500}},{status:500}));await deliverCrmOutbox(env);
  assert.equal(env.JOBS_DB.sqlite.prepare("SELECT delivery FROM crm_messages WHERE kind='outbound'").get().delivery,'unknown');
  assert.equal(env.JOBS_DB.sqlite.prepare('SELECT status FROM crm_tickets').get().status,'open');
});
test('explicit 4xx rejection allows a deliberate retry, and waiting is set only after acceptance',async t=>{
  const env=setup(t,true),ticket=await create(env);await ok(admin(env,'message',{id:ticket.id,kind:'outbound',body:'Hello',request_key:crypto.randomUUID()}));
  let reject=true;mockProvider(t,()=>reject?Response.json({status:{code:400}},{status:400}):Response.json({status:{code:200},data:{messageId:'454545'}}));
  await deliverCrmOutbox(env);const message=env.JOBS_DB.sqlite.prepare("SELECT * FROM crm_messages WHERE kind='outbound'").get();assert.equal(message.delivery,'failed');
  reject=false;await ok(admin(env,'retry',{message_id:message.id}));await deliverCrmOutbox(env);assert.equal(env.JOBS_DB.sqlite.prepare('SELECT status FROM crm_tickets').get().status,'waiting');
});
test('classifying as spam cancels replies which have not started sending',async t=>{
  const env=setup(t,true),ticket=await create(env);await ok(admin(env,'message',{id:ticket.id,kind:'outbound',body:'Hello',request_key:crypto.randomUUID()}));
  const fresh=(await ok(admin(env,'ticket?id='+ticket.id))).ticket;await ok(admin(env,'update',{id:ticket.id,version:fresh.version,status:'spam',priority:'normal',assigned_to:'nathan',follow_up_at:null}));
  assert.equal(env.JOBS_DB.sqlite.prepare("SELECT delivery FROM crm_messages WHERE kind='outbound'").get().delivery,'cancelled');
});
