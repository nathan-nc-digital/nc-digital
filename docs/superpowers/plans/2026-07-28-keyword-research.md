# Keyword Research (DataForSEO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new static admin page at `/admin/keyword-research/` that shows DataForSEO search volume, CPC, competition, difficulty, related keyword ideas, and top-10 SERP competitors for a seed keyword list, refreshed via a script + cache file — matching the existing Ahrefs/GSC admin page pattern.

**Architecture:** A seed keyword list (`scripts/dataforseo-keywords.json`) is read by a fetch script (`scripts/dataforseo-keywords.mjs`) that calls the DataForSEO REST API (Basic Auth) for keyword overview, related keywords, and SERP data, then writes a combined JSON cache (`scripts/dataforseo-keywords-cache.json`). A new static Astro page reads that cache at build time — no runtime API calls, no live search box, no changes to `output: 'static'`. Pure data-shaping logic lives in a small helper module so it can be unit tested without network calls.

**Tech Stack:** Astro 5 (static output), Node.js `fetch`, `node:test` for unit tests, DataForSEO REST API v3.

**Reference spec:** `docs/superpowers/specs/2026-07-28-keyword-research-design.md`

---

### Task 1: Seed keyword list

**Files:**
- Create: `scripts/dataforseo-keywords.json`

- [ ] **Step 1: Create the seed list**

```json
[
  "web design merthyr tydfil",
  "seo services south wales",
  "ecommerce website cardiff",
  "web design swansea",
  "logo design merthyr tydfil"
]
```

This is a starting list Nathan can edit freely — plain array of keyword strings, no required structure beyond that.

- [ ] **Step 2: Commit**

```bash
git add scripts/dataforseo-keywords.json
git commit -m "feat: add DataForSEO seed keyword list"
```

---

### Task 2: Pure data-shaping helpers (TDD)

These are the only parts of the fetch pipeline that can be unit tested without hitting the real DataForSEO API, so they're built test-first.

**Files:**
- Create: `scripts/lib/dataforseo-helpers.mjs`
- Test: `tests/unit/dataforseo-helpers.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthHeader,
  mapKeywordOverviewItem,
  mapSerpItems,
  mapRelatedKeywordItem,
  dedupeRelatedKeywords,
} from '../../scripts/lib/dataforseo-helpers.mjs';

describe('buildAuthHeader', () => {
  test('builds a Basic auth header from login and password', () => {
    const header = buildAuthHeader('user@example.com', 'secret');
    const expected = 'Basic ' + Buffer.from('user@example.com:secret').toString('base64');
    assert.equal(header, expected);
  });
});

describe('mapKeywordOverviewItem', () => {
  test('extracts volume, cpc, competition, and difficulty', () => {
    const item = {
      keyword: 'web design merthyr tydfil',
      keyword_info: { search_volume: 90, cpc: 4.2, competition: 0.31 },
      keyword_properties: { keyword_difficulty: 18 },
    };
    assert.deepEqual(mapKeywordOverviewItem(item), {
      keyword: 'web design merthyr tydfil',
      volume: 90,
      cpc: 4.2,
      competition: 0.31,
      difficulty: 18,
    });
  });

  test('falls back to null when fields are missing', () => {
    const item = { keyword: 'no data keyword' };
    assert.deepEqual(mapKeywordOverviewItem(item), {
      keyword: 'no data keyword',
      volume: null,
      cpc: null,
      competition: null,
      difficulty: null,
    });
  });
});

describe('mapSerpItems', () => {
  test('keeps only organic results, up to the limit, mapped to position/domain/title/url', () => {
    const items = [
      { type: 'organic', rank_group: 1, domain: 'a.com', title: 'A', url: 'https://a.com' },
      { type: 'paid', rank_group: 1, domain: 'ad.com', title: 'Ad', url: 'https://ad.com' },
      { type: 'organic', rank_group: 2, domain: 'b.com', title: 'B', url: 'https://b.com' },
    ];
    assert.deepEqual(mapSerpItems(items, 10), [
      { position: 1, domain: 'a.com', title: 'A', url: 'https://a.com' },
      { position: 2, domain: 'b.com', title: 'B', url: 'https://b.com' },
    ]);
  });

  test('truncates to the given limit', () => {
    const items = [
      { type: 'organic', rank_group: 1, domain: 'a.com', title: 'A', url: 'https://a.com' },
      { type: 'organic', rank_group: 2, domain: 'b.com', title: 'B', url: 'https://b.com' },
    ];
    assert.equal(mapSerpItems(items, 1).length, 1);
  });

  test('handles an empty or missing list', () => {
    assert.deepEqual(mapSerpItems(undefined, 10), []);
    assert.deepEqual(mapSerpItems([], 10), []);
  });
});

describe('mapRelatedKeywordItem', () => {
  test('extracts related keyword data and tags it with the source keyword', () => {
    const item = {
      keyword_data: {
        keyword: 'web designer merthyr',
        keyword_info: { search_volume: 40, cpc: 3.9 },
        keyword_properties: { keyword_difficulty: 22 },
      },
    };
    assert.deepEqual(mapRelatedKeywordItem(item, 'web design merthyr tydfil'), {
      keyword: 'web designer merthyr',
      volume: 40,
      cpc: 3.9,
      difficulty: 22,
      sourceKeyword: 'web design merthyr tydfil',
    });
  });
});

describe('dedupeRelatedKeywords', () => {
  test('keeps the first occurrence of each keyword, case-insensitively', () => {
    const items = [
      { keyword: 'Web Designer Merthyr', volume: 40, cpc: 3.9, difficulty: 22, sourceKeyword: 'seed a' },
      { keyword: 'web designer merthyr', volume: 999, cpc: 999, difficulty: 99, sourceKeyword: 'seed b' },
      { keyword: 'another keyword', volume: 10, cpc: 1, difficulty: 5, sourceKeyword: 'seed a' },
    ];
    const result = dedupeRelatedKeywords(items);
    assert.equal(result.length, 2);
    assert.equal(result[0].sourceKeyword, 'seed a');
    assert.equal(result[1].keyword, 'another keyword');
  });

  test('drops entries with an empty keyword', () => {
    const items = [{ keyword: '  ', volume: null, cpc: null, difficulty: null, sourceKeyword: 'seed a' }];
    assert.deepEqual(dedupeRelatedKeywords(items), []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/unit/dataforseo-helpers.test.js`
Expected: FAIL — `Cannot find module '../../scripts/lib/dataforseo-helpers.mjs'`

- [ ] **Step 3: Implement the helpers**

```javascript
// scripts/lib/dataforseo-helpers.mjs

export function buildAuthHeader(login, password) {
  const token = Buffer.from(`${login}:${password}`).toString('base64');
  return `Basic ${token}`;
}

export function mapKeywordOverviewItem(item) {
  const info = item?.keyword_info ?? {};
  const props = item?.keyword_properties ?? {};
  return {
    keyword: item?.keyword ?? '',
    volume: info.search_volume ?? null,
    cpc: info.cpc ?? null,
    competition: info.competition ?? null,
    difficulty: props.keyword_difficulty ?? null,
  };
}

export function mapSerpItems(items, limit = 10) {
  return (items ?? [])
    .filter((item) => item?.type === 'organic')
    .slice(0, limit)
    .map((item) => ({
      position: item.rank_group ?? item.rank_absolute ?? null,
      domain: item.domain ?? '',
      title: item.title ?? '',
      url: item.url ?? '',
    }));
}

export function mapRelatedKeywordItem(item, sourceKeyword) {
  const data = item?.keyword_data ?? {};
  const info = data.keyword_info ?? {};
  const props = data.keyword_properties ?? {};
  return {
    keyword: data.keyword ?? '',
    volume: info.search_volume ?? null,
    cpc: info.cpc ?? null,
    difficulty: props.keyword_difficulty ?? null,
    sourceKeyword,
  };
}

export function dedupeRelatedKeywords(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.keyword.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, item);
  }
  return [...seen.values()];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/dataforseo-helpers.test.js`
Expected: PASS — all tests green, 0 failures

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/dataforseo-helpers.mjs tests/unit/dataforseo-helpers.test.js
git commit -m "feat: add DataForSEO response-shaping helpers with tests"
```

---

### Task 3: Fetch script

**Files:**
- Create: `scripts/dataforseo-keywords.mjs`
- Modify: `package.json:8-17` (add npm script)

- [ ] **Step 1: Write the script**

```javascript
/**
 * DataForSEO keyword research fetch.
 * Run: node scripts/dataforseo-keywords.mjs
 *
 * Reads scripts/dataforseo-keywords.json and writes scripts/dataforseo-keywords-cache.json.
 *
 * Requires:
 * - DATAFORSEO_LOGIN in .env or environment
 * - DATAFORSEO_PASSWORD in .env or environment
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildAuthHeader,
  mapKeywordOverviewItem,
  mapSerpItems,
  mapRelatedKeywordItem,
  dedupeRelatedKeywords,
} from './lib/dataforseo-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENV_PATH = path.join(__dirname, '..', '.env');
const SEED_PATH = path.join(__dirname, 'dataforseo-keywords.json');
const CACHE_PATH = path.join(__dirname, 'dataforseo-keywords-cache.json');
const BASE = 'https://api.dataforseo.com/v3';
const LOCATION_NAME = 'United Kingdom';
const LANGUAGE_CODE = 'en';
const RELATED_LIMIT = 20;
const SERP_LIMIT = 10;

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

function loadSeedKeywords() {
  if (!fs.existsSync(SEED_PATH)) {
    console.error(`
No seed keyword list found at scripts/dataforseo-keywords.json.

Create it with an array of keywords, e.g.:
["web design merthyr tydfil", "seo services south wales"]
`);
    process.exit(1);
  }
  const list = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  if (!Array.isArray(list) || list.length === 0) {
    console.error('scripts/dataforseo-keywords.json must be a non-empty array of keyword strings.');
    process.exit(1);
  }
  return list;
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
  if (!res.ok || (json.status_code && json.status_code >= 40000)) {
    const message = json.status_message || `${res.status} ${res.statusText}`;
    throw new Error(`${endpoint}: ${message}`);
  }
  return json;
}

async function fetchKeywordOverview(authHeader, keywords) {
  const json = await postTask(authHeader, 'dataforseo_labs/google/keyword_overview/live', [
    { keywords, location_name: LOCATION_NAME, language_code: LANGUAGE_CODE },
  ]);
  const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
  return items.map(mapKeywordOverviewItem);
}

async function fetchRelatedKeywords(authHeader, keyword) {
  try {
    const json = await postTask(authHeader, 'dataforseo_labs/google/related_keywords/live', [
      { keyword, location_name: LOCATION_NAME, language_code: LANGUAGE_CODE, limit: RELATED_LIMIT },
    ]);
    const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
    return items.map((item) => mapRelatedKeywordItem(item, keyword));
  } catch (err) {
    console.warn(`Related keywords failed for "${keyword}": ${err.message}`);
    return [];
  }
}

async function fetchSerp(authHeader, keyword) {
  try {
    const json = await postTask(authHeader, 'serp/google/organic/live/advanced', [
      { keyword, location_name: LOCATION_NAME, language_code: LANGUAGE_CODE, device: 'desktop', os: 'windows', depth: SERP_LIMIT },
    ]);
    const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
    return mapSerpItems(items, SERP_LIMIT);
  } catch (err) {
    console.warn(`SERP fetch failed for "${keyword}": ${err.message}`);
    return [];
  }
}

async function main() {
  const seedKeywords = loadSeedKeywords();
  const { login, password } = loadConfig();
  const authHeader = buildAuthHeader(login, password);

  console.log(`Fetching DataForSEO data for ${seedKeywords.length} seed keyword(s)...`);

  const overviewItems = await fetchKeywordOverview(authHeader, seedKeywords);
  const overviewByKeyword = new Map(overviewItems.map((item) => [item.keyword.trim().toLowerCase(), item]));

  const keywords = [];
  const relatedKeywordBatches = [];

  for (const keyword of seedKeywords) {
    const [serp, related] = await Promise.all([
      fetchSerp(authHeader, keyword),
      fetchRelatedKeywords(authHeader, keyword),
    ]);
    const overview = overviewByKeyword.get(keyword.trim().toLowerCase()) ?? {
      keyword,
      volume: null,
      cpc: null,
      competition: null,
      difficulty: null,
    };
    keywords.push({ ...overview, serp });
    relatedKeywordBatches.push(...related);
  }

  const relatedKeywords = dedupeRelatedKeywords(relatedKeywordBatches);

  const cache = {
    fetchedAt: new Date().toISOString(),
    location: LOCATION_NAME,
    language: 'English',
    keywords,
    relatedKeywords,
  };

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');

  console.log(`
Done.
  Seed keywords fetched: ${keywords.length}
  Related keyword ideas found: ${relatedKeywords.length}

Cache saved to: scripts/dataforseo-keywords-cache.json
`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the missing-credentials error path**

Run: `node scripts/dataforseo-keywords.mjs`
Expected (no `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` set and none in `.env` yet): exits non-zero and prints `DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD not found. Add them to .env or set them as environment variables.`

- [ ] **Step 3: Add the npm script**

In `package.json`, add this line inside `"scripts"`, alongside the existing `ahrefs:*`/`gsc:*` entries:

```json
    "dataforseo:keywords": "node scripts/dataforseo-keywords.mjs",
```

- [ ] **Step 4: Add real credentials to `.env` and do a live dry run**

Add to `.env` (not committed — `.env` is already gitignored):
```
DATAFORSEO_LOGIN=your-dataforseo-login
DATAFORSEO_PASSWORD=your-dataforseo-password
```

Run: `npm run dataforseo:keywords`
Expected: prints `Fetching DataForSEO data for 5 seed keyword(s)...` then `Done.` with counts, and creates `scripts/dataforseo-keywords-cache.json`. If any individual keyword's related-keywords or SERP call fails, a `Related keywords failed for "..."` or `SERP fetch failed for "..."` warning prints but the run still completes — verify this by checking the script continues past a warning rather than exiting non-zero.

If the response shapes from the live API don't match `mapKeywordOverviewItem`/`mapRelatedKeywordItem`/`mapSerpItems` (DataForSEO occasionally nests fields differently across account types), inspect the raw JSON with `console.log(JSON.stringify(json, null, 2))` temporarily inside `fetchKeywordOverview`/`fetchRelatedKeywords`/`fetchSerp`, adjust the mapping functions in `scripts/lib/dataforseo-helpers.mjs` to match, remove the temporary log, and re-run `node --test tests/unit/dataforseo-helpers.test.js` to confirm the unit tests still pass with the corrected field paths.

- [ ] **Step 5: Commit**

```bash
git add scripts/dataforseo-keywords.mjs package.json
git commit -m "feat: add DataForSEO keyword research fetch script"
```

`.env` is already gitignored. `scripts/dataforseo-keywords-cache.json` is not gitignored — matching `scripts/ahrefs-keywords-cache.json` and `scripts/gsc-report.json`, which are also generated but never committed. Just don't `git add` it; only stage `scripts/dataforseo-keywords.mjs` and `package.json` as shown above.

---

### Task 4: Admin page

**Files:**
- Create: `src/pages/admin/keyword-research.astro`

- [ ] **Step 1: Write the page**

```astro
---
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface SerpResult {
  position: number | null;
  domain: string;
  title: string;
  url: string;
}

interface KeywordRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  serp: SerpResult[];
}

interface RelatedKeywordRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  difficulty: number | null;
  sourceKeyword: string;
}

interface DataForSeoCache {
  fetchedAt?: string;
  location?: string;
  language?: string;
  keywords?: KeywordRow[];
  relatedKeywords?: RelatedKeywordRow[];
}

const CACHE_PATH = join(process.cwd(), 'scripts/dataforseo-keywords-cache.json');
const cache: DataForSeoCache = existsSync(CACHE_PATH)
  ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  : {};

const keywords = cache.keywords ?? [];
const relatedKeywords = cache.relatedKeywords ?? [];
const hasData = Boolean(cache.fetchedAt);

const volumes = keywords.map((row) => row.volume).filter((v): v is number => v !== null);
const totalVolume = volumes.reduce((sum, v) => sum + v, 0);
const difficulties = keywords.map((row) => row.difficulty).filter((d): d is number => d !== null);
const avgDifficulty = difficulties.length
  ? difficulties.reduce((sum, d) => sum + d, 0) / difficulties.length
  : null;

function fmtDate(value?: string | null) {
  if (!value) return 'Not refreshed yet';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtNumber(value?: number | null) {
  return value === null || value === undefined ? '-' : value.toLocaleString();
}

function fmtCpc(value?: number | null) {
  return value === null || value === undefined ? '-' : `£${value.toFixed(2)}`;
}

function fmtCompetition(value?: number | null) {
  return value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`;
}
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Keyword Research | NC Digital Admin</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #090911;
        --panel: #11111c;
        --border: #25253a;
        --text: #f7f7fb;
        --muted: #a6a6bb;
        --purple: #8750f7;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: Sora, Inter, system-ui, -apple-system, Segoe UI, sans-serif;
      }
      a { color: inherit; }
      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        padding: 1rem 1.5rem;
        background: rgba(9, 9, 17, 0.94);
        border-bottom: 1px solid var(--border);
        backdrop-filter: blur(10px);
      }
      .brand { font-weight: 800; }
      .nav { display: flex; gap: 0.5rem; flex-wrap: wrap; }
      .nav a {
        text-decoration: none;
        color: var(--muted);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 0.55rem 0.8rem;
        font-size: 0.82rem;
        font-weight: 700;
      }
      .nav a.active { color: var(--text); background: var(--purple); border-color: var(--purple); }
      main { width: min(100% - 3rem, 1600px); margin: 0 auto; padding: 2rem 0 4rem; }
      .hero { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; margin-bottom: 1.5rem; }
      h1 { margin: 0 0 0.5rem; font-size: clamp(2rem, 4vw, 3.4rem); letter-spacing: -0.04em; }
      .sub { color: var(--muted); line-height: 1.6; margin: 0; max-width: 780px; }
      .cmd {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 0.85rem 1rem;
        color: var(--muted);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 0.8rem;
        white-space: nowrap;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 1rem;
        margin: 1.5rem 0;
      }
      .stat {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 1rem;
      }
      .label { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800; }
      .value { font-size: 1.7rem; font-weight: 900; margin-top: 0.4rem; letter-spacing: -0.03em; }
      .panel-title {
        font-size: 1.3rem;
        font-weight: 900;
        margin: 2rem 0 0.75rem;
        letter-spacing: -0.02em;
      }
      .filters {
        display: flex;
        gap: 0.75rem;
        margin: 1rem 0;
        flex-wrap: wrap;
      }
      .filters input, .filters button {
        background: var(--panel);
        border: 1px solid var(--border);
        color: var(--text);
        border-radius: 8px;
        padding: 0.75rem 0.9rem;
        font: inherit;
      }
      .filters input { min-width: min(260px, 100%); flex: 1; }
      .filters input[type="number"] { flex: 0 0 140px; min-width: 0; }
      .filters button { cursor: pointer; font-weight: 800; }
      .filters button:hover, .filters button:focus-visible { border-color: var(--purple); background: #171728; outline: none; }
      .table-shell {
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: auto;
        background: var(--panel);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.18);
      }
      table { width: 100%; border-collapse: collapse; background: var(--panel); }
      th, td {
        padding: 0.7rem 0.85rem;
        border-bottom: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
        font-size: 0.82rem;
      }
      th {
        position: sticky;
        top: 0;
        z-index: 2;
        background: #0d0d16;
        color: var(--muted);
        font-size: 0.66rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      tr:last-child td { border-bottom: 0; }
      tbody tr:hover td { background: #151522; }
      .sort-button {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-weight: inherit;
        text-transform: inherit;
        letter-spacing: inherit;
        cursor: pointer;
        white-space: nowrap;
      }
      .sort-button::after { content: '↕'; color: #66667d; }
      .sort-button[data-direction="asc"]::after { content: '↑'; color: var(--purple); }
      .sort-button[data-direction="desc"]::after { content: '↓'; color: var(--purple); }
      .keyword { font-weight: 800; }
      .muted { color: var(--muted); }
      details.serp-details { margin-top: 0.4rem; }
      details.serp-details summary {
        cursor: pointer;
        color: var(--purple);
        font-size: 0.72rem;
        font-weight: 800;
        list-style: none;
      }
      details.serp-details summary::-webkit-details-marker { display: none; }
      .serp-table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
      .serp-table th, .serp-table td {
        padding: 0.4rem 0.5rem;
        font-size: 0.74rem;
        border-bottom: 1px solid var(--border);
      }
      .serp-table .domain { font-weight: 800; display: block; }
      .serp-table .url {
        display: block;
        color: var(--muted);
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .empty {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 2rem;
        color: var(--muted);
      }
      code { color: var(--text); }
      @media (max-width: 960px) {
        .topbar { align-items: flex-start; padding: 0.75rem; }
        .brand { display: none; }
        .nav { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; }
        .nav a { padding: 0.5rem 0.25rem; text-align: center; font-size: 0.66rem; }
        main { width: auto; padding: 1.25rem 0.75rem 3rem; }
        .hero { display: block; }
        h1 { font-size: 1.8rem; }
        .sub { font-size: 0.85rem; }
        .cmd { display: none; }
        .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; margin: 1rem 0; }
        .stat { padding: 0.75rem; }
        .label { font-size: 0.62rem; }
        .value { font-size: 1.35rem; }
        .filters input, .filters button { width: 100%; min-width: 0; }
        .filters input[type="number"] { flex: 1 1 auto; }
        table, tbody, tr, td { display: block; width: 100%; }
        table { border: 0; background: transparent; }
        thead { display: none; }
        tbody { display: grid; gap: 0.6rem; padding: 0.6rem; }
        tr { display: grid; gap: 0.4rem; padding: 0.75rem; background: #0d0d16; border: 1px solid var(--border); border-radius: 8px; }
        td {
          display: grid;
          grid-template-columns: 6rem minmax(0, 1fr);
          gap: 0.5rem;
          border: 0;
          padding: 0.15rem 0;
          font-size: 0.78rem;
        }
        td::before {
          content: attr(data-label);
          color: var(--muted);
          font-size: 0.6rem;
          font-weight: 800;
          text-transform: uppercase;
        }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="brand">NC Digital Admin</div>
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/">Keywords</a>
        <a href="/admin/keyword-research/" class="active">Keyword Research</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
      </nav>
    </header>

    <main>
      <section class="hero">
        <div>
          <h1>Keyword Research</h1>
          <p class="sub">
            DataForSEO search volume, CPC, competition, and difficulty for your seed keyword list, plus related keyword ideas and top-10 SERP competitors for each. Refresh whenever you want current data rebuilt and deployed.
          </p>
        </div>
        <div class="cmd">node scripts/dataforseo-keywords.mjs && npm run build && npx wrangler deploy</div>
      </section>

      {!hasData ? (
        <div class="empty">
          No DataForSEO cache found yet. Add <code>DATAFORSEO_LOGIN</code> and <code>DATAFORSEO_PASSWORD</code> to your <code>.env</code>, list keywords in <code>scripts/dataforseo-keywords.json</code>, then run <code>node scripts/dataforseo-keywords.mjs</code> and rebuild.
        </div>
      ) : (
        <>
          <section class="stats">
            <div class="stat">
              <div class="label">Last Refresh</div>
              <div class="value" style="font-size:1rem;">{fmtDate(cache.fetchedAt)}</div>
            </div>
            <div class="stat">
              <div class="label">Tracked Keywords</div>
              <div class="value">{keywords.length}</div>
            </div>
            <div class="stat">
              <div class="label">Total Search Volume</div>
              <div class="value">{fmtNumber(totalVolume)}</div>
            </div>
            <div class="stat">
              <div class="label">Average Difficulty</div>
              <div class="value">{avgDifficulty === null ? '-' : avgDifficulty.toFixed(0)}</div>
            </div>
          </section>

          <h2 class="panel-title">Seed Keywords</h2>
          <div class="filters">
            <input id="seed-search" type="search" placeholder="Search keywords or ranking domains" />
            <input id="seed-min-volume" type="number" min="0" placeholder="Min volume" />
            <input id="seed-max-difficulty" type="number" min="0" max="100" placeholder="Max difficulty" />
            <button id="seed-reset" type="button">Reset filters</button>
          </div>

          {keywords.length ? (
            <div class="table-shell">
              <table id="seed-keywords">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th><button class="sort-button" type="button" data-sort="volume" data-type="number">Volume</button></th>
                    <th><button class="sort-button" type="button" data-sort="cpc" data-type="number">CPC</button></th>
                    <th><button class="sort-button" type="button" data-sort="competition" data-type="number">Competition</button></th>
                    <th><button class="sort-button" type="button" data-sort="difficulty" data-type="number">Difficulty</button></th>
                    <th>Top Ranking Domain</th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((row) => (
                    <tr
                      data-search={`${row.keyword} ${row.serp.map((s) => s.domain).join(' ')}`.toLowerCase()}
                      data-volume={row.volume ?? ''}
                      data-cpc={row.cpc ?? ''}
                      data-competition={row.competition ?? ''}
                      data-difficulty={row.difficulty ?? ''}
                    >
                      <td data-label="Keyword">
                        <span class="keyword">{row.keyword}</span>
                        {row.serp.length > 0 && (
                          <details class="serp-details">
                            <summary>View top {row.serp.length} SERP results</summary>
                            <table class="serp-table">
                              <thead><tr><th>#</th><th>Domain</th><th>Title</th></tr></thead>
                              <tbody>
                                {row.serp.map((result) => (
                                  <tr>
                                    <td>{fmtNumber(result.position)}</td>
                                    <td>
                                      <span class="domain">{result.domain}</span>
                                      <a class="url" href={result.url} target="_blank" rel="noopener">{result.url}</a>
                                    </td>
                                    <td class="muted">{result.title}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        )}
                      </td>
                      <td data-label="Volume">{fmtNumber(row.volume)}</td>
                      <td data-label="CPC">{fmtCpc(row.cpc)}</td>
                      <td data-label="Competition">{fmtCompetition(row.competition)}</td>
                      <td data-label="Difficulty">{fmtNumber(row.difficulty)}</td>
                      <td data-label="Top Domain">
                        {row.serp[0] ? <span class="muted">{row.serp[0].domain}</span> : <span class="muted">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div class="empty">No seed keywords in the cache yet.</div>
          )}

          <h2 class="panel-title">Related Keyword Ideas</h2>
          <div class="filters">
            <input id="related-search" type="search" placeholder="Search related keywords or source keyword" />
            <button id="related-reset" type="button">Reset filters</button>
          </div>

          {relatedKeywords.length ? (
            <div class="table-shell">
              <table id="related-keywords">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th><button class="sort-button" type="button" data-sort="volume" data-type="number">Volume</button></th>
                    <th><button class="sort-button" type="button" data-sort="cpc" data-type="number">CPC</button></th>
                    <th><button class="sort-button" type="button" data-sort="difficulty" data-type="number">Difficulty</button></th>
                    <th>Found Via</th>
                  </tr>
                </thead>
                <tbody>
                  {relatedKeywords.map((row) => (
                    <tr
                      data-search={`${row.keyword} ${row.sourceKeyword}`.toLowerCase()}
                      data-volume={row.volume ?? ''}
                      data-cpc={row.cpc ?? ''}
                      data-difficulty={row.difficulty ?? ''}
                    >
                      <td data-label="Keyword"><span class="keyword">{row.keyword}</span></td>
                      <td data-label="Volume">{fmtNumber(row.volume)}</td>
                      <td data-label="CPC">{fmtCpc(row.cpc)}</td>
                      <td data-label="Difficulty">{fmtNumber(row.difficulty)}</td>
                      <td data-label="Found Via"><span class="muted">{row.sourceKeyword}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div class="empty">No related keyword ideas in the cache yet.</div>
          )}
        </>
      )}
    </main>

    <script>
      function setupTable({ tableId, searchId, resetId, minVolumeId, maxDifficultyId }: {
        tableId: string;
        searchId: string;
        resetId: string;
        minVolumeId?: string;
        maxDifficultyId?: string;
      }) {
        const table = document.getElementById(tableId);
        if (!table) return;
        const search = document.getElementById(searchId) as HTMLInputElement | null;
        const reset = document.getElementById(resetId);
        const minVolume = minVolumeId ? (document.getElementById(minVolumeId) as HTMLInputElement | null) : null;
        const maxDifficulty = maxDifficultyId ? (document.getElementById(maxDifficultyId) as HTMLInputElement | null) : null;
        const tbody = table.querySelector('tbody');
        const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'));
        const sortButtons = Array.from(table.querySelectorAll<HTMLButtonElement>('.sort-button'));

        function applyFilters() {
          const q = search?.value.trim().toLowerCase() || '';
          const minVol = minVolume?.value ? Number(minVolume.value) : null;
          const maxDiff = maxDifficulty?.value ? Number(maxDifficulty.value) : null;
          for (const row of rows) {
            const matchesQuery = !q || (row.dataset.search ?? '').includes(q);
            const volume = row.dataset.volume ? Number(row.dataset.volume) : null;
            const difficulty = row.dataset.difficulty ? Number(row.dataset.difficulty) : null;
            const matchesVolume = minVol === null || (volume !== null && volume >= minVol);
            const matchesDifficulty = maxDiff === null || (difficulty !== null && difficulty <= maxDiff);
            row.style.display = matchesQuery && matchesVolume && matchesDifficulty ? '' : 'none';
          }
        }

        search?.addEventListener('input', applyFilters);
        minVolume?.addEventListener('input', applyFilters);
        maxDifficulty?.addEventListener('input', applyFilters);
        reset?.addEventListener('click', () => {
          if (search) search.value = '';
          if (minVolume) minVolume.value = '';
          if (maxDifficulty) maxDifficulty.value = '';
          for (const button of sortButtons) delete button.dataset.direction;
          for (const row of rows) tbody?.appendChild(row);
          applyFilters();
        });

        for (const button of sortButtons) {
          button.addEventListener('click', () => {
            const key = button.dataset.sort as string;
            const type = button.dataset.type;
            const direction = button.dataset.direction === 'asc' ? 'desc' : 'asc';
            for (const other of sortButtons) delete other.dataset.direction;
            button.dataset.direction = direction;
            rows.sort((a, b) => {
              const aRaw = a.dataset[key] ?? '';
              const bRaw = b.dataset[key] ?? '';
              const aEmpty = aRaw === '';
              const bEmpty = bRaw === '';
              if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
              if (aEmpty && bEmpty) return 0;
              const comparison = type === 'number'
                ? Number(aRaw) - Number(bRaw)
                : aRaw.localeCompare(bRaw);
              return direction === 'asc' ? comparison : -comparison;
            });
            for (const row of rows) tbody?.appendChild(row);
          });
        }
      }

      setupTable({
        tableId: 'seed-keywords',
        searchId: 'seed-search',
        resetId: 'seed-reset',
        minVolumeId: 'seed-min-volume',
        maxDifficultyId: 'seed-max-difficulty',
      });
      setupTable({
        tableId: 'related-keywords',
        searchId: 'related-search',
        resetId: 'related-reset',
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Verify the empty state builds**

With no `scripts/dataforseo-keywords-cache.json` present, run: `npm run build`
Expected: build succeeds (exit code 0), and `dist/admin/keyword-research/index.html` contains the "No DataForSEO cache found yet" empty-state message.

- [ ] **Step 3: Verify the populated state builds**

Temporarily create a minimal `scripts/dataforseo-keywords-cache.json` for this check:

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
        { "position": 1, "domain": "example.com", "title": "Example", "url": "https://example.com" }
      ]
    }
  ],
  "relatedKeywords": [
    { "keyword": "web designer merthyr", "volume": 40, "cpc": 3.9, "difficulty": 22, "sourceKeyword": "web design merthyr tydfil" }
  ]
}
```

Run: `npm run build`
Expected: build succeeds, and `dist/admin/keyword-research/index.html` contains `Tracked Keywords`, the keyword row, and the related keyword row.

Delete this temporary cache file afterward (`rm scripts/dataforseo-keywords-cache.json` or restore whatever real cache existed) unless you already have a real one from Task 3 Step 4.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/keyword-research.astro
git commit -m "feat: add DataForSEO keyword research admin page"
```

---

### Task 5: Add nav links across existing admin pages

**Files:**
- Modify: `src/pages/admin/keywords.astro:477-483`
- Modify: `src/pages/admin/gsc.astro:391-397`
- Modify: `src/pages/admin/indexing.astro` (nav block, same shape as the above two)
- Modify: `src/pages/admin/backlinks.astro:106-116`
- Modify: `src/pages/admin/links.astro:442-452`

- [ ] **Step 1: Update `keywords.astro`**

Find:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/" class="active">Keywords</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
      </nav>
```
Replace with:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/" class="active">Keywords</a>
        <a href="/admin/keyword-research/">Keyword Research</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
      </nav>
```

- [ ] **Step 2: Update `gsc.astro`**

Find:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/">Keywords</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/" class="active">GSC</a>
      </nav>
```
Replace with:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/">Keywords</a>
        <a href="/admin/keyword-research/">Keyword Research</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/" class="active">GSC</a>
      </nav>
```

- [ ] **Step 3: Update `indexing.astro`**

Find the equivalent nav block (same five links, with `class="active"` on the Indexing link):
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/">Keywords</a>
        <a href="/admin/indexing/" class="active">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
      </nav>
```
Replace with:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/">Keywords</a>
        <a href="/admin/keyword-research/">Keyword Research</a>
        <a href="/admin/indexing/" class="active">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
      </nav>
```

- [ ] **Step 4: Update `backlinks.astro`**

Find:
```astro
    <a href="/admin/links/">Internal Links →</a>
    <a href="/admin/keywords/">Keywords →</a>
    <a href="/admin/indexing/">Indexing →</a>
    <a href="/admin/gsc/">GSC →</a>
    <a href="/">← Back to site</a>
```
Replace with:
```astro
    <a href="/admin/links/">Internal Links →</a>
    <a href="/admin/keywords/">Keywords →</a>
    <a href="/admin/keyword-research/">Keyword Research →</a>
    <a href="/admin/indexing/">Indexing →</a>
    <a href="/admin/gsc/">GSC →</a>
    <a href="/">← Back to site</a>
```

- [ ] **Step 5: Update `links.astro`**

Find:
```astro
    <a href="/admin/backlinks/">Backlinks →</a>
    <a href="/admin/keywords/">Keywords →</a>
    <a href="/admin/indexing/">Indexing →</a>
    <a href="/admin/gsc/">GSC →</a>
    <a href="/">← Back to site</a>
```
Replace with:
```astro
    <a href="/admin/backlinks/">Backlinks →</a>
    <a href="/admin/keywords/">Keywords →</a>
    <a href="/admin/keyword-research/">Keyword Research →</a>
    <a href="/admin/indexing/">Indexing →</a>
    <a href="/admin/gsc/">GSC →</a>
    <a href="/">← Back to site</a>
```

- [ ] **Step 6: Build and spot-check**

Run: `npm run build`
Expected: build succeeds; grep the output for the new link:

```bash
grep -l "keyword-research" dist/admin/keywords/index.html dist/admin/gsc/index.html dist/admin/indexing/index.html dist/admin/backlinks/index.html dist/admin/links/index.html
```
Expected: all five files listed.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/keywords.astro src/pages/admin/gsc.astro src/pages/admin/indexing.astro src/pages/admin/backlinks.astro src/pages/admin/links.astro
git commit -m "feat: link Keyword Research from existing admin pages"
```

---

### Task 6: Full verification pass

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run test:unit`
Expected: all tests pass, including `tests/unit/worker.test.js` and the new `tests/unit/dataforseo-helpers.test.js`.

- [ ] **Step 2: Run a full production build**

Run: `npm run build`
Expected: exit code 0, no Astro/TypeScript errors.

- [ ] **Step 3: Preview locally and check the new page**

Run: `npm run preview`
Visit `http://localhost:4321/admin/keyword-research/` (port may differ — check the terminal output) and confirm:
- If a real cache exists (from Task 3 Step 4), the stats row, seed keyword table, and related keyword table all render with data, sorting and filtering work, and the SERP `<details>` disclosure expands per row.
- Every other `/admin/*` page's nav now includes a working "Keyword Research" link.

- [ ] **Step 4: Deploy**

Run: `npx wrangler deploy`
Expected: deploy succeeds; confirm `https://nc-digital.co.uk/admin/keyword-research/` loads (behind existing `/admin/*` auth).
