import test from 'node:test';
import assert from 'node:assert/strict';
import { crmDatabase } from '../helpers/crm-db.mjs';
import { handleAnalyticsReport } from '../../src/lib/analytics-report-api.js';
import { handlePublicReport, runReportAlerts } from '../../src/lib/website-audit-api.js';
import { customerSubject } from '../../src/lib/crm.js';
import { seoReportHtml, monthlyVisits, seoEmailCopy, enquiries, seoWins } from '../../src/lib/seo-report-view.js';

const origin = 'https://nc-digital.co.uk', property = 'properties/123', site = 'sc-domain:ir-energy.co.uk';
const zoho = { ZOHO_REGION: 'eu', ZOHO_ACCOUNT_ID: '123', ZOHO_CLIENT_ID: 'id', ZOHO_CLIENT_SECRET: 'secret', ZOHO_REFRESH_TOKEN: 'refresh' };
const env = t => ({ JOBS_DB: crmDatabase(t), CRM_ENABLED: 'true', GOOGLE_ANALYTICS_CONFIG: '{}', GOOGLE_GSC_CONFIG: '{}', DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p', ...zoho });
const request = (route, body) => new Request(origin + '/admin/analytics-reports/api/' + route, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
async function api(e, route, body) { const r = await handleAnalyticsReport(request(route, body), e), d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d)); return d; }

// Google and DataForSEO stand-ins. `positions` sets where ir-energy.co.uk ranks for each search.
function providers(t, positions = {}) {
  const calls = { serp: [], mail: [], google: 0 };
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    url = String(url);
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'g' });
    if (url.includes('accounts.zoho.eu')) return Response.json({ access_token: 'z' });
    if (url.includes('mail.zoho.eu')) { calls.mail.push(JSON.parse(opts.body)); return Response.json({ status: { code: 200 }, data: { messageId: '1' } }); }
    if (url.includes('api.dataforseo.com')) {
      const body = JSON.parse(opts.body)[0]; calls.serp.push(body);
      const pos = positions[body.keyword];
      return Response.json({ status_code: 20000, cost: 0.006, tasks: [{ status_code: 20000, result: [{ items: pos ? [{ type: 'organic', rank_group: pos, domain: 'ir-energy.co.uk', url: 'https://ir-energy.co.uk/' }] : [] }] }] });
    }
    if (url.includes('analyticsadmin') && url.endsWith(property)) return Response.json({ name: property, displayName: 'IR Energy Ltd GA4', timeZone: 'Europe/London' });
    if (url.endsWith('/sites')) return Response.json({ siteEntry: [{ siteUrl: site, permissionLevel: 'siteOwner' }] });
    calls.google++;
    const q = JSON.parse(opts.body);
    if (url.includes('webmasters')) {
      const dim = q.dimensions[0];
      const rows = dim === 'date' ? [{ keys: [q.startDate], clicks: 40, impressions: 900, ctr: 0.04, position: 12 }] : [{ keys: dim ? [dim === 'query' ? 'solar panels cardiff' : 'https://ir-energy.co.uk/solar/'] : [], clicks: 50, impressions: 1000, ctr: 0.05, position: 11 }];
      return Response.json({ rows });
    }
    return Response.json({ dimensionHeaders: [...q.dimensions, { name: 'dateRange' }], metricHeaders: q.metrics, rows: ['current', 'previous'].map(period => ({ dimensionValues: [...q.dimensions.map(d => ({ value: d.name === 'eventName' ? 'call_now_click' : d.name === 'date' ? '20260801' : 'Organic Search' })), { value: period }], metricValues: q.metrics.map(m => ({ value: m.name.includes('Rate') ? '0.5' : '10' })) })), rowCount: 2 });
  });
  return calls;
}
async function finish(e, r) { let steps = 0; for (; r.status === 'running' && steps < 30; steps++) r = await api(e, 'advance', { id: r.id }); return { r, steps }; }
const clientBody = { name: 'IR Energy', property, site, country: 'all', brandTerms: 'ir solar\nirenergy', enquiryEvents: 'call_now_click', keywords: 'solar panels cardiff\nbattery storage cardiff\nsolar panels cardiff', town: 'Cardiff,Wales,United Kingdom', contactName: 'Ian', contactEmail: 'ian@ir-energy.co.uk' };

test('saved clients store the setup a monthly report needs, with sensible validation', async t => {
  const e = env(t); providers(t);
  const { client } = await api(e, 'client', clientBody);
  assert.equal(client.name, 'IR Energy');
  assert.deepEqual(client.keywords, ['solar panels cardiff', 'battery storage cardiff'], 'duplicates removed');
  assert.deepEqual(client.brandTerms, ['ir solar', 'irenergy']);
  assert.deepEqual(client.enquiryEvents, ['call_now_click']);
  assert.equal(client.locationName, 'Cardiff,Wales,United Kingdom');
  assert.ok(client.locationCode > 0);
  assert.equal((await api(e, 'clients')).clients.length, 1);
  await api(e, 'client', { ...clientBody, id: client.id, contactName: 'Ian R' });
  assert.equal((await api(e, 'clients')).clients[0].contactName, 'Ian R', 'saving again updates rather than duplicating');
  for (const bad of [{ name: '' }, { keywords: 'x', town: '' }, { contactEmail: 'nope' }, { property: 'nope' }])
    assert.equal((await handleAnalyticsReport(request('client', { ...clientBody, ...bad }), e)).status, 400, JSON.stringify(bad));
});

test('a one-click report uses the saved client, runs Google steps in parallel and tracks rankings against the last report', async t => {
  const e = env(t); let calls = providers(t, { 'solar panels cardiff': 24 });
  const { client } = await api(e, 'client', clientBody);
  let { r, steps } = await finish(e, await api(e, 'start', { clientId: client.id, period: '1' }));
  assert.equal(r.status, 'complete');
  assert.ok(r.stages.includes('rankings:0'));
  assert.ok(steps <= 7, `${r.stages.length} steps finished in ${steps} requests`);
  assert.equal(r.clientId, client.id);
  assert.equal(r.report.client.name, 'IR Energy');
  assert.deepEqual(r.report.rankings.current.map(x => [x.keyword, x.position]), [['solar panels cardiff', 24], ['battery storage cardiff', null]]);
  assert.equal(r.report.rankings.previous, null, 'first report has nothing to compare with');
  assert.equal(calls.serp[0].location_code, client.locationCode);
  assert.equal(calls.serp[0].depth, 50);
  assert.ok(r.rankingCost > 0);
  t.mock.restoreAll(); providers(t, { 'solar panels cardiff': 8, 'battery storage cardiff': 15 });
  ({ r } = await finish(e, await api(e, 'start', { clientId: client.id, period: '1', refresh: true })));
  assert.deepEqual(r.report.rankings.previous, { 'solar panels cardiff': 24, 'battery storage cardiff': null });
  const html = seoReportHtml({ report: r.report, notes: '' });
  assert.match(html, /Your Key Searches \(checked from Cardiff\)/);
  assert.match(html, /▲ up 16 places/);
  assert.match(html, /New: now ranking/);
  assert.match(html, /1 of 2<\/strong> of your key searches are on the first page of Google in Cardiff/);
  assert.match(html, /IR Energy SEO Report/, 'the saved client name is used, not the Analytics property name');
});

test('SEO reports get a private client link that shows only client-safe data, counts views and alerts Nathan', async t => {
  const e = env(t); const calls = providers(t);
  const { client } = await api(e, 'client', { ...clientBody, keywords: '', town: '' });
  const { r } = await finish(e, await api(e, 'start', { clientId: client.id, period: '1' }));
  await api(e, 'notes', { id: r.id, notes: 'Added a Cardiff solar page.' });
  const shared = await api(e, 'share', { id: r.id, enable: true });
  assert.match(shared.share.url, /^https:\/\/nc-digital\.co\.uk\/report\/[A-Za-z0-9_-]{24}$/);
  const open = q => handlePublicReport(new Request(origin + '/api/report/' + shared.share.token + q), e);
  const res = await open('?preview=1'), body = await res.json(), text = JSON.stringify(body);
  assert.equal(res.status, 200);
  assert.equal(body.type, 'seo');
  assert.equal(body.report.property.name, 'IR Energy');
  assert.equal(body.notes, 'Added a Cardiff solar page.');
  for (const secret of ['properties/123', 'warnings', 'countries', 'sources', 'devices', 'rankingCost', 'contactEmail', 'ian@ir-energy', 'explanation', 'insight']) assert.ok(!text.includes(secret), secret);
  assert.equal(e.JOBS_DB.sqlite.prepare('SELECT share_views FROM analytics_reports WHERE id=?').get(r.id).share_views, 0, 'previews are not counted');
  await open('');
  await runReportAlerts(e);
  assert.equal(calls.mail.length, 1);
  assert.equal(calls.mail[0].subject, 'IR Energy just opened their SEO report');
  assert.match(calls.mail[0].content, /\/admin\/analytics-reports\/\?report=/);
  assert.equal((await api(e, 'share', { id: r.id, enable: false })).share, null);
  assert.equal((await open('')).status, 404, 'a turned-off link stops working');
});

test('an SEO report can be emailed from the CRM mailbox with its own subject line', async t => {
  const e = env(t); providers(t);
  const { client } = await api(e, 'client', { ...clientBody, keywords: '', town: '' });
  const { r } = await finish(e, await api(e, 'start', { clientId: client.id, period: '1' }));
  const sent = await api(e, 'email', { id: r.id, name: 'Ian', email: 'ian@ir-energy.co.uk', message: 'Hi Ian,\n\nHere is your report.', request_key: crypto.randomUUID() });
  assert.equal(sent.emails.length, 1);
  assert.ok(sent.share.token, 'emailing creates the link');
  const ticket = e.JOBS_DB.sqlite.prepare("SELECT * FROM crm_tickets WHERE source_page='seo-report'").get();
  assert.equal(ticket.company, 'IR Energy');
  assert.equal(customerSubject(ticket), `Your SEO report from NC Digital [${ticket.reference}]`);
  const outbound = e.JOBS_DB.sqlite.prepare("SELECT body FROM crm_messages WHERE ticket_id=? AND kind='outbound'").get(ticket.id);
  assert.ok(outbound.body.includes(sent.share.url));
  const copy = seoEmailCopy({ report: r.report }, 'Ian Roberts', sent.share.url);
  assert.match(copy, /^Hi Ian,\n\nHere is your SEO report for/);
  assert.ok(copy.includes(sent.share.url));
});

test('monthly chart, saved name variations and chosen enquiry events shape the client report', () => {
  const report = {
    property: { name: 'IR Energy' }, input: { site }, client: { name: 'IR Energy', brandTerms: ['ir solar'], enquiryEvents: ['call_now_click', 'quote_form'] },
    periods: { current: { startDate: '2026-07-01', endDate: '2026-08-31' }, previous: { startDate: '2026-05-01', endDate: '2026-06-30' }, currentDays: 62, previousDays: 61 },
    cards: [{ key: 'clicks', source: 'gsc', type: 'number', current: 130, previous: 35 }],
    data: {
      gscCurrentTrend: { rows: [{ keys: ['2026-07-03'], clicks: 30 }, { keys: ['2026-07-20'], clicks: 20 }, { keys: ['2026-08-02'], clicks: 80 }] },
      gscPreviousTrend: { rows: [{ keys: ['2026-05-10'], clicks: 10 }, { keys: ['2026-06-10'], clicks: 25 }] },
      events: { rows: [['call_now_click', 7], ['quote_form', 3], ['phone_click', 99]].map(([k, n]) => ({ dimensions: { dateRange: 'current', eventName: k }, metrics: { eventCount: n } })) },
      gscCurrentQueries: { rows: [{ keys: ['ir solar panels'], clicks: 9, impressions: 50, position: 2 }, { keys: ['solar panels cardiff'], clicks: 4, impressions: 90, position: 8 }] },
    },
  };
  assert.deepEqual(monthlyVisits(report).months.map(m => [m.month, m.period, m.value]), [['2026-05', 'previous', 10], ['2026-06', 'previous', 25], ['2026-07', 'current', 50], ['2026-08', 'current', 80]]);
  const html = seoReportHtml({ report, notes: '' });
  assert.match(html, /Clicks from Google, month by month/);
  assert.equal((html.match(/class="sr-col /g) || []).length, 4);
  const enq = enquiries(report);
  assert.deepEqual(enq.current, { phone: 7, email: 0, form: 3, total: 10 }, 'only the chosen events count (phone_click is ignored); call_now_click reads as a phone call');
  const wins = seoWins(report);
  assert.equal(wins.brand.current, 9, '"ir solar panels" is a name search thanks to the saved variation');
  assert.equal(wins.service.current, 4);
});
