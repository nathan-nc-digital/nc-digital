import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker, { resolveRole, listJobs, createJob, updateJob, deleteJob, runScheduledJobs, jobsForCron } from '../../src/worker.js';

const authEnv = { ADMIN_PASSWORD: 'test-admin-password', BEN_PASSWORD: 'test-ben-password' };

function basicAuthHeader(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function makeFakeDb(initialRows = []) {
  let rows = initialRows.map(r => ({ ...r }));
  let nextId = rows.length ? Math.max(...rows.map(r => r.id)) + 1 : 1;
  return {
    prepare(sql) {
      return {
        _args: [],
        bind(...args) {
          this._args = args;
          return this;
        },
        async all() {
          if (sql.startsWith('SELECT * FROM jobs WHERE assigned_to')) {
            return { results: rows.filter(r => r.assigned_to === this._args[0]) };
          }
          if (sql.startsWith('SELECT * FROM jobs ORDER BY')) {
            return { results: rows };
          }
          return { results: [] };
        },
        async first() {
          if (sql.startsWith('SELECT * FROM jobs WHERE id')) {
            return rows.find(r => r.id === this._args[0]) ?? null;
          }
          return null;
        },
        async run() {
          if (sql.startsWith('INSERT INTO jobs')) {
            const [client_name, notes, status, eta, assigned_to, created_at, updated_at] = this._args;
            rows.push({ id: nextId++, client_name, notes, status, eta, assigned_to, created_at, updated_at });
          } else if (sql.startsWith('UPDATE jobs SET')) {
            const [client_name, notes, status, eta, assigned_to, updated_at, id] = this._args;
            const row = rows.find(r => r.id === id);
            if (row) Object.assign(row, { client_name, notes, status, eta, assigned_to, updated_at });
          } else if (sql.startsWith('DELETE FROM jobs')) {
            rows = rows.filter(r => r.id !== this._args[0]);
          }
          return {};
        },
      };
    },
  };
}

describe('resolveRole', async () => {
  test('missing or empty secrets fail closed and rotated secrets take effect', async () => {
    const header = basicAuthHeader('nathan', authEnv.ADMIN_PASSWORD);
    assert.equal(await resolveRole('/admin/crm/', header), null);
    assert.equal(await resolveRole('/admin/crm/', basicAuthHeader('nathan', ''), { ADMIN_PASSWORD: '' }), null);
    assert.equal(await resolveRole('/admin/crm/', header, { ADMIN_PASSWORD: 'rotated-test-password' }), null);
    assert.equal(await resolveRole('/admin/crm/', basicAuthHeader('nathan', 'rotated-test-password'), { ADMIN_PASSWORD: 'rotated-test-password' }), 'nathan');
  });

  test('Worker enforces secret-backed authentication for CRM pages and API', async () => {
    let assets = 0;
    const env = { ...authEnv, ASSETS: { async fetch() { assets++; return new Response('CRM'); } } };
    for (const path of ['/admin/crm/', '/admin/crm/api/setup']) {
      for (const headers of [{}, { Authorization: basicAuthHeader('ben', authEnv.BEN_PASSWORD) }, { Authorization: basicAuthHeader('nathan', 'wrong') }]) {
        assert.equal((await worker.fetch(new Request('https://nc-digital.co.uk' + path, { headers }), env)).status, 401);
      }
      assert.equal((await worker.fetch(new Request('https://nc-digital.co.uk' + path, { headers: { Authorization: basicAuthHeader('nathan', authEnv.ADMIN_PASSWORD) } }), env)).status, 200);
    }
    assert.equal(assets, 1);
  });

  test('nathan credentials work on any /admin path', async () => {
    const header = basicAuthHeader('nathan', authEnv.ADMIN_PASSWORD);
    assert.equal(await resolveRole('/admin/backlinks', header, authEnv), 'nathan');
    assert.equal(await resolveRole('/admin/jobs', header, authEnv), 'nathan');
  });

  test('ben credentials work only on /admin/jobs paths', async () => {
    const header = basicAuthHeader('ben', authEnv.BEN_PASSWORD);
    assert.equal(await resolveRole('/admin/jobs', header, authEnv), 'ben');
    assert.equal(await resolveRole('/admin/jobs/api/list', header, authEnv), 'ben');
    assert.equal(await resolveRole('/admin/backlinks', header, authEnv), null);
    assert.equal(await resolveRole('/admin/gsc', header, authEnv), null);
  });

  test('wrong password is rejected', async () => {
    const header = basicAuthHeader('nathan', 'wrong-password');
    assert.equal(await resolveRole('/admin/jobs', header, authEnv), null);
  });

  test('missing or malformed Authorization header is rejected', async () => {
    assert.equal(await resolveRole('/admin/jobs', null, authEnv), null);
    assert.equal(await resolveRole('/admin/jobs', 'Bearer sometoken', authEnv), null);
  });

  test('ben is rejected on paths that merely share the /admin/jobs prefix', async () => {
    const header = basicAuthHeader('ben', authEnv.BEN_PASSWORD);
    assert.equal(await resolveRole('/admin/jobsecrets', header, authEnv), null);
    assert.equal(await resolveRole('/admin/jobs-report', header, authEnv), null);
  });
});

describe('listJobs', () => {
  function seededEnv() {
    return { JOBS_DB: makeFakeDb([
      { id: 1, client_name: 'Smith Plumbing', notes: '', status: 'not_started', eta: null, assigned_to: 'ben', created_at: '2026-01-01', updated_at: '2026-01-01' },
      { id: 2, client_name: 'Davies Electrical', notes: '', status: 'doing', eta: null, assigned_to: 'nathan', created_at: '2026-01-02', updated_at: '2026-01-02' },
    ]) };
  }

  test('nathan sees every job', async () => {
    const jobs = await listJobs(seededEnv(), 'nathan');
    assert.equal(jobs.length, 2);
  });

  test('ben only sees jobs assigned to him', async () => {
    const jobs = await listJobs(seededEnv(), 'ben');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].client_name, 'Smith Plumbing');
  });
});

describe('createJob', () => {
  test('nathan can create a job', async () => {
    const env = { JOBS_DB: makeFakeDb() };
    const result = await createJob(env, 'nathan', { client_name: 'Jones Roofing', notes: 'Brief here', eta: '2026-08-05', assigned_to: 'ben' });
    assert.equal(result.status, 201);
    const jobs = await listJobs(env, 'nathan');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'not_started');
  });

  test('ben can create a job, always assigned to himself', async () => {
    const env = { JOBS_DB: makeFakeDb() };
    const result = await createJob(env, 'ben', { client_name: 'Jones Roofing', notes: 'Brief here' });
    assert.equal(result.status, 201);
    const jobs = await listJobs(env, 'nathan');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].assigned_to, 'ben');
  });

  test('ben cannot allocate a job to nathan even if he tries', async () => {
    const env = { JOBS_DB: makeFakeDb() };
    const result = await createJob(env, 'ben', { client_name: 'Jones Roofing', assigned_to: 'nathan' });
    assert.equal(result.status, 201);
    const jobs = await listJobs(env, 'nathan');
    assert.equal(jobs[0].assigned_to, 'ben');
  });

  test('rejects missing client_name', async () => {
    const env = { JOBS_DB: makeFakeDb() };
    const result = await createJob(env, 'nathan', { assigned_to: 'ben' });
    assert.equal(result.status, 400);
  });

  test('rejects invalid assigned_to', async () => {
    const env = { JOBS_DB: makeFakeDb() };
    const result = await createJob(env, 'nathan', { client_name: 'X', assigned_to: 'someone-else' });
    assert.equal(result.status, 400);
  });
});

describe('updateJob', () => {
  function seededEnv() {
    return { JOBS_DB: makeFakeDb([
      { id: 1, client_name: 'Smith Plumbing', notes: '', status: 'not_started', eta: null, assigned_to: 'ben', created_at: '2026-01-01', updated_at: '2026-01-01' },
      { id: 2, client_name: 'Davies Electrical', notes: '', status: 'doing', eta: null, assigned_to: 'nathan', created_at: '2026-01-02', updated_at: '2026-01-02' },
    ]) };
  }

  test('ben can move status on his own job', async () => {
    const env = seededEnv();
    const result = await updateJob(env, 'ben', { id: 1, status: 'doing' });
    assert.equal(result.status, 200);
    const [job] = await listJobs(env, 'ben');
    assert.equal(job.status, 'doing');
  });

  test('ben can update eta on his own job', async () => {
    const env = seededEnv();
    const result = await updateJob(env, 'ben', { id: 1, eta: '2026-08-10' });
    assert.equal(result.status, 200);
  });

  test('ben cannot update a job not assigned to him', async () => {
    const env = seededEnv();
    const result = await updateJob(env, 'ben', { id: 2, status: 'done' });
    assert.equal(result.status, 403);
    const jobs = await listJobs(env, 'nathan');
    const job2 = jobs.find(j => j.id === 2);
    assert.equal(job2.status, 'doing');
  });

  test('ben cannot change client_name, notes, or assigned_to', async () => {
    const env = seededEnv();
    const result = await updateJob(env, 'ben', { id: 1, client_name: 'New Name' });
    assert.equal(result.status, 403);
    const jobs = await listJobs(env, 'nathan');
    const job1 = jobs.find(j => j.id === 1);
    assert.equal(job1.client_name, 'Smith Plumbing');
  });

  test('explicit null clears eta instead of falling back to the old value', async () => {
    const env = { JOBS_DB: makeFakeDb([
      { id: 1, client_name: 'Smith Plumbing', notes: '', status: 'not_started', eta: '2026-08-01', assigned_to: 'ben', created_at: '2026-01-01', updated_at: '2026-01-01' },
    ]) };
    const result = await updateJob(env, 'nathan', { id: 1, eta: null });
    assert.equal(result.status, 200);
    const [job] = await listJobs(env, 'nathan');
    assert.equal(job.eta, null);
  });

  test('ben can explicitly clear eta on his own job', async () => {
    const env = { JOBS_DB: makeFakeDb([
      { id: 1, client_name: 'Smith Plumbing', notes: '', status: 'not_started', eta: '2026-08-01', assigned_to: 'ben', created_at: '2026-01-01', updated_at: '2026-01-01' },
    ]) };
    const result = await updateJob(env, 'ben', { id: 1, eta: null });
    assert.equal(result.status, 200);
    const [job] = await listJobs(env, 'ben');
    assert.equal(job.eta, null);
  });

  test('nathan can update any field on any job', async () => {
    const env = seededEnv();
    const result = await updateJob(env, 'nathan', { id: 1, client_name: 'Renamed', assigned_to: 'nathan' });
    assert.equal(result.status, 200);
  });

  test('rejects unknown job id', async () => {
    const env = seededEnv();
    const result = await updateJob(env, 'nathan', { id: 999, status: 'done' });
    assert.equal(result.status, 404);
  });

  test('rejects invalid status value', async () => {
    const env = seededEnv();
    const result = await updateJob(env, 'nathan', { id: 1, status: 'archived' });
    assert.equal(result.status, 400);
  });
});

describe('deleteJob', () => {
  test('nathan can delete a job', async () => {
    const env = { JOBS_DB: makeFakeDb([{ id: 1, client_name: 'X', notes: '', status: 'not_started', eta: null, assigned_to: 'ben', created_at: '', updated_at: '' }]) };
    const result = await deleteJob(env, 'nathan', { id: 1 });
    assert.equal(result.status, 200);
    assert.equal((await listJobs(env, 'nathan')).length, 0);
  });

  test('ben cannot delete a job', async () => {
    const env = { JOBS_DB: makeFakeDb([{ id: 1, client_name: 'X', notes: '', status: 'not_started', eta: null, assigned_to: 'ben', created_at: '', updated_at: '' }]) };
    const result = await deleteJob(env, 'ben', { id: 1 });
    assert.equal(result.status, 403);
    assert.equal((await listJobs(env, 'nathan')).length, 1);
  });
});

describe('scheduled jobs', () => {
  test('one failing job never stops the others, and each failure is logged by name', async () => {
    const ran = [];
    const logged = [];
    const original = console.error;
    console.error = (line) => logged.push(JSON.parse(line));
    try {
      await runScheduledJobs({}, {
        meta: async () => { ran.push('meta'); },
        crm: async () => { throw new Error('provider down'); },
        workspace: () => { throw new TypeError('sync throw'); },
        backup: async () => { await new Promise(r => setTimeout(r, 20)); ran.push('backup'); },
      });
    } finally { console.error = original; }
    assert.deepEqual(ran.sort(), ['backup', 'meta']);
    assert.deepEqual(logged.map(l => l.job).sort(), ['crm', 'workspace']);
    assert(logged.every(l => l.event === 'scheduled_job_failed'));
    assert(!JSON.stringify(logged).includes('provider down'), 'error messages are not logged');
  });

  test('customer email sending has its own cron invocation, separate from heavier jobs', () => {
    assert.deepEqual(Object.keys(jobsForCron('* * * * *')), ['crmOutbox', 'reportAlerts']);
    const shared = Object.keys(jobsForCron('*/2 * * * *'));
    assert(!shared.includes('crmOutbox'));
    assert.deepEqual(shared.sort(), ['backup', 'buffer', 'crmSync', 'meta', 'workspace']);
    assert.deepEqual(Object.keys(jobsForCron(undefined)).sort(), ['backup', 'buffer', 'crmOutbox', 'crmSync', 'meta', 'reportAlerts', 'workspace']);
  });

  test('shared report links serve the public report page without login, never indexed or cached', async () => {
    const requested = [];
    const env = { ...authEnv, ASSETS: { async fetch(req) { requested.push(new URL(req.url).pathname); return new Response('<html>report</html>', { headers: { 'Content-Type': 'text/html' } }); } } };
    const res = await worker.fetch(new Request('https://nc-digital.co.uk/report/AbCdEfGhIjKlMnOpQrStUv_-'), env);
    assert.equal(res.status, 200);
    assert.deepEqual(requested, ['/report/']);
    assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(res.headers.get('Cache-Control'), /no-store/);
    const api = await worker.fetch(new Request('https://nc-digital.co.uk/api/report/AbCdEfGhIjKlMnOpQrStUv_-'), env);
    assert.equal(api.status, 404, 'unknown links are not found, and the API needs no admin login');
  });

  test('the Worker scheduled handler resolves even when every job fails', async () => {
    const original = console.error; console.error = () => {};
    try { await worker.scheduled({}, {}); } finally { console.error = original; }
  });
});

