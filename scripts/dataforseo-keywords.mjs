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
  const task = json.tasks?.[0];
  if (!res.ok || (json.status_code && json.status_code >= 40000) || (task?.status_code && task.status_code >= 40000)) {
    const message = task?.status_message || json.status_message || `${res.status} ${res.statusText}`;
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
  const relatedKeywordItems = [];

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
    relatedKeywordItems.push(...related);
  }

  const relatedKeywords = dedupeRelatedKeywords(relatedKeywordItems);

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
