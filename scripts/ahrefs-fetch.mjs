/**
 * Ahrefs Backlink Data Fetch
 * Run: node scripts/ahrefs-fetch.mjs
 *
 * Fetches backlink data from Ahrefs API and saves to scripts/ahrefs-cache.json
 * The admin backlinks page reads this cache at build time.
 *
 * Requires AHREFS_API_KEY in .env or set as an environment variable.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CACHE_PATH = path.join(__dirname, 'ahrefs-cache.json');
const ENV_PATH   = path.join(__dirname, '..', '.env');
const TARGET     = 'nc-digital.co.uk';
const BASE       = 'https://api.ahrefs.com/v3/site-explorer';

// ── Load API key ──────────────────────────────────────────────────────────────

function loadApiKey() {
  let key = process.env.AHREFS_API_KEY;
  if (!key && fs.existsSync(ENV_PATH)) {
    const env = fs.readFileSync(ENV_PATH, 'utf8');
    const match = env.match(/^AHREFS_API_KEY=(.+)$/m);
    if (match) key = match[1].trim();
  }
  if (!key) {
    console.error('❌  AHREFS_API_KEY not found. Add it to .env or set as an env variable.');
    process.exit(1);
  }
  return key;
}

// ── API helper ────────────────────────────────────────────────────────────────

async function get(apiKey, endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${endpoint}?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const json = await res.json();
  if (json.error) throw new Error(`${endpoint}: ${json.error}`);
  return json;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = loadApiKey();
  const today  = new Date().toISOString().slice(0, 10);

  console.log(`\nFetching Ahrefs data for ${TARGET}…\n`);

  // Domain Rating
  console.log('  → Domain rating…');
  const drData = await get(apiKey, 'domain-rating', { target: TARGET, date: today });
  const dr     = drData.domain_rating;

  // Referring Domains (top 100 by DR)
  console.log('  → Referring domains…');
  const rdData = await get(apiKey, 'refdomains', {
    target:   TARGET,
    mode:     'domain',
    limit:    '100',
    order_by: 'domain_rating:desc',
    select:   'domain,domain_rating,links_to_target,dofollow_links,traffic_domain,first_seen,is_spam',
  });
  const refdomains = rdData.refdomains || [];

  // Recent Backlinks (100 newest)
  console.log('  → Recent backlinks…');
  const blData = await get(apiKey, 'all-backlinks', {
    target:   TARGET,
    mode:     'domain',
    limit:    '100',
    order_by: 'first_seen:desc',
    select:   'anchor,url_from,url_to,domain_rating_source,first_seen,is_dofollow',
  });
  const backlinks = blData.backlinks || [];

  // Top Pages by Backlinks
  console.log('  → Top linked pages…');
  const pagesData = await get(apiKey, 'best-by-external-links', {
    target:   TARGET,
    mode:     'domain',
    limit:    '20',
    order_by: 'refdomains_target:desc',
    select:   'url_to,url_to_plain,refdomains_target,dofollow_to_target,links_to_target,url_rating_target',
  });
  const topPages = pagesData.pages || [];

  // Compute summary stats
  const totalDofollow = refdomains.reduce((s, r) => s + (r.dofollow_links || 0), 0);
  const totalLinks    = refdomains.reduce((s, r) => s + (r.links_to_target || 0), 0);

  const cache = {
    fetchedAt:   new Date().toISOString(),
    target:      TARGET,
    domainRating: dr,
    summary: {
      refdomains:     refdomains.length,
      totalBacklinks: totalLinks,
      dofollow:       totalDofollow,
      nofollow:       totalLinks - totalDofollow,
    },
    refdomains,
    backlinks,
    topPages,
  };

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');

  console.log(`
✅  Done!

  Domain Rating:    ${dr.domain_rating}  (Ahrefs Rank: #${dr.ahrefs_rank?.toLocaleString()})
  Referring Domains: ${refdomains.length}
  Total Backlinks:  ${totalLinks}
  Dofollow:         ${totalDofollow}

  Cache saved to: scripts/ahrefs-cache.json

Run \`npm run build && npx wrangler deploy\` to publish the updated data.
`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
