/**
 * EMD competitor check — SERP + referring-domain analysis for EMD Finder domains.
 * Run: node scripts/emd-competitor-check.mjs [--limit=N] [--top-volume=N] [--top-job-cost=N]
 *        [--domains=a.co.uk,b.co.uk] [--min-volume=N] [--min-job-cost=N]
 *        [--unknown-volume-min-job-cost=N] [--force]
 *
 * Checks every domain marked available in scripts/emd-finder-cache.json
 * whose volume isn't a confirmed 0 (a null volume reading is a
 * DataForSEO data gap, not proof of zero demand, so it's still worth
 * checking).
 *
 * The value gate narrows that further so credit goes on combos worth
 * winning. All three flags are optional and off by default:
 *   --min-volume=200                  keep only a confirmed volume ABOVE 200
 *   --min-job-cost=150                keep only an average job value ABOVE £150
 *   --unknown-volume-min-job-cost=1000
 *                                     for combos with NO reported volume, keep
 *                                     only those whose average job value is AT
 *                                     LEAST this much. Small-town phrases often
 *                                     go unreported by DataForSEO despite real
 *                                     demand, so rather than binning them
 *                                     wholesale this checks them blind only when
 *                                     a single job would justify the domain.
 *
 * By default, skips combos that already have a check in a
 * COMPLETED scripts/emd-competitor-check-cache.json and only checks
 * what's new, merging the results with what's already there. Pass
 * --force to re-check everything from scratch.
 *
 * Raw SERP and referring-domain lookups are cached separately
 * (scripts/emd-serp-raw-cache.json, scripts/emd-referring-domains-raw-cache.json)
 * and persist across runs regardless of whether a run finishes — so if
 * this script gets interrupted partway through (a long run can take
 * hours), re-running it picks up from whatever raw data was already
 * fetched instead of starting over. The final competitor-check cache
 * is only ever written once, in full, after every combo in this run
 * has real SERP + backlink data — no partial/placeholder entries.
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
const SERP_RAW_CACHE_PATH = path.join(__dirname, 'emd-serp-raw-cache.json');
const REFERRING_RAW_CACHE_PATH = path.join(__dirname, 'emd-referring-domains-raw-cache.json');
const BASE = 'https://api.dataforseo.com/v3';
const LOCATION_NAME = 'United Kingdom';
const LANGUAGE_CODE = 'en';
const SERP_LIMIT = 10;
const REQUEST_DELAY_MS = 200;
const RAW_CACHE_SAVE_INTERVAL = 10;

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = true] = arg.replace(/^--/, '').split('=');
    return [key, value];
  })
);
const LIMIT = args.limit ? Number(args.limit) : null;
const TOP_VOLUME_LIMIT = args['top-volume'] ? Number(args['top-volume']) : null;
const TOP_JOB_COST_LIMIT = args['top-job-cost'] ? Number(args['top-job-cost']) : null;
const DOMAIN_FILTER = args.domains
  ? new Set(String(args.domains).split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean))
  : null;
const MIN_VOLUME = args['min-volume'] ? Number(args['min-volume']) : null;
const MIN_JOB_COST = args['min-job-cost'] ? Number(args['min-job-cost']) : null;
const UNKNOWN_VOLUME_MIN_JOB_COST = args['unknown-volume-min-job-cost']
  ? Number(args['unknown-volume-min-job-cost'])
  : null;
const FORCE = Boolean(args.force);

// Is this combo worth spending a SERP + backlink lookup on?
// A reported volume is judged on volume first, then job value. A null volume is
// judged on job value alone, because null means "DataForSEO reported nothing",
// which for town-level phrases is a data gap rather than evidence of no demand.
function meetsValueGate(combo) {
  const jobCost = combo.avgJobCost ?? 0;
  if (combo.volume === null) {
    return UNKNOWN_VOLUME_MIN_JOB_COST === null || jobCost >= UNKNOWN_VOLUME_MIN_JOB_COST;
  }
  if (MIN_VOLUME !== null && !(combo.volume > MIN_VOLUME)) return false;
  if (MIN_JOB_COST !== null && !(jobCost > MIN_JOB_COST)) return false;
  return true;
}

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

function loadCombosToCheck() {
  if (!fs.existsSync(EMD_CACHE_PATH)) {
    console.error('No scripts/emd-finder-cache.json found. Run node scripts/emd-finder.mjs first.');
    process.exit(1);
  }
  const cache = JSON.parse(fs.readFileSync(EMD_CACHE_PATH, 'utf8'));
  const combos = cache.combos ?? [];
  // Every available domain gets checked, not just ones with confirmed
  // search volume — a null volume reading is a DataForSEO data gap, not
  // proof there's no real competition worth scoring. A confirmed 0 is
  // excluded (genuinely zero demand, not worth checking).
  let available = combos.filter((c) => c.available === true && c.volume !== 0);
  if (available.length === 0) {
    console.error('No checkable domains found in scripts/emd-finder-cache.json (need available === true and volume !== 0).');
    process.exit(1);
  }
  return available;
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

function loadExistingChecks() {
  if (!fs.existsSync(CACHE_PATH)) return [];
  try {
    const existing = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    // Every check is now written only once its SERP and all its non-directory
    // backlink counts are in hand, so individual checks are trustworthy even
    // when the run as a whole was cut short. That replaces the old run-level
    // `complete` gate, which threw away hundreds of good checks whenever a
    // single lookup failed. `complete` is still recorded, as a run summary.
    return existing.checks ?? [];
  } catch {
    return [];
  }
}

function loadRawCache(rawPath) {
  if (!fs.existsSync(rawPath)) return new Map();
  try {
    const obj = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function saveRawCache(rawPath, map) {
  fs.writeFileSync(rawPath, JSON.stringify(Object.fromEntries(map), null, 2), 'utf8');
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

// A failed call and a successful call that found nothing used to both come back
// as null/[], so an outage looked identical to a wide-open SERP — and an empty
// SERP or an all-null floor scores as 'Soft', the most attractive verdict. This
// sentinel keeps the two apart so failures are never cached or scored.
const FETCH_FAILED = Symbol('fetch-failed');

// Stop the run rather than grinding through hundreds of doomed calls when the
// account runs out of credit or the API goes down mid-run.
const CONSECUTIVE_FAILURE_ABORT = 10;

async function fetchSerp(authHeader, phrase) {
  try {
    const json = await postTask(authHeader, 'serp/google/organic/live/advanced', [
      { keyword: phrase, location_name: LOCATION_NAME, language_code: LANGUAGE_CODE, device: 'desktop', os: 'windows', depth: SERP_LIMIT },
    ]);
    const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
    return mapSerpItems(items, SERP_LIMIT);
  } catch (err) {
    console.warn(`SERP fetch failed for "${phrase}": ${err.message}`);
    return FETCH_FAILED;
  }
}

async function fetchReferringDomains(authHeader, domain) {
  try {
    const json = await postTask(authHeader, 'backlinks/summary/live', [{ target: domain }]);
    const result = json.tasks?.[0]?.result?.[0];
    return result?.referring_domains ?? null;
  } catch (err) {
    console.warn(`Backlinks summary failed for "${domain}": ${err.message}`);
    return FETCH_FAILED;
  }
}

function buildChecks(combos, serpByComboKey, referringDomainsByDomain, directoryList) {
  return combos.map((combo) => {
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
  if (!process.argv.includes('--legacy-unbounded')) {
    console.log('Use https://nc-digital.co.uk/admin/emd-finder/ for capped scans with bulk checks. The legacy per-domain paid scanner is disabled by default; existing caches remain intact.');
    return;
  }
  const availableCombos = loadCombosToCheck();
  const directoryList = loadDirectoryList();
  const existingChecks = loadExistingChecks();
  const existingKeys = FORCE ? new Set() : new Set(existingChecks.map((c) => `${c.trade}|${c.town}`));
  let toCheck = availableCombos.filter((combo) => !existingKeys.has(`${combo.trade}|${combo.town}`));

  if (MIN_VOLUME !== null || MIN_JOB_COST !== null || UNKNOWN_VOLUME_MIN_JOB_COST !== null) {
    const before = toCheck.length;
    const excluded = toCheck.filter((combo) => !meetsValueGate(combo));
    toCheck = toCheck.filter(meetsValueGate);
    // Attribute each exclusion to exactly one reason, in the order the gate applies.
    let lowVolume = 0;
    let lowValue = 0;
    let unknownLowValue = 0;
    for (const combo of excluded) {
      if (combo.volume === null) unknownLowValue++;
      else if (MIN_VOLUME !== null && !(combo.volume > MIN_VOLUME)) lowVolume++;
      else lowValue++;
    }
    console.log(`Value gate: ${before} -> ${toCheck.length} combo(s) worth checking.
  excluded ${lowVolume} with reported volume at/below ${MIN_VOLUME}
  excluded ${lowValue} clearing volume but with average job value at/below £${MIN_JOB_COST}
  excluded ${unknownLowValue} with no reported volume and job value under £${UNKNOWN_VOLUME_MIN_JOB_COST}`);
  }

  if (DOMAIN_FILTER) {
    toCheck = toCheck.filter((combo) => DOMAIN_FILTER.has(combo.domain.toLowerCase()));
  }
  if (TOP_VOLUME_LIMIT) {
    toCheck = toCheck
      .filter((combo) => combo.volume > 0)
      .toSorted((a, b) => {
        if (a.volume !== b.volume) return b.volume - a.volume;
        return a.domain.localeCompare(b.domain);
      })
      .slice(0, TOP_VOLUME_LIMIT);
  }
  if (TOP_JOB_COST_LIMIT) {
    toCheck = toCheck
      .filter((combo) => combo.avgJobCost !== null && combo.avgJobCost !== undefined)
      .toSorted((a, b) => {
        if (a.avgJobCost !== b.avgJobCost) return b.avgJobCost - a.avgJobCost;
        const aVolume = a.volume ?? -1;
        const bVolume = b.volume ?? -1;
        if (aVolume !== bVolume) return bVolume - aVolume;
        return a.domain.localeCompare(b.domain);
      })
      .slice(0, TOP_JOB_COST_LIMIT);
  }
  if (LIMIT) {
    toCheck = toCheck.slice(0, LIMIT);
  }

  if (toCheck.length === 0) {
    const qualifier = DOMAIN_FILTER
      ? ' selected available unchecked domain(s)'
      : TOP_VOLUME_LIMIT
        ? ` available positive-volume unchecked combo(s) in the top ${TOP_VOLUME_LIMIT} selection`
        : TOP_JOB_COST_LIMIT
          ? ` available unchecked combo(s) in the top ${TOP_JOB_COST_LIMIT} average job cost selection`
          : ` available combo(s)`;
    console.log(`No${qualifier} need a competitor check. Nothing to do — pass --force to re-check everything.`);
    return;
  }

  const { login, password } = loadConfig();
  const authHeader = buildAuthHeader(login, password);

  const serpByComboKey = loadRawCache(SERP_RAW_CACHE_PATH);
  const referringDomainsByDomain = loadRawCache(REFERRING_RAW_CACHE_PATH);

  const alreadyCached = toCheck.filter((c) => serpByComboKey.has(`${c.trade}|${c.town}`)).length;
  console.log(`Running competitor check for ${toCheck.length} available combo(s) (${existingChecks.length} already finalized, ${alreadyCached} already have raw SERP data cached from a prior run)...`);

  let serpFetchedThisRun = 0;
  let serpFailures = 0;
  let consecutiveSerpFailures = 0;
  let aborted = false;
  for (let i = 0; i < toCheck.length; i++) {
    const combo = toCheck[i];
    const key = `${combo.trade}|${combo.town}`;
    if (!FORCE && serpByComboKey.has(key)) continue;
    const phrase = `${combo.trade} ${combo.town.replace(/-/g, ' ')}`;
    const serp = await fetchSerp(authHeader, phrase);
    await sleep(REQUEST_DELAY_MS);
    if (serp === FETCH_FAILED) {
      // Leave the key absent so a later run retries it.
      serpFailures++;
      consecutiveSerpFailures++;
      if (consecutiveSerpFailures >= CONSECUTIVE_FAILURE_ABORT) {
        console.error(`\nAborting SERP fetch after ${consecutiveSerpFailures} consecutive failures — check your DataForSEO balance and re-run.`);
        aborted = true;
        break;
      }
      continue;
    }
    consecutiveSerpFailures = 0;
    serpByComboKey.set(key, serp);
    serpFetchedThisRun++;
    if (serpFetchedThisRun % RAW_CACHE_SAVE_INTERVAL === 0) {
      saveRawCache(SERP_RAW_CACHE_PATH, serpByComboKey);
    }
    if ((i + 1) % PROGRESS_INTERVAL === 0 || i + 1 === toCheck.length) {
      console.log(`SERP fetch: ${i + 1}/${toCheck.length}`);
    }
  }
  saveRawCache(SERP_RAW_CACHE_PATH, serpByComboKey);

  const uniqueBusinessDomains = new Set();
  for (const combo of toCheck) {
    const serp = serpByComboKey.get(`${combo.trade}|${combo.town}`) ?? [];
    for (const result of serp) {
      if (!isDirectoryDomain(result.domain, directoryList)) {
        uniqueBusinessDomains.add(result.domain);
      }
    }
  }

  if (toCheck.length > 0 && uniqueBusinessDomains.size === 0) {
    console.warn('No real-business competitor domains found across any combo\'s SERP. This usually means the SERP fetch is failing broadly (e.g. an outage or auth issue), not that every top-10 result is genuinely a directory.');
  }

  const domainList = [...uniqueBusinessDomains];
  const alreadyLookedUp = domainList.filter((d) => referringDomainsByDomain.has(d)).length;
  console.log(`Looking up referring domains for ${domainList.length} unique real-business domain(s) (${alreadyLookedUp} already cached from a prior run)...`);

  let lookedUpThisRun = 0;
  let lookupFailures = 0;
  let consecutiveLookupFailures = 0;
  for (let i = 0; i < domainList.length; i++) {
    const domain = domainList[i];
    if (referringDomainsByDomain.has(domain)) continue;
    const count = await fetchReferringDomains(authHeader, domain);
    await sleep(REQUEST_DELAY_MS);
    if (count === FETCH_FAILED) {
      // Leave the domain out of the cache entirely. Caching a null here would
      // make `has(domain)` true and permanently skip the retry.
      lookupFailures++;
      consecutiveLookupFailures++;
      if (consecutiveLookupFailures >= CONSECUTIVE_FAILURE_ABORT) {
        console.error(`\nAborting backlinks lookup after ${consecutiveLookupFailures} consecutive failures — check your DataForSEO balance and re-run.`);
        aborted = true;
        break;
      }
      continue;
    }
    consecutiveLookupFailures = 0;
    referringDomainsByDomain.set(domain, count);
    lookedUpThisRun++;
    if (lookedUpThisRun % RAW_CACHE_SAVE_INTERVAL === 0) {
      saveRawCache(REFERRING_RAW_CACHE_PATH, referringDomainsByDomain);
    }
    if ((i + 1) % PROGRESS_INTERVAL === 0 || i + 1 === domainList.length) {
      console.log(`Backlinks lookup: ${i + 1}/${domainList.length}`);
    }
  }
  saveRawCache(REFERRING_RAW_CACHE_PATH, referringDomainsByDomain);

  // Only finalize combos backed by complete data. A combo whose SERP never
  // landed, or whose competitors are missing backlink counts, would be scored
  // from a partial picture — and a missing floor scores 'Soft'. Leaving them
  // out means a later run redoes them properly instead of baking in a guess.
  const completeCombos = [];
  let skippedIncomplete = 0;
  for (const combo of toCheck) {
    const serp = serpByComboKey.get(`${combo.trade}|${combo.town}`);
    if (!serp) {
      skippedIncomplete++;
      continue;
    }
    const missingBacklinks = serp.some(
      (result) => !isDirectoryDomain(result.domain, directoryList) && !referringDomainsByDomain.has(result.domain)
    );
    if (missingBacklinks) {
      skippedIncomplete++;
      continue;
    }
    completeCombos.push(combo);
  }

  const newChecks = buildChecks(completeCombos, serpByComboKey, referringDomainsByDomain, directoryList);
  const newKeys = new Set(newChecks.map((check) => `${check.trade}|${check.town}`));
  const checks = FORCE
    ? [...existingChecks.filter((check) => !newKeys.has(`${check.trade}|${check.town}`)), ...newChecks]
    : [...existingChecks, ...newChecks];
  const runComplete = !aborted && serpFailures === 0 && lookupFailures === 0 && skippedIncomplete === 0;
  writeCache(checks, runComplete);

  const verdictCounts = checks.reduce((acc, c) => {
    acc[c.verdict] = (acc[c.verdict] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`
${runComplete ? 'Done.' : 'Done (INCOMPLETE — see warnings below).'}
  New combos checked: ${newChecks.length}
  Total combos in cache: ${checks.length}
  Unique competitor domains looked up this run: ${lookedUpThisRun}
  Verdicts (all): ${JSON.stringify(verdictCounts)}

Cache saved to: scripts/emd-competitor-check-cache.json
`);

  if (!runComplete) {
    console.warn(`Run did not fully complete:
  SERP fetch failures: ${serpFailures}
  Backlinks lookup failures: ${lookupFailures}
  Combos held back for incomplete data: ${skippedIncomplete}${aborted ? '\n  Run aborted early after consecutive failures.' : ''}

Failed lookups were NOT written to the caches, so re-running picks them up.
No partial-data combo was scored, so nothing was recorded as a false 'Soft'.`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
