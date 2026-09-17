# Jobs Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal Kanban jobs board at `/admin/jobs/` where Nathan creates and assigns website jobs, and his staff member Ben (a separate login, scoped only to this page) moves his assigned jobs through Not started → Doing → Done and keeps an ETA updated.

**Architecture:** This is the first feature on this site that needs data changing at runtime — everything else is a static build. It adds one Cloudflare D1 database (`nc-digital-jobs`, bound as `JOBS_DB`), a handful of API routes added to the existing `src/worker.js` (which already handles Basic Auth and asset-serving for `/admin/*`), and one new static Astro page (`src/pages/admin/jobs.astro`) whose vanilla-JS talks to those routes with `fetch()` — the same pattern the quote calculator already uses for Web3Forms. Auth is extended from one shared Basic Auth credential to two: Nathan's (works everywhere under `/admin/*`) and Ben's (works only under `/admin/jobs`).

**Tech Stack:** Cloudflare Workers + D1 (SQLite), Astro 5 static page, vanilla JS. Testing: Node's built-in test runner (`node --test`, zero new dependencies) for the worker's auth/API logic against a fake in-memory D1 double, and Playwright (mocking the API via `page.route()`, matching the existing convention from `tests/website-cost-calculator.spec.ts`) for the page's UI behaviour.

**Reference spec:** `docs/superpowers/specs/2026-07-24-jobs-board-design.md`

---

### Task 1: Provision the D1 database and schema

**Files:**
- Create: `migrations/0001_create_jobs_table.sql`
- Modify: `wrangler.toml`

This task provisions a **real Cloudflare resource** in the account (a D1 database). It's expected and was called out explicitly in the approved design spec — not a surprise action — but report back clearly what was created so it's visible, not just silently done.

- [ ] **Step 1: Create the D1 database**

Run (uses the same `CLOUDFLARE_API_TOKEN` already used for `wrangler deploy` elsewhere in this project):

```bash
CLOUDFLARE_API_TOKEN=<CLOUDFLARE_API_TOKEN> npx wrangler d1 create nc-digital-jobs
```

Expected output includes a block like:

```toml
[[d1_databases]]
binding = "DB"
database_name = "nc-digital-jobs"
database_id = "<a-uuid-will-appear-here>"
```

- [ ] **Step 2: Add the binding to `wrangler.toml`**

Add the block from Step 1 to `wrangler.toml`, renaming `binding = "DB"` to `binding = "JOBS_DB"` (this exact binding name, `JOBS_DB`, is what `src/worker.js` will reference in Task 2 — keep them in sync). Append it after the existing `[assets]` block:

```toml
[[d1_databases]]
binding = "JOBS_DB"
database_name = "nc-digital-jobs"
database_id = "<the-uuid-from-step-1>"
```

- [ ] **Step 3: Write the schema migration**

Create `migrations/0001_create_jobs_table.sql`:

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'doing', 'done')),
  eta TEXT,
  assigned_to TEXT NOT NULL CHECK (assigned_to IN ('nathan', 'ben')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 4: Apply the migration locally and remotely**

```bash
CLOUDFLARE_API_TOKEN=<CLOUDFLARE_API_TOKEN> npx wrangler d1 execute nc-digital-jobs --local --file=migrations/0001_create_jobs_table.sql
CLOUDFLARE_API_TOKEN=<CLOUDFLARE_API_TOKEN> npx wrangler d1 execute nc-digital-jobs --remote --file=migrations/0001_create_jobs_table.sql
```

- [ ] **Step 5: Verify the table exists remotely**

```bash
CLOUDFLARE_API_TOKEN=<CLOUDFLARE_API_TOKEN> npx wrangler d1 execute nc-digital-jobs --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs';"
```

Expected: output includes a row with `name: jobs`.

- [ ] **Step 6: Commit**

```bash
git add wrangler.toml migrations/0001_create_jobs_table.sql
git commit -m "feat: provision D1 database for jobs board"
```

---

### Task 2: Worker auth + API logic (TDD, no D1 needed for testing)

**Files:**
- Modify: `src/worker.js`
- Create: `tests/unit/worker.test.js`
- Modify: `package.json` (add `test:unit` script)
- Modify: `playwright.config.ts` (exclude `tests/unit/` from Playwright's own test collection)

**Context:** `src/worker.js` currently has one hardcoded admin credential (`ADMIN_USER`/`ADMIN_PASS`) checked by a `checkAuth()` boolean function for every `/admin/*` request. This task replaces that with a `resolveRole()` function returning `'nathan' | 'ben' | null` — Nathan's credentials work anywhere under `/admin/*`; Ben's only work under `/admin/jobs`. It also adds the D1-backed job CRUD functions and wires new `/admin/jobs/api/*` routes into the existing `fetch` handler.

Since `npm run dev` (Astro's own dev server, used by the Playwright suite) never invokes `src/worker.js` at all — it's only run via `wrangler dev` or in production — none of this can be tested through Playwright. Instead, the auth and CRUD logic are written as small, pure, exported functions and tested directly with Node's built-in test runner against a lightweight fake D1 double (no real database, no `wrangler dev` process needed). This keeps the tests fast and dependency-free.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/worker.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/unit/`
Expected: FAIL — `resolveRole`, `listJobs`, `createJob`, `updateJob`, `deleteJob` aren't exported from `src/worker.js` yet.

- [ ] **Step 3: Replace `src/worker.js` with the new auth + API logic**

Replace the entire contents of `src/worker.js` with:

```js
const ADMIN_USER = 'nathan';
const ADMIN_PASS = 'NC-Digital2026';
const BEN_USER = 'ben';
const BEN_PASS = 'B1E2N3!';

const VALID_STATUSES = ['not_started', 'doing', 'done'];
const VALID_ASSIGNEES = ['nathan', 'ben'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.protocol !== 'https:' || url.hostname === 'www.nc-digital.co.uk') {
      url.protocol = 'https:';
      url.hostname = 'nc-digital.co.uk';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith('/admin/jobs/api/')) {
      const role = resolveRole(url.pathname, request.headers.get('Authorization'));
      if (!role) return unauthorizedResponse();
      return handleJobsApi(request, env, role, url.pathname);
    }

    if (url.pathname.startsWith('/admin')) {
      const role = resolveRole(url.pathname, request.headers.get('Authorization'));
      if (!role) return unauthorizedResponse();
      // Bypass cache for admin pages so auth always runs
      const res = await env.ASSETS.fetch(request);
      return new Response(res.body, {
        status: res.status,
        headers: {
          ...Object.fromEntries(res.headers),
          'Cache-Control': 'no-store, no-cache, private',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

function unauthorizedResponse() {
  return new Response('Unauthorised', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="NC Digital Admin", charset="UTF-8"',
      'Cache-Control': 'no-store, no-cache, private',
    },
  });
}

export function decodeBasicAuth(header) {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice(6));
    const colon = decoded.indexOf(':');
    if (colon === -1) return null;
    return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
  } catch {
    return null;
  }
}

export function resolveRole(pathname, authHeader) {
  const creds = decodeBasicAuth(authHeader);
  if (!creds) return null;
  if (creds.user === ADMIN_USER && creds.pass === ADMIN_PASS) return 'nathan';
  if (creds.user === BEN_USER && creds.pass === BEN_PASS && pathname.startsWith('/admin/jobs')) return 'ben';
  return null;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, private' },
  });
}

export async function listJobs(env, role) {
  const stmt = role === 'ben'
    ? env.JOBS_DB.prepare('SELECT * FROM jobs WHERE assigned_to = ? ORDER BY created_at').bind('ben')
    : env.JOBS_DB.prepare('SELECT * FROM jobs ORDER BY created_at');
  const { results } = await stmt.all();
  return results;
}

export async function createJob(env, role, body) {
  if (role !== 'nathan') return { error: 'Forbidden', status: 403 };
  const { client_name, notes, eta, assigned_to } = body;
  if (!client_name || !assigned_to) return { error: 'client_name and assigned_to are required', status: 400 };
  if (!VALID_ASSIGNEES.includes(assigned_to)) return { error: 'Invalid assigned_to', status: 400 };
  const now = new Date().toISOString();
  await env.JOBS_DB.prepare(
    'INSERT INTO jobs (client_name, notes, status, eta, assigned_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(client_name, notes ?? null, 'not_started', eta ?? null, assigned_to, now, now).run();
  return { status: 201 };
}

export async function updateJob(env, role, body) {
  const { id, status, eta, client_name, notes, assigned_to } = body;
  if (!id) return { error: 'id is required', status: 400 };
  if (status !== undefined && !VALID_STATUSES.includes(status)) return { error: 'Invalid status', status: 400 };
  if (assigned_to !== undefined && !VALID_ASSIGNEES.includes(assigned_to)) return { error: 'Invalid assigned_to', status: 400 };

  const job = await env.JOBS_DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  if (!job) return { error: 'Not found', status: 404 };

  if (role === 'ben') {
    if (job.assigned_to !== 'ben') return { error: 'Forbidden', status: 403 };
    if (client_name !== undefined || notes !== undefined || assigned_to !== undefined) {
      return { error: 'Forbidden', status: 403 };
    }
  }

  const now = new Date().toISOString();
  const next = {
    client_name: client_name ?? job.client_name,
    notes: notes ?? job.notes,
    status: status ?? job.status,
    eta: eta ?? job.eta,
    assigned_to: assigned_to ?? job.assigned_to,
  };
  await env.JOBS_DB.prepare(
    'UPDATE jobs SET client_name=?, notes=?, status=?, eta=?, assigned_to=?, updated_at=? WHERE id=?'
  ).bind(next.client_name, next.notes, next.status, next.eta, next.assigned_to, now, id).run();
  return { status: 200 };
}

export async function deleteJob(env, role, body) {
  if (role !== 'nathan') return { error: 'Forbidden', status: 403 };
  if (!body.id) return { error: 'id is required', status: 400 };
  await env.JOBS_DB.prepare('DELETE FROM jobs WHERE id = ?').bind(body.id).run();
  return { status: 200 };
}

async function handleJobsApi(request, env, role, pathname) {
  if (pathname === '/admin/jobs/api/whoami') {
    return jsonResponse({ role }, 200);
  }
  if (pathname === '/admin/jobs/api/list' && request.method === 'GET') {
    const jobs = await listJobs(env, role);
    return jsonResponse({ jobs }, 200);
  }
  if (pathname === '/admin/jobs/api/create' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const result = await createJob(env, role, body);
    return jsonResponse(result.error ? { error: result.error } : { ok: true }, result.status);
  }
  if (pathname === '/admin/jobs/api/update' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const result = await updateJob(env, role, body);
    return jsonResponse(result.error ? { error: result.error } : { ok: true }, result.status);
  }
  if (pathname === '/admin/jobs/api/delete' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const result = await deleteJob(env, role, body);
    return jsonResponse(result.error ? { error: result.error } : { ok: true }, result.status);
  }
  return jsonResponse({ error: 'Not found' }, 404);
}
```

Note: this fully replaces the old `checkAuth()` function — `resolveRole()` supersedes it for every `/admin/*` path, not just the new jobs routes. This is intentional consolidation, not scope creep: there's now exactly one auth code path for the whole `/admin/*` tree.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/unit/`
Expected: PASS (all tests)

- [ ] **Step 5: Add the `test:unit` script**

In `package.json`, in the `"scripts"` block, add:

```json
"test:unit": "node --test tests/unit/",
```

- [ ] **Step 6: Exclude `tests/unit/` from Playwright**

In `playwright.config.ts`, add `testIgnore` so Playwright's own test run (`npx playwright test`) doesn't try to collect and run `tests/unit/worker.test.js` (which uses `node:test`, not `@playwright/test`, and would fail to load under Playwright's runner):

Replace:

```ts
export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:4321',
  },
```

with:

```ts
export default defineConfig({
  testDir: './tests',
  testIgnore: ['unit/**'],
  use: {
    baseURL: 'http://localhost:4321',
  },
```

- [ ] **Step 7: Verify existing Playwright suite still collects correctly**

Run: `npx playwright test --list | head -5`
Expected: lists Playwright specs, does not mention `worker.test.js`.

- [ ] **Step 8: Commit**

```bash
git add src/worker.js tests/unit/worker.test.js package.json playwright.config.ts
git commit -m "feat: add role-based auth and D1-backed job CRUD to worker"
```

---

### Task 3: The board page (static shell + Kanban UI, API mocked in tests)

**Files:**
- Create: `src/pages/admin/jobs.astro`
- Create: `tests/admin-jobs.spec.ts`

**Context:** This is a plain static Astro page, structurally similar to `src/pages/admin/links.astro` (full standalone HTML document, `noindex`, dark theme, vanilla-JS `<script is:inline>` — no Astro components, no framework). Its JS calls the API routes built in Task 2. Since `npm run dev` never runs `src/worker.js`, these routes don't exist when Playwright's tests hit the page — so, exactly like `tests/website-cost-calculator.spec.ts` mocks `https://api.web3forms.com/submit` with `page.route()`, these tests mock `/admin/jobs/api/*` with `page.route()`. That tests the page's rendering and interaction logic thoroughly; Task 2's unit tests already cover the server-side auth/business logic; a manual end-to-end check against the real stack happens in Task 4.

- [ ] **Step 1: Write the failing tests**

Create `tests/admin-jobs.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

const NATHAN_JOBS = [
  { id: 1, client_name: 'Smith Plumbing', notes: 'New site', status: 'not_started', eta: null, assigned_to: 'ben' },
  { id: 2, client_name: 'Davies Electrical', notes: '', status: 'doing', eta: '2026-08-01', assigned_to: 'nathan' },
  { id: 3, client_name: 'Evans Landscaping', notes: '', status: 'done', eta: null, assigned_to: 'ben' },
];

const BEN_JOBS = [
  { id: 1, client_name: 'Smith Plumbing', notes: 'New site', status: 'not_started', eta: null, assigned_to: 'ben' },
];

async function mockWhoamiAndList(page, role, jobs) {
  await page.route('/admin/jobs/api/whoami', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role }) }));
  await page.route('/admin/jobs/api/list', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs }) }));
}

test('nathan sees the Add job button and every job, including assignee tags', async ({ page }) => {
  await mockWhoamiAndList(page, 'nathan', NATHAN_JOBS);
  await page.goto('/admin/jobs');
  await expect(page.getByRole('button', { name: '+ Add job' })).toBeVisible();
  await expect(page.getByText('Smith Plumbing')).toBeVisible();
  await expect(page.getByText('Davies Electrical')).toBeVisible();
  await expect(page.getByText('Evans Landscaping')).toBeVisible();
  await expect(page.locator('.jb-card-assignee').first()).toBeVisible();
});

test('ben does not see the Add job button, assignee tags, or delete, and only sees his own jobs', async ({ page }) => {
  await mockWhoamiAndList(page, 'ben', BEN_JOBS);
  await page.goto('/admin/jobs');
  await expect(page.getByRole('button', { name: '+ Add job' })).toHaveCount(0);
  await expect(page.getByText('Smith Plumbing')).toBeVisible();
  await expect(page.locator('.jb-card-assignee')).toHaveCount(0);
  await expect(page.locator('.jb-card-delete')).toHaveCount(0);
});

test('clicking Start moves a not-started job to Doing', async ({ page }) => {
  await mockWhoamiAndList(page, 'ben', BEN_JOBS);

  let updateBody = null;
  await page.route('/admin/jobs/api/update', async route => {
    updateBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/admin/jobs');
  await expect(page.locator('#col-not_started .jb-card')).toHaveCount(1);

  await page.route('/admin/jobs/api/list', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jobs: [{ ...BEN_JOBS[0], status: 'doing' }] }),
  }));

  await page.getByRole('button', { name: 'Start' }).click();
  expect(updateBody).toEqual({ id: 1, status: 'doing' });
  await expect(page.locator('#col-doing .jb-card')).toHaveCount(1);
  await expect(page.locator('#col-not_started .jb-card')).toHaveCount(0);
});

test('clicking Mark done moves a doing job to Done', async ({ page }) => {
  const doingJob = [{ id: 2, client_name: 'Davies Electrical', notes: '', status: 'doing', eta: null, assigned_to: 'nathan' }];
  await mockWhoamiAndList(page, 'nathan', doingJob);

  let updateBody = null;
  await page.route('/admin/jobs/api/update', async route => {
    updateBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/admin/jobs');
  await page.route('/admin/jobs/api/list', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jobs: [{ ...doingJob[0], status: 'done' }] }),
  }));

  await page.getByRole('button', { name: 'Mark done' }).click();
  expect(updateBody).toEqual({ id: 2, status: 'done' });
  await expect(page.locator('#col-done .jb-card')).toHaveCount(1);
});

test('a done job has no Start/Mark done button', async ({ page }) => {
  const doneJob = [{ id: 3, client_name: 'Evans Landscaping', notes: '', status: 'done', eta: null, assigned_to: 'ben' }];
  await mockWhoamiAndList(page, 'ben', doneJob);
  await page.goto('/admin/jobs');
  await expect(page.locator('#col-done .jb-card-btn')).toHaveCount(0);
});

test('nathan can open the add-job modal and submit a new job', async ({ page }) => {
  await mockWhoamiAndList(page, 'nathan', []);

  let createBody = null;
  await page.route('/admin/jobs/api/create', async route => {
    createBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/admin/jobs');
  await expect(page.locator('#col-not_started .jb-empty')).toBeVisible();

  await page.getByRole('button', { name: '+ Add job' }).click();
  await page.locator('#addClientName').fill('Jones Roofing');
  await page.locator('#addNotes').fill('Rebuild homepage');
  await page.locator('#addAssignedTo').selectOption('ben');

  await page.route('/admin/jobs/api/list', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jobs: [{ id: 4, client_name: 'Jones Roofing', notes: 'Rebuild homepage', status: 'not_started', eta: null, assigned_to: 'ben' }] }),
  }));

  await page.getByRole('button', { name: 'Save job' }).click();

  expect(createBody).toMatchObject({ client_name: 'Jones Roofing', notes: 'Rebuild homepage', assigned_to: 'ben' });
  await expect(page.getByText('Jones Roofing')).toBeVisible();
});

test('shows an error banner if the board fails to load', async ({ page }) => {
  await page.route('/admin/jobs/api/whoami', route =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorised' }) }));
  await page.goto('/admin/jobs');
  await expect(page.locator('#errorBanner')).toBeVisible();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/admin-jobs.spec.ts`
Expected: FAIL — `/admin/jobs` doesn't exist yet (404).

- [ ] **Step 3: Create the page**

Create `src/pages/admin/jobs.astro`:

```astro
---
---
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Jobs Board — NC Digital</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d0d14; color: #e2e8f0; font-size: 15px; line-height: 1.6; }

    .topbar { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.5rem; border-bottom: 1px solid #1e1e30; background: #0d0d14; position: sticky; top: 0; z-index: 50; }
    .topbar h1 { font-size: 1rem; font-weight: 700; color: #f1f5f9; }

    .jb-add-btn { background: #7c3aed; color: #fff; border: none; border-radius: 6px; padding: 0.5rem 1rem; font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
    .jb-add-btn:hover { opacity: 0.9; }

    .jb-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; padding: 1.5rem; align-items: start; }
    .jb-column { background: #13131f; border: 1px solid #1e1e30; border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; min-height: 200px; }
    .jb-column-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; margin-bottom: 0.25rem; }

    .jb-card { background: #18182a; border: 1px solid #2a2a3e; border-radius: 8px; padding: 0.875rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .jb-card-title { font-size: 0.9375rem; font-weight: 600; color: #f1f5f9; }
    .jb-card-notes { font-size: 0.8125rem; color: #94a3b8; }
    .jb-card-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: #94a3b8; flex-wrap: wrap; }
    .jb-card-assignee { padding: 0.15rem 0.5rem; border-radius: 4px; background: #7c3aed22; color: #c4b5fd; font-weight: 600; font-size: 0.6875rem; text-transform: uppercase; }
    .jb-card-eta { display: flex; align-items: center; gap: 0.375rem; }
    .jb-card-eta input { background: #0d0d14; border: 1px solid #2a2a3e; color: #e2e8f0; border-radius: 4px; padding: 0.2rem 0.4rem; font-size: 0.75rem; }
    .jb-card-actions { display: flex; gap: 0.5rem; margin-top: 0.25rem; }
    .jb-card-btn { flex: 1; background: #7c3aed; color: #fff; border: none; border-radius: 6px; padding: 0.4rem 0.75rem; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
    .jb-card-btn:hover { opacity: 0.9; }
    .jb-card-delete { background: transparent; border: 1px solid #ef444455; color: #ef4444; border-radius: 6px; padding: 0.4rem 0.6rem; font-size: 0.75rem; cursor: pointer; }
    .jb-card-delete:hover { background: #ef444422; }
    .jb-empty { font-size: 0.8125rem; color: #4b5563; font-style: italic; padding: 0.5rem 0; }

    .jb-error { margin: 1rem 1.5rem; padding: 0.75rem 1rem; background: #ef444422; border: 1px solid #ef444455; border-radius: 8px; color: #fca5a5; font-size: 0.875rem; }

    .jb-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 100; }
    .jb-modal-overlay.open { display: flex; }
    .jb-modal { background: #13131f; border: 1px solid #1e1e30; border-radius: 10px; padding: 1.5rem; width: 400px; max-width: 90vw; display: flex; flex-direction: column; gap: 0.75rem; }
    .jb-modal h2 { font-size: 1rem; margin-bottom: 0.25rem; }
    .jb-modal label { font-size: 0.8125rem; color: #94a3b8; display: flex; flex-direction: column; gap: 0.25rem; }
    .jb-modal input, .jb-modal textarea, .jb-modal select {
      background: #0d0d14; border: 1px solid #2a2a3e; color: #e2e8f0; border-radius: 6px; padding: 0.5rem 0.625rem; font: inherit; font-size: 0.875rem;
    }
    .jb-modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
    .jb-modal-cancel { background: transparent; border: 1px solid #2a2a3e; color: #94a3b8; border-radius: 6px; padding: 0.5rem 1rem; font-size: 0.8125rem; cursor: pointer; }
  </style>
</head>
<body>

<div class="topbar">
  <h1>Jobs Board</h1>
  <div id="topbarActions"></div>
</div>

<div id="errorBanner" class="jb-error" style="display:none;"></div>

<div class="jb-board" id="board">
  <div class="jb-column" data-status="not_started">
    <div class="jb-column-title">Not started</div>
    <div class="jb-cards" id="col-not_started"></div>
  </div>
  <div class="jb-column" data-status="doing">
    <div class="jb-column-title">Doing</div>
    <div class="jb-cards" id="col-doing"></div>
  </div>
  <div class="jb-column" data-status="done">
    <div class="jb-column-title">Done</div>
    <div class="jb-cards" id="col-done"></div>
  </div>
</div>

<div class="jb-modal-overlay" id="addModalOverlay">
  <form class="jb-modal" id="addForm">
    <h2>Add job</h2>
    <label>Client / business name
      <input type="text" id="addClientName" required />
    </label>
    <label>Notes
      <textarea id="addNotes" rows="3"></textarea>
    </label>
    <label>ETA
      <input type="date" id="addEta" />
    </label>
    <label>Assigned to
      <select id="addAssignedTo">
        <option value="nathan">Nathan</option>
        <option value="ben">Ben</option>
      </select>
    </label>
    <div class="jb-modal-actions">
      <button type="button" class="jb-modal-cancel" id="addCancel">Cancel</button>
      <button type="submit" class="jb-add-btn">Save job</button>
    </div>
  </form>
</div>

<script is:inline>
(function () {
  const NEXT_STATUS = { not_started: 'doing', doing: 'done' };
  const NEXT_LABEL = { not_started: 'Start', doing: 'Mark done' };

  const state = { role: null, jobs: [], error: '' };

  async function api(path, options) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function load() {
    try {
      const who = await api('/admin/jobs/api/whoami');
      state.role = who.role;
      const listRes = await api('/admin/jobs/api/list');
      state.jobs = listRes.jobs;
      state.error = '';
    } catch (err) {
      state.error = err.message || 'Something went wrong loading the board.';
    }
    render();
  }

  function render() {
    const errorBanner = document.getElementById('errorBanner');
    if (state.error) {
      errorBanner.textContent = state.error;
      errorBanner.style.display = 'block';
    } else {
      errorBanner.style.display = 'none';
    }

    const topbarActions = document.getElementById('topbarActions');
    topbarActions.innerHTML = '';
    if (state.role === 'nathan') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jb-add-btn';
      btn.textContent = '+ Add job';
      btn.addEventListener('click', openAddModal);
      topbarActions.appendChild(btn);
    }

    ['not_started', 'doing', 'done'].forEach(status => {
      const col = document.getElementById('col-' + status);
      col.innerHTML = '';
      const jobs = state.jobs.filter(j => j.status === status);
      if (!jobs.length) {
        const empty = document.createElement('div');
        empty.className = 'jb-empty';
        empty.textContent = 'No jobs';
        col.appendChild(empty);
        return;
      }
      jobs.forEach(job => col.appendChild(renderCard(job)));
    });
  }

  function renderCard(job) {
    const card = document.createElement('div');
    card.className = 'jb-card';

    const title = document.createElement('div');
    title.className = 'jb-card-title';
    title.textContent = job.client_name;
    card.appendChild(title);

    if (job.notes) {
      const notes = document.createElement('div');
      notes.className = 'jb-card-notes';
      notes.textContent = job.notes;
      card.appendChild(notes);
    }

    const meta = document.createElement('div');
    meta.className = 'jb-card-meta';

    if (state.role === 'nathan') {
      const assignee = document.createElement('span');
      assignee.className = 'jb-card-assignee';
      assignee.textContent = job.assigned_to;
      meta.appendChild(assignee);
    }

    const etaWrap = document.createElement('label');
    etaWrap.className = 'jb-card-eta';
    etaWrap.append('ETA: ');
    const etaInput = document.createElement('input');
    etaInput.type = 'date';
    etaInput.value = job.eta || '';
    etaInput.addEventListener('change', async () => {
      await updateJob(job.id, { eta: etaInput.value || null });
    });
    etaWrap.appendChild(etaInput);
    meta.appendChild(etaWrap);
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'jb-card-actions';

    const nextStatus = NEXT_STATUS[job.status];
    if (nextStatus) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jb-card-btn';
      btn.textContent = NEXT_LABEL[job.status];
      btn.addEventListener('click', async () => {
        await updateJob(job.id, { status: nextStatus });
      });
      actions.appendChild(btn);
    }

    if (state.role === 'nathan') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'jb-card-delete';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        if (!confirm('Delete this job?')) return;
        try {
          await api('/admin/jobs/api/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: job.id }),
          });
          await load();
        } catch (err) {
          state.error = err.message;
          render();
        }
      });
      actions.appendChild(del);
    }

    if (actions.childNodes.length) card.appendChild(actions);

    return card;
  }

  async function updateJob(id, fields) {
    try {
      await api('/admin/jobs/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...fields }),
      });
      await load();
    } catch (err) {
      state.error = err.message;
      render();
    }
  }

  function openAddModal() {
    document.getElementById('addModalOverlay').classList.add('open');
  }
  function closeAddModal() {
    document.getElementById('addModalOverlay').classList.remove('open');
    document.getElementById('addForm').reset();
  }

  document.getElementById('addCancel').addEventListener('click', closeAddModal);
  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/admin/jobs/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: document.getElementById('addClientName').value,
          notes: document.getElementById('addNotes').value,
          eta: document.getElementById('addEta').value || null,
          assigned_to: document.getElementById('addAssignedTo').value,
        }),
      });
      closeAddModal();
      await load();
    } catch (err) {
      state.error = err.message;
      render();
    }
  });

  load();
})();
</script>

</body>
</html>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/admin-jobs.spec.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/jobs.astro tests/admin-jobs.spec.ts
git commit -m "feat: add jobs board Kanban page"
```

---

### Task 4: Full regression pass + real end-to-end smoke test

**Files:** none (verification only)

Tasks 2 and 3 tested the worker logic and the page's UI separately, each in isolation (unit tests with a fake D1; Playwright with a mocked API). Neither proves the two actually work together against the real D1 database and real Basic Auth. This task does that.

- [ ] **Step 1: Run the full automated test suite**

```bash
node --test tests/unit/
npx playwright test
```

Expected: all `tests/unit/` tests pass; all Playwright tests pass except the two pre-existing, unrelated failures already known from before this feature (`footer has services link`, and any other pre-existing failures tied to Nathan's in-progress, uncommitted site redesign — not this feature).

- [ ] **Step 2: Run a production build**

```bash
npm run build
```

Expected: completes with no errors, confirming `src/pages/admin/jobs.astro` compiles cleanly.

- [ ] **Step 3: Manual end-to-end smoke test against the real worker + D1**

Run:

```bash
CLOUDFLARE_API_TOKEN=<CLOUDFLARE_API_TOKEN> npx wrangler dev --local
```

With the local dev server running, in a browser:

1. Visit `http://localhost:8787/admin/jobs` (port may differ — check `wrangler dev`'s printed URL). Confirm the browser's Basic Auth prompt appears.
2. Log in as `nathan` / `NC-Digital2026`. Confirm the board loads (empty — no jobs yet), with a visible "+ Add job" button.
3. Add a job (e.g. client name "Test Job", assigned to `ben`). Confirm it appears in "Not started".
4. Open a private/incognito window, visit the same URL, log in as `ben` / `B1E2N3!`. Confirm Ben sees the "Test Job" card, with no "+ Add job" button and no assignee tag or delete button.
5. As Ben, click "Start". Confirm it moves to "Doing". Refresh as Nathan and confirm he sees it in "Doing" too.
6. As Ben, click "Mark done". Confirm it moves to "Done".
7. Still as Ben, try visiting `http://localhost:8787/admin/backlinks` — confirm the Basic Auth prompt re-appears and Ben's credentials do **not** grant access (this is the security-critical check: Ben must not be able to reach Nathan's other admin tools).
8. As Nathan, delete the test job. Confirm it disappears from the board.

If all 8 checks pass, the feature works end-to-end. Fix and re-verify before considering this done — do not skip step 7.

No commit for this task — it's verification only.
