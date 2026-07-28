# Keyword Research (DataForSEO) — Design

## Purpose

Nathan is moving keyword research off Ahrefs and onto DataForSEO. This adds a new admin page, `/admin/keyword-research/`, that shows search volume, CPC, competition, and keyword difficulty for a seed list of keywords, plus related keyword ideas (for finding new terms to target — including for rank-and-rent) and a SERP competitor breakdown per keyword.

This is separate and independent from the existing `/admin/keywords/` page (Ahrefs rank tracking) and `/admin/gsc/` page (Google Search Console). Nothing about those pages changes. A future, separate project will add an EMD (exact-match-domain) opportunity finder for rank-and-rent town/service combos — out of scope here.

## Data model — matches the existing Ahrefs/GSC pattern

The site is fully static (`output: 'static'`). Every other admin page (`backlinks.astro`, `gsc.astro`, `indexing.astro`, `keywords.astro`) follows the same pattern: a script fetches from a third-party API and writes a JSON cache file, and the Astro page reads that cache at **build time** — no runtime API calls, no live search box. This page follows the same pattern.

- **Seed list** — `scripts/dataforseo-keywords.json`: a plain JSON array of keyword strings that Nathan maintains by hand, e.g.:
  ```json
  ["web design merthyr tydfil", "seo services south wales", "ecommerce website cardiff"]
  ```
  Independent from `scripts/ahrefs-keywords.json` — no shared source, no attempt to keep them in sync.

- **Fetch script** — `scripts/dataforseo-keywords.mjs`, run manually (`node scripts/dataforseo-keywords.mjs`). Reads `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` from `.env` (via the same `parseEnvFile()` helper already used in `ahrefs-keywords.mjs`) and authenticates to the DataForSEO REST API (`https://api.dataforseo.com`) with HTTP Basic Auth. Location fixed to United Kingdom, language English (matches the DataForSEO `location_name` / `language_code` parameters — no per-keyword override in this version).

  For each run, it makes three kinds of calls:
  1. **`POST /v3/dataforseo_labs/google/keyword_overview/live`** — one bulk request covering every seed keyword — returns search volume, CPC, competition, and keyword difficulty per keyword.
  2. **`POST /v3/dataforseo_labs/google/related_keywords/live`** — one request per seed keyword — returns related keyword ideas with their own volume/CPC/difficulty. Each result is tagged with the seed keyword it came from. Results across all seeds are pooled and deduplicated (same keyword found via multiple seeds keeps only the first source).
  3. **`POST /v3/serp/google/organic/live/advanced`** — one request per seed keyword — returns the top 10 organic results (domain, title, URL, position).

  All responses are combined and written to `scripts/dataforseo-keywords-cache.json`:
  ```json
  {
    "fetchedAt": "2026-07-28T12:00:00.000Z",
    "location": "United Kingdom",
    "language": "English",
    "keywords": [
      {
        "keyword": "web design merthyr tydfil",
        "volume": 90,
        "cpc": 4.2,
        "competition": 0.31,
        "difficulty": 18,
        "serp": [
          { "position": 1, "domain": "example.com", "title": "...", "url": "..." }
        ]
      }
    ],
    "relatedKeywords": [
      { "keyword": "web designer merthyr", "volume": 40, "cpc": 3.9, "difficulty": 22, "sourceKeyword": "web design merthyr tydfil" }
    ]
  }
  ```

  If a keyword returns no data (DataForSEO has no volume for it), it's still included with `volume: null` etc., same convention as `position: null` in the Ahrefs cache — the page renders `-` for null fields.

- **Admin page** — `src/pages/admin/keyword-research.astro`. Reads `scripts/dataforseo-keywords-cache.json` at build time, same `existsSync`/`readFileSync` pattern as the other admin pages. No new dependencies, no runtime API calls, no secrets shipped to the client.

- **Refresh workflow** (shown on the page, same convention as the others):
  ```
  node scripts/dataforseo-keywords.mjs && npm run build && npx wrangler deploy
  ```

## Page layout

Same dark admin theme, topbar, and nav pattern as the existing five admin pages (`backlinks.astro`, `gsc.astro`, `indexing.astro`, `keywords.astro`, `links.astro`, `jobs.astro`). Add `Keyword Research` as a new nav link across all of them, pointing to `/admin/keyword-research/`.

1. **Stats row**: Last Refresh, Tracked Keywords (count), Total Search Volume (sum), Average Difficulty.

2. **Seed Keywords table** — one row per seed keyword: Keyword | Volume | CPC | Competition | Difficulty | Top-ranking domain (from `serp[0]`). Each row has a native `<details>`/`<summary>` disclosure that expands to the full top-10 SERP table (Position, Domain, Title, URL) — no extra JS needed for this part. Standard search box + min-volume/max-difficulty filters and column sorting, matching the filter/sort conventions already used in `keywords.astro`.

3. **Related Keyword Ideas table** — the flattened, deduplicated `relatedKeywords` list: Keyword | Volume | CPC | Difficulty | Found Via (source seed keyword). Sortable and searchable the same way. This is the discovery table for finding new terms worth targeting.

**Empty state**: if `scripts/dataforseo-keywords-cache.json` doesn't exist yet, show the same style of empty-state message as the other pages, instructing Nathan to add `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` to `.env`, populate `scripts/dataforseo-keywords.json`, then run the fetch script and rebuild.

## Error handling

- Script: if credentials are missing, print a clear message and exit non-zero (matches `ahrefs-keywords.mjs`'s existing behavior for missing `AHREFS_API_KEY`).
- Script: if `scripts/dataforseo-keywords.json` doesn't exist or is empty, print an instructional message and exit non-zero rather than making empty API calls.
- Script: if an individual DataForSEO call fails for one keyword (e.g. rate limit, no data), log a warning and continue with the remaining keywords rather than aborting the whole run — matches the cache's `volume: null` fallback convention.
- Page: no server-side error handling needed since it's pure static file reads at build time; a missing/corrupt cache file falls back to the empty state.

## Out of scope

- No live/interactive search box — this would require switching the site from `output: 'static'` to a Cloudflare SSR adapter, a much larger architectural change not needed for this feature.
- No EMD/domain-availability opportunity finder — separate future project.
- No per-keyword location override — everything fetched at UK/English level.
- No changes to `/admin/keywords/` (Ahrefs) or `/admin/gsc/` — they continue to operate exactly as they do today.
