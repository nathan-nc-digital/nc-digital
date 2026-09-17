# Budgeted EMD finder

Live admin: `/admin/emd-finder/`. Nathan-only API at `/admin/emd-finder/api/`.

The archived 3,741 keyword/domain combinations are retained in `src/data/emd-catalog.json`, generated with `node scripts/prepare-emd-catalog.mjs`. Their original July 2026 retrieval dates remain visible. D1 migration `0007_emd_finder.sql` adds fresh caches, watchlist assumptions, scan progress and spending reservations. Existing archived data is never overwritten by scans.

Defaults: South Wales, town + service `.co.uk` names, balanced 50+ UK monthly searches and £500+ assumed job value, $1 cap. High value: 20+ and £1,500+. Explore keeps missing-volume ideas separate. Custom service/town input generates a new candidate. Job values are manual estimates, not an API measurement, and can be overridden per selection or saved per opportunity.

A scan selects at most 100 candidates. It batches missing/stale keyword metrics, checks up to 30 registrations with Nominet RDAP, then checks local Google organic results for up to 20 currently unregistered names. One bulk referring-domain request covers both domains and ranking pages for at most five finalists (100 deduplicated targets maximum). Existing national competitor checks are archival context only. Missing or stale competition data remains Unverified.

Cache TTL: keyword metrics and links 90 days, local SERPs 30 days, RDAP one day. Nominet checks run directly from the admin's browser with a timeout and sequential pacing, per [Nominet guidance](https://registrars.nominet.uk/dragon/how-to/how-to-use-rdap/). Only status and domain are sent back to the authenticated API; stored results identify this browser source. No registrant data is retained. A manual registration recheck is free of DataForSEO usage. Errors set availability to unknown rather than silently reusing an old positive. Registered and unknown names do not trigger paid SERP checks.

Paid requests reserve $0.05 for a maximum 100-keyword overview, $0.01 per ordinary 10-result live SERP, and $0.10 for the single bulk links request. Successful responses replace the reservation with reported cost. The budget is checked before dispatch. Price changes above the conservative reservation stop further spending; the provider remains authoritative for billing. Unknown outcomes retain reservations. Scan progress and each reservation are saved in a D1 transaction before dispatch, preventing automatic duplicate retries after interruption. A global expiring lock serializes starts/steps across tabs; a scan resumes only on explicit browser interaction. Closing the page pauses work after the in-flight step. Ten starts per hour maximum. No domain purchasing occurs.

Legacy CLI scanners are disabled by default to prevent uncapped spending. Their historical behavior remains accessible only through explicit `--legacy-unbounded`; the admin finder is the supported route.

API costs checked against DataForSEO's [Google Labs pricing](https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api), [organic SERP pricing](https://dataforseo.com/pricing/google-serp/google-organic-serp-api), and [backlinks pricing](https://dataforseo.com/pricing/backlinks/backlinks). Estimates omit clickstream, special search operators and paid optional SERP features. [Bulk referring domains](https://docs.dataforseo.com/v3/backlinks/bulk_referring_domains/live/) supports domains and page URLs.

Validation: `npm run test:unit`, `npm run build`, `npx playwright test --config tests/emd-playwright.config.ts`, Wrangler dry-run, and authenticated live smoke checks. No live scan starts automatically on page load.
