import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { crmDatabase } from '../helpers/crm-db.mjs';
import { parsePage } from '../../src/lib/website-audit.js';
import { handleWebsiteAudit, handlePublicReport, runReportAlerts } from '../../src/lib/website-audit-api.js';
import { customerSubject } from '../../src/lib/crm.js';
import { handleCrmApi } from '../../src/lib/crm-api.js';
import { reviewEmailCopy, documentHtml, similarWork } from '../../src/lib/audit-report-view.js';
import { rankingFrom } from '../../src/lib/audit-local-search.js';

const origin = 'https://nc-digital.co.uk';
const zoho = { ZOHO_REGION: 'eu', ZOHO_ACCOUNT_ID: '123', ZOHO_CLIENT_ID: 'id', ZOHO_CLIENT_SECRET: 'secret', ZOHO_REFRESH_TOKEN: 'refresh' };
const html = '<html lang="en"><head><title>Plumbing and heating in Merthyr</title><meta name="viewport" content="width=device-width"></head><body><h1>Plumbers</h1><p>Call 01685 123456</p></body></html>';

function setup(t, extra = {}) {
  const db = crmDatabase(t);
  const state = { phase: 'done', maxPages: 5, finalUrl: 'https://dowlais.example.co.uk/', origin: 'https://dowlais.example.co.uk', pages: [{ url: 'https://dowlais.example.co.uk/', status: 200, parsed: parsePage(html, 'https://dowlais.example.co.uk/') }], linkChecks: [], skipped: [], warnings: [], discovered: [], queue: [], robots: '',
    local: { service: 'plumber', town: 'merthyr tydfil', townLabel: 'Merthyr Tydfil', keywords: [{ keyword: 'plumber merthyr tydfil', volume: 260, cpc: 8, checked: true, position: null, mapPackShown: true, inMapPack: false, mapPack: ['A'], top3: [] }] } };
  db.sqlite.prepare("INSERT INTO website_audits(id,url,client,created_at,updated_at,status,state) VALUES('audit-1','https://dowlais.example.co.uk/','Dowlais Heating','2026-09-23T10:00:00Z','2026-09-23T10:00:00Z','complete',?)").run(JSON.stringify(state));
  return { JOBS_DB: db, CRM_ENABLED: 'true', ...zoho, ...extra };
}
const post = (env, route, body) => handleWebsiteAudit(new Request(origin + '/admin/website-audit/api/' + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
async function ok(response) { const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data; }

test('the written email covers the findings, the link and never adds a second sign-off', () => {
  const copy = reviewEmailCopy({ client: 'Dowlais Heating', url: 'https://dowlais.example.co.uk/', finalUrl: 'https://dowlais.example.co.uk/', pagesChecked: 2, findings: [], speed: null,
    local: { service: 'plumber', townLabel: 'Merthyr Tydfil', keywords: [{ keyword: 'plumber merthyr tydfil', volume: 260, cpc: 8, checked: true, position: null, mapPackShown: true, inMapPack: false }, { keyword: 'plumbers merthyr tydfil', volume: 260, cpc: 8, checked: true, position: 18 }] } }, 'Gareth Evans', 'https://nc-digital.co.uk/report/TOKEN');
  assert.match(copy, /^Hi Gareth,/);
  assert.match(copy, /dowlais\.example\.co\.uk/);
  assert.match(copy, /around 520 people a month/i);
  assert.match(copy, /not on the first page .* any of the 2 searches/);
  assert.match(copy, /Google Maps/);
  assert.match(copy, /https:\/\/nc-digital\.co\.uk\/report\/TOKEN/);
  assert.doesNotMatch(copy, /Kind regards|Nathan$/, 'the CRM adds the sign-off and signature');
  const plain = reviewEmailCopy({ client: 'Example', url: 'https://example.co.uk/', pagesChecked: 3, findings: [{ priority: 'high', title: 'x' }, { priority: 'medium', title: 'y' }], local: null }, '', 'https://nc-digital.co.uk/report/T');
  assert.match(plain, /^Hi,/);
  assert.match(plain, /2 things/);
});

test('emailing a report creates a CRM lead, queues the email from the CRM mailbox and books a follow-up', async t => {
  const env = setup(t), key = crypto.randomUUID();
  const report = await ok(await post(env, 'email', { id: 'audit-1', name: 'Gareth Evans', email: 'Gareth@Dowlais.example.co.uk', message: 'Hi Gareth,\n\nHere is your review.', request_key: key }));
  const ticket = env.JOBS_DB.sqlite.prepare("SELECT * FROM crm_tickets WHERE source_page='website-audit'").get();
  assert.ok(ticket);
  assert.equal(ticket.email, 'gareth@dowlais.example.co.uk');
  assert.equal(ticket.name, 'Gareth Evans');
  assert.equal(ticket.company, 'Dowlais Heating');
  assert.equal(ticket.service, 'plumber');
  assert.equal(JSON.parse(ticket.metadata).lead_source, 'website-audit');
  const messages = env.JOBS_DB.sqlite.prepare('SELECT kind,body,delivery FROM crm_messages WHERE ticket_id=? ORDER BY created_at').all(ticket.id);
  assert.ok(!messages.some(m => m.kind === 'inbound'), 'an outreach email is never recorded as if the customer wrote it');
  const outbound = messages.find(m => m.kind === 'outbound');
  assert.equal(outbound.delivery, 'queued');
  assert.ok(outbound.body.includes(report.share.url), 'the report link is always in the email');
  assert.ok(messages.some(m => m.kind === 'note' && m.body.includes(report.share.url)));
  const task = env.JOBS_DB.sqlite.prepare('SELECT * FROM crm_tasks WHERE ticket_id=?').get(ticket.id);
  assert.match(task.title, /Follow up website review/);
  assert.ok(task.due_date > new Date().toISOString().slice(0, 10));
  assert.equal(report.emails.length, 1);
  assert.equal(report.emails[0].to, 'gareth@dowlais.example.co.uk');
  assert.equal(report.emails[0].reference, ticket.reference);
  await ok(await post(env, 'email', { id: 'audit-1', name: 'Gareth Evans', email: 'gareth@dowlais.example.co.uk', message: 'Hi Gareth,\n\nHere is your review.', request_key: key }));
  assert.equal(env.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_messages WHERE kind='outbound'").get().n, 1, 'a repeated click never sends twice');
  assert.equal(customerSubject({ ...ticket, reference: ticket.reference }), `Your website review from NC Digital [${ticket.reference}]`);
});

test('an existing open conversation with the same email is reused rather than duplicated', async t => {
  const env = setup(t);
  env.JOBS_DB.sqlite.prepare("INSERT INTO crm_tickets(id,reference,submission_key,name,email,subject,created_at,updated_at,last_inbound_at,status) VALUES('ticket-existing-000001','NC-EXISTING','k-1','Gareth','gareth@dowlais.example.co.uk','Quote please','2026-09-01','2026-09-01','2026-09-01','open')").run();
  await ok(await post(env, 'email', { id: 'audit-1', name: 'Gareth', email: 'gareth@dowlais.example.co.uk', message: 'Hi Gareth,\n\nHere is your review.', request_key: crypto.randomUUID() }));
  assert.equal(env.JOBS_DB.sqlite.prepare('SELECT COUNT(*) n FROM crm_tickets').get().n, 1);
  assert.equal(env.JOBS_DB.sqlite.prepare("SELECT COUNT(*) n FROM crm_messages WHERE ticket_id='ticket-existing-000001' AND kind='outbound'").get().n, 1);
});

test('bad addresses, empty messages and a disconnected mailbox are refused before anything is created', async t => {
  const env = setup(t);
  assert.equal((await post(env, 'email', { id: 'audit-1', name: 'G', email: 'not-an-email', message: 'Hello there, here is the review.', request_key: crypto.randomUUID() })).status, 400);
  assert.equal((await post(env, 'email', { id: 'audit-1', name: 'G', email: 'g@example.co.uk', message: '', request_key: crypto.randomUUID() })).status, 400);
  assert.equal((await post(env, 'email', { id: 'audit-1', name: 'G', email: 'nathan@nc-digital.co.uk', message: 'Hello there, here is the review.', request_key: crypto.randomUUID() })).status, 400);
  const offline = setup(t, { ZOHO_REFRESH_TOKEN: '' });
  assert.equal((await post(offline, 'email', { id: 'audit-1', name: 'G', email: 'g@example.co.uk', message: 'Hello there, here is the review.', request_key: crypto.randomUUID() })).status, 503);
  assert.equal(env.JOBS_DB.sqlite.prepare('SELECT COUNT(*) n FROM crm_tickets').get().n, 0);
});

test('a quote request from the review page lands in the CRM with the review it came from', async t => {
  const { handleEnquiry } = await import('../../src/lib/crm-api.js');
  const env = setup(t);
  const payload = { name: 'Gareth Evans', email: 'gareth@dowlais.example.co.uk', phone: '07700 900123', company: 'Dowlais Heating', message: 'Hi Nathan, I have read the website review for Dowlais Heating and I would like a free quote for a new multi-page WordPress website.', subject: 'Website review enquiry: Dowlais Heating', service: 'Multi-page WordPress website', from_page: '/report/AbCdEfGhIjKlMnOpQrStUv_-', website_url: 'https://dowlais.example.co.uk/', lead_source: 'Website review link', lead_temperature: 'hot', submission_key: crypto.randomUUID(), botcheck: '' };
  const response = await handleEnquiry(new Request(origin + '/api/enquiries', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify(payload) }), env);
  assert.equal(response.status, 201, await response.clone().text());
  const ticket = env.JOBS_DB.sqlite.prepare('SELECT * FROM crm_tickets').get();
  assert.equal(ticket.source_page, '/report/AbCdEfGhIjKlMnOpQrStUv_-');
  assert.equal(ticket.phone, '07700 900123');
  assert.equal(ticket.service, 'Multi-page WordPress website');
  const meta = JSON.parse(ticket.metadata);
  assert.equal(meta.lead_source, 'Website review link');
  assert.equal(meta.lead_temperature, 'hot');
  assert.equal(meta.website_url, 'https://dowlais.example.co.uk/');
  const kinds = env.JOBS_DB.sqlite.prepare('SELECT kind FROM crm_messages WHERE ticket_id=?').all(ticket.id).map(m => m.kind).sort();
  assert.deepEqual(kinds, ['confirmation', 'inbound', 'notification'], 'Nathan is alerted and the prospect gets a confirmation');
});

test('Google Maps competitors show their rating and review count, and the client is flagged when missing', () => {
  const serp = { items: [
    { type: 'local_pack', title: 'L Murphy Plumbing', domain: 'lmurphy.co.uk', rating: { rating_type: 'Max5', value: 4.9, votes_count: 87, rating_max: 5 } },
    { type: 'local_pack', title: 'Elite Plumbing & Gas', rating: { value: 4.8, votes_count: 1 } },
    { type: 'local_pack', title: 'No Reviews Ltd' },
  ] };
  const ranking = rankingFrom(serp, 'https://dowlais.example.co.uk/', 'Dowlais Heating');
  assert.deepEqual(ranking.mapPackDetails, [{ title: 'L Murphy Plumbing', rating: 4.9, reviews: 87 }, { title: 'Elite Plumbing & Gas', rating: 4.8, reviews: 1 }, { title: 'No Reviews Ltd', rating: null, reviews: null }]);
  const html = documentHtml({ client: 'Dowlais Heating', createdAt: '2026-09-23T10:00:00Z', url: 'https://d.co.uk/', status: 'complete', summary: '', notes: '', maxPages: 5, pagesChecked: 2, findings: [],
    local: { service: 'plumber', townLabel: 'Merthyr Tydfil', keywords: [{ keyword: 'plumber merthyr tydfil', volume: 260, checked: true, position: null, ...ranking }] } });
  assert.match(html, /4\.9 ★ · 87 Google reviews/);
  assert.match(html, /4\.8 ★ · 1 Google review</);
  assert.match(html, /Dowlais Heating is not shown here/);
});

test('similar case studies favour the same trade, then the same industry, and never show unrelated work', () => {
  const portfolio = [
    { slug: 'web-design-south-wales', title: 'Web Design South Wales', industry: ['agency'], image: '/_astro/a.webp' },
    { slug: 'k-williams-roofing', title: 'K Williams Roofing', industry: ['trades'], image: '/_astro/b.webp' },
    { slug: 'ir-energy', title: 'IR Energy', industry: ['energy'], image: null },
    { slug: 'pro-tech-plumbing', title: 'Pro Tech Plumbing and Bathrooms', industry: ['trades'], image: '/_astro/c.webp' },
    { slug: 'ds-carpentry', title: 'DS Carpentry', industry: ['trades'], image: '/_astro/d.webp' },
  ];
  assert.deepEqual(similarWork(portfolio, { local: { service: 'plumber' } }).map(p => p.slug), ['pro-tech-plumbing', 'k-williams-roofing', 'ds-carpentry']);
  assert.equal(similarWork(portfolio, { local: { service: 'roofer' } })[0].slug, 'k-williams-roofing');
  assert.deepEqual(similarWork(portfolio, { local: { service: 'gym' } }), [], 'no similar work, no section');
  assert.deepEqual(similarWork(portfolio, { local: { service: 'accountant' } }), []);
  assert.deepEqual(similarWork(portfolio, { local: null }), [], 'no service to match against');
  assert.equal(similarWork(portfolio, { local: { service: 'solar installer' } })[0].slug, 'ir-energy', 'the specific industry comes before general trades work');
  assert.deepEqual(similarWork([], { local: { service: 'plumber' } }), []);
  const html = documentHtml({ client: 'Dowlais Heating', createdAt: '2026-09-23T10:00:00Z', url: 'https://d.co.uk/', status: 'complete', summary: '', notes: '', maxPages: 5, pagesChecked: 2, findings: [], offerView: { type: 'website', platform: 'Wix' }, local: { service: 'plumber', townLabel: 'Merthyr Tydfil', keywords: [] } }, { portfolio });
  assert.match(html, /Similar work we have done/);
  assert.match(html, /https:\/\/nc-digital\.co\.uk\/portfolio\/pro-tech-plumbing\//);
  assert.match(html, /src="https:\/\/nc-digital\.co\.uk\/_astro\/c\.webp"/, 'absolute image links also work in the downloaded report');
  const gym = documentHtml({ client: 'Horizn Fitness', createdAt: '2026-09-23T10:00:00Z', url: 'https://x.co.uk/', status: 'complete', summary: '', notes: '', maxPages: 5, pagesChecked: 1, findings: [], offerView: { type: 'website', platform: null }, local: { service: 'gym', townLabel: 'Merthyr Tydfil', keywords: [] } }, { portfolio });
  assert.doesNotMatch(gym, /Similar work/, 'no unrelated case studies');
  assert.match(gym, /href="https:\/\/nc-digital\.co\.uk\/portfolio\/"[^>]*>See the websites we have built for other local businesses/, 'links to the whole portfolio instead');
  assert.doesNotMatch(html, /See the websites we have built/, 'no generic link when there is matching work');
  const seo = documentHtml({ client: 'Dowlais Heating', createdAt: '2026-09-23T10:00:00Z', url: 'https://d.co.uk/', status: 'complete', summary: '', notes: '', maxPages: 5, pagesChecked: 2, findings: [], offerView: { type: 'seo', platform: 'WordPress' }, local: { service: 'plumber', townLabel: 'Merthyr Tydfil', keywords: [] } }, { portfolio });
  assert.match(seo, /Local SEO to get Dowlais Heating/);
  assert.doesNotMatch(seo, /Similar work|See the websites we have built/, 'the SEO offer shows no portfolio');
});

test('Nathan is emailed once when a prospect first opens the review, again only after a long gap, never for previews', async t => {
  const env = setup(t), sent = [];
  env.JOBS_DB.sqlite.prepare("UPDATE website_audits SET share_token='AbCdEfGhIjKlMnOpQrStUv_-',share_created_at='2026-09-23T10:00:00Z' WHERE id='audit-1'").run();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('/oauth/v2/token')) return Response.json({ access_token: 'test-access' });
    if (String(url).includes('/messages')) { sent.push(JSON.parse(options.body)); return Response.json({ status: { code: 200 }, data: { messageId: '1' } }); }
    throw new Error('unexpected ' + url);
  });
  const open = q => handlePublicReport(new Request(origin + '/api/report/AbCdEfGhIjKlMnOpQrStUv_-' + q), env);
  const row = () => env.JOBS_DB.sqlite.prepare("SELECT share_views,share_alert_due,share_alerted_at FROM website_audits WHERE id='audit-1'").get();
  assert.equal((await open('?preview=1')).status, 200);
  assert.deepEqual([row().share_views, row().share_alert_due], [0, null], 'previews are not counted and do not alert');
  await open('');
  assert.equal(row().share_views, 1);
  assert.ok(row().share_alert_due);
  await runReportAlerts(env);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].toAddress, 'nathan@nc-digital.co.uk');
  assert.equal(sent[0].subject, 'Dowlais Heating just opened their website review');
  assert.match(sent[0].content, /\/admin\/website-audit\/\?report=audit-1/);
  assert.equal(row().share_alert_due, null);
  await open('');
  await runReportAlerts(env);
  assert.equal(sent.length, 1, 'reading on in the same session does not alert again');
  env.JOBS_DB.sqlite.prepare("UPDATE website_audits SET share_last_viewed_at='2026-09-01T10:00:00Z' WHERE id='audit-1'").run();
  await open('');
  await runReportAlerts(env);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].subject, 'Dowlais Heating is looking at their website review');
  assert.match(sent[1].content, /come back to/);
});

test('the CRM inbox shows whether a website review email has been opened, counting only opens after sending', async t => {
  const env = setup(t);
  await ok(await post(env, 'email', { id: 'audit-1', name: 'Gareth', email: 'gareth@dowlais.example.co.uk', message: 'Hi Gareth,\n\nHere is your review.', request_key: crypto.randomUUID() }));
  const token = env.JOBS_DB.sqlite.prepare("SELECT share_token FROM website_audits WHERE id='audit-1'").get().share_token;
  const list = async () => (await (await handleCrmApi(new Request(origin + '/admin/crm/api/list'), env, 'nathan')).json()).tickets.find(x => x.email === 'gareth@dowlais.example.co.uk');
  let row = await list();
  assert.equal(row.review_audit, 'audit-1');
  assert.equal(row.review_opened_at, null, 'not opened yet');
  await handlePublicReport(new Request(origin + '/api/report/' + token + '?preview=1'), env);
  assert.equal((await list()).review_opened_at, null, 'your own previews do not count');
  await handlePublicReport(new Request(origin + '/api/report/' + token), env);
  row = await list();
  assert.ok(row.review_opened_at, 'opened by the prospect');
  env.JOBS_DB.sqlite.prepare("INSERT INTO crm_tickets(id,reference,submission_key,name,email,subject,created_at,updated_at,last_inbound_at) VALUES('ticket-plain-000000001','NC-PLAIN','k-2','Kay','kay@example.co.uk','Quote','2026-09-01','2026-09-01','2026-09-01')").run();
  const plain = (await (await handleCrmApi(new Request(origin + '/admin/crm/api/list'), env, 'nathan')).json()).tickets.find(x => x.email === 'kay@example.co.uk');
  assert.equal(plain.review_audit, null, 'ordinary enquiries have no review status');
});
