import { parseFragment } from 'parse5';
import { CRM_MAILBOX, CRM_FROM_ADDRESS, crmError, limitedText, ticketSubject, customerSubject, stateGet, stateSet, acquireLock, releaseLock } from './crm.js';
import { cachedZohoToken } from './crm-token.js';
import { syncMailbox } from './crm-sync.js';

const REGIONS = { eu: ['https://accounts.zoho.eu', 'https://mail.zoho.eu'], com: ['https://accounts.zoho.com', 'https://mail.zoho.com'] };
export function zohoConfigured(env) {
  return Boolean(REGIONS[env.ZOHO_REGION] && /^\d+$/.test(env.ZOHO_ACCOUNT_ID || '') && env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN);
}
export function zohoSetup(env) {
  return { configured: zohoConfigured(env), mailbox: CRM_MAILBOX, region: env.ZOHO_REGION || null,
    missing: ['ZOHO_REGION','ZOHO_ACCOUNT_ID','ZOHO_CLIENT_ID','ZOHO_CLIENT_SECRET','ZOHO_REFRESH_TOKEN'].filter(k => !env[k]),
    webmail: REGIONS[env.ZOHO_REGION]?.[1] || 'https://www.zoho.com/mail/login.html' };
}
async function providerJson(url, options) {
  let response;
  try { response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
  catch { throw crmError('Zoho did not confirm the request. Check the mailbox before attempting another send.', 502); }
  // The deployed Workers runtime supports manual/follow, but not redirect:error.
  // Never forward the authorisation header or token body to a redirect target.
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw crmError('Zoho returned an unexpected redirect. Check the configured account region.', 502);
  }
  let data;
  try { data = JSON.parse(await limitedText(response, 1500000)); }
  catch { throw crmError('Zoho returned an unreadable response.', 502); }
  if (!response.ok || data.error || (data.status?.code && Number(data.status.code) >= 400)) {
    if (url.endsWith('/oauth/v2/token') && ['Access Denied', 'access_denied'].includes(data.error)) {
      throw crmError('Zoho temporarily denied authorisation. Its token request limit may have been reached; wait ten minutes before retrying. If it persists, check account access.', 502);
    }
    // Only explicit provider rejection is safe to retry; never expose tokens or raw upstream errors.
    const code = Number(data.status?.code) >= 400 ? Number(data.status.code) : response.status;
    throw Object.assign(crmError(`Zoho did not accept the request (${code}). Check the mailbox connection and permissions.`, 502), { rejected: [400,401,403,404,405,413,415,422,429].includes(code) });
  }
  return data;
}
export async function zohoClient(env) {
  if (!zohoConfigured(env)) throw crmError('Connect Zoho Mail before sending or syncing replies.', 503);
  const [accounts, mail] = REGIONS[env.ZOHO_REGION];
  const accessToken = await cachedZohoToken(env, () => providerJson(`${accounts}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.ZOHO_REFRESH_TOKEN, client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET }) }));
  if (!accessToken || typeof accessToken !== 'string') throw crmError('Zoho did not issue an access token.', 502);
  const base = `${mail}/api/accounts/${env.ZOHO_ACCOUNT_ID}`;
  return async (path, body) => providerJson(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
export function mailText(html) {
  if (String(html || '').length > 500000) throw crmError('Email is too large to import safely. Open Zoho to view it.', 502);
  const root = parseFragment(String(html || ''));
  const lines = [];
  function visit(node) {
    if (['script','style','iframe','object','svg'].includes(node.tagName)) return;
    if (node.nodeName === '#text') lines.push(node.value);
    if (['br','p','div','li','tr','blockquote'].includes(node.tagName)) lines.push('\n');
    for (const child of node.childNodes || []) visit(child);
    if (['p','div','li','tr','blockquote'].includes(node.tagName)) lines.push('\n');
  }
  visit(root);
  return lines.join('').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}
export function trimQuotedReply(value) {
  let body = String(value || '').trim();
  body = body.replace(/\n(?:On [^\n]{1,240} wrote:|[-_]{2,}\s*Original Message\s*[-_]{2,})[\s\S]*$/i, '').trim();
  // This is only a display excerpt. The full plaintext and source are retained.
  // A standalone > line can be a genuine answer, not an email quote marker.
  return body.slice(0, 32000);
}
export function messageTicketReference(subject) { return String(subject || '').match(/\[(NC-[A-F0-9]{16})\]/i)?.[1].toUpperCase() || null; }
export function senderAddress(value) {
  const s = String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim().toLowerCase();
  return s.match(/<([^<>]+)>/)?.[1] || s;
}
function htmlEscape(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
}
export function crmEmailHtml(value, quoted = '') {
  const body = htmlEscape(String(value || '').slice(0, 32000));
  const paragraphs = body.split(/\n{2,}/).map(part => `<p style="margin:0 0 16px;">${part.replace(/\n/g, '<br>')}</p>`).join('');
  const quotedText = typeof quoted === 'string' ? quoted : quoted?.body;
  const quote = quotedText ? `<div style="margin-top:28px;padding:14px 16px;border-left:3px solid #d8d2ff;color:#667085;font-size:13px;line-height:1.5;"><p style="margin:0 0 8px;font-weight:700;color:#52606d;">Your original message:</p><div>${htmlEscape(String(quotedText).slice(0, 16000)).replace(/\n/g, '<br>')}</div></div>` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1b2430;font-size:15px;line-height:1.6;max-width:640px;">${paragraphs}<p style="margin:24px 0 0;">Kind regards,<br>Nathan</p><img src="https://nc-digital.co.uk/images/email-signature.jpg" alt="NC Digital email signature" width="500" style="display:block;width:100%;max-width:500px;height:auto;margin-top:12px;border:0;">${quote}</div>`;
}
export async function syncZoho(env) {
  return syncMailbox(env,zohoClient,{mailText,trimQuotedReply,messageTicketReference,senderAddress});
}

export async function deliverCrmOutbox(env) {
  const db = env.JOBS_DB;
  const owner = await acquireLock(db, 'send_lock');
  if (!owner) return;
  try {
    const stale = new Date(Date.now() - 300000).toISOString();
    await db.prepare("UPDATE crm_messages SET delivery='unknown',error='Delivery was interrupted. Check Zoho before resending.' WHERE delivery='sending' AND updated_at < ?").bind(stale).run();
    const { results } = await db.prepare("SELECT m.*,t.email,t.subject,t.reference,t.name,t.phone,t.company,t.service FROM crm_messages m JOIN crm_tickets t ON t.id=m.ticket_id WHERE m.delivery='queued' AND t.archived_at IS NULL AND t.status<>'spam' ORDER BY m.rowid LIMIT 3").all();
    let api;
    for (const row of results) {
      if ((row.kind === 'outbound' || row.kind === 'notification') && !zohoConfigured(env)) continue;
      if ((row.kind === 'outbound' || row.kind === 'notification') && !api) api = await zohoClient(env); // Refresh before claiming; a refresh failure cannot have sent email.
      const claim = await db.prepare("UPDATE crm_messages SET delivery='sending',updated_at=? WHERE id=? AND delivery='queued' AND EXISTS(SELECT 1 FROM crm_tickets t WHERE t.id=ticket_id AND t.archived_at IS NULL AND t.status<>'spam')").bind(new Date().toISOString(), row.id).run();
      if (!claim.meta.changes) continue;
      const attemptId = crypto.randomUUID();
      await db.prepare("INSERT INTO crm_message_attempts(id,message_id,started_at,outcome) VALUES(?,?,?,'sending')").bind(attemptId,row.id,new Date().toISOString()).run();
      try {
        let providerId = null;
        if (row.kind === 'notification' || row.kind === 'outbound') {
          const isNotification = row.kind === 'notification';
          const content = isNotification ? `${row.body}\n\nManage this enquiry: https://nc-digital.co.uk/admin/crm/?ticket=${row.ticket_id}` : row.body;
          const firstInbound = !isNotification ? await db.prepare("SELECT body FROM crm_messages WHERE ticket_id=? AND kind='inbound' ORDER BY created_at ASC,id ASC LIMIT 1").bind(row.ticket_id).first() : null;
          const latestInbound = !isNotification ? await db.prepare("SELECT provider_id FROM crm_messages WHERE ticket_id=? AND kind='inbound' ORDER BY created_at DESC,id DESC LIMIT 1").bind(row.ticket_id).first() : null;
          const previousOutbound = !isNotification ? await db.prepare("SELECT id FROM crm_messages WHERE ticket_id=? AND kind='outbound' AND id<>? AND (rowid < (SELECT rowid FROM crm_messages WHERE id=?) OR delivery IN ('sent','unknown','sending')) AND delivery NOT IN ('failed','cancelled') LIMIT 1").bind(row.ticket_id, row.id, row.id).first() : null;
          const includeContext = row.send_context === null ? !previousOutbound : Boolean(row.send_context);
          if (!isNotification && row.send_context === null) await db.prepare('UPDATE crm_messages SET send_context=? WHERE id=?').bind(includeContext?1:0,row.id).run();
          const quoted = !isNotification && includeContext && firstInbound ? [
            firstInbound.body,
            '',
            `Name: ${row.name}`,
            `Email: ${row.email}`,
            row.phone ? `Phone: ${row.phone}` : '',
            row.company ? `Company: ${row.company}` : '',
            row.service ? `Service: ${row.service}` : '',
          ].filter(Boolean).join('\n') : '';
          const replyId = !isNotification ? latestInbound?.provider_id : null;
          const payload = { fromAddress: CRM_FROM_ADDRESS, toAddress: isNotification ? CRM_MAILBOX : row.email, subject: isNotification ? `New CRM enquiry ${ticketSubject(row)}` : customerSubject(row, { reply: Boolean(replyId) }), content: crmEmailHtml(content, quoted), mailFormat: 'html', encoding: 'UTF-8', ...(replyId ? { action: 'reply' } : {}) };
          const result = await api(`/messages${replyId ? '/' + replyId : ''}`, payload);
          providerId = result.data?.messageId ? String(result.data.messageId) : null;
          if (!providerId || !/^\d+$/.test(providerId)) throw crmError('Zoho returned no valid sending receipt. Check Zoho before resending.',502);
        }
        const now = new Date().toISOString();
        await db.batch([
          db.prepare("UPDATE crm_messages SET delivery='sent',provider_id=?,error=NULL,updated_at=? WHERE id=?").bind(providerId, now, row.id),
          db.prepare("UPDATE crm_message_attempts SET outcome='accepted',provider_id=?,finished_at=? WHERE id=?").bind(providerId,now,attemptId),
          db.prepare("UPDATE crm_quotes SET status='sent',sent_at=?,updated_at=?,version=version+1 WHERE id=? AND revision=? AND status='queued'").bind(now,now,row.quote_id,row.quote_revision),
          db.prepare("UPDATE crm_tickets SET status=CASE WHEN ?='outbound' AND status IN ('new','open','waiting') AND last_inbound_at<=? THEN 'waiting' ELSE status END,updated_at=?,version=version+1 WHERE id=?").bind(row.kind, row.created_at, now, row.ticket_id),
        ]);
      } catch (error) {
        await db.prepare('UPDATE crm_messages SET delivery=?,error=?,updated_at=? WHERE id=?').bind(error.rejected ? 'failed' : 'unknown', error.publicMessage || 'Delivery not confirmed. Check your mailbox before resending.', new Date().toISOString(), row.id).run();
        await db.prepare('UPDATE crm_message_attempts SET outcome=?,finished_at=? WHERE id=?').bind(error.rejected?'failed':'unknown',new Date().toISOString(),attemptId).run();
      }
    }
    await stateSet(db,'last_send_check',new Date().toISOString());
  } finally { await releaseLock(db, 'send_lock', owner); }
}
export async function runCrmSchedule(env) {
  if (env.CRM_ENABLED !== 'true' || !env.JOBS_DB) return;
  for (const task of [() => deliverCrmOutbox(env), ...(zohoConfigured(env) ? [() => syncZoho(env)] : [])]) {
    try { await task(); } catch { console.error(JSON.stringify({ event: 'crm_background_failed' })); }
  }
}
