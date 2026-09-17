/**
 * Ahrefs Rank Tracker keyword fetch.
 * Run: node scripts/ahrefs-keywords.mjs
 *
 * Reads scripts/ahrefs-keywords.json and writes scripts/ahrefs-keywords-cache.json.
 *
 * Requires:
 * - AHREFS_API_KEY in .env or environment
 * - AHREFS_RANK_TRACKER_PROJECT_ID in .env or environment, or the default NC Digital project ID
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENV_PATH = path.join(__dirname, '..', '.env');
const KEYWORDS_PATH = path.join(__dirname, 'ahrefs-keywords.json');
const CACHE_PATH = path.join(__dirname, 'ahrefs-keywords-cache.json');
const BASE = 'https://api.ahrefs.com/v3/rank-tracker';
const MANAGEMENT_BASE = 'https://api.ahrefs.com/v3/management';
const SITE_ORIGIN = 'https://nc-digital.co.uk';
const DEFAULT_PROJECT_ID = '9408297';
const LOCATION_PREFIXES = [
  'ecommerce-web-design',
  'logo-design',
  'managed-starter-websites',
  'professional-email',
  'seo',
  'web-design',
  'web-development',
  'website-maintenance',
];

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = true] = arg.replace(/^--/, '').split('=');
    return [key, value];
  })
);

const DEVICE = String(args.device || 'desktop');
const COMPARE_DAYS = Number(args.compareDays || 7);
const LIMIT = String(args.limit || 1000);

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
  const apiKey = process.env.AHREFS_API_KEY || env.AHREFS_API_KEY;
  const projectId = process.env.AHREFS_RANK_TRACKER_PROJECT_ID || env.AHREFS_RANK_TRACKER_PROJECT_ID || env.AHREFS_PROJECT_ID || DEFAULT_PROJECT_ID;

  if (!apiKey) {
    console.error('AHREFS_API_KEY not found. Add it to .env or set it as an environment variable.');
    process.exit(1);
  }

  if (!projectId) {
    console.error(`
AHREFS_RANK_TRACKER_PROJECT_ID not found.

Open your Ahrefs Rank Tracker project and copy the numeric ID from the URL:
https://app.ahrefs.com/rank-tracker/overview/#project_id#

Then add this to .env:
AHREFS_RANK_TRACKER_PROJECT_ID=123456
`);
    process.exit(1);
  }

  return { apiKey, projectId };
}

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function absUrl(targetUrl) {
  if (!targetUrl) return '';
  if (targetUrl.startsWith('http')) return targetUrl;
  return SITE_ORIGIN + (targetUrl.startsWith('/') ? targetUrl : `/${targetUrl}`);
}

function slugify(value) {
  return normaliseKeyword(value)
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function availableLocationSlugs() {
  const dir = path.join(__dirname, '..', 'src', 'content', 'locations');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );
}

function availableBlogSlugs() {
  const dir = path.join(__dirname, '..', 'src', 'content', 'blog');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );
}

function availableServiceSlugs() {
  const dir = path.join(__dirname, '..', 'src', 'content', 'services');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );
}

const LOCATION_SLUGS = availableLocationSlugs();
const BLOG_SLUGS = availableBlogSlugs();
const SERVICE_SLUGS = availableServiceSlugs();
const LOCATION_NAMES = [...LOCATION_SLUGS]
  .flatMap((slug) => LOCATION_PREFIXES
    .filter((prefix) => slug.startsWith(`${prefix}-`))
    .map((prefix) => slug.slice(prefix.length + 1)))
  .filter(Boolean)
  .sort((a, b) => b.length - a.length);

const SERVICE_FALLBACKS = {
  Ecommerce: '/services/ecommerce-development/',
  'Logo Design': '/services/logo-design/',
  'Managed Starter': '/services/managed-starter-websites/',
  'Professional Email': '/services/professional-mailboxes-email-setup/',
  SEO: '/services/local-seo-google-ranking/',
  'Web Design': '/services/web-design/',
  'Web Development': '/services/web-development/',
  'Website Maintenance': '/services/website-maintenance-packages/',
  Maintenance: '/services/website-maintenance-packages/',
};

const GROUP_PREFIXES = {
  Ecommerce: 'ecommerce-web-design',
  'Logo Design': 'logo-design',
  'Managed Starter': 'managed-starter-websites',
  'Professional Email': 'professional-email',
  SEO: 'seo',
  'Web Design': 'web-design',
  'Web Development': 'web-development',
  'Website Maintenance': 'website-maintenance',
  Maintenance: 'website-maintenance',
};

const LOCATION_ALIASES = {
  merthyr: 'merthyr-tydfil',
};

const INDUSTRY_BLOG_TARGETS = [
  { terms: ['architect', 'surveyor', 'quantity surveyor'], slug: 'web-design-for-architects-and-surveyors-a-portfolio-that-wins-projects-before-the-pitch' },
  { terms: ['auto repair', 'garage', 'mechanic'], slug: 'web-design-for-automotive-businesses-a-website-that-keeps-your-workshop-full' },
  { terms: ['builder', 'construction', 'carpenter', 'joiner', 'kitchen fitter', 'flooring', 'landscaper', 'landscaping', 'roofer', 'plumber', 'electrician', 'heating engineer', 'solar', 'window cleaner', 'utility', 'tradesmen'], slug: 'web-design-for-construction-how-a-professional-website-wins-better-projects' },
  { terms: ['online store', 'jewellery', 'ecommerce'], slug: 'web-design-for-ecommerce-businesses-an-online-store-that-turns-browsers-into-buyers' },
  { terms: ['estate agent', 'letting agent', 'property developer'], slug: 'web-design-for-estate-and-letting-agents-an-online-presence-that-wins-instructions' },
  { terms: ['event', 'venue', 'hotel', 'restaurant', 'wedding'], slug: 'web-design-for-events-and-hospitality-a-website-that-fills-rooms-and-books-dates' },
  { terms: ['fitness', 'gym', 'yoga'], slug: 'web-design-for-fitness-businesses-a-website-that-works-as-hard-as-you-do' },
  { terms: ['dentist', 'healthcare', 'vet', 'optician'], slug: 'web-design-for-healthcare-businesses-a-website-that-puts-patients-and-clients-at-ease' },
  { terms: ['cleaning', 'nonprofit', 'nursery', 'kids activity', 'zoo', 'attraction'], slug: 'web-design-for-local-and-community-services-a-website-that-connects-you-with-the-people-who-need-you' },
  { terms: ['accountant', 'law firm', 'solicitor', 'financial advisor', 'insurance broker', 'mortgage broker', 'recruitment', 'marketing agency', 'it company', 'tutor'], slug: 'web-design-for-professional-services-a-website-that-builds-trust-before-the-first-meeting' },
  { terms: ['salon', 'hairdresser', 'barber', 'beauty'], slug: 'web-design-for-salons-attract-more-clients-with-a-website-that-reflects-your-brand' },
];

function pageExists(targetUrl) {
  const slug = targetUrl.replace(/^\/|\/$/g, '');
  if (!slug) return true;
  if (slug.startsWith('services/')) return SERVICE_SLUGS.has(slug.replace('services/', ''));
  if (slug.startsWith('blog/')) return BLOG_SLUGS.has(slug.replace('blog/', ''));
  return LOCATION_SLUGS.has(slug) || fs.existsSync(path.join(__dirname, '..', 'src', 'pages', `${slug}.astro`));
}

function bestLocationSlug(keyword) {
  const value = ` ${normaliseKeyword(keyword).replace(/&/g, ' and ')} `;
  return LOCATION_NAMES.find((location) => value.includes(` ${location.replace(/-/g, ' ')} `));
}

function matchingLocationTarget(keyword, group) {
  const prefix = GROUP_PREFIXES[group];
  if (!prefix) return '';

  const keywordSlug = `-${slugify(keyword)}-`;
  const aliasMatch = Object.entries(LOCATION_ALIASES)
    .find(([alias, location]) => keywordSlug.includes(`-${alias}-`) && LOCATION_SLUGS.has(`${prefix}-${location}`));
  if (aliasMatch) return `/${prefix}-${aliasMatch[1]}/`;

  const match = [...LOCATION_SLUGS]
    .filter((slug) => slug.startsWith(`${prefix}-`))
    .map((slug) => ({ slug, location: slug.slice(prefix.length + 1) }))
    .sort((a, b) => b.location.length - a.location.length)
    .find(({ location }) => keywordSlug.includes(`-${location}-`));

  return match ? `/${match.slug}/` : '';
}

function exactBlogTarget(keyword) {
  const base = slugify(keyword);
  const candidates = [
    base,
    `${base}-in-the-uk`,
    `${base}-uk`,
    `${base}-south-wales`,
  ];
  const match = candidates.find((slug) => BLOG_SLUGS.has(slug));
  return match ? `/blog/${match}/` : '';
}

function industryBlogTarget(keyword) {
  const value = normaliseKeyword(keyword);
  const match = INDUSTRY_BLOG_TARGETS.find((item) => item.terms.some((term) => value.includes(term)));
  return match && BLOG_SLUGS.has(match.slug) ? `/blog/${match.slug}/` : '';
}

function inferTargetUrl(keyword, group) {
  const value = normaliseKeyword(keyword);

  if (value === 'free website plan') return '/free-website-plan/';

  const exactBlog = exactBlogTarget(keyword);
  if (exactBlog) return exactBlog;

  if (value.includes('website hosting') || value.includes('web hosting') || value.includes('wordpress hosting') || value.includes('managed hosting') || value.includes('shared hosting') || value.includes('new host') || value.includes('hosting provider')) {
    if (value.includes('what should')) return '/blog/what-should-website-hosting-include/';
    if (value.includes('how much')) return '/blog/how-much-does-website-hosting-cost-in-the-uk/';
    if (value.includes('does web hosting affect seo')) return '/blog/does-your-website-host-affect-your-google-rankings/';
    return '/services/website-hosting-security/';
  }

  if (value.includes('wordpress')) {
    if (value.includes('plugin')) return '/blog/5-essential-wordpress-plugins-every-website-needs-in-2025/';
    if (value.includes('training')) return '';
    if (value.includes('developer') || value.includes('development')) return '/services/web-development/';
    return value.includes('south wales') || value.includes('wales')
      ? '/web-design-wales/'
      : '/services/web-design/';
  }

  if (value.includes('digital marketing')) return '';

  if (value.startsWith('web design for')) {
    return industryBlogTarget(keyword) || '';
  }

  const locationTarget = matchingLocationTarget(keyword, group);
  if (locationTarget) return locationTarget;

  const prefix = GROUP_PREFIXES[group];
  const location = bestLocationSlug(keyword);
  if (prefix && location) {
    const target = `/${prefix}-${location}/`;
    if (pageExists(target)) return target;
  }

  if (value.includes('seo agency') || value.includes('seo company') || value.includes('seo service') || value.includes('seo package') || value.includes('seo marketing') || value.includes('local seo') || value.includes('google seo') || value.includes('basic seo')) {
    if (location) {
      const target = `/seo-${location}/`;
      if (pageExists(target)) return target;
    }
    return '/services/local-seo-google-ranking/';
  }

  return SERVICE_FALLBACKS[group] || '';
}

async function get(apiKey, endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${endpoint}?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    const message = json.error || json.message || `${res.status} ${res.statusText}`;
    throw new Error(`${endpoint}: ${message}`);
  }
  return json;
}

async function getManagement(apiKey, endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${MANAGEMENT_BASE}/${endpoint}?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    const message = json.error || json.message || `${res.status} ${res.statusText}`;
    throw new Error(`${endpoint}: ${message}`);
  }
  return json;
}

async function fetchProjectKeywords(apiKey, projectId) {
  const data = await getManagement(apiKey, 'project-keywords', {
    project_id: projectId,
    output: 'json',
  });
  return data.keywords || [];
}

async function fetchOverviewWithFallback(apiKey, projectId) {
  const select = [
    'keyword',
    'country',
    'location',
    'language',
    'position',
    'position_prev',
    'position_diff',
    'url',
    'traffic',
    'traffic_diff',
    'volume',
    'keyword_difficulty',
    'serp_updated',
    'keyword_has_data',
    'keyword_is_frozen',
    'tags',
    'best_position_kind',
  ].join(',');

  let lastError;
  for (let offset = 0; offset <= 10; offset++) {
    const date = dateStr(offset);
    const dateCompared = dateStr(offset + COMPARE_DAYS);
    try {
      const data = await get(apiKey, 'overview', {
        project_id: projectId,
        device: DEVICE,
        date,
        date_compared: dateCompared,
        limit: LIMIT,
        select,
        output: 'json',
      });
      return { data, date, dateCompared };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function normaliseKeyword(value) {
  return String(value || '').trim().toLowerCase();
}

function inferGroup(keyword, tags = []) {
  const tag = tags.find(Boolean);
  if (tag) return tag;

  const value = normaliseKeyword(keyword);
  if (value.includes('seo')) return 'SEO';
  if (value.includes('ecommerce') || value.includes('online shop')) return 'Ecommerce';
  if (value.includes('logo')) return 'Logo Design';
  if (value.includes('email') || value.includes('mailbox')) return 'Professional Email';
  if (value.includes('maintenance')) return 'Website Maintenance';
  if (value.includes('managed') || value.includes('starter')) return 'Managed Starter';
  if (value.includes('development') || value.includes('developer')) return 'Web Development';
  if (value.includes('web design') || value.includes('website design')) return 'Web Design';
  return 'General';
}

function simplifyTracked(row) {
  return {
    keyword: row.keyword,
    country: row.country || '',
    location: row.location || '',
    language: row.language || '',
    position: row.position ?? null,
    previousPosition: row.position_prev ?? null,
    change: row.position_diff ?? null,
    url: row.url || '',
    traffic: row.traffic ?? null,
    trafficDiff: row.traffic_diff ?? null,
    volume: row.volume ?? null,
    keywordDifficulty: row.keyword_difficulty ?? null,
    serpUpdated: row.serp_updated || null,
    hasData: row.keyword_has_data ?? null,
    frozen: row.keyword_is_frozen ?? null,
    tags: row.tags || [],
    bestPositionKind: row.best_position_kind || '',
  };
}

async function main() {
  const targetList = fs.existsSync(KEYWORDS_PATH)
    ? JSON.parse(fs.readFileSync(KEYWORDS_PATH, 'utf8'))
    : [];
  const { apiKey, projectId } = loadConfig();

  console.log(`Fetching Ahrefs Rank Tracker data for project ${projectId} (${DEVICE})...`);
  const [projectKeywords, overview] = await Promise.all([
    fetchProjectKeywords(apiKey, projectId),
    fetchOverviewWithFallback(apiKey, projectId),
  ]);

  const { data, date, dateCompared } = overview;
  const allRows = data.overviews || [];
  const byKeyword = new Map(allRows.map((row) => [normaliseKeyword(row.keyword), row]));
  const targetsByKeyword = new Map(targetList.map((item) => [normaliseKeyword(item.keyword), item]));

  const keywords = projectKeywords.map((item) => {
    const key = normaliseKeyword(item.keyword);
    const row = byKeyword.get(key);
    const target = targetsByKeyword.get(key);
    const tags = item.tags || [];
    const group = target?.group || inferGroup(item.keyword, tags);
    const inferredTargetUrl = inferTargetUrl(item.keyword, group);
    const targetUrl = target?.targetUrl || inferredTargetUrl;
    return {
      keyword: item.keyword,
      group,
      targetUrl,
      targetAbsoluteUrl: absUrl(targetUrl),
      targetSource: target?.targetUrl ? 'manual' : targetUrl ? 'inferred' : 'none',
      trackedInAhrefs: true,
      inTargetList: Boolean(target),
      projectLocation: item.location || '',
      projectLocationId: item.location_id ?? null,
      projectLanguage: item.language || '',
      projectLanguageCode: item.language_code || '',
      ...(row ? simplifyTracked(row) : {
        country: '',
        location: item.location || '',
        language: item.language || '',
        position: null,
        previousPosition: null,
        change: null,
        url: '',
        traffic: null,
        trafficDiff: null,
        volume: null,
        keywordDifficulty: null,
        serpUpdated: null,
        hasData: false,
        frozen: null,
        tags,
        bestPositionKind: '',
      }),
    };
  });

  for (const item of targetList) {
    if (projectKeywords.some((keyword) => normaliseKeyword(keyword.keyword) === normaliseKeyword(item.keyword))) continue;
    const group = item.group || inferGroup(item.keyword);
    const inferredTargetUrl = inferTargetUrl(item.keyword, group);
    const targetUrl = item.targetUrl || inferredTargetUrl;
    keywords.push({
      keyword: item.keyword,
      group,
      targetUrl,
      targetAbsoluteUrl: absUrl(targetUrl),
      targetSource: item.targetUrl ? 'manual' : targetUrl ? 'inferred' : 'none',
      trackedInAhrefs: false,
      inTargetList: true,
      projectLocation: '',
      projectLocationId: null,
      projectLanguage: '',
      projectLanguageCode: '',
      ...{
        country: '',
        location: '',
        language: '',
        position: null,
        previousPosition: null,
        change: null,
        url: '',
        traffic: null,
        trafficDiff: null,
        volume: null,
        keywordDifficulty: null,
        serpUpdated: null,
        hasData: false,
        frozen: null,
        tags: [],
        bestPositionKind: '',
      },
    });
  }

  const cache = {
    fetchedAt: new Date().toISOString(),
    source: 'ahrefs-rank-tracker',
    projectId,
    device: DEVICE,
    date,
    dateCompared,
    trackedKeywordCount: projectKeywords.length,
    overviewKeywordCount: allRows.length,
    keywords,
  };

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');

  const ranking = keywords.filter((row) => row.position !== null).length;
  const missing = keywords.filter((row) => !row.trackedInAhrefs).length;
  console.log(`
Done.
  Date: ${date}
  Compared with: ${dateCompared}
  Ahrefs project keywords fetched: ${projectKeywords.length}
  Ahrefs overview rows fetched: ${allRows.length}
  Tracked list with ranking data: ${ranking}/${keywords.length}
  Missing from Ahrefs Rank Tracker project: ${missing}

Cache saved to: scripts/ahrefs-keywords-cache.json
`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
