# EMD Domain Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new static admin page at `/admin/emd-finder/` that checks every trade × South Wales town combination for (a) whether the exact-match `.co.uk` domain is available to register (via free Nominet RDAP lookups) and (b) real search demand for that phrase (via the existing DataForSEO integration), so Nathan can prioritize rank-and-rent domain purchases by genuine opportunity.

**Architecture:** A seed file (`scripts/emd-finder-seed.json`) lists trades and towns. A fetch script (`scripts/emd-finder.mjs`) builds all combos, checks each domain's availability via Nominet's public RDAP service, fetches search volume/CPC/difficulty for all combos in a single bulk DataForSEO call (reusing `mapKeywordOverviewItem` from the existing `scripts/lib/dataforseo-helpers.mjs`), and writes a combined cache. A new static Astro page reads that cache at build time — same pattern as every other admin page on this site. Pure combo-building and RDAP-response-interpretation logic lives in a small helper module, unit tested.

**Tech Stack:** Astro 5 (static output), Node.js `fetch`, `node:test`, DataForSEO REST API v3 (already integrated), Nominet RDAP (`rdap.nominet.uk`).

**Reference spec:** `docs/superpowers/specs/2026-07-28-emd-finder-design.md`

**Existing prerequisites already in place (nothing to set up):** `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` are already in `.env` (added for the keyword research feature), and `scripts/lib/dataforseo-helpers.mjs` already exports `buildAuthHeader` and `mapKeywordOverviewItem`.

---

### Task 1: Seed file

**Files:**
- Create: `scripts/emd-finder-seed.json`

- [ ] **Step 1: Create the seed file**

```json
{
  "trades": [
    "plumber",
    "electrician",
    "roofer",
    "locksmith",
    "gardener",
    "carpet cleaner",
    "driveway paving",
    "tree surgeon",
    "pest control",
    "heating engineer",
    "window cleaner",
    "skip hire"
  ],
  "towns": [
    "aberdare",
    "abergavenny",
    "ammanford",
    "bargoed",
    "barry",
    "blackwood",
    "brecon",
    "bridgend",
    "caerphilly",
    "cardiff",
    "carmarthen",
    "chepstow",
    "cwmbran",
    "ebbw-vale",
    "llandeilo",
    "llanelli",
    "maesteg",
    "merthyr-tydfil",
    "monmouth",
    "neath",
    "newport",
    "penarth",
    "pontypool",
    "pontypridd",
    "port-talbot",
    "porthcawl",
    "rhondda",
    "swansea",
    "tredegar"
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/emd-finder-seed.json
git commit -m "feat: add EMD finder trade and town seed lists"
```

---

### Task 2: Pure combo-building helpers (TDD)

**Files:**
- Create: `scripts/lib/emd-finder-helpers.mjs`
- Test: `tests/unit/emd-finder-helpers.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDomain,
  buildPhrase,
  buildCombos,
  interpretRdapStatus,
} from '../../scripts/lib/emd-finder-helpers.mjs';

describe('buildDomain', () => {
  test('strips hyphens from the town and joins with the trade', () => {
    assert.equal(buildDomain('plumber', 'merthyr-tydfil'), 'merthyrtydfilplumber.co.uk');
  });

  test('strips spaces from multi-word trades', () => {
    assert.equal(buildDomain('carpet cleaner', 'port-talbot'), 'porttalbotcarpetcleaner.co.uk');
  });

  test('lowercases everything', () => {
    assert.equal(buildDomain('Plumber', 'Merthyr-Tydfil'), 'merthyrtydfilplumber.co.uk');
  });
});

describe('buildPhrase', () => {
  test('joins trade and town with town hyphens turned to spaces', () => {
    assert.equal(buildPhrase('plumber', 'merthyr-tydfil'), 'plumber merthyr tydfil');
  });

  test('leaves multi-word trades as-is', () => {
    assert.equal(buildPhrase('carpet cleaner', 'port-talbot'), 'carpet cleaner port talbot');
  });
});

describe('buildCombos', () => {
  test('builds one combo per trade/town pair with domain and phrase', () => {
    const combos = buildCombos(['plumber', 'roofer'], ['cardiff', 'newport']);
    assert.equal(combos.length, 4);
    assert.deepEqual(combos[0], {
      trade: 'plumber',
      town: 'cardiff',
      domain: 'cardiffplumber.co.uk',
      phrase: 'plumber cardiff',
    });
  });

  test('returns an empty array for empty inputs', () => {
    assert.deepEqual(buildCombos([], []), []);
    assert.deepEqual(buildCombos(['plumber'], []), []);
  });
});

describe('interpretRdapStatus', () => {
  test('404 means the domain is available', () => {
    assert.equal(interpretRdapStatus(404), true);
  });

  test('200 means the domain is registered/taken', () => {
    assert.equal(interpretRdapStatus(200), false);
  });

  test('any other status is unknown', () => {
    assert.equal(interpretRdapStatus(500), null);
    assert.equal(interpretRdapStatus(403), null);
    assert.equal(interpretRdapStatus(429), null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/unit/emd-finder-helpers.test.js`
Expected: FAIL — `Cannot find module '../../scripts/lib/emd-finder-helpers.mjs'`

- [ ] **Step 3: Implement the helpers**

```javascript
// scripts/lib/emd-finder-helpers.mjs

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function buildDomain(trade, town) {
  return `${slug(town)}${slug(trade)}.co.uk`;
}

export function buildPhrase(trade, town) {
  return `${trade} ${town.replace(/-/g, ' ')}`;
}

export function buildCombos(trades, towns) {
  const combos = [];
  for (const town of towns) {
    for (const trade of trades) {
      combos.push({
        trade,
        town,
        domain: buildDomain(trade, town),
        phrase: buildPhrase(trade, town),
      });
    }
  }
  return combos;
}

export function interpretRdapStatus(status) {
  if (status === 404) return true;
  if (status === 200) return false;
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/emd-finder-helpers.test.js`
Expected: PASS — all tests green, 0 failures

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/emd-finder-helpers.mjs tests/unit/emd-finder-helpers.test.js
git commit -m "feat: add EMD finder combo-building helpers with tests"
```

---

### Task 3: Fetch script

**Files:**
- Create: `scripts/emd-finder.mjs`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: Sanity-check the RDAP endpoint assumption before writing the full script**

The design spec flags that `https://rdap.nominet.uk/uk/domain/{domain}` returning 404-for-available/200-for-registered is based on Nominet's published docs, not a live-verified response. Confirm it now with two real requests:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://rdap.nominet.uk/uk/domain/nc-digital.co.uk
curl -s -o /dev/null -w "%{http_code}\n" https://rdap.nominet.uk/uk/domain/zzqxvthisdomainprobablydoesnotexist12345.co.uk
```

Expected: the first (a real, registered domain Nathan owns) returns `200`; the second (an implausible random string) returns `404`. If either comes back differently (e.g. a redirect, a different registered-domain code, or the endpoint doesn't resolve at all), STOP and report BLOCKED with the actual response — don't proceed with a script built on an unconfirmed assumption. If both match, continue to Step 2.

- [ ] **Step 2: Write the script**

```javascript
/**
 * EMD (exact-match-domain) finder for rank-and-rent.
 * Run: node scripts/emd-finder.mjs
 *
 * Reads scripts/emd-finder-seed.json and writes scripts/emd-finder-cache.json.
 *
 * Requires:
 * - DATAFORSEO_LOGIN in .env or environment
 * - DATAFORSEO_PASSWORD in .env or environment
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAuthHeader, mapKeywordOverviewItem } from './lib/dataforseo-helpers.mjs';
import { buildCombos, interpretRdapStatus } from './lib/emd-finder-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENV_PATH = path.join(__dirname, '..', '.env');
const SEED_PATH = path.join(__dirname, 'emd-finder-seed.json');
const CACHE_PATH = path.join(__dirname, 'emd-finder-cache.json');
const BASE = 'https://api.dataforseo.com/v3';
const LOCATION_NAME = 'United Kingdom';
const LANGUAGE_CODE = 'en';
const RDAP_DELAY_MS = 200;

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

function loadSeed() {
  if (!fs.existsSync(SEED_PATH)) {
    console.error(`
No seed file found at scripts/emd-finder-seed.json.

Create it with "trades" and "towns" arrays, e.g.:
{"trades": ["plumber"], "towns": ["merthyr-tydfil"]}
`);
    process.exit(1);
  }
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const trades = seed.trades;
  const towns = seed.towns;
  if (!Array.isArray(trades) || trades.length === 0 || !Array.isArray(towns) || towns.length === 0) {
    console.error('scripts/emd-finder-seed.json must have non-empty "trades" and "towns" arrays.');
    process.exit(1);
  }
  return { trades, towns };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkAvailability(domain) {
  try {
    const res = await fetch(`https://rdap.nominet.uk/uk/domain/${domain}`);
    return interpretRdapStatus(res.status);
  } catch (err) {
    console.warn(`RDAP check failed for "${domain}": ${err.message}`);
    return null;
  }
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

async function fetchKeywordOverview(authHeader, phrases) {
  const json = await postTask(authHeader, 'dataforseo_labs/google/keyword_overview/live', [
    { keywords: phrases, location_name: LOCATION_NAME, language_code: LANGUAGE_CODE },
  ]);
  const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
  return items.map(mapKeywordOverviewItem);
}

async function main() {
  const { trades, towns } = loadSeed();
  const { login, password } = loadConfig();
  const authHeader = buildAuthHeader(login, password);
  const combos = buildCombos(trades, towns);

  console.log(`Checking ${combos.length} trade/town combo(s)...`);

  for (const combo of combos) {
    combo.available = await checkAvailability(combo.domain);
    await sleep(RDAP_DELAY_MS);
  }

  const overviewItems = await fetchKeywordOverview(authHeader, combos.map((c) => c.phrase));
  const overviewByPhrase = new Map(overviewItems.map((item) => [item.keyword.trim().toLowerCase(), item]));

  if (overviewItems.length > 0 && overviewItems.every((item) => item.volume === null)) {
    console.warn('Every combo came back with volume: null. This usually means the DataForSEO response shape has changed, not that these phrases genuinely have zero volume.');
  }

  const results = combos.map((combo) => {
    const overview = overviewByPhrase.get(combo.phrase.trim().toLowerCase());
    return {
      trade: combo.trade,
      town: combo.town,
      domain: combo.domain,
      available: combo.available,
      volume: overview?.volume ?? null,
      cpc: overview?.cpc ?? null,
      difficulty: overview?.difficulty ?? null,
    };
  });

  const cache = {
    fetchedAt: new Date().toISOString(),
    combos: results,
  };

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');

  const availableCount = results.filter((r) => r.available === true).length;
  const opportunityCount = results.filter((r) => r.available === true && r.volume !== null && r.volume > 0).length;

  console.log(`
Done.
  Combos checked: ${results.length}
  Domains available: ${availableCount}
  Opportunities (available + has search volume): ${opportunityCount}

Cache saved to: scripts/emd-finder-cache.json
`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add this line inside `"scripts"`, alongside `dataforseo:keywords`:

```json
    "emd:finder": "node scripts/emd-finder.mjs",
```

- [ ] **Step 4: Run the full script for real**

Real `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` credentials already exist in `.env` from the keyword research feature, so this can be run for real (no adjustment needed this time). This will make 348 free RDAP requests (sequentially, ~200ms apart — expect roughly 1-2 minutes) plus one DataForSEO bulk call.

Run: `npm run emd:finder`
Expected: prints `Checking 348 trade/town combo(s)...`, then eventually `Done.` with counts for combos checked, domains available, and opportunities. Confirm `scripts/emd-finder-cache.json` was created, and spot-check a few entries — do the `available` values look plausible (some `true`, most `false` for a set this size, since most short generic-sounding `.co.uk` domains are already registered)? Do the `volume`/`cpc`/`difficulty` fields have real (non-null) values for at least some combos?

If any individual RDAP check fails, a `RDAP check failed for "..."` warning should print but the run should still complete — verify this doesn't happen for more than a handful of combos (occasional transient failures are expected and fine, matching the pattern already seen with DataForSEO SERP calls in the keyword research feature).

- [ ] **Step 5: Commit**

```bash
git add scripts/emd-finder.mjs package.json
git commit -m "feat: add EMD finder fetch script"
```

`scripts/emd-finder-cache.json` is not gitignored but is never committed, same convention as the other cache files (`scripts/ahrefs-keywords-cache.json`, `scripts/dataforseo-keywords-cache.json`). Do not `git add` it.

---

### Task 4: Admin page

**Files:**
- Create: `src/pages/admin/emd-finder.astro`

- [ ] **Step 1: Write the page**

```astro
---
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ComboRow {
  trade: string;
  town: string;
  domain: string;
  available: boolean | null;
  volume: number | null;
  cpc: number | null;
  difficulty: number | null;
}

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

const availableCount = combos.filter((c) => c.available === true).length;
const opportunityCount = combos.filter((c) => c.available === true && c.volume !== null && c.volume > 0).length;

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

function availabilityLabel(value: boolean | null) {
  return value === true ? 'Available' : value === false ? 'Taken' : 'Unknown';
}

function availabilityClass(value: boolean | null) {
  return value === true ? 'available' : value === false ? 'taken' : 'unknown';
}
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EMD Finder | NC Digital Admin</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #090911;
        --panel: #11111c;
        --border: #25253a;
        --text: #f7f7fb;
        --muted: #a6a6bb;
        --purple: #8750f7;
        --green: #2dd77c;
        --red: #ff5c7a;
        --amber: #f6c85f;
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
      main { width: min(100% - 3rem, 1400px); margin: 0 auto; padding: 2rem 0 4rem; }
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
        grid-template-columns: repeat(3, minmax(0, 1fr));
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
      .filters {
        display: flex;
        gap: 0.75rem;
        margin: 1rem 0;
        flex-wrap: wrap;
        align-items: center;
      }
      .filters input, .filters button {
        background: var(--panel);
        border: 1px solid var(--border);
        color: var(--text);
        border-radius: 8px;
        padding: 0.75rem 0.9rem;
        font: inherit;
      }
      .filters input[type="search"] { min-width: min(260px, 100%); flex: 1; }
      .filters input[type="number"] { flex: 0 0 140px; min-width: 0; }
      .filters button { cursor: pointer; font-weight: 800; }
      .filters button:hover, .filters button:focus-visible { border-color: var(--purple); background: #171728; outline: none; }
      .checkbox-label {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--muted);
        font-size: 0.85rem;
        font-weight: 700;
        white-space: nowrap;
      }
      .checkbox-label input[type="checkbox"] { width: 1.1rem; height: 1.1rem; accent-color: var(--purple); }
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
      tbody tr.opportunity td:first-child { box-shadow: inset 3px 0 0 var(--green); }
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
      .domain { font-weight: 800; }
      .muted { color: var(--muted); }
      .pill {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--border);
        color: var(--muted);
        border-radius: 999px;
        padding: 0.25rem 0.55rem;
        font-size: 0.7rem;
        font-weight: 800;
        white-space: nowrap;
      }
      .pill.available { color: var(--green); border-color: rgba(45, 215, 124, 0.35); }
      .pill.taken { color: var(--muted); }
      .pill.unknown { color: var(--amber); border-color: rgba(246, 200, 95, 0.35); }
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
        .nav a { padding: 0.5rem 0.25rem; text-align: center; font-size: 0.62rem; }
        main { width: auto; padding: 1.25rem 0.75rem 3rem; }
        .hero { display: block; }
        h1 { font-size: 1.8rem; }
        .sub { font-size: 0.85rem; }
        .cmd { display: none; }
        .stats { grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 0.5rem; margin: 1rem 0; }
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
        tbody tr.opportunity { box-shadow: inset 3px 0 0 var(--green); }
        tbody tr.opportunity td:first-child { box-shadow: none; }
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
        <a href="/admin/keyword-research/">Keyword Research</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
        <a href="/admin/emd-finder/" class="active">EMD Finder</a>
      </nav>
    </header>

    <main>
      <section class="hero">
        <div>
          <h1>EMD Finder</h1>
          <p class="sub">
            Checks exact-match .co.uk domains for trade + South Wales town combinations against real availability and search demand, for rank-and-rent opportunities. Refresh whenever you want current data rebuilt and deployed.
          </p>
        </div>
        <div class="cmd">node scripts/emd-finder.mjs && npm run build && npx wrangler deploy</div>
      </section>

      {!hasData ? (
        <div class="empty">
          No EMD finder cache found yet. Edit <code>scripts/emd-finder-seed.json</code> with your trade and town lists (a starter list is already included), then run <code>node scripts/emd-finder.mjs</code> and rebuild.
        </div>
      ) : (
        <>
          <section class="stats">
            <div class="stat">
              <div class="label">Last Refresh</div>
              <div class="value" style="font-size:1rem;">{fmtDate(cache.fetchedAt)}</div>
            </div>
            <div class="stat">
              <div class="label">Combos Checked</div>
              <div class="value">{combos.length}</div>
            </div>
            <div class="stat">
              <div class="label">Domains Available</div>
              <div class="value">{availableCount}</div>
            </div>
          </section>

          <section class="stats">
            <div class="stat">
              <div class="label">Opportunities</div>
              <div class="value">{opportunityCount}</div>
            </div>
          </section>

          <div class="filters">
            <input id="search" type="search" placeholder="Search trade, town, or domain" />
            <input id="min-volume" type="number" min="0" placeholder="Min volume" />
            <label class="checkbox-label">
              <input id="available-only" type="checkbox" />
              Available only
            </label>
            <button id="reset-filters" type="button">Reset filters</button>
          </div>

          {combos.length ? (
            <div class="table-shell">
              <table id="combos">
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Trade</th>
                    <th>Town</th>
                    <th>Availability</th>
                    <th><button class="sort-button" type="button" data-sort="volume" data-type="number">Volume</button></th>
                    <th><button class="sort-button" type="button" data-sort="cpc" data-type="number">CPC</button></th>
                    <th><button class="sort-button" type="button" data-sort="difficulty" data-type="number">Difficulty</button></th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map((row) => (
                    <tr
                      class={row.available === true && row.volume !== null && row.volume > 0 ? 'opportunity' : ''}
                      data-search={`${row.trade} ${row.town} ${row.domain}`.toLowerCase()}
                      data-available={row.available === true ? 'true' : row.available === false ? 'false' : 'unknown'}
                      data-volume={row.volume ?? ''}
                      data-cpc={row.cpc ?? ''}
                      data-difficulty={row.difficulty ?? ''}
                    >
                      <td data-label="Domain"><span class="domain">{row.domain}</span></td>
                      <td data-label="Trade">{row.trade}</td>
                      <td data-label="Town">{row.town.replace(/-/g, ' ')}</td>
                      <td data-label="Availability"><span class={`pill ${availabilityClass(row.available)}`}>{availabilityLabel(row.available)}</span></td>
                      <td data-label="Volume">{fmtNumber(row.volume)}</td>
                      <td data-label="CPC">{fmtCpc(row.cpc)}</td>
                      <td data-label="Difficulty">{fmtNumber(row.difficulty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div class="empty">No combos in the cache yet.</div>
          )}
        </>
      )}
    </main>

    <script>
      const search = document.getElementById('search') as HTMLInputElement | null;
      const minVolume = document.getElementById('min-volume') as HTMLInputElement | null;
      const availableOnly = document.getElementById('available-only') as HTMLInputElement | null;
      const reset = document.getElementById('reset-filters');
      const table = document.getElementById('combos');
      const tbody = table?.querySelector('tbody');
      const rows = Array.from(table?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []);
      const sortButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sort-button'));

      function applyFilters() {
        const q = search?.value.trim().toLowerCase() || '';
        const minVol = minVolume?.value ? Number(minVolume.value) : null;
        const onlyAvailable = availableOnly?.checked ?? false;
        for (const row of rows) {
          const matchesQuery = !q || (row.dataset.search ?? '').includes(q);
          const volume = row.dataset.volume ? Number(row.dataset.volume) : null;
          const matchesVolume = minVol === null || (volume !== null && volume >= minVol);
          const matchesAvailable = !onlyAvailable || row.dataset.available === 'true';
          row.style.display = matchesQuery && matchesVolume && matchesAvailable ? '' : 'none';
        }
      }

      search?.addEventListener('input', applyFilters);
      minVolume?.addEventListener('input', applyFilters);
      availableOnly?.addEventListener('change', applyFilters);
      reset?.addEventListener('click', () => {
        if (search) search.value = '';
        if (minVolume) minVolume.value = '';
        if (availableOnly) availableOnly.checked = false;
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
    </script>
  </body>
</html>
```

- [ ] **Step 2: Verify the empty state builds**

With no `scripts/emd-finder-cache.json` present, run: `npm run build`
Expected: build succeeds (exit code 0), and `dist/admin/emd-finder/index.html` contains the "No EMD finder cache found yet" empty-state message.

If a real `scripts/emd-finder-cache.json` already exists from Task 3 Step 4, temporarily move it aside (`mv scripts/emd-finder-cache.json scripts/emd-finder-cache.json.bak`) for this check, then restore it afterward.

- [ ] **Step 3: Verify the populated state builds**

If a real cache from Task 3 Step 4 exists, just run `npm run build` again (it should already be present) and confirm `dist/admin/emd-finder/index.html` contains `Combos Checked`, at least one real domain from the cache, and the `pill available`/`pill taken` classes.

If no real cache exists yet, temporarily create a minimal one for this check:

```json
{
  "fetchedAt": "2026-07-28T12:00:00.000Z",
  "combos": [
    { "trade": "plumber", "town": "merthyr-tydfil", "domain": "merthyrtydfilplumber.co.uk", "available": true, "volume": 90, "cpc": 4.2, "difficulty": 18 },
    { "trade": "roofer", "town": "cardiff", "domain": "cardiffroofer.co.uk", "available": false, "volume": null, "cpc": null, "difficulty": null }
  ]
}
```

Run `npm run build`, confirm the content appears, then delete the temporary file unless it's the real one from Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/emd-finder.astro
git commit -m "feat: add EMD finder admin page"
```

---

### Task 5: Add nav links across all six existing admin pages

**Files:**
- Modify: `src/pages/admin/keywords.astro`
- Modify: `src/pages/admin/gsc.astro`
- Modify: `src/pages/admin/indexing.astro`
- Modify: `src/pages/admin/keyword-research.astro`
- Modify: `src/pages/admin/backlinks.astro`
- Modify: `src/pages/admin/links.astro`

- [ ] **Step 1: Update `keywords.astro`**

Find:
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
Replace with:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/" class="active">Keywords</a>
        <a href="/admin/keyword-research/">Keyword Research</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
        <a href="/admin/emd-finder/">EMD Finder</a>
      </nav>
```

- [ ] **Step 2: Update `gsc.astro`**

Find:
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
Replace with:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/">Keywords</a>
        <a href="/admin/keyword-research/">Keyword Research</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/" class="active">GSC</a>
        <a href="/admin/emd-finder/">EMD Finder</a>
      </nav>
```

- [ ] **Step 3: Update `indexing.astro`**

Find:
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
Replace with:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/">Keywords</a>
        <a href="/admin/keyword-research/">Keyword Research</a>
        <a href="/admin/indexing/" class="active">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
        <a href="/admin/emd-finder/">EMD Finder</a>
      </nav>
```

- [ ] **Step 4: Update `keyword-research.astro`**

Find:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/">Keywords</a>
        <a href="/admin/keyword-research/" class="active">Keyword Research</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
      </nav>
```
Replace with:
```astro
      <nav class="nav">
        <a href="/admin/links/">Internal Links</a>
        <a href="/admin/backlinks/">Backlinks</a>
        <a href="/admin/keywords/">Keywords</a>
        <a href="/admin/keyword-research/" class="active">Keyword Research</a>
        <a href="/admin/indexing/">Indexing</a>
        <a href="/admin/gsc/">GSC</a>
        <a href="/admin/emd-finder/">EMD Finder</a>
      </nav>
```

- [ ] **Step 5: Update `backlinks.astro`**

Find:
```astro
    <a href="/admin/links/">Internal Links →</a>
    <a href="/admin/keywords/">Keywords →</a>
    <a href="/admin/keyword-research/">Keyword Research →</a>
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
    <a href="/admin/emd-finder/">EMD Finder →</a>
    <a href="/">← Back to site</a>
```

- [ ] **Step 6: Update `links.astro`**

Find:
```astro
    <a href="/admin/backlinks/">Backlinks →</a>
    <a href="/admin/keywords/">Keywords →</a>
    <a href="/admin/keyword-research/">Keyword Research →</a>
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
    <a href="/admin/emd-finder/">EMD Finder →</a>
    <a href="/">← Back to site</a>
```

- [ ] **Step 7: Build and spot-check**

Run: `npm run build`
Expected: build succeeds; grep the output for the new link:

```bash
grep -l "emd-finder" dist/admin/keywords/index.html dist/admin/gsc/index.html dist/admin/indexing/index.html dist/admin/keyword-research/index.html dist/admin/backlinks/index.html dist/admin/links/index.html
```
Expected: all six files listed.

- [ ] **Step 8: Commit**

```bash
git add src/pages/admin/keywords.astro src/pages/admin/gsc.astro src/pages/admin/indexing.astro src/pages/admin/keyword-research.astro src/pages/admin/backlinks.astro src/pages/admin/links.astro
git commit -m "feat: link EMD Finder from existing admin pages"
```

---

### Task 6: Full verification pass

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run test:unit`
Expected: all tests pass, including the new `tests/unit/emd-finder-helpers.test.js` alongside the existing `worker.test.js` and `dataforseo-helpers.test.js`.

- [ ] **Step 2: Run a full production build**

Run: `npm run build`
Expected: exit code 0, no Astro/TypeScript errors.

- [ ] **Step 3: Preview locally and check the new page**

Run: `npm run preview`
Visit `http://localhost:4321/admin/emd-finder/` (port may differ) and confirm: stats row shows real numbers, the table renders with sortable Volume/CPC/Difficulty columns, the "Available only" checkbox and min-volume filter work, and opportunity rows (available + has volume) show the green accent border. Confirm all six other admin pages now link to EMD Finder.

- [ ] **Step 4: Deploy**

Run: `npx wrangler deploy`
Expected: deploy succeeds; confirm `https://nc-digital.co.uk/admin/emd-finder/` loads (behind existing `/admin/*` auth).
