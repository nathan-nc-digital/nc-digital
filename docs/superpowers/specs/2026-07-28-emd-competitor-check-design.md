# EMD Competitor Check — Design

## Purpose

The EMD Finder's current "Opportunity" flag (available domain + real search volume) is naive — it says nothing about whether the SERP is actually winnable. Nathan's manual analysis of "locksmith newport" showed the real decisive signals: how many of the top-10 organic results are soft directory/aggregator listings versus genuine competing businesses, and — among the real businesses — the lowest referring-domain count ("the floor you'd have to beat"). A domain with great volume but a floor of 42 referring domains and zero directories to displace is a much harder bet than one with a floor of 0.

This adds a second-stage script, `scripts/emd-competitor-check.mjs`, that runs a real SERP + backlink competitive analysis over every current EMD Finder "Opportunity" and surfaces the result as an expandable detail on each opportunity row on `/admin/emd-finder/`.

## Data model

- **Input**: reads the existing `scripts/emd-finder-cache.json`, filters to combos where `available === true && volume !== null && volume > 0` (the same "Opportunity" definition already used on the page) — currently 279 combos.

- **Directory list** — `scripts/emd-directory-domains.json`, a plain array Nathan can edit:
  ```json
  [
    "yell.com", "facebook.com", "bark.com", "checkatrade.com", "trustpilot.com",
    "thomsonlocal.com", "freeindex.co.uk", "cylex-uk.co.uk", "scoot.co.uk",
    "192.com", "threebestrated.co.uk", "mybuilder.com", "ratedpeople.com",
    "houzz.co.uk", "nextdoor.co.uk", "businessmagnet.co.uk", "sortlist.co.uk",
    "themanifest.com", "reddit.com", "yelp.com", "118118.com", "twitter.com",
    "x.com", "instagram.com", "linkedin.com", "indeed.com", "wikipedia.org"
  ]
  ```
  A SERP result's domain is classified as a directory if it exactly equals, or is a subdomain of, any entry in this list (e.g. `www.yell.com` and `uk.trustpilot.com` both match).

- **Fetch script** — `scripts/emd-competitor-check.mjs`, run manually (`node scripts/emd-competitor-check.mjs`):
  1. For each of the 279 opportunity combos, fetches the top-10 organic SERP via `POST /v3/serp/google/organic/live/advanced` (same endpoint already used in `scripts/dataforseo-keywords.mjs`), mapped through the existing `mapSerpItems` helper from `scripts/lib/dataforseo-helpers.mjs` — not reimplemented.
  2. Classifies each of the 10 results' domains as directory or real-business using the directory list above.
  3. Collects the set of **unique** real-business domains across the entire run (a domain appearing in multiple SERPs is only looked up once) and fetches each one's referring-domains count via `POST /v3/backlinks/summary/live` (`{ target: domain }` per task), reading `result[0].referring_domains` from the response.
  4. Per combo, computes:
     - `directoryRatio`: directory count ÷ number of organic results returned (usually 10, but uses the actual count if fewer).
     - `realBusinessCompetitors`: the real-business domains from that combo's top 10, each with its referring-domain count.
     - `floor`: the lowest referring-domain count among `realBusinessCompetitors`, or `null` if there are none (i.e. the whole top 10 was directories/social — the best-case scenario, nothing real to beat).
     - `verdict`, from this exact logic:
       ```js
       function verdict(directoryRatio, floor) {
         if (floor === null) return 'Soft'; // no real competitors in the top 10 at all
         if (directoryRatio <= 0.3 && floor >= 30) return 'Defended';
         if (directoryRatio >= 0.5 || floor < 15) return 'Soft';
         return 'Moderate';
       }
       ```
       This is a rough triage label, not a verdict to trust blindly — the raw numbers and competitor list are always shown alongside it so Nathan can read the actual picture, the same way he did for Newport by hand.
  5. Writes `scripts/emd-competitor-check-cache.json`:
     ```json
     {
       "fetchedAt": "2026-07-28T12:00:00.000Z",
       "checks": [
         {
           "trade": "locksmith",
           "town": "newport",
           "directoryRatio": 0.3,
           "floor": 42,
           "verdict": "Defended",
           "competitors": [
             { "position": 1, "domain": "locksmith-newport.co.uk", "isDirectory": false, "referringDomains": 80 },
             { "position": 2, "domain": "yell.com", "isDirectory": true, "referringDomains": null }
           ]
         }
       ]
     }
     ```
     `referringDomains` is `null` for directory entries (never looked up) and for any real-business lookup that failed.

- **Error handling**: an individual SERP or backlinks-summary failure logs a warning and that combo/domain is recorded with `null` data (skipped from the floor calculation) rather than aborting the whole run — matching the established fault-tolerance pattern from the other fetch scripts. Given the run covers ~279 combos and ~1,000-2,000 backlink lookups, occasional individual failures are expected and must not restart the whole run.

- **Sanity check before writing the main script**: verify the assumed `backlinks/summary/live` request/response shape against one real, known domain (e.g. `nc-digital.co.uk`) before relying on it for the full run — same discipline used for the Nominet RDAP endpoint in the original EMD Finder build.

- **Refresh workflow**: `node scripts/emd-competitor-check.mjs && npm run build && npx wrangler deploy`. This is a separate, optional refresh step from the main `emd:finder` run — running the main EMD Finder script does not automatically re-run the competitor check (the competitor check reads whatever `emd-finder-cache.json` currently has, and is intentionally a manual, deliberate second step given its cost).

## Page changes to `src/pages/admin/emd-finder.astro`

- Reads `scripts/emd-competitor-check-cache.json` alongside the existing cache. Builds a lookup keyed by `${trade}|${town}`.
- Each combo row that has a matching competitor check gets a `<details>` disclosure (same UI pattern as the SERP details on `/admin/keyword-research/`) labeled with the verdict, e.g. "Check competitors — Defended". Expanding it shows:
  - Directory ratio and floor as plain text.
  - A small table of the top-10 competitors: position, domain, Directory/Business pill, referring domains (or "-" for directories/failed lookups).
- Combos with no competitor check yet (not run, or not an opportunity at the time it was run) show no disclosure — same as today.
- No new filters in this version — the verdict is visible once expanded, and the existing search/volume/available-only filters are untouched. (A "verdict" filter could be a fast follow if it turns out to matter once real data exists.)

## Out of scope

- No local pack / Google Business review-count data — deferred, per the scope decision above.
- No automated purchase or domain registration.
- No re-running the competitor check automatically when `emd:finder` runs — it's a deliberate, separate, manual step.
- No verdict filter/sort in this version.
- No changes to the directory list beyond the starter set — Nathan edits `scripts/emd-directory-domains.json` directly as he encounters new directories in results.
