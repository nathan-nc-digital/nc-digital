// Search Console insights and indexing helpers shared by the Worker API and the admin pages.
// The report keeps the shape the old scripts/gsc-report.mjs produced, so the page reads the same.

const DAY = 86400000;
const iso = (date) => date.toISOString().slice(0, 10);

export function gscDates(now = new Date()) {
  const ago = (days) => iso(new Date(now.getTime() - days * DAY));
  return { startDate: ago(28), endDate: ago(0), previousStartDate: ago(56), previousEndDate: ago(28), recentStartDate: ago(7), priorRecentStartDate: ago(14) };
}

// The nine Search Analytics queries behind one refresh, keyed by what they feed.
export function gscQueries(p) {
  const last28 = { startDate: p.startDate, endDate: p.endDate };
  return {
    topQueries: { ...last28, dimensions: ['query'], rowLimit: 25 },
    topPages: { ...last28, dimensions: ['page'], rowLimit: 20 },
    allQueries: { ...last28, dimensions: ['query'], rowLimit: 500 },
    queryPages: { ...last28, dimensions: ['query', 'page'], rowLimit: 500 },
    allPages: { ...last28, dimensions: ['page'], rowLimit: 500 },
    recent: { startDate: p.recentStartDate, endDate: p.endDate, dimensions: ['query'], rowLimit: 200 },
    prior: { startDate: p.priorRecentStartDate, endDate: p.recentStartDate, dimensions: ['query'], rowLimit: 200 },
    totals: { ...last28, dimensions: [] },
    prevTotals: { startDate: p.previousStartDate, endDate: p.previousEndDate, dimensions: [] },
  };
}

function rowToObject(row) {
  return { keys: row.keys || [], query: row.keys?.[0] || '', page: row.keys?.[1] || row.keys?.[0] || '', clicks: row.clicks || 0, impressions: row.impressions || 0, ctr: row.ctr || 0, position: row.position || 0 };
}

const byClicks = (a, b) => b.clicks - a.clicks;
const change = (a, b) => (b === 0 ? '—' : ((a - b) / b * 100).toFixed(1) + '%');

export function buildGscReport(site, period, results, now = new Date()) {
  const rows = (key) => results[key] || [];
  const opportunities = rows('allQueries')
    .filter(r => r.impressions >= 20 && r.ctr < 0.05 && r.position >= 4 && r.position <= 20)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 20);
  const queryPages = [...rows('queryPages')].sort((a, b) => b.impressions - a.impressions).slice(0, 200);
  const prior = Object.fromEntries(rows('prior').map(r => [r.keys[0], r]));
  const movers = rows('recent')
    .filter(r => prior[r.keys[0]] && r.impressions >= 10)
    .map(r => { const prev = prior[r.keys[0]]; return { query: r.keys[0], pos: r.position, prev: prev.position, delta: prev.position - r.position, clicks: r.clicks }; })
    .filter(r => Math.abs(r.delta) >= 2)
    .sort((a, b) => b.delta - a.delta);
  const blank = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const t = rows('totals')[0] || blank, pt = rows('prevTotals')[0] || blank;
  return {
    generatedAt: now.toISOString(),
    siteUrl: site,
    period,
    overview: { current: t, previous: pt, change: { clicks: change(t.clicks, pt.clicks), impressions: change(t.impressions, pt.impressions), ctr: change(t.ctr, pt.ctr) } },
    topQueries: [...rows('topQueries')].sort(byClicks).map(rowToObject),
    topPages: [...rows('topPages')].sort(byClicks).map(rowToObject),
    opportunities: opportunities.map(rowToObject),
    queryPages: queryPages.map(rowToObject),
    gained: movers.filter(r => r.delta > 0).slice(0, 10),
    lost: movers.filter(r => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10),
    // Compact lists kept for comparing one refresh with the next: [key, clicks, impressions, position].
    queries: rows('allQueries').map(compact),
    pages: rows('allPages').map(compact),
  };
}

const compact = (r) => [r.keys[0], r.clicks || 0, r.impressions || 0, Math.round((r.position || 0) * 10) / 10];
const MIN_IMPRESSIONS = 5, LIST = 12;

// What changed between two refreshes. Both hold last-28-day figures, so this shows how the rolling
// picture moved since the earlier refresh. Detailed lists need both refreshes to include `queries`.
export function compareSnapshots(cur, prev) {
  if (!cur || !prev) return null;
  const a = cur.overview.current, b = prev.overview.current;
  const out = { previousAt: prev.generatedAt, totals: ['clicks', 'impressions', 'ctr', 'position'].map(key => ({ key, previous: b[key] ?? 0, current: a[key] ?? 0 })), detailed: Boolean(cur.queries && prev.queries) };
  if (!out.detailed) return out;
  const map = (list = []) => new Map(list.map(([key, clicks, impressions, position]) => [key, { clicks, impressions, position }]));
  const q1 = map(cur.queries), q0 = map(prev.queries);
  const moves = [];
  for (const [query, now] of q1) {
    const was = q0.get(query);
    if (!was || now.impressions < MIN_IMPRESSIONS || was.impressions < MIN_IMPRESSIONS) continue;
    const delta = Math.round((was.position - now.position) * 10) / 10;
    if (Math.abs(delta) >= 1) moves.push({ query, from: was.position, to: now.position, delta, impressions: now.impressions, clicks: now.clicks, clicksBefore: was.clicks });
  }
  const weight = (m) => Math.abs(m.delta) * Math.log10(m.impressions + 10);
  out.rankingsUp = moves.filter(m => m.delta > 0).sort((x, y) => weight(y) - weight(x)).slice(0, LIST);
  out.rankingsDown = moves.filter(m => m.delta < 0).sort((x, y) => weight(y) - weight(x)).slice(0, LIST);
  const only = (from, other) => [...from].filter(([k, v]) => !other.has(k) && v.impressions >= MIN_IMPRESSIONS).sort((x, y) => y[1].impressions - x[1].impressions).slice(0, LIST).map(([query, v]) => ({ query, ...v }));
  out.newSearches = only(q1, q0);
  out.lostSearches = only(q0, q1);
  const p1 = map(cur.pages), p0 = map(prev.pages), pageMoves = [];
  for (const page of new Set([...p1.keys(), ...p0.keys()])) {
    const now = p1.get(page) || { clicks: 0, impressions: 0 }, was = p0.get(page) || { clicks: 0, impressions: 0 };
    const clicks = now.clicks - was.clicks, impressions = now.impressions - was.impressions;
    const bigImpressions = Math.abs(impressions) >= Math.max(20, was.impressions * 0.2);
    if (clicks || bigImpressions) pageMoves.push({ page, clicks, impressions, clicksNow: now.clicks, clicksBefore: was.clicks, impressionsNow: now.impressions, impressionsBefore: was.impressions });
  }
  const score = (m) => m.clicks * 1000 + m.impressions;
  out.pagesUp = pageMoves.filter(m => score(m) > 0).sort((x, y) => score(y) - score(x)).slice(0, LIST);
  out.pagesDown = pageMoves.filter(m => score(m) < 0).sort((x, y) => score(x) - score(y)).slice(0, LIST);
  return out;
}

// The refresh to compare against: the newest one at least six hours older, so two refreshes in a
// row still show a useful comparison; otherwise the newest older one.
export function pickBaseline(candidates, at, minHours = 6) {
  const older = candidates.filter(c => c && c.generatedAt < at).sort((x, y) => y.generatedAt.localeCompare(x.generatedAt));
  return older.find(c => Date.parse(at) - Date.parse(c.generatedAt) >= minHours * 3600000) || older[0] || null;
}

// ── Advice rules (unchanged from the original page) ─────────────────────────

export function queryIntent(query = '') {
  const q = query.toLowerCase();
  if (/\b(price|cost|cheap|affordable|quote|packages?)\b/.test(q)) return 'commercial';
  if (/\b(near me|cardiff|newport|swansea|wales|merthyr|aberdare|bridgend|llanelli|pontypridd|caerphilly)\b/.test(q)) return 'local';
  if (/\b(how|what|why|guide|best|compare|vs)\b/.test(q)) return 'informational';
  return 'mixed';
}

export function recommendedAction(row) {
  const ctr = row.ctr ?? 0, pos = row.position ?? 0, impressions = row.impressions ?? 0;
  if (impressions >= 50 && ctr < 0.01 && pos <= 20) return 'Rewrite title/meta to make the result more clickable.';
  if (pos >= 4 && pos <= 10) return 'Add stronger internal links and improve the matching section on the target page.';
  if (pos > 10 && pos <= 30) return 'Expand the page around this query and add supporting FAQ copy.';
  if (impressions >= 100 && ctr < 0.02) return 'Check search intent and make the snippet more specific.';
  if ((row.clicks ?? 0) > 0) return 'Keep monitoring and protect the ranking with internal links.';
  return 'Review whether this query needs a better target page.';
}

export function issueType(row) {
  if ((row.position ?? 0) >= 4 && (row.position ?? 0) <= 20 && (row.ctr ?? 0) < 0.05) return 'quick-win';
  if ((row.impressions ?? 0) >= 100 && (row.ctr ?? 0) < 0.01) return 'low-ctr';
  if ((row.position ?? 0) > 20) return 'page-two-plus';
  return 'monitor';
}

export function priorityActions(report) {
  return [
    ...(report.lost || []).slice(0, 6).map(row => ({ type: 'Ranking drop', title: row.query, detail: `Position moved from ${row.prev.toFixed(1)} to ${row.pos.toFixed(1)}.`, action: 'Check the ranking page, compare the current SERP, and add internal links from relevant pages.', score: 100 - row.delta, tone: 'page-two-plus' })),
    ...(report.opportunities || []).slice(0, 12).map(row => ({ type: issueType(row) === 'low-ctr' ? 'Low CTR' : 'Quick win', title: row.query, detail: `${Math.round(row.impressions).toLocaleString('en-GB')} impressions, ${(row.ctr * 100).toFixed(row.ctr * 100 < 1 ? 2 : 1)}% CTR, position ${row.position.toFixed(1)}.`, action: recommendedAction(row), score: (row.impressions ?? 0) + (30 - (row.position ?? 30)) * 10, tone: issueType(row) })),
  ].sort((a, b) => b.score - a.score).slice(0, 10);
}

// The site's home page, used to show short paths: sc-domain:x.co.uk → https://x.co.uk
export function siteOrigin(site = '') {
  if (site.startsWith('sc-domain:')) return 'https://' + site.slice(10);
  return site.replace(/\/$/, '');
}

export function pagePath(url, site) {
  if (!url) return '-';
  try { const u = new URL(url); return (u.pathname + u.search) || '/'; } catch { return url.replace(siteOrigin(site), '') || '/'; }
}

// ── Indexing ────────────────────────────────────────────────────────────────

// Reads <loc> entries from a sitemap or sitemap index. Child sitemaps are returned separately.
export function parseSitemap(xml = '') {
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'));
  return /<sitemapindex[\s>]/i.test(xml) ? { sitemaps: locs, urls: [] } : { sitemaps: [], urls: locs };
}

// Only pages on the property itself can be inspected.
export function belongsToSite(url, site) {
  try {
    const u = new URL(url);
    if (site.startsWith('sc-domain:')) { const d = site.slice(10).toLowerCase(), h = u.hostname.toLowerCase(); return h === d || h.endsWith('.' + d); }
    return url.startsWith(site);
  } catch { return false; }
}

export function inspectionRow(result) {
  const index = result?.inspectionResult?.indexStatusResult ?? {};
  return {
    status: index.verdict === 'PASS' ? 'indexed' : index.verdict ? 'not-indexed' : 'unknown',
    verdict: index.verdict ?? 'UNKNOWN',
    coverageState: index.coverageState ?? 'No coverage reason returned',
    pageFetchState: index.pageFetchState ?? null,
    lastCrawlTime: index.lastCrawlTime ?? null,
    googleCanonical: index.googleCanonical ?? null,
    userCanonical: index.userCanonical ?? null,
  };
}

// Plain-English explanation and fix for Google's coverage reasons.
export function coverageAdvice(page) {
  const reason = (page.coverageState || '').toLowerCase();
  if (page.status === 'indexed') return '';
  if (page.status === 'pending') return 'Not checked yet.';
  if (reason.includes('discovered')) return 'Google knows the page exists but has not crawled it yet. Link to it from strong pages (home, services, related posts) and request indexing in Search Console.';
  if (reason.includes('crawled')) return 'Google crawled the page but chose not to index it. Usually thin or overlapping content: make it more useful and distinct, and link to it internally.';
  if (reason.includes('duplicate') || reason.includes('canonical')) return 'Google treats this as a copy of another page. Check the canonical tag and make the content clearly different, or redirect it.';
  if (reason.includes('noindex')) return 'The page has a noindex tag. Remove it if the page should appear in Google.';
  if (reason.includes('robots')) return 'robots.txt blocks this page. Allow it if it should be indexed.';
  if (reason.includes('404') || reason.includes('not found')) return 'The page returns “not found”. Fix or redirect it, and remove it from the sitemap.';
  if (reason.includes('redirect')) return 'The URL redirects. List the final URL in the sitemap instead.';
  if (reason.includes('unknown to google')) return 'Google has not found this page yet. Submit the sitemap and request indexing in Search Console.';
  if (reason.includes('soft 404')) return 'Google thinks the page looks empty. Add real content or remove it.';
  if (reason.includes('server error') || reason.includes('5xx')) return 'Google hit a server error. Check the page loads reliably.';
  return 'Open the page in Search Console’s URL Inspection for details, then request indexing.';
}

export function daysSince(at, now = Date.now()) {
  return at ? Math.floor((now - Date.parse(at)) / DAY) : null;
}
