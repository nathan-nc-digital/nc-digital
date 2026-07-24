# Jobs Board — Design

## Purpose

An internal Kanban-style jobs board so Nathan can track the websites currently in progress (starting with 4) and assign them to his staff member, Ben. Ben logs in separately, sees only the jobs assigned to him, and moves them through Not started → Doing → Done, updating an ETA as he goes so Nathan knows when each is likely to finish.

This is an internal tool only — not customer-facing, `noindex`, excluded from the sitemap (already covered by the existing sitemap filter on `/admin/`).

## Why this needs new infrastructure

The site is fully static today (`output: 'static'` in `astro.config.mjs`): every page, including the existing `/admin/*` tools (backlinks, GSC, keywords, indexing, the link map), is pre-built HTML with data baked in at build time. Updating that data means rebuilding and redeploying the whole site.

That doesn't work for a jobs board — Ben marking a job "Doing" needs to take effect immediately, without a full site rebuild. This is the first feature on this site that needs data which changes at runtime, so it introduces one new, self-contained piece of infrastructure: a small **Cloudflare D1 database** (SQLite, free at this scale), read and written through a few API routes added to the existing `src/worker.js`. Everything else about the site — the static build, the deploy process, every other page — stays exactly as it is.

## Data model

A single D1 table, `jobs`:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `client_name` | TEXT NOT NULL | The job's primary label, e.g. "Smith Plumbing" |
| `notes` | TEXT | Free text — brief, links, whatever Nathan wants to note |
| `status` | TEXT NOT NULL, CHECK IN `('not_started','doing','done')` | Defaults to `'not_started'` on create |
| `eta` | TEXT | ISO date string (`YYYY-MM-DD`), nullable |
| `assigned_to` | TEXT NOT NULL, CHECK IN `('nathan','ben')` | Who the job is assigned to |
| `created_at` | TEXT NOT NULL | ISO timestamp, set on create |
| `updated_at` | TEXT NOT NULL | ISO timestamp, set on every update |

No priority field, no due-date reminders, no support for assignees beyond `nathan`/`ben` — deliberately out of scope per the "out of scope" section below.

## Access — two Basic Auth logins, different scopes

The existing `/admin/*` protection in `src/worker.js` is a single hardcoded username/password checked against every `/admin/*` request (`ADMIN_USER`/`ADMIN_PASS`, currently `nathan`/`NC-Digital2026`). This gets extended, not replaced:

- **Nathan's existing credentials** continue to work everywhere under `/admin/*`, including the new `/admin/jobs/` — full access: create, edit (client name/notes/ETA/status/assignment), delete, sees every job regardless of assignee.
- **A new second credential pair for Ben** (`BEN_USER = 'ben'`, `BEN_PASS = 'B1E2N3!'`) — valid **only** for paths starting with `/admin/jobs`. Ben's credentials must NOT grant access to `/admin/backlinks`, `/admin/gsc`, `/admin/indexing`, `/admin/keywords`, or `/admin/links`.

Routing/auth logic in `worker.js`:
- Request path starts with `/admin/jobs` → accept **either** credential pair; the matched pair determines the `role` (`'nathan'` or `'ben'`) used by the API routes below.
- Request path starts with `/admin/` but not `/admin/jobs` → accept **only** Nathan's credentials (unchanged behaviour).

Both credential pairs are stored as plaintext constants in `worker.js`, matching the existing pattern for `ADMIN_USER`/`ADMIN_PASS` — not a change in security posture, just consistency with what's already there.

## API routes

All new routes live under `/admin/jobs/api/` and are handled inside `src/worker.js` (extending its existing `fetch` handler, reading/writing the D1 binding). All require the same `/admin/jobs` auth described above.

- **`GET /admin/jobs/api/whoami`** → `{ role: 'nathan' | 'ben' }`, derived from which credential pair matched. The page's JS calls this once on load to know whether to show Nathan's controls (Add job, edit, delete, reassign) or Ben's read/status-only view.
- **`GET /admin/jobs/api/list`** → returns all jobs as JSON. If `role === 'ben'`, filtered server-side to `assigned_to = 'ben'` only — Ben's client-side JS never even receives jobs that aren't his.
- **`POST /admin/jobs/api/create`** → Nathan only (403 for Ben). Body: `{ client_name, notes, eta, assigned_to }`. Creates a row with `status = 'not_started'`.
- **`POST /admin/jobs/api/update`** → Body: `{ id, status?, eta?, client_name?, notes?, assigned_to? }`.
  - Nathan: may update any field on any job.
  - Ben: may only update `status` and `eta`, and only on a job where `assigned_to = 'ben'` **and** the job's current `assigned_to` matches Ben (server-side ownership check on every request — never trust the client to only ask for its own jobs).
- **`POST /admin/jobs/api/delete`** → Nathan only (403 for Ben). Body: `{ id }`.

## The board UI

New static Astro page at `src/pages/admin/jobs.astro` (`<meta name="robots" content="noindex, nofollow" />`, same dark theme and general page-chrome pattern as `src/pages/admin/links.astro`). The page itself is static HTML/CSS; a vanilla-JS `<script>` (no framework, matching every other interactive piece on this site — the quote calculator, the free-website-plan quiz, the link map) does the rest:

1. On load, calls `/admin/jobs/api/whoami` to get the role, then `/admin/jobs/api/list` to get the jobs.
2. Renders a 3-column Kanban board — **Not started / Doing / Done** — as columns, one card per job.
3. Each card shows: client name, notes, ETA, and (Nathan's view only) who it's assigned to.
4. Each card has one action button depending on its current column:
   - Not started → **"Start"** button → moves to Doing (`status: 'doing'`)
   - Doing → **"Mark done"** button → moves to Done (`status: 'done'`)
   - Done → no button (or a "Reopen" affordance is out of scope for v1 — see below)
5. An ETA field on each card is editable inline by whoever the job is assigned to (or Nathan, always).
6. Nathan-only: a **"+ Add job"** button opens a small form (client name, notes, ETA, assigned-to dropdown) that POSTs to `/admin/jobs/api/create`; a delete affordance on each card (Nathan-only) POSTs to `/admin/jobs/api/delete`.
7. No drag-and-drop — moving between columns is button-only, chosen deliberately for simplicity and to work well on a phone screen.

## Error handling

- API routes return appropriate HTTP status codes (400 for bad input, 403 for permission failures like Ben trying to create/delete or touch a job not assigned to him, 404 for an unknown job id) with a JSON `{ error: string }` body.
- The board's JS shows an inline error message (matching the site's existing `.qcc-error`-style pattern — small red text) if any API call fails, and does not silently swap the UI to a broken state.

## Out of scope (for this iteration)

- No email/notification system — Nathan checks the board himself.
- No drag-and-drop.
- No priority field, no due-date reminders/alerts.
- No support for assignees beyond `nathan`/`ben` — the schema's `CHECK` constraint and the auth logic are both hardcoded to these two, not built generically for an arbitrary team. Extending to a third person later is a small, contained change (new credential pair, widen the `CHECK` constraint) but isn't built now.
- No "reopen a done job" affordance — if that turns out to be needed in practice, it's a fast follow-up.
- The 4 current jobs are not pre-seeded as data; Nathan adds them himself through the "+ Add job" form once the board is live.
