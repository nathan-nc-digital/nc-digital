// Admin home dashboard: one summary of what needs attention across the CRM, shared reports,
// saved SEO clients, Search Console and DataForSEO spend. Everything is read from D1 apart from
// the DataForSEO balance, which is cached for 30 minutes.
import { readLimitedBody } from './social-http.js';
import { DEFAULT_SITE } from './gsc-live-api.js';

const DAY = 86400000, BALANCE_TTL = 30 * 60000, DEFAULT_BUDGET = 20;
const now = () => new Date().toISOString();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex' } });
const ukDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const all = async (stmt) => (await stmt.all()).results;

export const TOOL_LABELS = { 'keyword-research': 'Keyword research', 'website-audit': 'Website audits', 'seo-report': 'SEO report rankings', 'competitor-gaps': 'Competitor gaps', 'emd-finder': 'EMD finder', other: 'Other' };

async function setting(db, key) {
  const row = await db.prepare('SELECT value,updated_at AS updatedAt FROM admin_settings WHERE key=?').bind(key).first();
  return row ? { value: JSON.parse(row.value), updatedAt: row.updatedAt } : null;
}
const saveSetting = (db, key, value) => db.prepare('INSERT INTO admin_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key, JSON.stringify(value), now()).run();

async function dataForSeoBalance(env, db) {
  const cached = await setting(db, 'dataforseo_balance');
  if (cached && Date.now() - Date.parse(cached.updatedAt) < BALANCE_TTL) return { ...cached.value, checkedAt: cached.updatedAt };
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) return null;
  try {
    const auth = btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`);
    const r = await fetch('https://api.dataforseo.com/v3/appendix/user_data', { headers: { Authorization: 'Basic ' + auth }, signal: AbortSignal.timeout(10000) });
    const body = JSON.parse(new TextDecoder().decode(await readLimitedBody(r, 200000)));
    const balance = body.tasks?.[0]?.result?.[0]?.money?.balance;
    if (typeof balance !== 'number') throw new Error('no balance');
    await saveSetting(db, 'dataforseo_balance', { balance });
    return { balance, checkedAt: now() };
  } catch { return cached ? { ...cached.value, checkedAt: cached.updatedAt, stale: true } : null; }
}

export async function spendSummary(env, db, at = new Date()) {
  const monthStart = ukDate(at).slice(0, 8) + '01';
  const [rows, budget, balance] = await Promise.all([
    all(db.prepare('SELECT tool,COUNT(*) AS lookups,SUM(cost) AS cost FROM dataforseo_usage WHERE at>=? GROUP BY tool ORDER BY cost DESC').bind(monthStart)),
    setting(db, 'dataforseo_budget'),
    dataForSeoBalance(env, db),
  ]);
  const month = rows.reduce((sum, r) => sum + r.cost, 0), limit = budget?.value ?? DEFAULT_BUDGET;
  return {
    month: Math.round(month * 10000) / 10000, budget: limit, since: monthStart,
    level: month >= limit ? 'over' : month >= limit * 0.8 ? 'near' : 'ok',
    byTool: rows.map(r => ({ tool: r.tool, label: TOOL_LABELS[r.tool] || r.tool, lookups: r.lookups, cost: Math.round(r.cost * 10000) / 10000 })),
    balance: balance?.balance ?? null, balanceCheckedAt: balance?.checkedAt ?? null,
  };
}

export async function dashboardSummary(env, at = new Date()) {
  const db = env.JOBS_DB, today = ukDate(at), monthStart = today.slice(0, 8) + '01';
  const weekAgo = new Date(at.getTime() - 7 * DAY).toISOString(), monthAgo = new Date(at.getTime() - 30 * DAY).toISOString();
  const [newCount, enquiries, tasks, unopenedAudits, unopenedReports, openedAudits, openedReports, clients, index, snapshot, spend] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM crm_tickets WHERE status='new' AND archived_at IS NULL").first(),
    all(db.prepare("SELECT id,name,company,subject,status,created_at AS createdAt FROM crm_tickets WHERE status IN ('new','open') AND archived_at IS NULL ORDER BY created_at DESC LIMIT 6")),
    all(db.prepare("SELECT id,title,due_date AS dueDate,ticket_id AS ticketId FROM crm_tasks WHERE status='open' AND archived_at IS NULL AND due_date IS NOT NULL AND due_date<=? ORDER BY due_date LIMIT 8").bind(today)),
    all(db.prepare('SELECT id,client AS name,url,share_created_at AS sharedAt FROM website_audits WHERE share_token IS NOT NULL AND share_views=0 AND share_created_at>=? ORDER BY share_created_at DESC LIMIT 8').bind(monthAgo)),
    all(db.prepare('SELECT id,title AS name,share_created_at AS sharedAt FROM analytics_reports WHERE share_token IS NOT NULL AND share_views=0 AND share_created_at>=? ORDER BY share_created_at DESC LIMIT 8').bind(monthAgo)),
    all(db.prepare('SELECT id,client AS name,share_views AS views,share_last_viewed_at AS viewedAt FROM website_audits WHERE share_last_viewed_at>=? ORDER BY share_last_viewed_at DESC LIMIT 6').bind(weekAgo)),
    all(db.prepare('SELECT id,title AS name,share_views AS views,share_last_viewed_at AS viewedAt FROM analytics_reports WHERE share_last_viewed_at>=? ORDER BY share_last_viewed_at DESC LIMIT 6').bind(weekAgo)),
    all(db.prepare("SELECT c.id,c.name,(SELECT MAX(r.created_at) FROM analytics_reports r WHERE r.client_id=c.id AND r.status='complete') AS lastReport FROM seo_clients c ORDER BY c.name")),
    db.prepare("SELECT COUNT(*) AS total,SUM(status='indexed') AS indexed,SUM(status='not-indexed') AS notIndexed,SUM(status='pending') AS pending,SUM(status<>'indexed' AND first_seen<=?) AS stuck,MAX(inspected_at) AS lastChecked FROM gsc_index_pages WHERE site=? AND in_sitemap=1").bind(weekAgo, DEFAULT_SITE).first(),
    db.prepare('SELECT data FROM gsc_snapshots WHERE site=?').bind(DEFAULT_SITE).first(),
    spendSummary(env, db, at),
  ]);
  const stuckPages = index?.stuck ? await all(db.prepare("SELECT url,coverage_state AS coverageState,first_seen AS firstSeen FROM gsc_index_pages WHERE site=? AND in_sitemap=1 AND status<>'indexed' AND first_seen<=? ORDER BY first_seen DESC LIMIT 6").bind(DEFAULT_SITE, weekAgo)) : [];
  const search = snapshot ? JSON.parse(snapshot.data) : null;
  const tag = (kind) => (x) => ({ ...x, kind });
  return {
    generatedAt: at.toISOString(),
    enquiries: { newCount: newCount?.n || 0, recent: enquiries },
    tasks,
    shares: {
      unopened: [...unopenedAudits.map(tag('audit')), ...unopenedReports.map(tag('seo'))].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt)),
      opened: [...openedAudits.map(tag('audit')), ...openedReports.map(tag('seo'))].sort((a, b) => b.viewedAt.localeCompare(a.viewedAt)),
    },
    seoClients: clients.map(c => ({ ...c, due: !c.lastReport || c.lastReport < monthStart })),
    indexing: { site: DEFAULT_SITE, total: index?.total || 0, indexed: index?.indexed || 0, notIndexed: index?.notIndexed || 0, pending: index?.pending || 0, stuck: index?.stuck || 0, stuckPages, lastChecked: index?.lastChecked || null },
    search: search ? { generatedAt: search.generatedAt, period: search.period, current: search.overview.current, previous: search.overview.previous, gained: search.gained.length, lost: search.lost.length } : null,
    spend,
  };
}

export async function handleDashboard(request, env) {
  try {
    const u = new URL(request.url), route = u.pathname.replace('/admin/dashboard/api/', '').replace(/\/$/, '');
    if (request.method === 'POST' && request.headers.get('Origin') !== u.origin) throw fail('Refresh the admin page and try again.', 403);
    if (!env.JOBS_DB) throw fail('Storage is unavailable.', 503);
    if (route === 'summary' && request.method === 'GET') return json(await dashboardSummary(env));
    if (route === 'spend' && request.method === 'GET') return json(await spendSummary(env, env.JOBS_DB));
    if (route === 'budget' && request.method === 'POST') {
      const { budget } = await request.json().catch(() => ({}));
      const value = Number(budget);
      if (!Number.isFinite(value) || value < 1 || value > 10000) throw fail('Enter a monthly budget between $1 and $10,000.');
      await saveSetting(env.JOBS_DB, 'dataforseo_budget', Math.round(value * 100) / 100);
      return json(await spendSummary(env, env.JOBS_DB));
    }
    throw fail('Not found.', 404);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(JSON.stringify({ event: 'dashboard_failed', error: error.name || 'Error', message: String(error.message || '').slice(0, 200) }));
    return json({ error: status === 500 ? 'The dashboard could not load. Please try again.' : error.message }, status);
  }
}
