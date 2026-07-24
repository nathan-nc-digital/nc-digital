import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRole, listJobs, createJob, updateJob, deleteJob } from '../../src/worker.js';

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

describe('resolveRole', () => {
  test('nathan credentials work on any /admin path', () => {
    const header = basicAuthHeader('nathan', 'NC-Digital2026');
    assert.equal(resolveRole('/admin/backlinks', header), 'nathan');
    assert.equal(resolveRole('/admin/jobs', header), 'nathan');
  });

  test('ben credentials work only on /admin/jobs paths', () => {
    const header = basicAuthHeader('ben', 'B1E2N3!');
    assert.equal(resolveRole('/admin/jobs', header), 'ben');
    assert.equal(resolveRole('/admin/jobs/api/list', header), 'ben');
    assert.equal(resolveRole('/admin/backlinks', header), null);
    assert.equal(resolveRole('/admin/gsc', header), null);
  });

  test('wrong password is rejected', () => {
    const header = basicAuthHeader('nathan', 'wrong-password');
    assert.equal(resolveRole('/admin/jobs', header), null);
  });

  test('missing or malformed Authorization header is rejected', () => {
    assert.equal(resolveRole('/admin/jobs', null), null);
    assert.equal(resolveRole('/admin/jobs', 'Bearer sometoken'), null);
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

  test('ben cannot create a job', async () => {
    const env = { JOBS_DB: makeFakeDb() };
    const result = await createJob(env, 'ben', { client_name: 'Jones Roofing', assigned_to: 'ben' });
    assert.equal(result.status, 403);
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
  });

  test('ben cannot change client_name, notes, or assigned_to', async () => {
    const env = seededEnv();
    const result = await updateJob(env, 'ben', { id: 1, client_name: 'New Name' });
    assert.equal(result.status, 403);
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
