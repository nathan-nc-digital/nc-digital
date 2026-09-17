/**
 * Google Search Console Report
 * Run: node scripts/gsc-report.mjs
 *
 * First run: opens browser to authenticate — token saved for future runs.
 * Output: scripts/gsc-report.md (drop this file into Claude)
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CREDENTIALS_PATH = path.join(__dirname, 'gsc-credentials.json');
const TOKEN_PATH       = path.join(__dirname, 'gsc-token.json');
const REPORT_PATH      = path.join(__dirname, 'gsc-report.md');
const REPORT_JSON_PATH = path.join(__dirname, 'gsc-report.json');
const SITE_URL         = 'sc-domain:nc-digital.co.uk';

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

// ── Auth ──────────────────────────────────────────────────────────────────────

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`
❌  Missing credentials file.

1. Go to https://console.cloud.google.com/
2. Create a project → Enable "Google Search Console API"
3. APIs & Services → Credentials → Create → OAuth 2.0 Client ID
4. Application type: Desktop app
5. Download JSON → save as:
   ${CREDENTIALS_PATH}

Then run this script again.
`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
}

async function getAuthClient() {
  const creds = loadCredentials();
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3456');

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2.setCredentials(token);
    // Auto-refresh if needed
    try {
      await oauth2.getAccessToken();
    } catch {
      fs.unlinkSync(TOKEN_PATH);
      return getAuthClient();
    }
    return oauth2;
  }

  // First-time auth — open browser
  const authUrl = oauth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log('\n🔐 Opening browser to authenticate with Google...\n');
  console.log('If browser does not open, visit:\n', authUrl, '\n');

  // Try to open browser
  const open = (await import('child_process')).execSync;
  try { open(`start "" "${authUrl}"`, { stdio: 'ignore' }); } catch {}

  // Local server to catch the OAuth callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:3456');
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2 style="font-family:sans-serif;padding:2rem">✅ Authenticated! You can close this tab.</h2>');
      server.close();
      if (code) resolve(code); else reject(new Error('No code'));
    });
    server.listen(3456);
    server.on('error', reject);
  });

  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('✅ Token saved — future runs will not need browser auth.\n');
  return oauth2;
}

// ── GSC API helpers ───────────────────────────────────────────────────────────

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function query(webmasters, body) {
  const res = await webmasters.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: body,
  });
  return res.data.rows || [];
}

// ── Report sections ───────────────────────────────────────────────────────────

function fmtPct(n)  { return (n * 100).toFixed(1) + '%'; }
function fmtPos(n)  { return n.toFixed(1); }
function fmtNum(n)  { return n.toLocaleString(); }

function tableRows(rows, cols) {
  return rows.map(r => '| ' + cols.map(c => c(r)).join(' | ') + ' |').join('\n');
}

function tableHeader(headers) {
  const sep = headers.map(() => '---');
  return `| ${headers.join(' | ')} |\n| ${sep.join(' | ')} |`;
}

async function buildReport(webmasters) {
  const today     = dateStr(0);
  const d28       = dateStr(28);
  const d56       = dateStr(56);
  const d7        = dateStr(7);
  const d14       = dateStr(14);

  console.log('Fetching data...');

  // 1. Top queries — last 28 days
  const topQueries = await query(webmasters, {
    startDate: d28, endDate: today,
    dimensions: ['query'],
    rowLimit: 25,
    orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
  });

  // 2. Top pages — last 28 days
  const topPages = await query(webmasters, {
    startDate: d28, endDate: today,
    dimensions: ['page'],
    rowLimit: 20,
    orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
  });

  // 3. Quick wins — high impressions, low CTR, position 4–20
  const opportunities = await query(webmasters, {
    startDate: d28, endDate: today,
    dimensions: ['query'],
    rowLimit: 500,
  }).then(rows => rows
    .filter(r => r.impressions >= 20 && r.ctr < 0.05 && r.position >= 4 && r.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20)
  );

  // 3b. Query/page pairs — useful for knowing which page is earning each query
  const queryPages = await query(webmasters, {
    startDate: d28, endDate: today,
    dimensions: ['query', 'page'],
    rowLimit: 500,
  }).then(rows => rows
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 200)
  );

  // 4. Position movers — compare last 7 days vs prior 7 days
  const [recent, prior] = await Promise.all([
    query(webmasters, { startDate: d7,  endDate: today, dimensions: ['query'], rowLimit: 200 }),
    query(webmasters, { startDate: d14, endDate: d7,    dimensions: ['query'], rowLimit: 200 }),
  ]);
  const priorMap = Object.fromEntries(prior.map(r => [r.keys[0], r]));
  const movers = recent
    .filter(r => priorMap[r.keys[0]] && r.impressions >= 10)
    .map(r => {
      const prev = priorMap[r.keys[0]];
      return { query: r.keys[0], pos: r.position, prev: prev.position, delta: prev.position - r.position, clicks: r.clicks };
    })
    .filter(r => Math.abs(r.delta) >= 2)
    .sort((a, b) => b.delta - a.delta);

  const gained = movers.filter(r => r.delta > 0).slice(0, 10);
  const lost   = movers.filter(r => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);

  // 5. Overall totals — 28 days vs prior 28
  const [totals, prevTotals] = await Promise.all([
    query(webmasters, { startDate: d28, endDate: today, dimensions: [] }),
    query(webmasters, { startDate: d56, endDate: d28,   dimensions: [] }),
  ]);
  const t  = totals[0]       || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const pt = prevTotals[0]   || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const diff = (a, b) => b === 0 ? '—' : ((a - b) / b * 100).toFixed(1) + '%';

  const reportData = {
    generatedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    period: {
      startDate: d28,
      endDate: today,
      previousStartDate: d56,
      previousEndDate: d28,
      recentStartDate: d7,
      priorRecentStartDate: d14,
    },
    overview: {
      current: t,
      previous: pt,
      change: {
        clicks: diff(t.clicks, pt.clicks),
        impressions: diff(t.impressions, pt.impressions),
        ctr: diff(t.ctr, pt.ctr),
      },
    },
    topQueries: topQueries.map(rowToObject),
    topPages: topPages.map(rowToObject),
    opportunities: opportunities.map(rowToObject),
    queryPages: queryPages.map(rowToObject),
    gained,
    lost,
  };

  // ── Assemble markdown ──────────────────────────────────────────────────────

  const lines = [];
  const h = (n, t) => lines.push(`\n${'#'.repeat(n)} ${t}\n`);
  const p = (t) => lines.push(t);

  p(`# GSC Report — nc-digital.co.uk`);
  p(`Generated: ${new Date().toLocaleString('en-GB')} · Last 28 days vs prior 28 days\n`);

  h(2, '📊 Overview');
  p(tableHeader(['Metric', 'Last 28 days', 'Prior 28 days', 'Change']));
  p(tableRows([
    { label: 'Clicks',       curr: fmtNum(t.clicks),          prev: fmtNum(pt.clicks),          chg: diff(t.clicks, pt.clicks) },
    { label: 'Impressions',  curr: fmtNum(t.impressions),     prev: fmtNum(pt.impressions),     chg: diff(t.impressions, pt.impressions) },
    { label: 'Avg CTR',      curr: fmtPct(t.ctr),             prev: fmtPct(pt.ctr),             chg: diff(t.ctr, pt.ctr) },
    { label: 'Avg Position', curr: fmtPos(t.position),        prev: fmtPos(pt.position),        chg: '—' },
  ], [r => r.label, r => r.curr, r => r.prev, r => r.chg]));

  h(2, '🔍 Top 25 Queries (last 28 days)');
  p(tableHeader(['Query', 'Clicks', 'Impressions', 'CTR', 'Position']));
  p(tableRows(topQueries, [
    r => r.keys[0],
    r => fmtNum(r.clicks),
    r => fmtNum(r.impressions),
    r => fmtPct(r.ctr),
    r => fmtPos(r.position),
  ]));

  h(2, '📄 Top 20 Pages (last 28 days)');
  p(tableHeader(['Page', 'Clicks', 'Impressions', 'CTR', 'Position']));
  p(tableRows(topPages, [
    r => r.keys[0].replace('https://nc-digital.co.uk', ''),
    r => fmtNum(r.clicks),
    r => fmtNum(r.impressions),
    r => fmtPct(r.ctr),
    r => fmtPos(r.position),
  ]));

  h(2, '⚡ Quick Wins — High impressions, low CTR (pos 4–20)');
  p('_These queries are appearing in search results but not getting clicked. Improving title/meta could lift these._\n');
  if (opportunities.length) {
    p(tableHeader(['Query', 'Impressions', 'CTR', 'Position']));
    p(tableRows(opportunities, [
      r => r.keys[0],
      r => fmtNum(r.impressions),
      r => fmtPct(r.ctr),
      r => fmtPos(r.position),
    ]));
  } else {
    p('_No clear quick wins found in this period._');
  }

  h(2, '📈 Position Gainers (last 7 days vs prior 7)');
  if (gained.length) {
    p(tableHeader(['Query', 'Current pos', 'Previous pos', 'Change', 'Clicks']));
    p(tableRows(gained, [
      r => r.query,
      r => fmtPos(r.pos),
      r => fmtPos(r.prev),
      r => '+' + r.delta.toFixed(1),
      r => fmtNum(r.clicks),
    ]));
  } else { p('_No significant gainers this week._'); }

  h(2, '📉 Position Losers (last 7 days vs prior 7)');
  if (lost.length) {
    p(tableHeader(['Query', 'Current pos', 'Previous pos', 'Change', 'Clicks']));
    p(tableRows(lost, [
      r => r.query,
      r => fmtPos(r.pos),
      r => fmtPos(r.prev),
      r => r.delta.toFixed(1),
      r => fmtNum(r.clicks),
    ]));
  } else { p('_No significant losers this week._'); }

  return { markdown: lines.join('\n'), data: reportData };
}

function rowToObject(row) {
  return {
    keys: row.keys || [],
    query: row.keys?.[0] || '',
    page: row.keys?.[1] || row.keys?.[0] || '',
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    position: row.position || 0,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const auth       = await getAuthClient();
  const webmasters = google.webmasters({ version: 'v3', auth });

  const report = await buildReport(webmasters);
  fs.writeFileSync(REPORT_PATH, report.markdown, 'utf8');
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report.data, null, 2), 'utf8');

  console.log(`\n✅ Report saved to:\n   ${REPORT_PATH}\n`);
  console.log(`✅ JSON saved to:\n   ${REPORT_JSON_PATH}\n`);
  console.log('Drop that file into Claude for analysis.\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
