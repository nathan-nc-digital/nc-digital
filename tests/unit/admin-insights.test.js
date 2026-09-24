import test from 'node:test';
import assert from 'node:assert/strict';
import { crmDatabase } from '../helpers/crm-db.mjs';
import { buildGscReport, compareSnapshots, pickBaseline, gscDates, gscQueries, parseSitemap, belongsToSite, inspectionRow, coverageAdvice, priorityActions, pagePath } from '../../src/lib/gsc-insights.js';
import { handleGscLive } from '../../src/lib/gsc-live-api.js';
import { handleDashboard, dashboardSummary, spendSummary } from '../../src/lib/admin-dashboard-api.js';
import { dataForSeo } from '../../src/lib/keyword-research.js';
import { ageLabel } from '../../src/scripts/data-age.js';

const origin = 'https://nc-digital.co.uk', site = 'sc-domain:nc-digital.co.uk';
const env = t => ({ JOBS_DB: crmDatabase(t), GOOGLE_GSC_CONFIG: '{"client_id":"a","client_secret":"b","refresh_token":"c"}', DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p' });
const call = async (handler, e, path, body) => {
  const r = await handler(new Request(origin + path, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), e);
  return { status: r.status, data: await r.json() };
};
const row = (key, clicks, impressions, position) => ({ keys: key == null ? [] : [key].flat(), clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

test('the Search Console report finds quick wins, ranking movers and period change like the old script', () => {
  const period = gscDates(new Date('2026-09-24T12:00Z'));
  assert.equal(period.endDate, '2026-09-24');
  assert.equal(period.startDate, '2026-08-27');
  assert.equal(Object.keys(gscQueries(period)).length, 9);
  const report = buildGscReport(site, period, {
    totals: [row(null, 120, 6000, 14.2)], prevTotals: [row(null, 80, 4000, 18)],
    allQueries: [row('web design merthyr', 3, 400, 6.5), row('web design cardiff', 1, 15, 8), row('nc digital', 60, 90, 1.2), row('seo wales', 0, 300, 25)],
    recent: [row('web design merthyr', 2, 50, 5), row('seo wales', 0, 40, 30)], prior: [row('web design merthyr', 1, 40, 9), row('seo wales', 0, 30, 22)],
    topQueries: [row('a', 1, 10, 3), row('b', 5, 10, 3)], topPages: [], queryPages: [row(['web design merthyr', 'https://nc-digital.co.uk/web-design-merthyr/'], 3, 400, 6.5)],
  }, new Date('2026-09-24T12:00Z'));
  assert.equal(report.overview.change.clicks, '50.0%');
  assert.deepEqual(report.opportunities.map(r => r.query), ['web design merthyr'], 'needs 20+ impressions, under 5% CTR and position 4–20');
  assert.deepEqual(report.gained.map(r => [r.query, r.delta]), [['web design merthyr', 4]]);
  assert.deepEqual(report.lost.map(r => [r.query, r.delta]), [['seo wales', -8]]);
  assert.deepEqual(report.topQueries.map(r => r.query), ['b', 'a'], 'sorted by clicks');
  assert.equal(report.queryPages[0].page, 'https://nc-digital.co.uk/web-design-merthyr/');
  assert.deepEqual(priorityActions(report).map(a => a.type), ['Quick win', 'Ranking drop']);
  assert.equal(pagePath('https://ir-energy.co.uk/solar/?a=1', 'sc-domain:ir-energy.co.uk'), '/solar/?a=1');
});

test('sitemaps, property checks and Google coverage reasons read in plain English', () => {
  assert.deepEqual(parseSitemap('<sitemapindex><sitemap><loc>https://x.co.uk/sitemap-0.xml</loc></sitemap></sitemapindex>'), { sitemaps: ['https://x.co.uk/sitemap-0.xml'], urls: [] });
  assert.deepEqual(parseSitemap('<urlset><url><loc> https://x.co.uk/a?b=1&amp;c=2 </loc></url><url><loc><![CDATA[https://x.co.uk/b/]]></loc></url></urlset>').urls, ['https://x.co.uk/a?b=1&c=2', 'https://x.co.uk/b/']);
  assert.ok(belongsToSite('https://www.x.co.uk/a', 'sc-domain:x.co.uk'));
  assert.ok(!belongsToSite('https://evilx.co.uk/a', 'sc-domain:x.co.uk'));
  assert.ok(!belongsToSite('https://x.co.uk/a', 'https://www.x.co.uk/'));
  assert.equal(inspectionRow({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' } } }).status, 'indexed');
  assert.equal(inspectionRow({ inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' } } }).status, 'not-indexed');
  assert.match(coverageAdvice({ status: 'not-indexed', coverageState: 'Discovered - currently not indexed' }), /knows the page exists/);
  assert.match(coverageAdvice({ status: 'not-indexed', coverageState: 'Crawled - currently not indexed' }), /chose not to index/);
  assert.match(coverageAdvice({ status: 'not-indexed', coverageState: 'Duplicate, Google chose different canonical than user' }), /copy of another page/);
  assert.equal(coverageAdvice({ status: 'indexed' }), '');
  const now = Date.parse('2026-09-24T12:00Z');
  assert.equal(ageLabel('2026-07-27T10:31:13Z', { now }).tone, 'old');
  assert.match(ageLabel('2026-07-27T10:31:13Z', { now }).text, /27 Jul 2026 · 59 days ago/);
  assert.equal(ageLabel('2026-09-20T12:00Z', { now }).tone, 'fresh');
  assert.equal(ageLabel('2026-09-15T12:00Z', { now }).tone, 'stale');
  assert.equal(ageLabel(undefined), null);
});

// Google stand-in: Search Analytics, sitemaps list, sitemap files and URL Inspection.
function google(t, { pages = 45, notIndexed = [], quotaAfter = Infinity, sitemapsListed = true } = {}) {
  const calls = { inspect: [], analytics: 0, sitemapFetch: [] };
  const urls = Array.from({ length: pages }, (_, i) => `https://nc-digital.co.uk/page-${i}/`);
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    url = String(url);
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'g' });
    if (url.endsWith('/sites')) return Response.json({ siteEntry: [{ siteUrl: site, permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:ir-energy.co.uk', permissionLevel: 'siteFullUser' }] });
    if (url.endsWith('/sitemaps')) return Response.json(sitemapsListed ? { sitemap: [{ path: 'https://nc-digital.co.uk/sitemap-index.xml' }] } : {});
    if (url.endsWith('sitemap-index.xml')) { calls.sitemapFetch.push(url); return new Response('<sitemapindex><sitemap><loc>https://nc-digital.co.uk/sitemap-0.xml</loc></sitemap></sitemapindex>'); }
    if (url.endsWith('sitemap-0.xml')) { calls.sitemapFetch.push(url); return new Response(`<urlset>${urls.map(u => `<url><loc>${u}</loc></url>`).join('')}<url><loc>https://other.co.uk/x/</loc></url></urlset>`); }
    if (url.includes('urlInspection')) {
      const { inspectionUrl } = JSON.parse(opts.body);
      if (calls.inspect.length >= quotaAfter) return new Response('{}', { status: 429 });
      calls.inspect.push(inspectionUrl);
      const bad = notIndexed.includes(inspectionUrl);
      return Response.json({ inspectionResult: { indexStatusResult: { verdict: bad ? 'NEUTRAL' : 'PASS', coverageState: bad ? 'Crawled - currently not indexed' : 'Submitted and indexed', lastCrawlTime: '2026-09-20T10:00:00Z', googleCanonical: inspectionUrl } } });
    }
    if (url.includes('searchAnalytics')) { calls.analytics++; const q = JSON.parse(opts.body); return Response.json({ rows: q.dimensions.length ? [row(q.dimensions.length === 2 ? ['web design merthyr', 'https://nc-digital.co.uk/'] : 'web design merthyr', 3, 400, 6.5)] : [row(null, 100, 5000, 12)] }); }
    throw new Error('unexpected fetch ' + url);
  });
  return calls;
}

test('Search Console insights refresh live from Google, are saved, and list every property', async t => {
  const e = env(t), calls = google(t);
  assert.deepEqual((await call(handleGscLive, e, '/admin/gsc/api/report?site=' + site)).data, { report: null });
  const refreshed = await call(handleGscLive, e, '/admin/gsc/api/refresh', { site });
  assert.equal(refreshed.status, 200);
  assert.equal(calls.analytics, 9);
  assert.equal(refreshed.data.report.overview.current.clicks, 100);
  const saved = await call(handleGscLive, e, '/admin/gsc/api/report?site=' + site);
  assert.equal(saved.data.report.generatedAt, refreshed.data.report.generatedAt);
  const list = await call(handleGscLive, e, '/admin/gsc/api/sites');
  assert.equal(list.data.defaultSite, site);
  assert.equal(list.data.sites.length, 2);
  assert.equal((await call(handleGscLive, e, '/admin/gsc/api/refresh', { site: 'javascript:alert(1)' })).status, 400);
  const foreign = await handleGscLive(new Request(origin + '/admin/gsc/api/refresh', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }), e);
  assert.equal(foreign.status, 403);
});

test('an indexing check reads the sitemap, inspects pages 20 at a time, and a problems check skips indexed pages', async t => {
  const e = env(t), bad = 'https://nc-digital.co.uk/page-3/', calls = google(t, { pages: 45, notIndexed: [bad] });
  let state = (await call(handleGscLive, e, '/admin/indexing/api/start', { site, mode: 'all' })).data;
  assert.equal(state.pages.length, 45, 'pages on other domains are left out');
  assert.equal(state.run.running, true);
  assert.equal(state.run.remaining, 45);
  const steps = [];
  while (state.run.running) { state = (await call(handleGscLive, e, '/admin/indexing/api/step', { site })).data; steps.push(state.run.remaining); }
  assert.deepEqual(steps, [25, 5, 0, 0]);
  assert.equal(calls.inspect.length, 45);
  assert.equal(state.pages.filter(p => p.status === 'indexed').length, 44);
  const page3 = state.pages.find(p => p.url === bad);
  assert.equal(page3.status, 'not-indexed');
  assert.equal(page3.coverageState, 'Crawled - currently not indexed');
  assert.ok(state.lastChecked);

  calls.inspect.length = 0;
  state = (await call(handleGscLive, e, '/admin/indexing/api/start', { site, mode: 'problems' })).data;
  assert.equal(state.run.remaining, 1);
  while (state.run.running) state = (await call(handleGscLive, e, '/admin/indexing/api/step', { site })).data;
  assert.deepEqual(calls.inspect, [bad], 'only the page with a problem is rechecked');
});

test('the daily URL Inspection limit pauses the check with a clear message and keeps results', async t => {
  const e = env(t);
  google(t, { pages: 30, quotaAfter: 12 });
  await call(handleGscLive, e, '/admin/indexing/api/start', { site });
  const step = await call(handleGscLive, e, '/admin/indexing/api/step', { site });
  assert.equal(step.status, 429);
  assert.match(step.data.error, /2,000 pages per property/);
  const status = (await call(handleGscLive, e, '/admin/indexing/api/status?site=' + site)).data;
  assert.equal(status.pages.filter(p => p.status === 'indexed').length, 12);
  assert.equal(status.run.running, true);
  assert.match(status.run.error, /Resume tomorrow/);
  const stopped = (await call(handleGscLive, e, '/admin/indexing/api/stop', { site })).data;
  assert.equal(stopped.run.running, false);
});

test('without submitted sitemaps the usual sitemap locations are tried', async t => {
  const e = env(t), calls = google(t, { pages: 3, sitemapsListed: false });
  const state = (await call(handleGscLive, e, '/admin/indexing/api/start', { site })).data;
  assert.equal(state.pages.length, 3);
  assert.equal(calls.sitemapFetch[0], 'https://nc-digital.co.uk/sitemap-index.xml');
});

function dataForSeoApi(t, { cost = 0.0125, balance = 41.5 } = {}) {
  const calls = { balance: 0 };
  t.mock.method(globalThis, 'fetch', async (url) => {
    url = String(url);
    if (url.endsWith('/appendix/user_data')) { calls.balance++; return Response.json({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ money: { balance } }] }] }); }
    if (url.includes('api.dataforseo.com')) return Response.json({ status_code: 20000, cost, tasks: [{ status_code: 20000, cost, result: [{ items: [] }] }] });
    throw new Error('unexpected fetch ' + url);
  });
  return calls;
}

test('every paid DataForSEO lookup is logged by tool and totalled against the monthly budget', async t => {
  const e = env(t), calls = dataForSeoApi(t);
  await dataForSeo(e, 'serp/google/organic/live/advanced', { keyword: 'a' }, 'website-audit');
  await dataForSeo(e, 'serp/google/organic/live/advanced', { keyword: 'b' }, 'website-audit');
  await dataForSeo(e, 'dataforseo_labs/google/keyword_suggestions/live', { keyword: 'c' }, 'keyword-research');
  e.JOBS_DB.sqlite.prepare("INSERT INTO dataforseo_usage(at,tool,endpoint,cost) VALUES('2020-01-01T00:00:00Z','emd-finder','x',9)").run();
  const spend = await spendSummary(e, e.JOBS_DB);
  assert.equal(spend.month, 0.0375, 'last month is not counted');
  assert.deepEqual(spend.byTool.map(x => [x.label, x.lookups]), [['Website audits', 2], ['Keyword research', 1]]);
  assert.equal(spend.budget, 20);
  assert.equal(spend.level, 'ok');
  assert.equal(spend.balance, 41.5);
  await spendSummary(e, e.JOBS_DB);
  assert.equal(calls.balance, 1, 'the balance is cached');

  assert.equal((await call(handleDashboard, e, '/admin/dashboard/api/budget', { budget: 0 })).status, 400);
  const lowered = (await call(handleDashboard, e, '/admin/dashboard/api/budget', { budget: 0.04 + 1 })).data;
  assert.equal(lowered.budget, 1.04);
  assert.equal(lowered.level, 'ok');
  e.JOBS_DB.sqlite.prepare("INSERT INTO dataforseo_usage(at,tool,endpoint,cost) VALUES(?,'seo-report','x',0.9)").run(new Date().toISOString());
  assert.equal((await spendSummary(e, e.JOBS_DB)).level, 'near');
  e.JOBS_DB.sqlite.prepare("INSERT INTO dataforseo_usage(at,tool,endpoint,cost) VALUES(?,'seo-report','x',0.5)").run(new Date().toISOString());
  assert.equal((await spendSummary(e, e.JOBS_DB)).level, 'over');
});

test('a failed spend log never breaks the lookup', async t => {
  dataForSeoApi(t);
  const broken = { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p', JOBS_DB: { prepare() { throw new Error('no table'); } } };
  const r = await dataForSeo(broken, 'serp/google/organic/live/advanced', { keyword: 'a' }, 'website-audit');
  assert.equal(r.cost, 0.0125);
});

test('the dashboard gathers enquiries, tasks, opened and unopened reports, due SEO reports and stuck pages', async t => {
  const e = env(t), db = e.JOBS_DB.sqlite, at = new Date('2026-09-24T12:00:00Z');
  dataForSeoApi(t);
  const ticket = db.prepare("INSERT INTO crm_tickets(id,reference,submission_key,name,email,subject,status,created_at,updated_at,last_inbound_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
  ticket.run('t1', 'NC-1', 'k1', 'Sam Jones', 'sam@example.com', 'New website', 'new', '2026-09-23T10:00:00Z', '2026-09-23T10:00:00Z', '2026-09-23T10:00:00Z');
  ticket.run('t2', 'NC-2', 'k2', 'Alex', 'alex@example.com', 'SEO', 'closed', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z');
  const task = db.prepare("INSERT INTO crm_tasks(id,title,due_date,status,created_at,updated_at) VALUES(?,?,?,?,?,?)");
  task.run('k1', 'Call Sam back', '2026-09-22', 'open', at.toISOString(), at.toISOString());
  task.run('k2', 'Future task', '2026-10-10', 'open', at.toISOString(), at.toISOString());
  task.run('k3', 'Done task', '2026-09-20', 'done', at.toISOString(), at.toISOString());
  const audit = db.prepare("INSERT INTO website_audits(id,url,client,created_at,updated_at,status,state,share_token,share_created_at,share_views,share_last_viewed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  audit.run('a1', 'https://dowlais.co.uk', 'Dowlais Heating', '2026-09-01', '2026-09-01', 'complete', '{}', 'tok1', '2026-09-21T09:00:00Z', 0, null);
  audit.run('a2', 'https://mt.co.uk', 'M&T Heating', '2026-09-01', '2026-09-01', 'complete', '{}', 'tok2', '2026-09-10T09:00:00Z', 3, '2026-09-23T20:00:00Z');
  db.prepare("INSERT INTO seo_clients(id,name,property,created_at,updated_at) VALUES('c1','IR Energy','properties/1','x','x'),('c2','Tizer','properties/2','x','x')").run();
  db.prepare("INSERT INTO analytics_reports(id,fingerprint,property,title,created_at,updated_at,status,state,client_id) VALUES('r1','f','properties/2','Tizer SEO','2026-09-05T10:00:00Z','x','complete','{}','c2'),('r0','f','properties/1','IR SEO','2026-08-05T10:00:00Z','x','complete','{}','c1')").run();
  const page = db.prepare("INSERT INTO gsc_index_pages(site,url,first_seen,status,coverage_state,inspected_at) VALUES(?,?,?,?,?,?)");
  page.run(site, 'https://nc-digital.co.uk/', '2026-08-01T00:00:00Z', 'indexed', 'Submitted and indexed', '2026-09-23T00:00:00Z');
  page.run(site, 'https://nc-digital.co.uk/blog/old-post/', '2026-09-01T00:00:00Z', 'not-indexed', 'Crawled - currently not indexed', '2026-09-23T00:00:00Z');
  page.run(site, 'https://nc-digital.co.uk/blog/new-post/', '2026-09-22T00:00:00Z', 'not-indexed', 'Discovered - currently not indexed', '2026-09-23T00:00:00Z');

  const d = await dashboardSummary(e, at);
  assert.equal(d.enquiries.newCount, 1);
  assert.deepEqual(d.enquiries.recent.map(x => x.name), ['Sam Jones'], 'closed enquiries are left out');
  assert.deepEqual(d.tasks.map(x => x.title), ['Call Sam back'], 'only open tasks due today or earlier');
  assert.deepEqual(d.shares.unopened.map(x => [x.name, x.kind]), [['Dowlais Heating', 'audit']]);
  assert.deepEqual(d.shares.opened.map(x => [x.name, x.views]), [['M&T Heating', 3]]);
  assert.deepEqual(d.seoClients.map(c => [c.name, c.due]), [['IR Energy', true], ['Tizer', false]]);
  assert.equal(d.indexing.notIndexed, 2);
  assert.equal(d.indexing.stuck, 1, 'a page added two days ago is not stuck yet');
  assert.deepEqual(d.indexing.stuckPages.map(p => p.url), ['https://nc-digital.co.uk/blog/old-post/']);
  assert.equal(d.search, null);
  assert.equal(d.spend.balance, 41.5);
  const viaRoute = await call(handleDashboard, e, '/admin/dashboard/api/summary');
  assert.equal(viaRoute.status, 200);
});

test('this site reads its own sitemap from the deployed files, since a Worker cannot fetch its own domain', async t => {
  const e = env(t), served = [];
  google(t, { pages: 4 });
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, opts) => { if (String(url).endsWith('.xml')) throw new Error('own-domain fetch blocked'); return realFetch(url, opts); });
  e.ASSETS = { fetch: async (req) => { served.push(new URL(req.url).pathname); return new Response(served.length === 1 ? '<sitemapindex><sitemap><loc>https://nc-digital.co.uk/sitemap-0.xml</loc></sitemap></sitemapindex>' : '<urlset><url><loc>https://nc-digital.co.uk/a/</loc></url><url><loc>https://nc-digital.co.uk/b/</loc></url></urlset>'); } };
  const state = (await call(handleGscLive, e, '/admin/indexing/api/start', { site })).data;
  assert.deepEqual(served, ['/sitemap-index.xml', '/sitemap-0.xml']);
  assert.equal(state.pages.length, 2);
});

test('since the last refresh: searches that moved, new and dropped searches, and pages gaining or losing', () => {
  const snap = (at, clicks, queries, pages) => ({ generatedAt: at, overview: { current: { clicks, impressions: 1000, ctr: clicks / 1000, position: 20 } }, queries, pages });
  const before = snap('2026-09-20T09:00:00Z', 30,
    [['web design merthyr', 3, 200, 9.4], ['seo cardiff', 1, 80, 6], ['old search', 0, 40, 30], ['tiny', 0, 2, 50], ['steady', 5, 100, 4.2]],
    [['https://nc-digital.co.uk/', 20, 500, 5], ['https://nc-digital.co.uk/blog/a/', 5, 100, 12], ['https://nc-digital.co.uk/gone/', 2, 50, 20]]);
  const after = snap('2026-09-24T09:00:00Z', 37,
    [['web design merthyr', 6, 260, 5.1], ['seo cardiff', 0, 90, 11.5], ['new search', 1, 30, 8], ['steady', 5, 100, 4.6]],
    [['https://nc-digital.co.uk/', 28, 600, 4], ['https://nc-digital.co.uk/blog/a/', 5, 160, 10]]);
  const c = compareSnapshots(after, before);
  assert.equal(c.previousAt, '2026-09-20T09:00:00Z');
  assert.deepEqual(c.totals.find(t => t.key === 'clicks'), { key: 'clicks', previous: 30, current: 37 });
  assert.deepEqual(c.rankingsUp.map(m => [m.query, m.from, m.to]), [['web design merthyr', 9.4, 5.1]]);
  assert.deepEqual(c.rankingsDown.map(m => [m.query, m.delta]), [['seo cardiff', -5.5]], 'moves under one position are ignored');
  assert.deepEqual(c.newSearches.map(m => m.query), ['new search']);
  assert.deepEqual(c.lostSearches.map(m => m.query), ['old search'], 'searches with under 5 impressions are ignored');
  assert.deepEqual(c.pagesUp.map(m => [m.page, m.clicks]), [['https://nc-digital.co.uk/', 8], ['https://nc-digital.co.uk/blog/a/', 0]], 'a big rise in impressions counts even with the same clicks');
  assert.deepEqual(c.pagesDown.map(m => [m.page, m.clicks]), [['https://nc-digital.co.uk/gone/', -2]]);
  const old = compareSnapshots(after, { generatedAt: 'x', overview: before.overview });
  assert.equal(old.detailed, false, 'refreshes saved before this feature only compare the totals');
  assert.equal(compareSnapshots(after, null), null);
  const at = '2026-09-24T12:00:00Z', list = [{ generatedAt: '2026-09-24T11:59:00Z' }, { generatedAt: '2026-09-24T02:00:00Z' }, { generatedAt: '2026-09-20T02:00:00Z' }];
  assert.equal(pickBaseline(list, at).generatedAt, '2026-09-24T02:00:00Z', 'skips a refresh made a minute ago');
  assert.equal(pickBaseline([{ generatedAt: '2026-09-24T11:59:00Z' }], at).generatedAt, '2026-09-24T11:59:00Z');
  assert.equal(pickBaseline([], at), null);
});

test('each refresh is kept in history and compared with an earlier one', async t => {
  const e = env(t);
  google(t);
  const first = (await call(handleGscLive, e, '/admin/gsc/api/refresh', { site })).data.report;
  assert.equal(first.sinceLast, null, 'nothing to compare with on the first refresh');
  const second = (await call(handleGscLive, e, '/admin/gsc/api/refresh', { site })).data.report;
  assert.equal(second.sinceLast.previousAt, first.generatedAt);
  assert.equal(second.sinceLast.detailed, true);
  assert.deepEqual(second.sinceLast.rankingsUp, []);
  const saved = (await call(handleGscLive, e, '/admin/gsc/api/report?site=' + site)).data.report;
  assert.equal(saved.sinceLast.previousAt, first.generatedAt, 'the comparison is shown again when the page reopens');
  for (let i = 0; i < 22; i++) await call(handleGscLive, e, '/admin/gsc/api/refresh', { site });
  assert.equal(e.JOBS_DB.sqlite.prepare('SELECT COUNT(*) AS n FROM gsc_snapshot_history').get().n, 20, 'only the latest 20 are kept');
});
