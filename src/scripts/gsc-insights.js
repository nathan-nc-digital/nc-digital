// GSC Insights page: loads the saved Search Console snapshot for the chosen property, refreshes it
// from Google when it is missing or more than 12 hours old, and renders the insight tables.
import { queryIntent, recommendedAction, issueType, priorityActions, pagePath } from '../lib/gsc-insights.js';
import { ageLabel } from './data-age.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const AUTO_REFRESH_HOURS = 12;
let site = '', report = null, busy = false;

const fmtNumber = (v) => (v == null ? '-' : Math.round(v).toLocaleString('en-GB'));
const fmtPct = (v) => (v == null ? '-' : `${(v * 100).toFixed(v * 100 < 1 ? 2 : 1)}%`);
const fmtPos = (v) => (v == null ? '-' : Number(v).toFixed(1));
const fmtDate = (v) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not refreshed yet');
const link = (url, cls = 'url') => `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener">${esc(pagePath(url, site))}</a>`;

async function api(route, body) {
  const r = await fetch('/admin/gsc/api/' + route + (body ? '' : (route.includes('?') ? '&' : '?') + 'site=' + encodeURIComponent(site)), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Google could not be reached. Please try again.');
  return data;
}

function notice(text, tone = '') {
  $('notice').hidden = !text;
  $('notice').className = 'notice ' + tone;
  $('notice').textContent = text || '';
}

function panel(id, title, note, badge, head, rows) {
  return `<section class="panel"${id ? ` id="${id}"` : ''}><div class="panel-head"><div><div class="panel-title">${title}</div><div class="panel-note">${note}</div></div>${badge ? `<span class="pill${badge.tone ? ' ' + badge.tone : ''}">${badge.text}</span>` : ''}</div>
    ${rows.length ? `<table${id === 'opportunities' ? ' id="insights"' : ''}><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="panel-empty">Nothing to show for this period.</p>'}</section>`;
}

function metricRow(row, first) {
  return `<tr><td data-label="${first.label}">${first.html}</td><td data-label="Clicks"><span class="num">${fmtNumber(row.clicks)}</span></td><td data-label="Impressions"><span class="num">${fmtNumber(row.impressions)}</span></td><td data-label="CTR"><span class="num">${fmtPct(row.ctr)}</span></td><td data-label="Position"><span class="num">${fmtPos(row.position)}</span></td>`;
}

// "Since your last refresh": what moved between this refresh and an earlier one.
function sinceHtml(since) {
  if (!since) return `<section class="panel since" id="since"><div class="panel-head"><div><div class="panel-title">Since your last refresh</div><div class="panel-note">This is the first refresh saved for this property. Changes will show here after the next one.</div></div></div></section>`;
  const labels = { clicks: 'Clicks', impressions: 'Impressions', ctr: 'CTR', position: 'Avg position' };
  const fmt = { clicks: fmtNumber, impressions: fmtNumber, ctr: fmtPct, position: fmtPos };
  const chip = ({ key, previous, current }) => {
    const diff = current - previous, better = key === 'position' ? diff < 0 : diff > 0;
    const same = key === 'ctr' ? Math.abs(diff) < 0.00005 : key === 'position' ? Math.abs(diff) < 0.05 : Math.round(diff) === 0;
    const shown = key === 'ctr' ? `${diff > 0 ? '+' : ''}${(diff * 100).toFixed(2)} pts` : key === 'position' ? `${diff < 0 ? '▲ ' : '▼ '}${Math.abs(diff).toFixed(1)}` : `${diff > 0 ? '+' : ''}${fmtNumber(diff)}`;
    return `<div class="since-chip ${same ? '' : better ? 'good' : 'bad'}"><span>${labels[key]}</span><strong>${fmt[key](previous)} → ${fmt[key](current)}</strong><em>${same ? 'no change' : shown}</em></div>`;
  };
  const item = (main, sub, tag, tone) => `<li><span><strong>${main}</strong><small>${sub}</small></span><span class="since-tag ${tone}">${tag}</span></li>`;
  const block = (title, items, empty) => `<h4>${title}</h4>${items.length ? `<ul class="since-list">${items.join('')}</ul>` : `<p class="since-none">${empty}</p>`}`;
  const plural = (n, word) => `${fmtNumber(n)} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
  const stats = (m) => `${plural(m.impressions, 'impression')} · ${plural(m.clicks, 'click')}`;
  const pageSub = (m) => `${fmtNumber(m.clicksBefore)} → ${fmtNumber(m.clicksNow)} clicks · ${fmtNumber(m.impressionsBefore)} → ${fmtNumber(m.impressionsNow)} impressions`;
  const when = new Date(since.previousAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const detail = since.detailed ? `<div class="since-cols">
      <div class="since-col good">
        <h3>▲ Improved</h3>
        ${block('Searches ranking higher', since.rankingsUp.map(m => item(esc(m.query), stats(m), `${fmtPos(m.from)} → ${fmtPos(m.to)}`, 'good')), 'No searches moved up by a position or more.')}
        ${block('New searches you now appear for', since.newSearches.map(m => item(esc(m.query), stats(m), `pos ${fmtPos(m.position)}`, 'good')), 'No new searches.')}
        ${block('Pages gaining', since.pagesUp.map(m => item(esc(pagePath(m.page, site)), pageSub(m), m.clicks ? `+${plural(m.clicks, 'click')}` : `+${fmtNumber(m.impressions)} impr.`, 'good')), 'No pages gained clicks or impressions.')}
      </div>
      <div class="since-col bad">
        <h3>▼ Declined</h3>
        ${block('Searches ranking lower', since.rankingsDown.map(m => item(esc(m.query), stats(m), `${fmtPos(m.from)} → ${fmtPos(m.to)}`, 'bad')), 'No searches dropped by a position or more.')}
        ${block('Searches you no longer appear for', since.lostSearches.map(m => item(esc(m.query), 'had ' + stats(m), `was ${fmtPos(m.position)}`, 'bad')), 'No searches dropped out.')}
        ${block('Pages losing', since.pagesDown.map(m => item(esc(pagePath(m.page, site)), pageSub(m), m.clicks ? plural(m.clicks, 'click') : `${fmtNumber(m.impressions)} impr.`, 'bad')), 'No pages lost clicks or impressions.')}
      </div>
    </div>` : '<p class="since-none">Detailed search and page changes will show from the next refresh.</p>';
  return `<section class="panel since" id="since"><div class="panel-head"><div><div class="panel-title">Since your last refresh</div><div class="panel-note">Compared with the refresh on ${esc(when)}. Both cover the last 28 days, so this shows how the picture has moved since then (top 500 searches and pages).</div></div></div>
    <div class="since-chips">${since.totals.map(chip).join('')}</div>${detail}</section>`;
}

function render() {
  if (!report) { $('out').innerHTML = `<div class="empty">No Search Console data for this property yet. Press <strong>Refresh from Google</strong>.</div>`; return; }
  const cur = report.overview.current, prev = report.overview.previous, ch = report.overview.change, p = report.period;
  const actions = priorityActions(report), opp = report.opportunities, pairs = report.queryPages;
  const sortHead = (key, label) => `<th><button class="sort-button" type="button" data-sort="${key}">${label}</button></th>`;
  $('out').innerHTML = `
  <section class="stats">
    <div class="stat"><div class="label">Last Refresh</div><div class="value" style="font-size:1rem">${fmtDate(report.generatedAt)}</div></div>
    <div class="stat"><div class="label">Clicks</div><div class="value">${fmtNumber(cur.clicks)}</div><div class="delta">Prior: ${fmtNumber(prev.clicks)} · ${esc(ch.clicks)}</div></div>
    <div class="stat"><div class="label">Impressions</div><div class="value">${fmtNumber(cur.impressions)}</div><div class="delta">Prior: ${fmtNumber(prev.impressions)} · ${esc(ch.impressions)}</div></div>
    <div class="stat"><div class="label">Avg CTR / Position</div><div class="value">${fmtPct(cur.ctr)} / ${fmtPos(cur.position)}</div><div class="delta">${esc(p.startDate)} to ${esc(p.endDate)}</div></div>
  </section>
  <section class="stats">
    <button class="stat" type="button" data-jump="opportunities"><div class="label">Quick Wins</div><div class="value">${opp.length}</div></button>
    <button class="stat" type="button" data-jump="lost"><div class="label">Position Losers</div><div class="value">${report.lost.length}</div></button>
    <button class="stat" type="button" data-jump="gained"><div class="label">Position Gainers</div><div class="value">${report.gained.length}</div></button>
    <button class="stat" type="button" data-jump="query-pages"><div class="label">Query/Page Pairs</div><div class="value">${pairs.length}</div></button>
  </section>
  ${sinceHtml(report.sinceLast)}
  ${panel('priority-actions', 'Priority Actions', 'A short list of the clearest things to work on next from GSC data.', { text: `${actions.length} actions`, tone: 'quick-win' }, '<th>Issue</th><th>Query</th><th>Why it matters</th><th>Next move</th>',
    actions.map(a => `<tr><td data-label="Issue"><span class="pill ${a.tone}">${a.type}</span></td><td data-label="Query"><span class="query">${esc(a.title)}</span></td><td data-label="Why"><span class="muted">${esc(a.detail)}</span></td><td data-label="Next move"><span class="muted">${esc(a.action)}</span></td></tr>`))}
  <div class="filters">
    <input id="search" type="search" placeholder="Search query, page, intent, or action" />
    <select id="issue"><option value="">All issue types</option><option value="quick-win">Quick wins</option><option value="low-ctr">High impressions / low CTR</option><option value="page-two-plus">Page 2+</option><option value="monitor">Monitor</option></select>
    <select id="intent"><option value="">All intents</option><option value="local">Local</option><option value="commercial">Commercial</option><option value="informational">Informational</option><option value="mixed">Mixed</option></select>
    <button id="reset-filters" type="button">Reset filters</button>
  </div>
  ${panel('opportunities', 'Suggested Next Actions', 'Queries with impressions but weak click-through or positions close enough to push.', { text: `${opp.length} opportunities`, tone: 'quick-win' },
    `<th>Query</th>${sortHead('clicks', 'Clicks')}${sortHead('impressions', 'Impressions')}${sortHead('ctr', 'CTR')}${sortHead('position', 'Position')}<th>Intent</th><th>Action</th>`,
    opp.map(row => { const issue = issueType(row), intent = queryIntent(row.query), action = recommendedAction(row);
      return `<tr data-search="${esc(`${row.query} ${intent} ${action}`.toLowerCase())}" data-issue="${issue}" data-intent="${intent}" data-clicks="${row.clicks}" data-impressions="${row.impressions}" data-ctr="${row.ctr}" data-position="${row.position}">
        <td data-label="Query"><span class="query">${esc(row.query)}</span> <span class="pill ${issue}">${issue.replaceAll('-', ' ')}</span></td><td data-label="Clicks"><span class="num">${fmtNumber(row.clicks)}</span></td><td data-label="Impressions"><span class="num">${fmtNumber(row.impressions)}</span></td><td data-label="CTR"><span class="num">${fmtPct(row.ctr)}</span></td><td data-label="Position"><span class="num">${fmtPos(row.position)}</span></td><td data-label="Intent"><span class="pill ${intent}">${intent}</span></td><td data-label="Action"><span class="muted">${esc(action)}</span></td></tr>`; }))}
  ${panel('query-pages', 'Queries By Ranking Page', 'Shows which page Google is pairing with each query so you can spot mismatches or pages that need strengthening.', { text: `${pairs.length} rows` },
    '<th>Query / Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th><th>Action</th>',
    pairs.map(row => metricRow(row, { label: 'Query', html: `<span class="query">${esc(row.query)}</span>${link(row.page)}` }) + `<td data-label="Action"><span class="muted">${esc(recommendedAction(row))}</span></td></tr>`))}
  ${panel('', 'Top Queries', 'Queries with the most clicks in the last 28 days.', null, '<th>Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th>',
    report.topQueries.map(row => metricRow(row, { label: 'Query', html: `<span class="query">${esc(row.query)}</span>` }) + '</tr>'))}
  ${panel('', 'Top Pages', 'Pages with the most clicks in the last 28 days.', null, '<th>Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th>',
    report.topPages.map(row => metricRow(row, { label: 'Page', html: link(row.page || row.query, 'query') }) + '</tr>'))}
  ${panel('lost', 'Position Losers', 'Queries that fell over the last 7 days compared with the prior 7 days.', null, '<th>Query</th><th>Current</th><th>Previous</th><th>Change</th><th>Clicks</th><th>Action</th>',
    report.lost.map(row => `<tr><td data-label="Query"><span class="query">${esc(row.query)}</span></td><td data-label="Current"><span class="num">${fmtPos(row.pos)}</span></td><td data-label="Previous"><span class="num">${fmtPos(row.prev)}</span></td><td data-label="Change"><span class="down">${row.delta.toFixed(1)}</span></td><td data-label="Clicks"><span class="num">${fmtNumber(row.clicks)}</span></td><td data-label="Action"><span class="muted">Check the ranking page, add internal links, and compare the page title against current SERP intent.</span></td></tr>`))}
  ${panel('gained', 'Position Gainers', 'Queries that improved over the last 7 days compared with the prior 7 days.', null, '<th>Query</th><th>Current</th><th>Previous</th><th>Change</th><th>Clicks</th><th>Action</th>',
    report.gained.map(row => `<tr><td data-label="Query"><span class="query">${esc(row.query)}</span></td><td data-label="Current"><span class="num">${fmtPos(row.pos)}</span></td><td data-label="Previous"><span class="num">${fmtPos(row.prev)}</span></td><td data-label="Change"><span class="up">+${row.delta.toFixed(1)}</span></td><td data-label="Clicks"><span class="num">${fmtNumber(row.clicks)}</span></td><td data-label="Action"><span class="muted">Protect the gain with relevant internal links and avoid changing the page intent.</span></td></tr>`))}`;
  wireTable();
}

function wireTable() {
  const tbody = document.querySelector('#insights tbody');
  const rows = tbody ? [...tbody.rows] : [];
  const sortButtons = [...document.querySelectorAll('.sort-button')];
  const apply = () => {
    const q = $('search').value.trim().toLowerCase(), issue = $('issue').value, intent = $('intent').value;
    for (const row of rows) row.style.display = (!q || row.dataset.search.includes(q)) && (!issue || row.dataset.issue === issue) && (!intent || row.dataset.intent === intent) ? '' : 'none';
  };
  $('search').addEventListener('input', apply);
  $('issue').addEventListener('change', apply);
  $('intent').addEventListener('change', apply);
  $('reset-filters').addEventListener('click', () => { $('search').value = ''; $('issue').value = ''; $('intent').value = ''; sortButtons.forEach(b => delete b.dataset.direction); apply(); });
  document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => document.getElementById(b.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  for (const button of sortButtons) button.addEventListener('click', () => {
    const key = button.dataset.sort, direction = button.dataset.direction === 'asc' ? 'desc' : 'asc';
    sortButtons.forEach(b => delete b.dataset.direction);
    button.dataset.direction = direction;
    rows.sort((a, b) => (Number(a.dataset[key]) - Number(b.dataset[key])) * (direction === 'asc' ? 1 : -1));
    rows.forEach(r => tbody.appendChild(r));
  });
}

function showAge() {
  const age = report ? ageLabel(report.generatedAt, { staleDays: 1, oldDays: 7 }) : null;
  $('age').textContent = age ? `Data from ${age.text}` : '';
  $('age').className = 'age ' + (age?.tone || '');
}

async function refresh() {
  if (busy || !site) return;
  busy = true; $('refresh').disabled = true; $('refresh').textContent = 'Refreshing…';
  notice('Fetching the last 28 days from Google Search Console…');
  try { report = (await api('refresh', { site })).report; notice(''); render(); }
  catch (error) { notice(error.message, 'error'); }
  finally { busy = false; $('refresh').disabled = false; $('refresh').textContent = 'Refresh from Google'; showAge(); }
}

async function load() {
  notice('');
  $('out').innerHTML = '<div class="empty">Loading saved data…</div>';
  try { report = (await api('report')).report; } catch (error) { report = null; notice(error.message, 'error'); }
  render(); showAge();
  if (!report || Date.now() - Date.parse(report.generatedAt) > AUTO_REFRESH_HOURS * 3600000) refresh();
}

async function init() {
  $('refresh').addEventListener('click', refresh);
  $('site').addEventListener('change', () => {
    site = $('site').value;
    try { localStorage.setItem('gsc-site', site); } catch {}
    history.replaceState(null, '', '?site=' + encodeURIComponent(site));
    load();
  });
  try {
    const { sites, defaultSite } = await api('sites');
    let saved = new URLSearchParams(location.search).get('site');
    try { saved ||= localStorage.getItem('gsc-site'); } catch {}
    site = sites.some(s => s.site === saved) ? saved : defaultSite;
    $('site').innerHTML = sites.map(s => `<option value="${esc(s.site)}"${s.site === site ? ' selected' : ''}>${esc(s.site.replace('sc-domain:', ''))}</option>`).join('');
  } catch (error) {
    notice(error.message, 'error');
    site = 'sc-domain:nc-digital.co.uk';
    $('site').innerHTML = `<option value="${site}">nc-digital.co.uk</option>`;
  }
  load();
}

init();
