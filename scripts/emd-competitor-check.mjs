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

function buildChecks(opportunities, serpByComboKey, referringDomainsByDomain, directoryList) {
  return opportunities.map((combo) => {
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
    return { trade: combo.trade, town: combo.town, directoryRatio, floor, verdict, competitors };
  });
}

function writeCache(checks, complete) {
  const cache = { fetchedAt: new Date().toISOString(), complete, checks };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

const PROGRESS_INTERVAL = 25;

async function main() {
  const opportunities = loadOpportunities();
  const directoryList = loadDirectoryList();
  const { login, password } = loadConfig();
  const authHeader = buildAuthHeader(login, password);

  console.log(`Running competitor check for ${opportunities.length} opportunity combo(s)...`);

  const serpByComboKey = new Map();
  const referringDomainsByDomain = new Map();

  for (let i = 0; i < opportunities.length; i++) {
    const combo = opportunities[i];
    const key = `${combo.trade}|${combo.town}`;
    const phrase = `${combo.trade} ${combo.town.replace(/-/g, ' ')}`;
    const serp = await fetchSerp(authHeader, phrase);
    serpByComboKey.set(key, serp);
    await sleep(REQUEST_DELAY_MS);
    if ((i + 1) % PROGRESS_INTERVAL === 0 || i + 1 === opportunities.length) {
      console.log(`SERP fetch: ${i + 1}/${opportunities.length}`);
      writeCache(buildChecks(opportunities, serpByComboKey, referringDomainsByDomain, directoryList), false);
    }
  }

  const uniqueBusinessDomains = new Set();
  for (const serp of serpByComboKey.values()) {
    for (const result of serp) {
      if (!isDirectoryDomain(result.domain, directoryList)) {
        uniqueBusinessDomains.add(result.domain);
      }
    }
  }

  if (opportunities.length > 0 && uniqueBusinessDomains.size === 0) {
    console.warn('No real-business competitor domains found across any opportunity\'s SERP. This usually means the SERP fetch is failing broadly (e.g. an outage or auth issue), not that every top-10 result is genuinely a directory.');
  }

  console.log(`Looking up referring domains for ${uniqueBusinessDomains.size} unique real-business domain(s)...`);

  const domainList = [...uniqueBusinessDomains];
  for (let i = 0; i < domainList.length; i++) {
    const domain = domainList[i];
    const count = await fetchReferringDomains(authHeader, domain);
    referringDomainsByDomain.set(domain, count);
    await sleep(REQUEST_DELAY_MS);
    if ((i + 1) % PROGRESS_INTERVAL === 0 || i + 1 === domainList.length) {
      console.log(`Backlinks lookup: ${i + 1}/${domainList.length}`);
      writeCache(buildChecks(opportunities, serpByComboKey, referringDomainsByDomain, directoryList), false);
    }
  }

  const checks = buildChecks(opportunities, serpByComboKey, referringDomainsByDomain, directoryList);
  writeCache(checks, true);

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
