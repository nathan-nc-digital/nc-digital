# Competitor Gap Finder

Admin: `/admin/competitor-gaps/`, linked from the admin tools navigation. The existing Worker authentication restricts the API to Nathan. Uses the existing DataForSEO secrets and D1 `JOBS_DB`; migration `0011_competitor_gaps.sql` creates report, raw-result cache, spend ledger, directory exclusion and work-item tables.

## Inputs and directory policy

One client domain and one to three direct business competitors. Domains are normalized, `www` duplicates collapse, invalid/private-style hosts and credentials/ports are rejected, and client/subdomain overlap cannot be used as a competitor. A business and its subdomain cannot count as two competitors. Nothing is fetched from user-supplied domains by the Worker; all research calls go to DataForSEO.

Known directories, marketplaces and social platforms are blocked in input validation and result normalization, including subdomains. The policy reuses the EMD list with additional agency/property/trade directories, but excludes the overly broad `org.uk` suffix rule so legitimate organization sites are not automatically rejected. Provider ranking URLs must belong to the expected business domain. Additional directory domains can be saved from the UI. Saved report views reapply the current exclusions to keywords, evidence, plans, coverage and returned datasets. The list cannot identify every unknown directory automatically; the additional-exclusion control covers new ones.

## Research and evidence

Each competitor gets two bounded DataForSEO Labs Google Domain Intersection requests: `intersections:false` for competitor-only observations and `intersections:true` for shared results. Requests use UK location 2826, English, organic results only, optional keyword focus phrases and a competitor rank limit. Per-lookup limits are 50, 100 or 200 rows, ordered by UK monthly volume. No pagination or further SERP/backlink calls are made automatically.

Shared gaps require the competitor to be at least three organic positions ahead. Keywords are deduplicated across competitors; search volume is never summed. When snapshots conflict, a returned client rank takes precedence over a missing observation, and mixed snapshots are flagged. The best observed client rank is used. Missing provider metrics remain null.

Priority is an explicit heuristic using volume, competitor count, ranking gap, provider intent and difficulty. It is not a forecast or ranking guarantee. Suggested client pages use observed ranking URLs; possible related pages use a conservative title/path word-overlap rule and are labelled as a heuristic. New-page suggestions always require checking the existing website and whether the client actually offers the service. Draft page plans group related keywords using existing client URLs or the best competitor URL and suggested action. At most 300 opportunities and 100 page plans are displayed.

The data is a provider database snapshot, not a live local rank check. Keyword search volumes are UK estimates, CPC is advertising cost in USD, and organic difficulty is separate from Google Ads competition. Small local sites may have sparse coverage. “Client not observed” does not mean a page does not exist or is unindexed. Fetch time and available metric-update dates are shown.

## Spending and failure handling

Preview is free and shows cached and paid lookup counts. Each uncached request requires a conservative $0.05 USD allowance. The default run budget is $0.50, with configurable $0.05–$2.00 bounds, and a server-enforced rolling 24-hour $2.00 allowance across this tool. Ten starts per hour maximum. Starting a run requires sufficient allowance for the planned uncached steps.

A global expiring D1 lock serializes steps. Each paid request has a durable `uncertain` reservation inserted **before dispatch**. A confirmed provider charge, normalized result, shared cache and progress update are saved in one atomic batch. A timeout, invalid cost, or crash before saving leaves the reservation counted. On resume the paid request is skipped, not resent. Matching uncertain request keys are suppressed for 24 hours even across fresh runs. If a provider cost exceeds the reservation, further paid dispatch stops; the selected allowance cannot guarantee against an external pricing change for the call already sent.

Confirmed charges and uncertain reservations are displayed separately. Successful lookup results are reused for 30 days; identical completed reports for seven days. Changing client-side brand exclusions can reuse existing paid data. Refresh bypasses normal caches but not uncertain-request protection. Stopped reports retain their completed lookup caches for a later run.

## Review and export

Keyword filters, work-status filters and sorting do not call the paid API. Each keyword has a persistent work item scoped by client, with status and notes. Pending notes are saved before changing reports or printing. CSV exports the filtered shortlist with scope, units, competitor URLs and notes; spreadsheet formula prefixes are neutralized. Print produces the draft page plan with task notes. Reports are private and are not sent to clients automatically.

## Verification

`npm run test:unit`, `npm run build`, `npx playwright test --config tests/gaps-playwright.config.ts`, and Wrangler dry-run. On Windows, a manually started Astro preview at port 4344 and `GAPS_MANUAL_SERVER=1` avoid test-server teardown delays.

Tests cover directory and subdomain rejection, provider URL filtering, query deduplication, mixed ranking snapshots, related-page suggestions, cache reuse, notes, concurrency, budgets, timeout reservations, interruption after paid dispatch, directory exclusions on saved reports and same-origin enforcement. Browser tests cover pre-dispatch directory rejection, cost preview, evidence inspection, notes, CSV, mobile overflow and print layout. The live verification helper runs a small NC Digital comparison, checks real charges and a cached repeat, and verifies protected routes and the public homepage.
