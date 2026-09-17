# SEO quick-win finder

Admin: `/admin/seo-quick-wins/`. Nathan-only API uses the existing D1 binding with migration `0009_seo_quick_wins.sql`. Add Worker secret `GOOGLE_GSC_CONFIG` containing `client_id`, `client_secret`, and `refresh_token`. Never place this configuration in client assets. The Google scope is `webmasters.readonly`; no Search Console properties are modified.

The connected account's accessible properties populate the client picker. If a client is missing, grant this Google account access in Search Console. OAuth refresh failures leave saved research accessible and explain that reconnection is required. This project uses a desktop OAuth client; reconnect using a loopback browser flow on the owner's machine, then replace the Worker secret. The local `.tmp/gsc-reconnect.mjs` helper uses PKCE, a random state token, a loopback-only listener and a 30-minute timeout. Google application consent/testing settings may require periodic reconnection.

Periods are 28, 56 or 84 days, calculated using Pacific dates, ending three days before today. Previous periods are equal in length and non-overlapping. Only finalised Web search data is requested. Defaults: United Kingdom, all devices, 50 keyword impressions, 2% CTR threshold. Brand terms filter keyword signals only; property totals and declining-page signals include all queries.

Seven datasets are loaded: current/previous property totals, current/previous page data, current/previous query-page pairs, and a daily trend covering both periods. Page and pair data are paginated in 500-row requests up to 5,000 rows per dataset. Each step saves its chunk and progress atomically. Read-only retries replace the same chunk after interruption. A global expiring lock serializes work. Reports with identical periods and filters reuse results for 24 hours; a fresh option is available. Ten starts per hour maximum. No DataForSEO calls.

Signals: average positions 5–20; top-ten average position with at least 100 impressions and CTR below the user's threshold; page clicks down at least 20% and five clicks from a baseline of ten; and position worsening by at least two with fewer clicks and sufficient impressions in both periods. Priority is a heuristic based on demand evidence, signal type and position. It does not forecast traffic or establish causation. Page work items use independently requested page totals, not summed query metrics. Missing rows stay unknown. Previously active pages absent from the current set appear as review items, not 100% losses. Display is bounded to 300 signals and 100 page plans.

Google may omit anonymised queries and only return top rows. Differences in seasonality, query mix and search features need human review. Reports and CSV exports disclose their scope; no generic CTR benchmark is presented as a measured client benchmark.

Page work items support to-do, in-progress, done and dismissed, with persistent notes shared across reports for the same property and page. CSV exports the filtered opportunity list. Printing exports the selected page work plan and saves pending notes first.

Validation: `npm run test:unit`, `npm run build`, `npx playwright test --config tests/wins-playwright.config.ts`, Wrangler dry-run and authenticated live research/cached-repeat checks.
