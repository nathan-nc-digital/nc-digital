export const CRM_MAILBOX = 'nathan@nc-digital.co.uk';
export const CRM_FROM_ADDRESS = `NC Digital <${CRM_MAILBOX}>`;
export const CRM_STATUSES = ['new', 'open', 'waiting', 'closed', 'spam'];
export const CRM_ASSIGNEES = ['nathan', 'ben'];
export const CRM_PRIORITIES = ['low', 'normal', 'high'];
export function crmError(message, status = 400) { return Object.assign(new Error(message), { status, publicMessage: message }); }
export function text(value, max, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > max) throw crmError(`Invalid field (maximum ${max} characters).`);
  return value.replace(/\u0000/g, '').trim();
}
export function email(value) {
  const v = text(value, 254).toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(v)) throw crmError('Enter a valid email address.');
  return v;
}
export function key(value) {
  const v = text(value, 80);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(v)) throw crmError('Missing request identifier. Refresh and try again.');
  return v;
}
export function ticketSubject(ticket) { return `[${ticket.reference}] ${ticket.subject}`; }
// Customer-facing subject: keeps the reference the mailbox sync matches on, but never the form/ad-source wording (e.g. "websites from £170 (Meta)"), which reads as promotional to spam filters and to the customer.
export function customerSubject(ticket, { reply = false } = {}) { return `${reply ? 'Re: ' : ''}Your enquiry to NC Digital [${ticket.reference}]`; }
export function cleanSubject(value) { return text(value, 180, 'Website enquiry').replace(/[\r\n]/g, ' '); }
export async function enquiryHash(data) {
  const { submission_key, ...payload } = data;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2,'0')).join('');
}
export function normaliseEnquiry(body) {
  const name = text(body.name, 120);
  if (!name) throw crmError('Please enter your name.');
  const metadata = {};
  for (const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','website_type','website_url','referrer','lead_source','lead_temperature','calculator_build_total','calculator_hosting','calculator_breakdown']) {
    if (body[k]) metadata[k] = text(body[k], 500);
  }
  if (metadata.website_url) {
    let url; try { url = new URL(metadata.website_url); } catch { throw crmError('Enter a valid website URL.'); }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw crmError('Website must use http:// or https:// without login details.');
  }
  const source = text(body.from_page, 500);
  if (source && (!source.startsWith('/') || source.startsWith('//'))) throw crmError('Invalid form page.');
  return { name, email: email(body.email), phone: text(body.phone, 60), company: text(body.company, 160),
    subject: cleanSubject(body.subject), service: text(body.service, 180), source_page: source,
    metadata: JSON.stringify(metadata), body: text(body.message, 16000) || 'Customer requested a website quote. No additional message provided.',
    submission_key: key(body.submission_key) };
}
export async function limitedText(response, limit = 40000) {
  if (Number(response.headers.get('content-length')) > limit) throw crmError('Request is too large.', 413);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw crmError('Request is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
export async function readJson(request, limit = 40000) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw crmError('Expected JSON.', 415);
  let body;
  try { body = JSON.parse(await limitedText(request, limit)); } catch (error) { if (error.status) throw error; throw crmError('Invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw crmError('Invalid request.');
  return body;
}
export function sameOrigin(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw crmError('Refresh the page and try again.', 403);
}
export function crmResponse(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store, private', 'Cloudflare-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function failure(error) {
  const conflicts={crm_parent_archived:'Restore the customer before adding or changing linked records.',crm_customer_has_open_work:'Resolve open opportunities, tasks, quotes and services before archiving this customer.',crm_relationship_mismatch:'These records belong to different customers. Reload and check their links.',crm_linked_opportunity_cannot_move:'This opportunity already has linked tasks or quotes. Keep it with its current customer.'};
  const constraint=Object.keys(conflicts).find(code=>String(error.message).includes(code));
  if(constraint)return crmResponse({error:conflicts[constraint]},409);
  if (!error.status) console.error(JSON.stringify({ event: 'crm_error', type: error.name || 'Error' }));
  return crmResponse({ error: error.publicMessage || 'The CRM could not complete this request. Check the database setup and try again.' }, error.status || 500);
}
export async function stateGet(db, keyName, fallback = '') { return (await db.prepare('SELECT value FROM crm_state WHERE key=?').bind(keyName).first())?.value ?? fallback; }
export async function stateSet(db, keyName, value) { await db.prepare('INSERT INTO crm_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(keyName, String(value)).run(); }
export async function acquireLock(db, lockName, seconds = 240) {
  const owner = `${Date.now() + seconds * 1000}:${crypto.randomUUID()}`;
  const result = await db.prepare("INSERT INTO crm_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(substr(crm_state.value,1,instr(crm_state.value,':')-1) AS INTEGER) < ?").bind(lockName, owner, Date.now()).run();
  return result.meta.changes ? owner : null;
}
export async function releaseLock(db, lockName, owner) { await db.prepare('DELETE FROM crm_state WHERE key=? AND value=?').bind(lockName, owner).run(); }
