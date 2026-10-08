import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { enquiryOrigin, withCors, preflight, ENQUIRY_ORIGINS } from '../../src/lib/enquiry-cors.js';
import { handleEnquiry } from '../../src/lib/crm-api.js';

const API = 'https://nc-digital.co.uk/api/enquiries';
const PLUMBER = 'https://plumberwebsitedesign.co.uk';
const req = (url, origin, method = 'POST') => new Request(url, { method, headers: origin ? { Origin: origin } : {} });

test('own origin is accepted and not treated as external', () => {
  assert.deepEqual(enquiryOrigin(req(API, 'https://nc-digital.co.uk')), { origin: 'https://nc-digital.co.uk', external: false });
});

test('plumber origins are accepted as external', () => {
  for (const o of [PLUMBER, 'https://www.plumberwebsitedesign.co.uk']) {
    assert.deepEqual(enquiryOrigin(req(API, o)), { origin: o, external: true });
  }
});

test('unknown, look-alike and missing origins are rejected with 403', () => {
  for (const o of ['https://evil.example', 'https://plumberwebsitedesign.co.uk.evil.example', 'http://plumberwebsitedesign.co.uk', null]) {
    assert.throws(() => enquiryOrigin(req(API, o)), e => e.status === 403);
  }
});

test('withCors adds headers only for allowlisted origins', () => {
  const ext = withCors(Response.json({ ok: 1 }), PLUMBER);
  assert.equal(ext.headers.get('Access-Control-Allow-Origin'), PLUMBER);
  assert.equal(ext.headers.get('Vary'), 'Origin');
  assert.equal(withCors(Response.json({ ok: 1 }), null).headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(withCors(Response.json({ ok: 1 }), 'https://evil.example').headers.get('Access-Control-Allow-Origin'), null);
});

test('preflight answers allowlisted origins and refuses others', () => {
  const ok = preflight(req(API, PLUMBER, 'OPTIONS'));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), PLUMBER);
  assert.equal(ok.headers.get('Access-Control-Allow-Methods'), 'GET, POST');
  assert.equal(ok.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  const bad = preflight(req(API, 'https://evil.example', 'OPTIONS'));
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});

test('allowlist is exactly the plumber domains', () => {
  assert.deepEqual([...ENQUIRY_ORIGINS].sort(), [PLUMBER, 'https://www.plumberwebsitedesign.co.uk']);
});

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_create_jobs_table.sql', '0015_crm.sql', '0016_crm_workspace.sql', '0017_crm_reliability.sql', '0018_crm_undated_tasks.sql', '0019_crm_saved_views.sql', '0020_crm_tags.sql', '0021_crm_confirmation_kind.sql']) sqlite.exec(readFileSync('migrations/' + file, 'utf8'));
  t.after(() => sqlite.close());
  return { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { args: [], bind(...args) { this.args = args; return this; }, async first() { return statement.get(...this.args) || null; }, async all() { return { results: statement.all(...this.args) }; }, async run() { const r = statement.run(...this.args); return { meta: { changes: Number(r.changes) } }; } };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
const env = t => ({ JOBS_DB: database(t), CRM_ENABLED: 'true' });
const post = (origin, extra = {}) => new Request(API, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test Plumber', email: 'plumber@example.com', subject: 'New enquiry from Plumber Website Design', message: 'I need a website.', from_page: '/pricing/', service: 'Plumber website', submission_key: crypto.randomUUID(), ...extra }) });

test('plumber site enquiry is stored with its full source URL and CORS headers', async t => {
  const e = env(t);
  const body = post(PLUMBER);
  const key = JSON.parse(await body.clone().text()).submission_key;
  const res = await handleEnquiry(body, e);
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), PLUMBER);
  const ticket = await e.JOBS_DB.prepare('SELECT source_page FROM crm_tickets WHERE submission_key=?').bind(key).first();
  assert.equal(ticket.source_page, PLUMBER + '/pricing/');
});

test('own-site enquiry keeps its path and gets no CORS headers', async t => {
  const e = env(t);
  const body = post('https://nc-digital.co.uk', { from_page: '/contact/' });
  const key = JSON.parse(await body.clone().text()).submission_key;
  const res = await handleEnquiry(body, e);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  const ticket = await e.JOBS_DB.prepare('SELECT source_page FROM crm_tickets WHERE submission_key=?').bind(key).first();
  assert.equal(ticket.source_page, '/contact/');
});

test('unknown origin enquiry is rejected', async t => {
  const res = await handleEnquiry(post('https://evil.example'), env(t));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('preflight and config work from the plumber site', async t => {
  const e = env(t);
  const pre = await handleEnquiry(req(API, PLUMBER, 'OPTIONS'), e);
  assert.equal(pre.status, 204);
  const config = await handleEnquiry(req(API + '/config', PLUMBER, 'GET'), e);
  assert.equal(config.status, 200);
  assert.equal(config.headers.get('Access-Control-Allow-Origin'), PLUMBER);
  assert.deepEqual(await config.json(), { enabled: true });
});
