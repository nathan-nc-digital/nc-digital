# SEO & Analytics reports

Admin: `/admin/analytics-reports/`, linked from the existing admin tools navigation. The API is restricted to Nathan by the existing Worker authentication. D1 migration: `0010_analytics_reports.sql`.

## Google connection

The Worker secret `GOOGLE_ANALYTICS_CONFIG` contains `client_id`, `client_secret` and a refresh token with `https://www.googleapis.com/auth/analytics.readonly`. Search Console uses the existing separate `GOOGLE_GSC_CONFIG` secret. Browser assets never receive either connection. Enable both Google Analytics Admin API and Google Analytics Data API in the OAuth client's Google Cloud project.

`node scripts/ga-connect.mjs` uses the existing ignored desktop OAuth credentials file and opens a local callback on 127.0.0.1:3457. It writes the sign-in URL to `.tmp/ga-auth-url.txt` and stores tokens in ignored `scripts/ga-token.json`. It uses PKCE, random state and a 30-minute timeout. To reconnect, complete that Google consent flow and replace the Analytics Worker secret. It does not replace Search Console credentials. Consent-screen testing status or account policy can require periodic reconnection.

## Periods and scope

Presets use the last 1, 3 or 6 **completed calendar months**, based on the GA4 property's time zone. Comparison is the immediately preceding same number of calendar months. For example, in September 2026, six months means March–August 2026 versus September 2025–February 2026. These windows contain 184 and 181 days respectively. Daily averages are shown for additive volume metrics; users are not averaged or summed across dates. Custom periods span 1–184 days, end before today and compare with an immediately preceding equal number of days.

GA4 reports filter to web traffic, with all countries or UK. Organic Search is based on the session default channel group and includes all search engines. Optional Search Console reports use Google Web Search and the same country/date selection, but Pacific reporting dates and final data. The user selects the matching Search Console property explicitly; only NC Digital is preselected when its GA4 name matches. Search Console retains roughly 16 months of history, so old custom ranges can be incomplete and are flagged.

## Data, interpretation and storage

GA4 requests: independently aggregated totals, organic totals, acquisition channels, sources, landing pages, devices, countries, events and daily sessions. Named `current` and `previous` date ranges are parsed by header names. Detailed requests return at most 200 rows across both periods; daily data at most 400. Metadata discloses thresholding, sampling, restricted metrics, `(other)` rows and truncation. Only 20 rows per table are displayed, 10 in print. Missing rows remain unknown.

Search Console requests: totals, top pages, top queries and daily trend for each period. Top page/query sets are capped at 100. GA4 key events are event occurrences defined by the client's configuration, not verified leads. Rate changes use percentage points; lower average positions are treated as improvements. Zero baselines do not produce percentage growth. Commentary describes evidence and suggests investigations, rather than claiming causation or forecasting results.

Each report step is saved atomically with its progress. Transient failures can be resumed. One expiring database lock serializes report work; at most ten new reports per hour. Completed identical reports reuse results for 24 hours unless the user selects refresh. Cached reports can be opened without a working Google connection. Starting a cached report still checks GA4 property access, but does not rerun the expensive report queries. No DataForSEO calls are made.

Client notes persist per report. Printing saves pending notes and opens metric explanations before invoking the browser print dialog. CSV exports headline figures and GA4 breakdowns, with property IDs, countries, dates and explicit units. Reports are not published publicly or sent to clients automatically.

## Validation

`npm run test:unit`, `npm run build`, `npx playwright test --config tests/analytics-playwright.config.ts`, and a Wrangler dry-run. Unit coverage includes calendar and custom comparisons, leap years and time zones, rate/ranking direction, missing metrics, metadata restrictions, resumable quota failures, caching, notes persistence, origin checks and concurrent starts. Browser coverage includes six-month selection, explanations, CSV, mobile overflow, disabled connection and PDF notes.
