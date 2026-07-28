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
