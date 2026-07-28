# EMD Competitor Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second-stage script and page enhancement that runs a real SERP + referring-domain competitive analysis over every current EMD Finder "Opportunity," distinguishing genuinely soft opportunities (directory-heavy SERPs, low referring-domain floor) from defended ones (real, established competitors), surfaced as an expandable "Check competitors" detail on each opportunity row.

**Architecture:** A directory-domain blocklist (`scripts/emd-directory-domains.json`) plus pure classification/scoring helpers (`scripts/lib/emd-competitor-helpers.mjs`, unit tested) back a new fetch script (`scripts/emd-competitor-check.mjs`) that reads the existing `scripts/emd-finder-cache.json`, fetches SERP + backlink data for every opportunity via DataForSEO, and writes `scripts/emd-competitor-check-cache.json`. The existing `/admin/emd-finder/` page reads this second cache and adds a per-row expandable detail — no new page, no restructure of the existing table/filters.

**Tech Stack:** Node.js `fetch`, `node:test`, DataForSEO REST API v3 (SERP organic + Backlinks Summary — the latter not yet used anywhere in this repo).

**Reference spec:** `docs/superpowers/specs/2026-07-28-emd-competitor-check-design.md`

**Existing prerequisites already in place:** `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` are in `.env`; `scripts/lib/dataforseo-helpers.mjs` already exports `buildAuthHeader` and `mapSerpItems`; `scripts/emd-finder-cache.json` already exists with 279 real opportunities (available + has volume) as of the last EMD Finder run.

---

### Task 1: Directory domain list

**Files:**
- Create: `scripts/emd-directory-domains.json`

- [ ] **Step 1: Create the list**

```json
[
  "yell.com",
  "facebook.com",
  "bark.com",
  "checkatrade.com",
  "trustpilot.com",
  "thomsonlocal.com",
  "freeindex.co.uk",
  "cylex-uk.co.uk",
  "scoot.co.uk",
  "192.com",
  "threebestrated.co.uk",
  "mybuilder.com",
  "ratedpeople.com",
  "houzz.co.uk",
  "nextdoor.co.uk",
  "businessmagnet.co.uk",
  "sortlist.co.uk",
  "themanifest.com",
  "reddit.com",
  "yelp.com",
  "118118.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "linkedin.com",
  "indeed.com",
  "wikipedia.org"
]
```

- [ ] **Step 2: Commit**

```bash
git add scripts/emd-directory-domains.json
git commit -m "feat: add EMD competitor check directory domain list"
```

---

### Task 2: Classification and verdict helpers (TDD)

**Files:**
- Create: `scripts/lib/emd-competitor-helpers.mjs`
- Test: `tests/unit/emd-competitor-helpers.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDirectoryDomain,
  computeDirectoryRatio,
  computeFloor,
  computeVerdict,
} from '../../scripts/lib/emd-competitor-helpers.mjs';

const DIRECTORY_LIST = ['yell.com', 'trustpilot.com', 'facebook.com'];

describe('isDirectoryDomain', () => {
  test('matches an exact directory domain', () => {
    assert.equal(isDirectoryDomain('yell.com', DIRECTORY_LIST), true);
  });

  test('matches with a www prefix stripped', () => {
    assert.equal(isDirectoryDomain('www.yell.com', DIRECTORY_LIST), true);
  });

  test('matches a subdomain of a directory domain', () => {
    assert.equal(isDirectoryDomain('uk.trustpilot.com', DIRECTORY_LIST), true);
  });

  test('does not match a real business domain', () => {
    assert.equal(isDirectoryDomain('locksmith-newport.co.uk', DIRECTORY_LIST), false);
  });

  test('does not false-positive on a domain that merely contains a directory name as a substring', () => {
    assert.equal(isDirectoryDomain('notyell.com', DIRECTORY_LIST), false);
  });
});

describe('computeDirectoryRatio', () => {
  test('computes the fraction of directory results', () => {
    const competitors = [
      { isDirectory: true }, { isDirectory: true }, { isDirectory: false },
    ];
    assert.equal(computeDirectoryRatio(competitors), 2 / 3);
  });

  test('returns 0 for an empty list', () => {
    assert.equal(computeDirectoryRatio([]), 0);
  });
});

describe('computeFloor', () => {
  test('returns the lowest referring-domain count among real-business competitors', () => {
    const competitors = [
      { isDirectory: false, referringDomains: 80 },
      { isDirectory: false, referringDomains: 42 },
      { isDirectory: true, referringDomains: null },
    ];
    assert.equal(computeFloor(competitors), 42);
  });

  test('returns null when there are no real-business competitors', () => {
    const competitors = [{ isDirectory: true, referringDomains: null }];
    assert.equal(computeFloor(competitors), null);
  });

  test('ignores real-business competitors with a failed (null) lookup', () => {
    const competitors = [
      { isDirectory: false, referringDomains: null },
      { isDirectory: false, referringDomains: 20 },
    ];
    assert.equal(computeFloor(competitors), 20);
  });
});

describe('computeVerdict', () => {
  test('returns Soft when there is no real-business floor', () => {
    assert.equal(computeVerdict(0.8, null), 'Soft');
  });

  test('returns Defended for a low directory ratio and a high floor', () => {
    assert.equal(computeVerdict(0.3, 42), 'Defended');
  });

  test('returns Soft for a high directory ratio', () => {
    assert.equal(computeVerdict(0.5, 100), 'Soft');
  });

  test('returns Soft for a low floor even with a moderate ratio', () => {
    assert.equal(computeVerdict(0.4, 10), 'Soft');
  });

  test('returns Moderate otherwise', () => {
    assert.equal(computeVerdict(0.4, 20), 'Moderate');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/unit/emd-competitor-helpers.test.js`
Expected: FAIL — `Cannot find module '../../scripts/lib/emd-competitor-helpers.mjs'`

- [ ] **Step 3: Implement the helpers**

```javascript
// scripts/lib/emd-competitor-helpers.mjs

export function isDirectoryDomain(domain, directoryList) {
  const normalized = String(domain || '').toLowerCase().replace(/^www\./, '');
  return directoryList.some((entry) => {
    const d = entry.toLowerCase();
    return normalized === d || normalized.endsWith(`.${d}`);
  });
}

export function computeDirectoryRatio(competitors) {
  if (competitors.length === 0) return 0;
  const directoryCount = competitors.filter((c) => c.isDirectory).length;
  return directoryCount / competitors.length;
}

export function computeFloor(competitors) {
  const realBusiness = competitors.filter((c) => !c.isDirectory && c.referringDomains !== null);
  if (realBusiness.length === 0) return null;
  return Math.min(...realBusiness.map((c) => c.referringDomains));
}

export function computeVerdict(directoryRatio, floor) {
  if (floor === null) return 'Soft';
  if (directoryRatio <= 0.3 && floor >= 30) return 'Defended';
  if (directoryRatio >= 0.5 || floor < 15) return 'Soft';
  return 'Moderate';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/emd-competitor-helpers.test.js`
Expected: PASS — all tests green, 0 failures

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/emd-competitor-helpers.mjs tests/unit/emd-competitor-helpers.test.js
git commit -m "feat: add EMD competitor classification and verdict helpers with tests"
```

---

### Task 3: Fetch script

**Files:**
- Create: `scripts/emd-competitor-check.mjs`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: Sanity-check the Backlinks Summary endpoint before writing the full script**

This repo has never called `POST /v3/backlinks/summary/live` before (only SERP and Labs endpoints so far). Confirm the request/response shape works and `referring_domains` is the correct field name, using your existing DataForSEO credentials from `.env`:

```bash
node -e "
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).map(l=>l.match(/^([A-Z0-9_]+)=(.+)\$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
const auth = 'Basic ' + Buffer.from(env.DATAFORSEO_LOGIN + ':' + env.DATAFORSEO_PASSWORD).toString('base64');
fetch('https://api.dataforseo.com/v3/backlinks/summary/live', {
  method: 'POST',
  headers: { Authorization: auth, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ target: 'nc-digital.co.uk' }]),
}).then(r => r.json()).then(j => console.log(JSON.stringify(j, null, 2)));
"
```

Expected: a response with `tasks[0].result[0]` containing a `referring_domains` field (a number). If the field is named differently, or the response is nested differently, STOP and report BLOCKED with the actual response — adjust the plan's assumed field name before writing `fetchReferringDomains` in Step 2, don't guess.

- [ ] **Step 2: Write the script**

```javascript
/**
 * EMD competitor check — SERP + referring-domain analysis for EMD Finder opportunities.
 * Run: node scripts/emd-competitor-check.mjs [--limit=N]
 *
 * Reads scripts/emd-finder-cache.json and scripts/emd-directory-domains.json,
 * writes scripts/emd-competitor-check-cache.json.
 *
 * Requires:
 * - DATAFORSEO_LOGIN in .env or environment
 * - DATAFORSEO_PASSWORD in .env or environment
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAuthHeader, mapSerpItems } from './lib/dataforseo-helpers.mjs';
import { isDirectoryDomain, computeDirectoryRatio, computeFloor, computeVerdict } from './lib/emd-competitor-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENV_PATH = path.join(__dirname, '..', '.env');
const EMD_CACHE_PATH = path.join(__dirname, 'emd-finder-cache.json');
const DIRECTORY_LIST_PATH = path.join(__dirname, 'emd-directory-domains.json');
const CACHE_PATH = path.join(__dirname, 'emd-competitor-check-cache.json');
const BASE = 'https://api.dataforseo.com/v3';
const LOCATION_NAME = 'United Kingdom';
const LANGUAGE_CODE = 'en';
const SERP_LIMIT = 10;
const REQUEST_DELAY_MS = 200;

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = true] = arg.replace(/^--/, '').split('=');
    return [key, value];
  })
);
const LIMIT = args.limit ? Number(args.limit) : null;

function parseEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    fs.readFileSync(ENV_PATH, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.+)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].trim().replace(/^["']|["']$/g, '')])
  );
}

function loadConfig() {
  const env = parseEnvFile();
  const login = process.env.DATAFORSEO_LOGIN || env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD || env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    console.error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD not found. Add them to .env or set them as environment variables.');
    process.exit(1);
  }

  return { login, password };
}

function loadOpportunities() {
  if (!fs.existsSync(EMD_CACHE_PATH)) {
    console.error('No scripts/emd-finder-cache.json found. Run node scripts/emd-finder.mjs first.');
    process.exit(1);
  }
  const cache = JSON.parse(fs.readFileSync(EMD_CACHE_PATH, 'utf8'));
  const combos = cache.combos ?? [];
  const opportunities = combos.filter((c) => c.available === true && c.volume !== null && c.volume > 0);
  if (opportunities.length === 0) {
    console.error('No opportunities found in scripts/emd-finder-cache.json (need available === true && volume > 0).');
    process.exit(1);
  }
  return LIMIT ? opportunities.slice(0, LIMIT) : opportunities;
}

function loadDirectoryList() {
  if (!fs.existsSync(DIRECTORY_LIST_PATH)) {
    console.error('No scripts/emd-directory-domains.json found. Create it with an array of directory domain strings.');
    process.exit(1);
  }
  const list = JSON.parse(fs.readFileSync(DIRECTORY_LIST_PATH, 'utf8'));
  if (!Array.isArray(list) || list.length === 0) {
    console.error('scripts/emd-directory-domains.json must be a non-empty array of domain strings.');
    process.exit(1);
  }
  return list;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postTask(authHeader, endpoint, tasks) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tasks),
  });
  const json = await res.json();
  const task = json.tasks?.[0];
  if (!res.ok || (json.status_code && json.status_code >= 40000) || (task?.status_code && task.status_code >= 40000)) {
    const message = task?.status_message || json.status_message || `${res.status} ${res.statusText}`;
    throw new Error(`${endpoint}: ${message}`);
  }
  return json;
}

async function fetchSerp(authHeader, phrase) {
  try {
    const json = await postTask(authHeader, 'serp/google/organic/live/advanced', [
      { keyword: phrase, location_name: LOCATION_NAME, language_code: LANGUAGE_CODE, device: 'desktop', os: 'windows', depth: SERP_LIMIT },
    ]);
    const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
    return mapSerpItems(items, SERP_LIMIT);
  } catch (err) {
    console.warn(`SERP fetch failed for "${phrase}": ${err.message}`);
    return [];
  }
}

async function fetchReferringDomains(authHeader, domain) {
  try {
    const json = await postTask(authHeader, 'backlinks/summary/live', [{ target: domain }]);
    const result = json.tasks?.[0]?.result?.[0];
    return result?.referring_domains ?? null;
  } catch (err) {
    console.warn(`Backlinks summary failed for "${domain}": ${err.message}`);
    return null;
  }
}

async function main() {
  const opportunities = loadOpportunities();
  const directoryList = loadDirectoryList();
  const { login, password } = loadConfig();
  const authHeader = buildAuthHeader(login, password);

  console.log(`Running competitor check for ${opportunities.length} opportunity combo(s)...`);

  const serpByComboKey = new Map();
  for (const combo of opportunities) {
    const key = `${combo.trade}|${combo.town}`;
    const phrase = `${combo.trade} ${combo.town.replace(/-/g, ' ')}`;
    const serp = await fetchSerp(authHeader, phrase);
    serpByComboKey.set(key, serp);
    await sleep(REQUEST_DELAY_MS);
  }

  const uniqueBusinessDomains = new Set();
  for (const serp of serpByComboKey.values()) {
    for (const result of serp) {
      if (!isDirectoryDomain(result.domain, directoryList)) {
        uniqueBusinessDomains.add(result.domain);
      }
    }
  }

  console.log(`Looking up referring domains for ${uniqueBusinessDomains.size} unique real-business domain(s)...`);

  const referringDomainsByDomain = new Map();
  for (const domain of uniqueBusinessDomains) {
    const count = await fetchReferringDomains(authHeader, domain);
    referringDomainsByDomain.set(domain, count);
    await sleep(REQUEST_DELAY_MS);
  }

  const checks = opportunities.map((combo) => {
    const key = `${combo.trade}|${combo.town}`;
    const serp = serpByComboKey.get(key) ?? [];
    const competitors = serp.map((result) => {
      const isDirectory = isDirectoryDomain(result.domain, directoryList);
      return {
        position: result.position,
        domain: result.domain,
        isDirectory,
        referringDomains: isDirectory ? null : referringDomainsByDomain.get(result.domain) ?? null,
      };
    });
    const directoryRatio = computeDirectoryRatio(competitors);
    const floor = computeFloor(competitors);
    const verdict = computeVerdict(directoryRatio, floor);
    return {
      trade: combo.trade,
      town: combo.town,
      directoryRatio,
      floor,
      verdict,
      competitors,
    };
  });

  const cache = {
    fetchedAt: new Date().toISOString(),
    checks,
  };

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');

  const verdictCounts = checks.reduce((acc, c) => {
    acc[c.verdict] = (acc[c.verdict] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`
Done.
  Combos checked: ${checks.length}
  Unique competitor domains looked up: ${uniqueBusinessDomains.size}
  Verdicts: ${JSON.stringify(verdictCounts)}

Cache saved to: scripts/emd-competitor-check-cache.json
`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add this line inside `"scripts"`, alongside `emd:finder`:

```json
    "emd:competitor-check": "node scripts/emd-competitor-check.mjs",
```

- [ ] **Step 4: Quick verification run with a small limit**

Real DataForSEO credentials already exist in `.env`. Running against all 279 opportunities takes a long time (SERP live calls are slow — expect somewhere between 20 minutes and an hour for the full set, between SERP fetches and backlink lookups). For implementation verification, run a small slice first:

Run: `node scripts/emd-competitor-check.mjs --limit=5`
Expected: prints `Running competitor check for 5 opportunity combo(s)...`, then `Looking up referring domains for N unique real-business domain(s)...`, then `Done.` with verdict counts. Confirm `scripts/emd-competitor-check-cache.json` was created with 5 entries in `checks`, each with a `verdict` of `Soft`, `Moderate`, or `Defended`, and a `competitors` array with real domains, `isDirectory` flags, and `referringDomains` values (non-null for at least some real-business entries — a few nulls from occasional lookup failures are fine).

Do not run the full (unlimited) sweep during this task — that's deferred to Task 5's final verification, where it can run in the background without blocking review.

- [ ] **Step 5: Commit**

```bash
git add scripts/emd-competitor-check.mjs package.json
git commit -m "feat: add EMD competitor check fetch script"
```

`scripts/emd-competitor-check-cache.json` is not gitignored but is never committed, same convention as the other cache files. Do not `git add` it.

---

### Task 4: Admin page changes

**Files:**
- Modify: `src/pages/admin/emd-finder.astro`

- [ ] **Step 1: Add the new interfaces and cache read**

Find:
```astro
interface EmdCache {
  fetchedAt?: string;
  combos?: ComboRow[];
}

const CACHE_PATH = join(process.cwd(), 'scripts/emd-finder-cache.json');
const cache: EmdCache = existsSync(CACHE_PATH)
  ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  : {};

const combos = cache.combos ?? [];
const hasData = Boolean(cache.fetchedAt);
```
Replace with:
```astro
interface EmdCache {
  fetchedAt?: string;
  combos?: ComboRow[];
}

interface CompetitorEntry {
  position: number | null;
  domain: string;
  isDirectory: boolean;
  referringDomains: number | null;
}

interface CompetitorCheck {
  trade: string;
  town: string;
  directoryRatio: number;
  floor: number | null;
  verdict: string;
  competitors: CompetitorEntry[];
}

interface CompetitorCheckCache {
  fetchedAt?: string;
  checks?: CompetitorCheck[];
}

const CACHE_PATH = join(process.cwd(), 'scripts/emd-finder-cache.json');
const cache: EmdCache = existsSync(CACHE_PATH)
  ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  : {};

const COMPETITOR_CACHE_PATH = join(process.cwd(), 'scripts/emd-competitor-check-cache.json');
const competitorCache: CompetitorCheckCache = existsSync(COMPETITOR_CACHE_PATH)
  ? JSON.parse(readFileSync(COMPETITOR_CACHE_PATH, 'utf8'))
  : {};

const competitorChecksByKey = new Map(
  (competitorCache.checks ?? []).map((check) => [`${check.trade}|${check.town}`, check])
);

const combos = cache.combos ?? [];
const hasData = Boolean(cache.fetchedAt);
```

- [ ] **Step 2: Add CSS for the competitor detail**

Find:
```astro
      details.serp-details { margin-top: 0.4rem; }
```
This selector doesn't exist on this page yet (that's from the sibling `keyword-research.astro`) — instead, find:
```astro
      .empty {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 2rem;
        color: var(--muted);
      }
```
Replace with:
```astro
      .empty {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 2rem;
        color: var(--muted);
      }
      details.competitor-details { margin-top: 0.4rem; }
      details.competitor-details summary {
        cursor: pointer;
        color: var(--purple);
        font-size: 0.72rem;
        font-weight: 800;
        list-style: none;
      }
      details.competitor-details summary::-webkit-details-marker { display: none; }
      .competitor-summary { margin: 0.4rem 0; font-size: 0.72rem; }
      .competitor-table { width: 100%; border-collapse: collapse; margin-top: 0.3rem; }
      .competitor-table th, .competitor-table td {
        padding: 0.35rem 0.5rem;
        font-size: 0.72rem;
        border-bottom: 1px solid var(--border);
        text-align: left;
      }
      .pill.soft { color: var(--green); border-color: rgba(45, 215, 124, 0.35); }
      .pill.moderate { color: var(--amber); border-color: rgba(246, 200, 95, 0.35); }
      .pill.defended { color: var(--red); border-color: rgba(255, 92, 122, 0.35); }
      .pill.business { color: var(--green); border-color: rgba(45, 215, 124, 0.35); }
      .pill.directory { color: var(--muted); }
```

- [ ] **Step 3: Change the combos map to a block body and add the detail to the Domain cell**

Find:
```astro
                <tbody>
                  {combos.map((row) => (
                    <tr
                      class={row.available === true && row.volume !== null && row.volume > 0 ? 'opportunity' : ''}
                      data-search={`${row.trade} ${row.town.replace(/-/g, ' ')} ${row.domain}`.toLowerCase()}
                      data-available={row.available === true ? 'true' : row.available === false ? 'false' : 'unknown'}
                      data-volume={row.volume ?? ''}
                      data-cpc={row.cpc ?? ''}
                      data-difficulty={row.difficulty ?? ''}
                      data-avg-job-cost={row.avgJobCost ?? ''}
                    >
                      <td data-label="Domain"><span class="domain">{row.domain}</span></td>
                      <td data-label="Trade">{row.trade}</td>
                      <td data-label="Town">{row.town.replace(/-/g, ' ')}</td>
                      <td data-label="Availability"><span class={`pill ${availabilityClass(row.available)}`}>{availabilityLabel(row.available)}</span></td>
                      <td data-label="Volume">{fmtNumber(row.volume)}</td>
                      <td data-label="CPC">{fmtCpc(row.cpc)}</td>
                      <td data-label="Difficulty">{fmtNumber(row.difficulty)}</td>
                      <td data-label="Avg Job Cost">{fmtCost(row.avgJobCost)}</td>
                    </tr>
                  ))}
                </tbody>
```
Replace with:
```astro
                <tbody>
                  {combos.map((row) => {
                    const competitorCheck = competitorChecksByKey.get(`${row.trade}|${row.town}`) ?? null;
                    return (
                      <tr
                        class={row.available === true && row.volume !== null && row.volume > 0 ? 'opportunity' : ''}
                        data-search={`${row.trade} ${row.town.replace(/-/g, ' ')} ${row.domain}`.toLowerCase()}
                        data-available={row.available === true ? 'true' : row.available === false ? 'false' : 'unknown'}
                        data-volume={row.volume ?? ''}
                        data-cpc={row.cpc ?? ''}
                        data-difficulty={row.difficulty ?? ''}
                        data-avg-job-cost={row.avgJobCost ?? ''}
                      >
                        <td data-label="Domain">
                          <span class="domain">{row.domain}</span>
                          {competitorCheck && competitorCheck.competitors.length > 0 && (
                            <details class="competitor-details">
                              <summary>Check competitors — {competitorCheck.verdict}</summary>
                              <p class="competitor-summary muted">
                                Directory ratio: {Math.round(competitorCheck.directoryRatio * 100)}%
                                {' · '}
                                Floor: {competitorCheck.floor === null ? 'No real competitors' : `${competitorCheck.floor} referring domains`}
                              </p>
                              <table class="competitor-table">
                                <thead><tr><th>#</th><th>Domain</th><th>Type</th><th>Referring Domains</th></tr></thead>
                                <tbody>
                                  {competitorCheck.competitors.map((c) => (
                                    <tr>
                                      <td>{fmtNumber(c.position)}</td>
                                      <td>{c.domain}</td>
                                      <td><span class={`pill ${c.isDirectory ? 'directory' : 'business'}`}>{c.isDirectory ? 'Directory' : 'Business'}</span></td>
                                      <td>{fmtNumber(c.referringDomains)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </details>
                          )}
                        </td>
                        <td data-label="Trade">{row.trade}</td>
                        <td data-label="Town">{row.town.replace(/-/g, ' ')}</td>
                        <td data-label="Availability"><span class={`pill ${availabilityClass(row.available)}`}>{availabilityLabel(row.available)}</span></td>
                        <td data-label="Volume">{fmtNumber(row.volume)}</td>
                        <td data-label="CPC">{fmtCpc(row.cpc)}</td>
                        <td data-label="Difficulty">{fmtNumber(row.difficulty)}</td>
                        <td data-label="Avg Job Cost">{fmtCost(row.avgJobCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
```

- [ ] **Step 4: Verify the build with the small-limit competitor cache from Task 3**

Run: `npm run build`
Expected: build succeeds. Confirm `dist/admin/emd-finder/index.html` contains `Check competitors —` for the 5 combos that have a competitor check, and does NOT show that disclosure for any of the other ~274 opportunities (since they have no matching entry in `competitorChecksByKey` yet).

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/emd-finder.astro
git commit -m "feat: show competitor check detail on EMD finder opportunity rows"
```

---

### Task 5: Full verification pass

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run test:unit`
Expected: all tests pass, including the new `tests/unit/emd-competitor-helpers.test.js`.

- [ ] **Step 2: Run the full production build**

Run: `npm run build`
Expected: exit code 0, no Astro/TypeScript errors.

- [ ] **Step 3: Run the full competitor check for real**

This is the long-running step — expect anywhere from 20 minutes to over an hour for all 279 opportunities (SERP live calls plus deduped backlink lookups). Run it in a way that doesn't block on a single terminal session if your environment supports background execution; otherwise just let it run.

Run: `node scripts/emd-competitor-check.mjs`
Expected: eventually prints `Done.` with the combo count (279, unless the opportunity count has changed since the last EMD Finder refresh) and a verdict breakdown. Spot-check a handful of entries in `scripts/emd-competitor-check-cache.json` for plausibility — do the verdicts roughly match intuition (a combo with a director-heavy top 10 and low floor should say `Soft`; one with several strong, high-referring-domain real businesses should say `Defended`)?

- [ ] **Step 4: Rebuild with the full competitor check data**

Run: `npm run build`
Expected: exit 0. Spot-check that `dist/admin/emd-finder/index.html` now shows `Check competitors —` disclosures across many opportunity rows, not just 5.

- [ ] **Step 5: Preview and manually verify**

Run: `npm run preview`
Visit `/admin/emd-finder/`, expand a few "Check competitors" disclosures, and confirm the directory ratio, floor, verdict, and competitor table all render sensibly and match what's in the cache file.

- [ ] **Step 6: Deploy**

Run: `npx wrangler deploy`
Expected: deploy succeeds; confirm `https://nc-digital.co.uk/admin/emd-finder/` loads with the new competitor check data.
