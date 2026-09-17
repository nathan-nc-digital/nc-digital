import locations from '../data/research-locations.json' with { type: 'json' };
import { readLimitedBody } from './social-http.js';
import { clean, parseResearchInput, seedKeywords, mapKeyword, relevantDiscovery, buildReport } from './keyword-planner.js';

const API = 'https://api.dataforseo.com/v3/';
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'Cloudflare-CDN-Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const decoder = new TextDecoder();
export const researchLocations = locations.filter(x => ['City', 'Post town', 'County', 'Region', 'District'].includes(x.type));

export async function dataForSeo(env, endpoint, input) {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) throw fail('DataForSEO is not connected. Ask Nathan to configure the API credentials.', 503);
  const bytes = new TextEncoder().encode(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`);
  const auth = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
  let response;
  try {
    response = await fetch(API + endpoint, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify([input]), signal: AbortSignal.timeout(35000) });
  } catch { throw fail('DataForSEO did not respond in time. This lookup may have been charged. Open saved research before trying again.', 502); }
  let body;
  try { body = JSON.parse(decoder.decode(await readLimitedBody(response, 4 * 1024 * 1024))); } catch { throw fail('DataForSEO returned an unreadable response.', 502); }
  const task = body.tasks?.[0];
  if (!response.ok || body.status_code !== 20000 || ![20000, 40102].includes(task?.status_code)) {
    const code = task?.status_code || body.status_code || response.status;
    const message = [401, 40100].includes(code) ? 'DataForSEO credentials were rejected.' : [402, 40200].includes(code) ? 'DataForSEO needs account credit before research can run.' : `DataForSEO could not complete this lookup (code ${code}).`;
    throw fail(message, 502);
  }
  return { result: task.result?.[0] || null, cost: typeof body.cost === 'number' ? body.cost : typeof task.cost === 'number' ? task.cost : 0, costReported: typeof body.cost === 'number' || typeof task.cost === 'number' };
}

export async function runResearch(env, input) {
  const seeds = seedKeywords(input);
  const shared = { location_code: 2826, language_code: 'en' };
  let cost = 0, calls = 0;
  const warnings = [];
  const lookup = async (label, endpoint, params) => {
    calls++;
    try { const r = await dataForSeo(env, endpoint, params); cost += r.cost; return r.result; }
    catch (error) { warnings.push(`${label}: ${error.message}`); return null; }
  };
  const [suggestions, related, serp] = await Promise.all([
    lookup('Keyword suggestions', 'dataforseo_labs/google/keyword_suggestions/live', { ...shared, keyword: input.query, limit: 40, include_seed_keyword: true }),
    lookup('Related keywords', 'dataforseo_labs/google/related_keywords/live', { ...shared, keyword: input.query, limit: 30, depth: 1 }),
    lookup('Local Google results', 'serp/google/organic/live/advanced', { keyword: input.query, location_code: input.location.code, language_code: 'en', device: 'desktop', os: 'windows', depth: 10 }),
  ]);
  const discovered = [...(suggestions?.items || []), ...(related?.items || [])].map(x => mapKeyword(x)).filter(x => relevantDiscovery(x.keyword, input, seeds, researchLocations));
  const candidates = [...new Set([...seeds.local, ...discovered.map(x => x.keyword), ...seeds.broad])].slice(0, 100);
  const overview = await lookup('Search metrics', 'dataforseo_labs/google/keyword_overview/live', { ...shared, keywords: candidates, include_serp_info: false });
  if (!overview && !suggestions && !related && !serp) throw fail(warnings[0] || 'Research could not be completed.', 502);
  const measured = new Map([...discovered, ...(overview?.items || []).map(x => mapKeyword(x, 'DataForSEO overview'))].map(x => [x.keyword, x]));
  const items = candidates.map(keyword => measured.get(keyword) || mapKeyword({ keyword }, 'Service idea — no metrics returned'));
  if (!items.some(x => x.volume !== null)) warnings.push('No search volumes were returned. Recommendations are service ideas only; missing data is not evidence of zero demand.');
  return buildReport(input, items, serp, warnings, cost, calls);
}

export async function handleKeywordResearch(request, env) {
  try {
    const url = new URL(request.url);
    const route = url.pathname.replace('/admin/keyword-research/api/', '').replace(/\/$/, '');
    if (!['GET', 'POST'].includes(request.method)) throw fail('Method not allowed.', 405);
    if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) throw fail('Refresh the admin page and try again.', 403);
    if (route === 'status' && request.method === 'GET') {
      let ready = false;
      if (env.JOBS_DB) { try { await env.JOBS_DB.prepare('SELECT id FROM keyword_reports LIMIT 1').first(); ready = true; } catch {} }
      return json({ connected: Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD), storageReady: ready });
    }
    if (route === 'locations' && request.method === 'GET') {
      const q = clean(url.searchParams.get('q')).slice(0, 80);
      return json({ locations: q.length < 2 ? [] : researchLocations.filter(x => clean(x.name).includes(q)).sort((a, b) => (a.type === 'City' ? -1 : b.type === 'City' ? 1 : a.name.localeCompare(b.name))).slice(0, 20) });
    }
    if (!env.JOBS_DB) throw fail('Research storage is not configured.', 503);
    if (route === 'history' && request.method === 'GET') {
      const { results } = await env.JOBS_DB.prepare('SELECT id, query, created_at, status, error FROM keyword_reports ORDER BY created_at DESC LIMIT 30').all();
      return json({ reports: results.map(x => ({ ...x, status: x.status === 'running' && Date.parse(x.created_at) < Date.now() - 180000 ? 'interrupted' : x.status })) });
    }
    if (route === 'report' && request.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!/^[a-f0-9-]{36}$/.test(id || '')) throw fail('Invalid report ID.');
      const row = await env.JOBS_DB.prepare('SELECT id, report, status, error FROM keyword_reports WHERE id = ?').bind(id).first();
      if (!row) throw fail('Report not found.', 404);
      return json({ id: row.id, report: row.report ? JSON.parse(row.report) : null, status: row.status, error: row.error });
    }
    if (route !== 'research' || request.method !== 'POST') throw fail('Not found.', 404);
    if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) throw fail('Connect DataForSEO before starting research.', 503);
    let body;
    try { body = JSON.parse(decoder.decode(await readLimitedBody(request, 12000))); } catch { throw fail('Invalid or oversized research request.'); }
    let input;
    try { input = parseResearchInput(body, researchLocations); } catch (error) { throw fail(error.message); }
    const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...input, refresh: false }))))].map(x => x.toString(16).padStart(2, '0')).join('');
    const existing = await env.JOBS_DB.prepare("SELECT id, report, created_at FROM keyword_reports WHERE fingerprint = ? AND status = 'complete' ORDER BY created_at DESC LIMIT 1").bind(fingerprint).first();
    if (existing && Date.parse(existing.created_at) > Date.now() - (input.refresh ? 60000 : 7 * 86400000)) return json({ id: existing.id, report: JSON.parse(existing.report), cached: true });
    const recent = await env.JOBS_DB.prepare('SELECT COUNT(*) AS count FROM keyword_reports WHERE created_at > ?').bind(new Date(Date.now() - 3600000).toISOString()).first();
    if (recent.count >= 30) throw fail('The hourly limit of 30 research runs has been reached. Open saved research or try again later.', 429);
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const claim = await env.JOBS_DB.prepare('UPDATE keyword_research_lock SET owner = ?, expires_at = ? WHERE id = 1 AND expires_at < ?').bind(id, new Date(Date.now() + 180000).toISOString(), now).run();
    if (!claim.meta.changes) throw fail('A research run is already in progress. Check saved research in a moment.', 429);
    try {
      await env.JOBS_DB.prepare("INSERT INTO keyword_reports (id, fingerprint, query, created_at, status) VALUES (?, ?, ?, ?, 'running')").bind(id, fingerprint, input.query, now).run();
      const report = await runResearch(env, input);
      await env.JOBS_DB.prepare("UPDATE keyword_reports SET status = 'complete', report = ? WHERE id = ?").bind(JSON.stringify(report), id).run();
      return json({ id, report, cached: false });
    } catch (error) {
      const message = error.status ? error.message : 'Research could not be saved. Check saved research before retrying; API lookups may have been charged.';
      await env.JOBS_DB.prepare("UPDATE keyword_reports SET status = 'failed', error = ? WHERE id = ?").bind(message, id).run();
      throw fail(message, error.status || 502);
    } finally { await env.JOBS_DB.prepare("UPDATE keyword_research_lock SET expires_at = ? WHERE id = 1 AND owner = ?").bind(new Date(Date.now() + 5000).toISOString(), id).run(); }
  } catch (error) { return json({ error: error.status ? error.message : 'Research is temporarily unavailable. Please try again shortly.' }, error.status || 500); }
}
