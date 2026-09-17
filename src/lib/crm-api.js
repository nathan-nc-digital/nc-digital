import { CRM_MAILBOX, CRM_STATUSES, CRM_ASSIGNEES, CRM_PRIORITIES, crmError, text, key, email, normaliseEnquiry, enquiryHash, readJson, sameOrigin, crmResponse, failure, stateGet } from './crm.js';
import { zohoSetup, zohoConfigured, syncZoho } from './crm-zoho.js';
import { handleWorkspace } from './crm-workspace.js';
import { londonToday, plusDays, choice, tags } from './crm-domain.js';

async function rateLimit(request, db) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const window = Math.floor(Date.now() / 600000);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${window}:${ip}`));
  const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
  await db.prepare('DELETE FROM crm_limits WHERE expires_at < ?').bind(Date.now()).run();
  const result = await db.prepare('INSERT INTO crm_limits(key,hits,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 WHERE hits<5 RETURNING hits').bind(hash, Date.now() + 600000).first();
  if (!result) throw crmError('Too many enquiries. Please wait a few minutes and try again.', 429);
}
export async function handleEnquiry(request, env) {
  try {
    const url = new URL(request.url);
    if (url.pathname === '/api/enquiries/config' && request.method === 'GET') return crmResponse({ enabled: env.CRM_ENABLED === 'true' });
    if (url.pathname !== '/api/enquiries' || request.method !== 'POST') throw crmError('Not found.', 404);
    sameOrigin(request);
    if (env.CRM_ENABLED !== 'true' || !env.JOBS_DB) throw crmError('Enquiries are temporarily unavailable. Please email us directly.', 503);
    const raw = await readJson(request);
    if (raw.botcheck) return crmResponse({ success: true });
    const data = normaliseEnquiry(raw);
    const db = env.JOBS_DB;
    const hash = await enquiryHash(data);
    const existing = await db.prepare('SELECT id,submission_hash FROM crm_tickets WHERE submission_key=?').bind(data.submission_key).first();
    if (existing) {
      if (existing.submission_hash && existing.submission_hash !== hash) throw crmError('This request identifier was already used for different details. Refresh and submit again.',409);
      return crmResponse({ success: true });
    }
    await rateLimit(request, db);
    const id = crypto.randomUUID();
    const reference = 'NC-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
    const now = new Date().toISOString();
    // The enquiry and notification are committed atomically before success is returned.
    // A competing retry cannot insert partial or duplicate ticket/message records.
    try {
      await db.batch([
        db.prepare('INSERT INTO crm_tickets(id,reference,submission_key,submission_hash,name,email,phone,company,subject,service,source_page,metadata,created_at,updated_at,last_inbound_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, reference, data.submission_key, hash, data.name, data.email, data.phone, data.company, data.subject, data.service, data.source_page, data.metadata, now, now, now),
        db.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,created_at,updated_at) VALUES(?,?,'inbound',?,?,?,?)").bind(crypto.randomUUID(), id, data.email, data.body, now, now),
        db.prepare('INSERT INTO crm_tasks(id,title,ticket_id,due_date,external_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('followup-'+id,'Review enquiry: '+data.name,id,londonToday(),'ticket-followup:'+id,now,now),
        db.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,delivery,created_at,updated_at) VALUES(?,?,'notification',?,?,'queued',?,?)").bind(crypto.randomUUID(), id, CRM_MAILBOX, `${data.body}\n\nName: ${data.name}\nEmail: ${data.email}\nCompany: ${data.company}\nPhone: ${data.phone}\nService: ${data.service}\nPage: ${data.source_page}`, now, now),
      ]);
    } catch (error) {
      const winner=await db.prepare('SELECT submission_hash FROM crm_tickets WHERE submission_key=?').bind(data.submission_key).first();
      if (!winner) throw error;
      if(winner.submission_hash!==hash)throw crmError('Request identifier already used for different details.',409);
    }
    return crmResponse({ success: true }, 201);
  } catch (error) { return failure(error); }
}
async function getTicket(db, id) {
  const ticket = await db.prepare('SELECT * FROM crm_tickets WHERE id=?').bind(key(id)).first();
  if (!ticket) throw crmError('Ticket not found.', 404);
  return ticket;
}
export async function detail(db, id) {
  const ticket = await getTicket(db, id);
  const { results: messages } = await db.prepare('SELECT id,ticket_id,kind,author,body,delivery,provider_id,request_key,error,created_at,updated_at,delivery_confirmed_by,delivery_confirmation_note,delivery_confirmed_at,(full_body IS NOT NULL AND full_body<>body) AS has_original FROM crm_messages WHERE ticket_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').bind(ticket.id).all();
  messages.reverse();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM crm_messages WHERE ticket_id=?').bind(ticket.id).first();
  return { ticket, messages, truncated: count.count > 100 };
}
async function list(db, url) {
  const status = url.searchParams.get('status') || 'all';
  const assigned = url.searchParams.get('assigned') || 'all';
  const search = text(url.searchParams.get('q'), 120);
  const page = Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0));
  if (status !== 'all' && !CRM_STATUSES.includes(status)) throw crmError('Invalid status.');
  if (assigned !== 'all' && !CRM_ASSIGNEES.includes(assigned)) throw crmError('Invalid assignee.');
  const archived = url.searchParams.get('archived') === 'true';
  const where = [archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'], args = [];
  if (status !== 'all') { where.push('status=?'); args.push(status); }
  if (assigned !== 'all') { where.push('assigned_to=?'); args.push(assigned); }
  if (url.searchParams.get('overdue') === 'true') { where.push("follow_up_at <= ? AND status NOT IN ('closed','spam')"); args.push(new Date().toISOString()); }
  if (search) { where.push('(name LIKE ? OR email LIKE ? OR subject LIKE ? OR reference LIKE ? OR company LIKE ?)'); args.push(...Array(5).fill(`%${search}%`)); }
  const filter = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM crm_tickets${filter}`).bind(...args).first();
  const { results: tickets } = await db.prepare(`SELECT id,reference,name,email,company,subject,status,priority,assigned_to,follow_up_at,updated_at,metadata,tags FROM crm_tickets${filter} ORDER BY updated_at DESC LIMIT 50 OFFSET ?`).bind(...args, Math.floor(page) * 50).all();
  const { results: counts } = await db.prepare(`SELECT status,COUNT(*) AS count FROM crm_tickets WHERE ${where[0]} GROUP BY status`).all();
  const overdue = await db.prepare("SELECT COUNT(*) AS count FROM crm_tickets WHERE archived_at IS NULL AND follow_up_at<=? AND status NOT IN ('closed','spam')").bind(new Date().toISOString()).first();
  return { tickets, total: total.count, page: Math.floor(page), counts, overdue: overdue.count };
}
async function updateTicket(db, body, author) {
  const ticket = await getTicket(db, body.id);
  if (body.version !== ticket.version) throw crmError('This ticket changed. Refresh it before saving.', 409);
  if (!CRM_STATUSES.includes(body.status) || !CRM_ASSIGNEES.includes(body.assigned_to) || !CRM_PRIORITIES.includes(body.priority)) throw crmError('Invalid ticket settings.');
  if(body.assigned_to==='ben'&&ticket.assigned_to!=='ben')throw crmError('Ben has jobs access only. Keep the enquiry assigned to Nathan.');
  const updatedEmail = body.email === undefined ? ticket.email : (body.email ? email(body.email) : '');
  let metadata={};try{metadata=JSON.parse(ticket.metadata||'{}');}catch{metadata={};}
  if(body.lead_source!==undefined)metadata.lead_source=text(body.lead_source,80);
  if(body.lead_temperature!==undefined)metadata.lead_temperature=choice(body.lead_temperature,['cold','warm','hot'],'warm');
  const updatedTags=body.tags===undefined?(ticket.tags||'[]'):tags(body.tags);
  if(!updatedEmail&&ticket.email&&await db.prepare("SELECT id FROM crm_messages WHERE ticket_id=? AND kind='outbound' AND delivery IN ('queued','sending') LIMIT 1").bind(ticket.id).first())throw crmError('Finish or cancel the queued reply before removing the customer email.');
  let follow = null;
  if (body.follow_up_at) {
    const time = new Date(body.follow_up_at);
    if (!Number.isFinite(time.getTime()) || !/(Z|[+-]\d{2}:\d{2})$/.test(body.follow_up_at)) throw crmError('Follow-up time must include a timezone.');
    follow = time.toISOString();
  }
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const changes = `Email: ${updatedEmail || 'none'}. Status: ${body.status}. Assigned to: ${body.assigned_to}. Priority: ${body.priority}. Follow-up: ${follow || 'none'}. Lead source: ${metadata.lead_source || 'none'}. Temperature: ${metadata.lead_temperature || 'warm'}.`;
  const result = await db.batch([
    db.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,created_at,updated_at) SELECT ?,id,'event',?,?,?,? FROM crm_tickets WHERE id=? AND version=?").bind(auditId, author, changes, now, now, ticket.id, ticket.version),
    db.prepare('UPDATE crm_tickets SET email=?,status=?,assigned_to=?,priority=?,follow_up_at=?,metadata=?,tags=?,updated_at=?,version=version+1 WHERE id=? AND version=?').bind(updatedEmail, body.status, body.assigned_to, body.priority, follow, JSON.stringify(metadata), updatedTags, now, ticket.id, ticket.version),
    db.prepare("UPDATE crm_messages SET delivery='cancelled',updated_at=? WHERE ticket_id=? AND kind='outbound' AND delivery IN ('queued','failed') AND EXISTS(SELECT 1 FROM crm_tickets WHERE id=? AND status='spam')").bind(now, ticket.id, ticket.id),
    db.prepare("INSERT INTO crm_tasks(id,title,ticket_id,account_id,due_date,external_key,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ? IS NOT NULL AND ? NOT IN ('closed','spam') AND EXISTS(SELECT 1 FROM crm_messages WHERE id=?) ON CONFLICT(external_key) DO UPDATE SET title=excluded.title,due_date=excluded.due_date,status='open',completed_at=NULL,version=crm_tasks.version+1,updated_at=excluded.updated_at").bind('followup-'+ticket.id,'Follow up: '+ticket.name,ticket.id,ticket.account_id,follow?londonToday(new Date(follow)):null,'ticket-followup:'+ticket.id,now,now,follow,body.status,auditId),
    db.prepare("UPDATE crm_tasks SET status='cancelled',version=version+1,updated_at=? WHERE ticket_id=? AND status='open' AND ((external_key=? AND ? IS NULL AND ? IS NOT NULL) OR ? IN ('closed','spam')) AND EXISTS(SELECT 1 FROM crm_messages WHERE id=?)").bind(now,ticket.id,'ticket-followup:'+ticket.id,follow,ticket.follow_up_at,body.status,auditId),
  ]);
  if (!result[1].meta.changes) throw crmError('This ticket changed. Refresh it before saving.', 409);
}
export async function addMessage(db, env, body, author) {
  const ticket = await getTicket(db, body.id);
  const requestKey = key(body.request_key);
  const content = text(body.body, 16000);
  if (!content) throw crmError('Write a message first.');
  const kind = body.kind;
  if (!['note','outbound'].includes(kind)) throw crmError('Invalid message type.');
  const duplicate = await db.prepare('SELECT ticket_id,body,kind FROM crm_messages WHERE request_key=?').bind(requestKey).first();
  if (duplicate) {
    if (duplicate.ticket_id !== ticket.id || duplicate.body !== content || duplicate.kind !== kind) throw crmError('Request identifier already used for different content.', 409);
    return;
  }
  if (kind === 'outbound') {
    if(!ticket.email)throw crmError('This is a phone-only enquiry. Add an email address before replying by email.');
    if(ticket.archived_at)throw crmError('Restore this enquiry before replying.');
    if (!zohoConfigured(env)) throw crmError('Connect Zoho Mail before sending replies.', 503);
    if (ticket.status === 'spam') throw crmError('Move this ticket out of spam before replying.');
    if (ticket.email === CRM_MAILBOX) throw crmError('This ticket uses your own mailbox address.');
  }
  const now = new Date().toISOString(),messageId=crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO crm_messages(id,ticket_id,kind,author,body,delivery,request_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(messageId, ticket.id, kind, author, content, kind === 'outbound' ? 'queued' : 'received', requestKey, now, now),
    db.prepare("UPDATE crm_tickets SET status=CASE WHEN ?='outbound' AND status='new' THEN 'open' ELSE status END,updated_at=?,version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM crm_messages WHERE id=?)").bind(kind, now, ticket.id,messageId),
    db.prepare("UPDATE crm_tasks SET status='done',completed_at=?,updated_at=?,version=version+1 WHERE ticket_id=? AND status='open' AND (external_key LIKE 'ticket-followup:%' OR external_key LIKE 'reply-followup:%' OR external_key LIKE 'inbound-review:%') AND ?='outbound' AND EXISTS(SELECT 1 FROM crm_messages WHERE id=?)").bind(now,now,ticket.id,kind,messageId),
    db.prepare("INSERT OR IGNORE INTO crm_tasks(id,title,ticket_id,account_id,due_date,external_key,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ?='outbound' AND EXISTS(SELECT 1 FROM crm_messages WHERE id=?)").bind('reply-'+requestKey,'Follow up with '+ticket.name,ticket.id,ticket.account_id,plusDays(londonToday(),7),'reply-followup:'+requestKey,now,now,kind,messageId),
  ]);
  const saved=await db.prepare('SELECT ticket_id,body,kind FROM crm_messages WHERE request_key=?').bind(requestKey).first();
  if(!saved||saved.ticket_id!==ticket.id||saved.body!==content||saved.kind!==kind)throw crmError('Request identifier already used for different content.',409);
}
async function convertJob(db, ticketId, author) {
  const ticket = await getTicket(db, ticketId);
  if (ticket.status === 'spam') throw crmError('Move the ticket out of spam before creating a job.');
  if (ticket.job_id) return { job_id: ticket.job_id };
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO jobs(client_name,notes,status,assigned_to,created_at,updated_at) SELECT ?,?,'not_started',assigned_to,?,? FROM crm_tickets WHERE id=? AND job_id IS NULL").bind(ticket.company || ticket.name, `${ticket.reference}: ${ticket.subject}\n${ticket.email}\nhttps://nc-digital.co.uk/admin/crm/?ticket=${ticket.id}`, now, now, ticket.id),
    db.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,created_at,updated_at) SELECT ?,id,'event',?,'Created a linked job.',?,? FROM crm_tickets WHERE id=? AND job_id IS NULL").bind(crypto.randomUUID(), author, now, now, ticket.id),
    // SELECT the job via its unique reference, rather than last_insert_rowid (the audit insert also has a rowid).
    db.prepare("UPDATE crm_tickets SET job_id=(SELECT id FROM jobs WHERE notes=? ORDER BY id LIMIT 1),updated_at=?,version=version+1 WHERE id=? AND job_id IS NULL").bind(`${ticket.reference}: ${ticket.subject}\n${ticket.email}\nhttps://nc-digital.co.uk/admin/crm/?ticket=${ticket.id}`, now, ticket.id),
  ]);
  return { job_id: (await getTicket(db, ticket.id)).job_id };
}
export async function handleCrmApi(request, env, role) {
  if(new URL(request.url).pathname.startsWith('/admin/crm/api/workspace/'))return handleWorkspace(request,env,role);
  try {
    if (role !== 'nathan') throw crmError('CRM access is restricted to Nathan.', 403);
    const url = new URL(request.url);
    const route = url.pathname.replace('/admin/crm/api/', '').replace(/\/$/, '');
    if (!['GET','POST'].includes(request.method)) throw crmError('Method not allowed.', 405);
    if (request.method === 'POST') sameOrigin(request);
    const db = env.JOBS_DB;
    if (route === 'setup' && request.method === 'GET') {
      let ready = false;
      try { ready = Boolean(db && await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='crm_tickets'").first()); } catch { /* Show setup state without exposing internal errors. */ }
      return crmResponse({ enabled: env.CRM_ENABLED === 'true', database_ready: ready, ...zohoSetup(env), notifications_configured: zohoConfigured(env),
        last_sync: ready ? await stateGet(db, 'last_sync') : '', sync_error: ready ? await stateGet(db, 'sync_error') : '' });
    }
    if (!db) throw crmError('CRM database is not configured.', 503);
    if (request.method === 'GET') {
      if(route==='original') {
        const message=await db.prepare('SELECT full_body,body FROM crm_messages WHERE id=?').bind(key(url.searchParams.get('id'))).first();
        if(!message)throw crmError('Message not found.',404);
        return crmResponse({body:message.full_body||message.body});
      }
      if (route === 'list') return crmResponse(await list(db, url));
      if (route === 'ticket') return crmResponse(await detail(db, url.searchParams.get('id')));
    } else {
      const body = await readJson(request);
      if (route === 'update') { await updateTicket(db, body, role); return crmResponse(await detail(db, body.id)); }
      if (route === 'message') { await addMessage(db, env, body, role); return crmResponse(await detail(db, body.id), 201); }
      if (route === 'job') return crmResponse(await convertJob(db, body.id, role));
      if (route === 'sync') return crmResponse(await syncZoho(env));
      if (route === 'retry') {
        const result = await db.prepare("UPDATE crm_messages SET delivery='queued',send_context=NULL,error=NULL,updated_at=? WHERE id=? AND delivery='failed' AND EXISTS(SELECT 1 FROM crm_tickets t WHERE t.id=ticket_id AND t.status<>'spam' AND t.archived_at IS NULL)").bind(new Date().toISOString(), key(body.message_id)).run();
        if (!result.meta.changes) throw crmError('Only explicitly failed messages can be retried. Check Zoho for unconfirmed deliveries.', 409);
        return crmResponse({ ok: true });
      }
    }
    throw crmError('Not found.', 404);
  } catch (error) { return failure(error); }
}
