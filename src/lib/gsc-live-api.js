// Live Search Console data for /admin/gsc/ (insights) and /admin/indexing/ (URL Inspection).
// Insights refresh in one request (eight Google calls). Indexing checks run in small steps that the
// page repeats, so each request stays well inside the Worker's subrequest limit and a closed tab
// simply leaves the run to be resumed.
import { readLimitedBody } from './social-http.js';
import { googleToken, google, sites } from './seo-quick-wins-api.js';
import { gscDates, gscQueries, buildGscReport, compareSnapshots, pickBaseline, parseSitemap, belongsToSite, inspectionRow } from './gsc-insights.js';

export const DEFAULT_SITE = 'sc-domain:nc-digital.co.uk';
const HISTORY = 20, STEP_SIZE = 20, CONCURRENCY = 5, MAX_URLS = 1000, MAX_SITEMAPS = 10;
const now = () => new Date().toISOString();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex' } });

function validSite(site) {
  if (typeof site !== 'string' || site.length > 300 || !/^(sc-domain:[a-z0-9.-]+|https?:\/\/\S+)$/i.test(site)) throw fail('Choose a Search Console property.');
  return site;
}

// ── Insights ────────────────────────────────────────────────────────────────

async function refreshInsights(env, site) {
  const token = await googleToken(env), period = gscDates(), queries = gscQueries(period), keys = Object.keys(queries);
  const path = 'sites/' + encodeURIComponent(site) + '/searchAnalytics/query';
  const answers = await Promise.all(keys.map(k => google(token, path, queries[k])));
  const results = Object.fromEntries(keys.map((k, i) => [k, answers[i].rows || []]));
  const report = buildGscReport(site, period, results), db = env.JOBS_DB;
  // Compare with an earlier refresh: the saved history plus the current snapshot (which predates history).
  const [history, latest] = await Promise.all([
    db.prepare('SELECT data FROM gsc_snapshot_history WHERE site=? ORDER BY fetched_at DESC LIMIT ?').bind(site, HISTORY).all(),
    savedInsights(db, site),
  ]);
  const earlier = history.results.map(r => JSON.parse(r.data));
  if (latest && !earlier.some(e => e.generatedAt === latest.generatedAt)) earlier.push(latest);
  const baseline = pickBaseline(earlier.map(({ sinceLast, ...rest }) => rest), report.generatedAt);
  report.sinceLast = compareSnapshots(report, baseline);
  const stored = JSON.stringify({ ...report, sinceLast: undefined });
  await db.batch([
    db.prepare('INSERT INTO gsc_snapshots(site,data,fetched_at) VALUES(?,?,?) ON CONFLICT(site) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(site, JSON.stringify(report), report.generatedAt),
    db.prepare('INSERT OR REPLACE INTO gsc_snapshot_history(site,fetched_at,data) VALUES(?,?,?)').bind(site, report.generatedAt, stored),
    db.prepare('DELETE FROM gsc_snapshot_history WHERE site=? AND fetched_at NOT IN (SELECT fetched_at FROM gsc_snapshot_history WHERE site=? ORDER BY fetched_at DESC LIMIT ?)').bind(site, site, HISTORY),
  ]);
  return report;
}

async function savedInsights(db, site) {
  const row = await db.prepare('SELECT data FROM gsc_snapshots WHERE site=?').bind(site).first();
  return row ? JSON.parse(row.data) : null;
}

// ── Indexing ────────────────────────────────────────────────────────────────

// A Worker cannot fetch its own domain over the internet, so this site's sitemap is read from
// the deployed static files instead.
async function fetchText(url, own, max = 5 * 1024 * 1024) {
  const local = own?.assets && new URL(url).hostname === own.host;
  const r = local ? await own.assets.fetch(new Request(url)) : await fetch(url, { headers: { 'User-Agent': 'NC Digital sitemap check' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) { await r.body?.cancel(); return null; }
  return new TextDecoder().decode(await readLimitedBody(r, max));
}

// Sitemaps submitted in Search Console first; the usual locations otherwise.
export async function sitemapUrls(token, site, own = null) {
  let listed = [];
  try { listed = ((await google(token, 'sites/' + encodeURIComponent(site) + '/sitemaps')).sitemap || []).map(s => s.path).filter(Boolean); } catch {}
  const origin = site.startsWith('sc-domain:') ? 'https://' + site.slice(10) : site.replace(/\/$/, '');
  const queue = listed.length ? listed : [origin + '/sitemap-index.xml', origin + '/sitemap_index.xml', origin + '/sitemap.xml'];
  const urls = new Set(), seen = new Set();
  while (queue.length && seen.size < MAX_SITEMAPS && urls.size < MAX_URLS) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    const xml = await fetchText(next, own).catch(() => null);
    if (!xml) continue;
    const parsed = parseSitemap(xml);
    queue.push(...parsed.sitemaps);
    for (const u of parsed.urls) if (belongsToSite(u, site) && urls.size < MAX_URLS) urls.add(u);
    if (!listed.length && urls.size) break; // first fallback location that works is enough
  }
  return [...urls];
}

async function indexStatus(db, site) {
  const [pages, run] = await Promise.all([
    db.prepare('SELECT url,status,verdict,coverage_state AS coverageState,page_fetch_state AS pageFetchState,last_crawl_time AS lastCrawlTime,google_canonical AS googleCanonical,user_canonical AS userCanonical,inspected_at AS inspectedAt,first_seen AS firstSeen FROM gsc_index_pages WHERE site=? AND in_sitemap=1 ORDER BY url').bind(site).all(),
    db.prepare('SELECT mode,started_at AS startedAt,finished_at AS finishedAt,sitemap_checked_at AS sitemapCheckedAt,error FROM gsc_index_runs WHERE site=?').bind(site).first(),
  ]);
  const list = pages.results;
  const due = run?.startedAt && !run.finishedAt ? list.filter(p => isDue(p, run)).length : 0;
  const lastChecked = list.reduce((max, p) => (p.inspectedAt && p.inspectedAt > max ? p.inspectedAt : max), '');
  return { site, pages: list, run: run ? { ...run, remaining: due, running: Boolean(run.startedAt && !run.finishedAt) } : null, lastChecked: lastChecked || null };
}

const isDue = (p, run) => (!p.inspectedAt || p.inspectedAt < run.startedAt) && (run.mode === 'all' || p.status !== 'indexed');

async function startIndexRun(env, site, mode, host) {
  const db = env.JOBS_DB, token = await googleToken(env), urls = await sitemapUrls(token, site, { assets: env.ASSETS, host }), at = now();
  if (!urls.length) throw fail('No sitemap was found for this property. Submit one in Search Console first.', 422);
  const statements = [db.prepare('UPDATE gsc_index_pages SET in_sitemap=0 WHERE site=?').bind(site)];
  for (const url of urls) statements.push(db.prepare('INSERT INTO gsc_index_pages(site,url,first_seen) VALUES(?,?,?) ON CONFLICT(site,url) DO UPDATE SET in_sitemap=1').bind(site, url, at));
  statements.push(db.prepare('INSERT INTO gsc_index_runs(site,mode,started_at,finished_at,sitemap_checked_at,error) VALUES(?,?,?,NULL,?,NULL) ON CONFLICT(site) DO UPDATE SET mode=excluded.mode,started_at=excluded.started_at,finished_at=NULL,sitemap_checked_at=excluded.sitemap_checked_at,error=NULL').bind(site, mode, at, at));
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  return indexStatus(db, site);
}

async function inspect(token, site, url) {
  const r = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionUrl: url, siteUrl: site }), signal: AbortSignal.timeout(30000) });
  if (r.status === 429) { await r.body?.cancel(); throw fail('Google’s daily URL Inspection limit (2,000 pages per property) has been reached. Resume tomorrow; results so far are saved.', 429); }
  if (!r.ok) { await r.body?.cancel(); return { status: 'unknown', verdict: 'UNKNOWN', coverageState: `Google could not inspect this page (HTTP ${r.status}).` }; }
  return inspectionRow(JSON.parse(new TextDecoder().decode(await readLimitedBody(r, 500000))));
}

async function stepIndexRun(env, site) {
  const db = env.JOBS_DB, run = await db.prepare('SELECT mode,started_at AS startedAt,finished_at AS finishedAt FROM gsc_index_runs WHERE site=?').bind(site).first();
  if (!run?.startedAt || run.finishedAt) return indexStatus(db, site);
  const filter = run.mode === 'all' ? '' : " AND status<>'indexed'";
  const due = (await db.prepare(`SELECT url FROM gsc_index_pages WHERE site=? AND in_sitemap=1 AND (inspected_at IS NULL OR inspected_at<?)${filter} ORDER BY inspected_at IS NOT NULL, inspected_at, url LIMIT ?`).bind(site, run.startedAt, STEP_SIZE).all()).results.map(r => r.url);
  if (!due.length) {
    await db.prepare('UPDATE gsc_index_runs SET finished_at=? WHERE site=?').bind(now(), site).run();
    return indexStatus(db, site);
  }
  const token = await googleToken(env), results = new Map();
  let next = 0, quotaError = null;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, async () => {
    while (next < due.length && !quotaError) {
      const url = due[next++];
      try { results.set(url, await inspect(token, site, url)); } catch (error) { if (error.status === 429) quotaError = error; else results.set(url, { status: 'unknown', verdict: 'UNKNOWN', coverageState: 'Google did not respond in time. It will be retried on the next check.' }); }
    }
  }));
  const at = now(), writes = [...results].map(([url, x]) => db.prepare('UPDATE gsc_index_pages SET status=?,verdict=?,coverage_state=?,page_fetch_state=?,last_crawl_time=?,google_canonical=?,user_canonical=?,inspected_at=? WHERE site=? AND url=?').bind(x.status, x.verdict, x.coverageState, x.pageFetchState ?? null, x.lastCrawlTime ?? null, x.googleCanonical ?? null, x.userCanonical ?? null, at, site, url));
  if (quotaError) writes.push(db.prepare('UPDATE gsc_index_runs SET error=? WHERE site=?').bind(quotaError.message, site));
  if (writes.length) await db.batch(writes);
  if (quotaError) throw quotaError;
  return indexStatus(db, site);
}

// ── Routes ──────────────────────────────────────────────────────────────────

export async function handleGscLive(request, env) {
  try {
    const u = new URL(request.url), [, tool, route] = u.pathname.match(/^\/admin\/(gsc|indexing)\/api\/([a-z-]+)\/?$/) || [];
    if (!tool) throw fail('Not found.', 404);
    if (!['GET', 'POST'].includes(request.method)) throw fail('Method not allowed.', 405);
    if (request.method === 'POST' && request.headers.get('Origin') !== u.origin) throw fail('Refresh the admin page and try again.', 403);
    const db = env.JOBS_DB;
    if (!db) throw fail('Storage is unavailable.', 503);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const site = validSite(body.site || u.searchParams.get('site') || DEFAULT_SITE);
    if (route === 'sites' && request.method === 'GET') {
      const list = await sites(await googleToken(env));
      return json({ sites: list, defaultSite: list.some(s => s.site === DEFAULT_SITE) ? DEFAULT_SITE : list[0]?.site || DEFAULT_SITE });
    }
    if (tool === 'gsc' && route === 'report' && request.method === 'GET') return json({ report: await savedInsights(db, site) });
    if (tool === 'gsc' && route === 'refresh' && request.method === 'POST') return json({ report: await refreshInsights(env, site) });
    if (tool === 'indexing' && route === 'status' && request.method === 'GET') return json(await indexStatus(db, site));
    if (tool === 'indexing' && route === 'start' && request.method === 'POST') return json(await startIndexRun(env, site, body.mode === 'problems' ? 'problems' : 'all', u.hostname));
    if (tool === 'indexing' && route === 'step' && request.method === 'POST') return json(await stepIndexRun(env, site));
    if (tool === 'indexing' && route === 'stop' && request.method === 'POST') { await db.prepare('UPDATE gsc_index_runs SET finished_at=? WHERE site=? AND finished_at IS NULL').bind(now(), site).run(); return json(await indexStatus(db, site)); }
    throw fail('Not found.', 404);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(JSON.stringify({ event: 'gsc_live_failed', error: error.name || 'Error' }));
    return json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message }, status);
  }
}
