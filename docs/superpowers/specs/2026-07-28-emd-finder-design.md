# EMD Domain Finder (Rank & Rent) — Design

## Purpose

Nathan wants to find exact-match domains (EMDs) worth buying for a rank-and-rent business: build a small site around a trade+town domain (e.g. `merthyrtydfilplumber.co.uk`), rank it, then rent it to a local tradesperson. This adds a new admin page, `/admin/emd-finder/`, that checks every combination of a trade list and a South Wales town list for (a) whether the exact-match `.co.uk` domain is actually available to register, and (b) whether there's real search demand for that trade+town phrase — so Nathan can prioritize by genuine opportunity rather than guessing.

This is independent from the keyword research page (`/admin/keyword-research/`) and the Ahrefs rank tracking page (`/admin/keywords/`), though it reuses the same DataForSEO account and the `mapKeywordOverviewItem` helper from `scripts/lib/dataforseo-helpers.mjs`.

## Data model — same cached-script pattern as the other admin tools

The site is fully static (`output: 'static'`). This page follows the same convention as every other admin page: a script fetches data and writes a JSON cache; the Astro page reads that cache at build time.

- **Seed file** — `scripts/emd-finder-seed.json`:
  ```json
  {
    "trades": [
      "plumber", "electrician", "roofer", "locksmith", "gardener",
      "carpet cleaner", "driveway paving", "tree surgeon", "pest control",
      "heating engineer", "window cleaner", "skip hire"
    ],
    "towns": [
      "aberdare", "abergavenny", "ammanford", "bargoed", "barry", "blackwood",
      "brecon", "bridgend", "caerphilly", "cardiff", "carmarthen", "chepstow",
      "cwmbran", "ebbw-vale", "llandeilo", "llanelli", "maesteg",
      "merthyr-tydfil", "monmouth", "neath", "newport", "penarth",
      "pontypool", "pontypridd", "port-talbot", "porthcawl", "rhondda",
      "swansea", "tredegar"
    ]
  }
  ```
  Both arrays are plain, Nathan-editable lists — 12 trades × 29 towns = 348 combos to start. Town names use the same slug format as `src/content/locations/` (hyphenated, lowercase) since that's where this starter list was pulled from (filtered to Nathan's real South Wales service area, excluding the out-of-area North/Mid/West Wales towns already flagged `noindex` in `astro.config.mjs`).

- **Fetch script** — `scripts/emd-finder.mjs`, run manually (`node scripts/emd-finder.mjs`):
  1. Builds all `trades.length × towns.length` combos. For each combo, builds:
     - `phrase`: `"${trade} ${town}"` with the town's hyphens replaced by spaces (e.g. `"plumber merthyr tydfil"`) — used as the DataForSEO search keyword.
     - `domain`: `${town}${trade}.co.uk` with all spaces and hyphens stripped from both town and trade, lowercased (e.g. `merthyrtydfilplumber.co.uk`).
  2. **Domain availability** — for each combo, checks `https://rdap.nominet.uk/uk/domain/{domain}` (Nominet's public RDAP service for `.uk` domains, no API key required):
     - `404` response → domain is unregistered → `available: true`.
     - `200` response → domain is registered → `available: false`.
     - Any other response or network error → logs a warning (`RDAP check failed for "{domain}": {message}`) and sets `available: null` (unknown) rather than aborting the run — matches the fault-tolerant per-item pattern already used in `scripts/dataforseo-keywords.mjs`.
     - Runs sequentially with a short delay between requests (matching the existing scripts' pattern of not hammering a third-party service) — no concurrency needed since RDAP lookups are fast and free.
     - **Caveat:** the `rdap.nominet.uk` endpoint and its 404-means-available/200-means-registered behavior is based on Nominet's published RDAP documentation, not a live-verified response in this session. Before relying on it for all 348 combos, the implementation should sanity-check it against 2-3 known domains first (one definitely-registered `.co.uk` like `nc-digital.co.uk`, one almost-certainly-unregistered nonsense string) to confirm the response codes match this assumption, adjusting the endpoint/logic if not.
  3. **Search volume** — a single bulk `POST /v3/dataforseo_labs/google/keyword_overview/live` call covering all 348 `phrase` values at once (same endpoint and `mapKeywordOverviewItem` helper already used by `scripts/dataforseo-keywords.mjs`; imported from `scripts/lib/dataforseo-helpers.mjs`, not reimplemented). Uses the same `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` credentials already in `.env`, and the same `United Kingdom` / `en` location/language as the keyword research script.
  4. Combines both results per combo and writes `scripts/emd-finder-cache.json`:
     ```json
     {
       "fetchedAt": "2026-07-28T12:00:00.000Z",
       "combos": [
         {
           "trade": "plumber",
           "town": "merthyr-tydfil",
           "domain": "merthyrtydfilplumber.co.uk",
           "available": true,
           "volume": 90,
           "cpc": 4.2,
           "difficulty": 18
         }
       ]
     }
     ```

- **Admin page** — `src/pages/admin/emd-finder.astro`. Reads `scripts/emd-finder-cache.json` at build time, same `existsSync`/`readFileSync` pattern as the other admin pages. No runtime API calls, no secrets shipped to the client.

- **Refresh workflow** (shown on the page): `node scripts/emd-finder.mjs && npm run build && npx wrangler deploy`.

## Page layout

Same dark admin theme, topbar, and nav pattern as the other six admin pages. Add `EMD Finder` as a new nav link across all of them, pointing to `/admin/emd-finder/`.

1. **Stats row**: Last Refresh, Combos Checked, Domains Available, Opportunities (available AND `volume !== null && volume > 0`).
2. **Filters**: search box (matches trade, town, or domain), an "Available only" checkbox, a min-volume number input, reset button.
3. **Combos table**: Domain | Trade | Town | Availability (pill: green "Available" / muted "Taken" / amber "Unknown" for failed RDAP checks) | Volume | CPC | Difficulty — sortable on Volume/CPC/Difficulty, same sort-button convention as the other tables. Rows that are both available and have `volume > 0` get a subtle highlighted left border (an "opportunity" visual cue), reusing the CSS pattern already established for pills/highlights in the other admin pages.

**Empty state**: if `scripts/emd-finder-cache.json` doesn't exist yet, show the same style of empty-state message as the other pages, instructing Nathan to populate `scripts/emd-finder-seed.json` (already comes with the starter trades/towns list, so this is really just "run the script"), then run `node scripts/emd-finder.mjs` and rebuild.

## Error handling

- Script: if `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` are missing, print a clear message and exit non-zero (same as the keyword research script — these credentials are already required by that feature and are shared here).
- Script: if `scripts/emd-finder-seed.json` doesn't exist, is missing either array, or either array is empty, print an instructional message and exit non-zero.
- Script: an individual RDAP failure logs a warning and marks that combo's availability as `null` ("Unknown"), continuing with the rest — never aborts the whole run over one domain lookup.
- Script: the bulk DataForSEO overview call is allowed to hard-fail (no per-combo fallback makes sense for a single call covering everything) — same fail-fast behavior as `fetchKeywordOverview` in the keyword research script. Reuses the same "warn if every combo comes back with `volume: null`" signal added to the keyword research script, as a signal of a schema mismatch versus genuinely zero-volume phrases.
- Page: no server-side error handling needed — pure static file reads at build time; a missing/corrupt cache file falls back to the empty state.

## Out of scope

- No purchase automation — this only tells Nathan what's available and worth buying; he registers domains manually through his own registrar.
- No `.com` or other TLD checking — `.co.uk` only, per the confirmed scope.
- No alternate domain word-orderings (e.g. `plumbermerthyrtydfil.co.uk`) — only `{town}{trade}.co.uk`.
- No SERP/competitor data for these combos (unlike the keyword research page) — this tool is availability + demand only, not competitive analysis.
- No changes to any existing admin page beyond adding the nav link.
