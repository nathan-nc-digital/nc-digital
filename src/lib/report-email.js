// Emailing a report link from the CRM mailbox, shared by website reviews and SEO reports. The
// recipient becomes (or reuses) a CRM conversation so replies thread back into the inbox, and a
// follow-up task is booked three days out.
import { email as validEmail, key, enquiryHash, CRM_MAILBOX } from './crm.js';
import { addMessage } from './crm-api.js';
import { zohoConfigured } from './crm-zoho.js';
import { londonToday, plusDays } from './crm-domain.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();

// 18 random bytes as base64url: 24 characters, 144 bits, so links cannot be guessed or enumerated.
export const newShareToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, '-').replace(/\//g, '_');

// Validates the request before anything is created. Returns null when this request key was already sent.
export async function reportEmailRequest(db, env, body) {
  const name = String(body.name || '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 120);
  let to; try { to = validEmail(body.email); } catch { throw fail('Enter a valid email address for the client.'); }
  if (to === CRM_MAILBOX) throw fail('Use the client’s email address, not your own mailbox.');
  const message = String(body.message || '').trim().slice(0, 8000);
  if (message.length < 10) throw fail('Write the email message first.');
  if (env.CRM_ENABLED !== 'true' || !zohoConfigured(env)) throw fail('Connect Zoho Mail in the CRM before emailing reports.', 503);
  let requestKey; try { requestKey = key(body.request_key); } catch { throw fail('Refresh the page and try again.'); }
  if (await db.prepare('SELECT id FROM crm_messages WHERE request_key=?').bind(requestKey).first()) return null;
  return { name, to, message, requestKey };
}

// source: the ticket's source_page ('website-audit' or 'seo-report'), which also sets the email subject.
export async function queueReportEmail(db, env, { name, to, message, requestKey, url, linkLabel, company, service, source, subject, note, taskTitle, followUpKey, metadata }) {
  const at = now(), due = plusDays(londonToday(), 3);
  if (!message.includes(url)) message += `\n\n${linkLabel}\n${url}`;
  let ticket = await db.prepare("SELECT id,reference FROM crm_tickets WHERE lower(email)=? AND archived_at IS NULL AND status NOT IN ('spam','closed') ORDER BY updated_at DESC LIMIT 1").bind(to).first();
  if (!ticket) {
    const id = crypto.randomUUID(), reference = 'NC-' + id.replace(/-/g, '').slice(0, 16).toUpperCase();
    await db.batch([
      db.prepare('INSERT INTO crm_tickets(id,reference,submission_key,submission_hash,name,email,company,subject,service,source_page,metadata,created_at,updated_at,last_inbound_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, reference, id, await enquiryHash({ source, email: to, url, at }), name || company, to, company, subject, service || '', source, JSON.stringify(metadata), at, at, at),
      db.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,created_at,updated_at) VALUES(?,?,'note','nathan',?,?,?)").bind(crypto.randomUUID(), id, note, at, at),
      db.prepare('INSERT INTO crm_tasks(id,title,ticket_id,due_date,external_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('followup-' + id, taskTitle, id, due, 'ticket-followup:' + id, at, at),
    ]);
    ticket = { id, reference };
  } else {
    await db.batch([
      db.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,created_at,updated_at) VALUES(?,?,'note','nathan',?,?,?)").bind(crypto.randomUUID(), ticket.id, note, at, at),
      db.prepare('INSERT OR IGNORE INTO crm_tasks(id,title,ticket_id,due_date,external_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), taskTitle, ticket.id, due, followUpKey + ':' + ticket.id, at, at),
    ]);
  }
  await addMessage(db, env, { id: ticket.id, kind: 'outbound', body: message, request_key: requestKey }, 'nathan');
  return { to, name, at, ticketId: ticket.id, reference: ticket.reference };
}
