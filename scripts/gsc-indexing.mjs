import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, 'gsc-credentials.json');
const TOKEN_PATH = path.join(__dirname, 'gsc-token.json');
const SITEMAP_PATH = path.join(process.cwd(), 'dist', 'sitemap-0.xml');
const CACHE_PATH = path.join(__dirname, 'gsc-indexing-cache.json');
const SITE_URL = 'sc-domain:nc-digital.co.uk';
const CONCURRENCY = 5;
const args = new Set(process.argv.slice(2));
const FRESH = args.has('--fresh');

function getAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const config = credentials.installed || credentials.web;
  const auth = new google.auth.OAuth2(config.client_id, config.client_secret, 'http://localhost:3456');
  auth.setCredentials(token);
  return auth;
}

function sitemapUrls() {
  if (!fs.existsSync(SITEMAP_PATH)) {
    throw new Error('Missing dist/sitemap-0.xml. Run npm run build first.');
  }
  const xml = fs.readFileSync(SITEMAP_PATH, 'utf8');
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}

function normaliseResult(url, result) {
  const index = result?.inspectionResult?.indexStatusResult ?? {};
  return {
    url,
    status: index.verdict === 'PASS' ? 'indexed' : 'not-indexed',
    verdict: index.verdict ?? 'UNKNOWN',
    coverageState: index.coverageState ?? 'No coverage reason returned',
    robotsTxtState: index.robotsTxtState ?? null,
    indexingState: index.indexingState ?? null,
    pageFetchState: index.pageFetchState ?? null,
    lastCrawlTime: index.lastCrawlTime ?? null,
    googleCanonical: index.googleCanonical ?? null,
    userCanonical: index.userCanonical ?? null,
    crawledAs: index.crawledAs ?? null,
    inspectedAt: new Date().toISOString(),
  };
}

async function main() {
  const urls = sitemapUrls();
  const previous = fs.existsSync(CACHE_PATH)
    ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
    : { pages: [] };
  const previousByUrl = new Map((previous.pages ?? []).map((page) => [page.url, page]));
  const resultsByUrl = new Map(
    FRESH
      ? []
      : [...previousByUrl].filter(([, page]) => page.status === 'indexed' || page.status === 'not-indexed'),
  );
  const searchconsole = google.searchconsole({ version: 'v1', auth: getAuthClient() });
  const pending = urls.filter((url) => !resultsByUrl.has(url));
  let nextIndex = 0;
  let completed = 0;

  function saveCache() {
    const pages = urls
      .map((url) => resultsByUrl.get(url))
      .filter(Boolean);
    fs.writeFileSync(CACHE_PATH, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      siteUrl: SITE_URL,
      pages,
    }, null, 2));
  }

  async function worker() {
    while (nextIndex < pending.length) {
      const url = pending[nextIndex];
      nextIndex += 1;

      try {
        const response = await searchconsole.urlInspection.index.inspect({
          requestBody: { inspectionUrl: url, siteUrl: SITE_URL },
        });
        resultsByUrl.set(url, normaliseResult(url, response.data));
      } catch (error) {
        resultsByUrl.set(url, {
          url,
          status: 'unknown',
          verdict: 'UNKNOWN',
          coverageState: error.message,
          inspectedAt: new Date().toISOString(),
        });
      }

      completed += 1;
      if (completed % 25 === 0 || completed === pending.length) {
        console.log(`  ${resultsByUrl.size}/${urls.length} (${completed}/${pending.length} refreshed)`);
        saveCache();
      }
    }
  }

  console.log(
    `Inspecting ${pending.length} ${FRESH ? 'fresh' : 'pending'} sitemap URLs in Google Search Console `
    + `(${resultsByUrl.size}/${urls.length} retained)...`,
  );
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));
  saveCache();

  const pages = urls.map((url) => resultsByUrl.get(url)).filter(Boolean);
  const indexed = pages.filter((page) => page.status === 'indexed').length;
  const notIndexed = pages.filter((page) => page.status === 'not-indexed').length;
  const unknown = pages.filter((page) => page.status === 'unknown').length;
  console.log(`Done. Indexed: ${indexed}; Not indexed: ${notIndexed}; Unknown: ${unknown}`);
  console.log(`Cache saved to: ${CACHE_PATH}`);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
