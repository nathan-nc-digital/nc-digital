# Live client keyword research

The protected admin page is `/admin/keyword-research/`. Enter a UK service and location, such as `Plumber Merthyr Tydfil`. The existing Nathan admin authentication protects both the page and `/admin/keyword-research/api/*`; Ben cannot access it.

## Connection and deployment

The Worker uses `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` as Cloudflare secrets. They are never sent to browser code. The existing `.env` contains local development credentials; do not commit it or include it in static assets. Production secrets were configured on `nc-digital` on 8 September 2026.

Apply `migrations/0006_keyword_research.sql` to the existing `JOBS_DB` D1 database. The migration is idempotent and was applied through the Cloudflare connector for this deployment. Preserve the existing D1/R2/assets bindings, Meta/Buffer secrets, routes and cron schedule when deploying. Build Astro and bundle `src/worker.js` before deployment.

`scripts/sync-research-locations.mjs` refreshes `src/data/research-locations.json` from DataForSEO's free Google locations endpoint, using local credentials. The checked-in dataset was retrieved on 8 September 2026. Ambiguous towns require the full location name. Unrecognised locations prompt the user to select an area rather than silently using a national search.

## Research and evidence

Each new report uses at most four live API tasks: keyword suggestions, related keywords, a desktop Google SERP at the selected location, and a UK keyword overview for up to 100 phrases. The latter supplies estimated monthly volume, CPC in USD, paid competition, organic difficulty, intent and monthly search history where reported. Calls have timeouts and bounded response sizes; provider task status is checked independently of HTTP status.

Keyword metrics use the United Kingdom location (2826). They describe demand for each phrase across the UK, not the number of searches made inside the target town. The SERP uses the chosen town's DataForSEO location code. Missing metrics remain null; genuine zeroes remain zero. Close variants can share demand, so the interface does not sum volume as unique traffic. Provider update dates, report date, API cost and partial failures are shown.

Service templates cover plumbing, electrical, roofing, building and cleaning, with a generic fallback and up to 10 client-supplied extra services. Templates are proposed services to verify, not claims about the client's capabilities. Discovery filters out recruitment and other-town suggestions. Related keyword variants are grouped heuristically, not via full multi-keyword SERP overlap. The priority formula and its limitations are visible in the report.

The output includes keyword filtering/sorting, monthly trends, draft page groups/titles/H1s/sections, top 10 organic competitors, an optional client-domain presence check, observed People also ask questions and related searches, and clearly labelled editorial questions. CSV exports respect active filters and guard against spreadsheet formula injection. Markdown briefs include source links and evidence limitations. Print uses all report tabs.

## Storage and cost controls

Reports are stored in `keyword_reports`; the 30 most recent are listed in the interface. Repeat inputs reuse a completed report for 7 days. Explicit refresh uses new data except within the first minute. Opening saved reports never calls DataForSEO. A D1 mutex prevents concurrent research runs and expires after 3 minutes; a maximum of 30 new runs per hour limits accidental use. A stale running row is shown as interrupted in history.

No automatic retry follows an interrupted paid request. Results may be partial and report cost can omit failed-call charges. Check saved research before retrying. A live plumber/Merthyr test returned 27 phrases, ten organic competitors and four observed questions, with provider-reported cost of $0.04052; this is an observed example, not a pricing guarantee.

## Validation

- `npm.cmd run test:unit` — real SQLite migrations, cache reuse, concurrency, authentication, origin checks, input validation, provider errors, partial data and keyword planning.
- `npx.cmd playwright test --config tests/keyword-playwright.config.ts` — desktop/mobile research, filters, exports, saved reports, tabs, error recovery and safe rendering of provider text.
- `npm.cmd run build` and `wrangler.cmd deploy --dry-run --outdir .tmp/keyword-worker-build` — production assets and Worker bundle.

Sources: [Keyword Overview](https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live/), [Keyword Suggestions](https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live/), [Local Google SERPs](https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/), [Google locations](https://docs.dataforseo.com/v3/serp/google/locations/).
