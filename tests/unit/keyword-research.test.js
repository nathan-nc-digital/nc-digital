import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseResearchInput, mapKeyword, seedKeywords, classifyKeyword, planPages, relevantDiscovery } from '../../src/lib/keyword-planner.js';
import { handleKeywordResearch, researchLocations, dataForSeo } from '../../src/lib/keyword-research.js';
import worker from '../../src/worker.js';
const origin = 'https://nc-digital.co.uk';
const input = () => parseResearchInput({ query: 'Plumber Merthyr Tydfil' }, researchLocations);
function environment(t) {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../../migrations/0006_keyword_research.sql', import.meta.url), 'utf8')); t.after(() => db.close());
  return { DATAFORSEO_LOGIN: 'test', DATAFORSEO_PASSWORD: 'private-test', JOBS_DB: { prepare(sql) { const s = db.prepare(sql); return { args: [], bind(...args) { this.args = args; return this; }, async first() { return s.get(...this.args) || null; }, async all() { return { results: s.all(...this.args) }; }, async run() { return { meta: s.run(...this.args) }; } }; } } };
}
const request = (route, body, headers = {}) => new Request(`${origin}/admin/keyword-research/api/${route}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
function provider(t, hold) {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.ok(options.headers.Authorization.startsWith('Basic ')); assert.ok(!url.includes('private-test'));
    const task = JSON.parse(options.body)[0]; let result;
    if (url.includes('keyword_overview')) { assert.equal(task.location_code, 2826); result = { items: task.keywords.map(keyword => ({ keyword, keyword_info: { search_volume: keyword === 'plumber merthyr tydfil' ? 260 : null, cpc: 4.93, competition: .59 }, keyword_properties: { keyword_difficulty: null } })) }; }
    else if (url.includes('/serp/')) { assert.equal(task.location_code, 1007443); if (hold) await hold; result = { items: [{ type: 'organic', rank_group: 1, title: 'Local plumber', domain: 'example.co.uk', url: 'https://example.co.uk/' }] }; }
    else result = { items: [] };
    return Response.json({ status_code: 20000, cost: .01, tasks: [{ status_code: 20000, result: [result] }] });
  }); return () => calls;
}
test('service and precise location are inferred, with safe explicit overrides', () => {
  assert.equal(input().service, 'plumber'); assert.equal(input().location.code, 1007443);
  const r = parseResearchInput({ query: 'Electrician in Cardiff', website: 'www.example.co.uk/path', services: 'Rewiring, rewiring' }, researchLocations);
  assert.equal(r.service, 'electrician'); assert.equal(r.town, 'cardiff'); assert.equal(r.website, 'example.co.uk'); assert.deepEqual(r.extra, ['rewiring']);
  assert.throws(() => parseResearchInput({ query: 'plumber nonexistent-town' }, researchLocations), /Choose a UK town/);
  assert.throws(() => parseResearchInput({ query: 'plumber merthyr tydfil', website: 'javascript:alert(1)' }, researchLocations));
  assert.throws(() => parseResearchInput({ query: 'plumber merthyr tydfil', location: [] }, researchLocations));
});
test('missing metrics stay null; true zero difficulty is retained', () => {
  const a = mapKeyword({ keyword: 'plumber merthyr tydfil', keyword_info: { search_volume: null }, keyword_properties: { keyword_difficulty: null } });
  assert.equal(a.volume, null); assert.equal(a.difficulty, null);
  const b = mapKeyword({ keyword: a.keyword, keyword_info: { search_volume: 0 }, keyword_properties: { keyword_difficulty: 0 } });
  assert.equal(b.volume, 0); assert.equal(b.difficulty, 0);
  assert.ok(classifyKeyword(b, input(), seedKeywords(input())).score > classifyKeyword(a, input(), seedKeywords(input())).score);
});
test('close variants share one core page; generic UK demand stays out of local plans', () => {
  const i = input(), seeds = seedKeywords(i);
  const rows = ['plumber merthyr tydfil', 'plumbers merthyr tydfil', 'plumber', 'emergency plumber merthyr tydfil'].map(keyword => classifyKeyword(mapKeyword({ keyword }), i, seeds));
  const plan = planPages(rows, i); assert.equal(plan.length, 2); assert.equal(plan[0].path, '/'); assert.ok(plan[0].supporting.includes('plumbers merthyr tydfil')); assert.ok(!plan[0].supporting.includes('plumber')); assert.equal(rows[2].priority, 'Supporting research');
  assert.equal(relevantDiscovery('plumber jobs merthyr tydfil', i, seeds, researchLocations), false);
  assert.equal(relevantDiscovery('plumber cardiff', i, seeds, researchLocations), false);
});
test('research persists and the same query reuses its report without paid calls', async t => {
  const env = environment(t), calls = provider(t);
  const first = await handleKeywordResearch(request('research', { query: 'Plumber Merthyr Tydfil' }), env); assert.equal(first.status, 200);
  const data = await first.json(); assert.equal(data.report.cost.usd, .04); assert.equal(data.report.organic.length, 1); assert.equal(calls(), 4);
  const repeat = await (await handleKeywordResearch(request('research', { query: 'plumber merthyr tydfil' }), env)).json(); assert.equal(repeat.cached, true); assert.equal(repeat.id, data.id); assert.equal(calls(), 4);
  const history = await (await handleKeywordResearch(request('history'), env)).json(); assert.equal(history.reports.length, 1);
  const saved = await (await handleKeywordResearch(request(`report?id=${data.id}`), env)).json(); assert.equal(saved.report.keywords[0].keyword, 'plumber merthyr tydfil'); assert.ok(!JSON.stringify(saved).includes('private-test'));
});
test('concurrent requests cannot cause duplicate paid research', async t => {
  const env = environment(t); let release; const held = new Promise(r => { release = r; }); const calls = provider(t, held);
  const first = handleKeywordResearch(request('research', { query: 'plumber merthyr tydfil' }), env);
  while (calls() < 3) await new Promise(r => setTimeout(r, 1));
  const second = await handleKeywordResearch(request('research', { query: 'plumber merthyr tydfil' }), env); assert.equal(second.status, 429); release(); assert.equal((await first).status, 200); assert.equal(calls(), 4);
});
test('provider task failures cannot be presented as successful measured results', async t => {
  const env = environment(t); t.mock.method(globalThis, 'fetch', async () => Response.json({ status_code: 20000, tasks: [{ status_code: 40200, status_message: 'secret text private-test' }] }));
  const result = await handleKeywordResearch(request('research', { query: 'plumber merthyr tydfil' }), env); assert.equal(result.status, 502); const text = await result.text(); assert.match(text, /credit/); assert.ok(!text.includes('private-test'));
  const history = await (await handleKeywordResearch(request('history'), env)).json(); assert.equal(history.reports[0].status, 'failed');
});
test('partial provider failure is explicit while other evidence is saved', async t => {
  const env = environment(t); t.mock.method(globalThis, 'fetch', async url => Response.json(url.includes('/serp/') ? { status_code: 20000, cost: .002, tasks: [{ status_code: 20000, result: [{ items: [] }] }] } : { status_code: 20000, tasks: [{ status_code: 50000 }] }));
  const response = await handleKeywordResearch(request('research', { query: 'plumber merthyr tydfil' }), env); assert.equal(response.status, 200); const { report } = await response.json(); assert.ok(report.warnings.length >= 3); assert.ok(report.keywords.every(x => x.volume === null));
});
test('API rejects cross-origin requests and unauthorised users before paid work', async t => {
  const env = environment(t), calls = provider(t);
  assert.equal((await handleKeywordResearch(request('research', { query: 'plumber merthyr tydfil' }, { Origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await worker.fetch(request('status'), env)).status, 401);
  env.BEN_PASSWORD = 'test-ben-password';
  const ben = 'Basic ' + Buffer.from(`ben:${env.BEN_PASSWORD}`).toString('base64');
  assert.equal((await worker.fetch(request('status', null, { Authorization: ben }), env)).status, 401); assert.equal(calls(), 0);
});
test('oversized input, invalid report IDs and missing credentials fail safely', async t => {
  const env = environment(t), calls = provider(t);
  assert.equal((await handleKeywordResearch(request('research', { query: 'x'.repeat(15000) }), env)).status, 400);
  assert.equal((await handleKeywordResearch(request('report?id=../../secret'), env)).status, 400);
  delete env.DATAFORSEO_PASSWORD; assert.equal((await handleKeywordResearch(request('research', { query: 'plumber merthyr tydfil' }), env)).status, 503); assert.equal(calls(), 0);
});
