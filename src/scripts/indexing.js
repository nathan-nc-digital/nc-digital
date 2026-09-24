// Google Indexing page: live URL Inspection results for every page in the property's sitemap.
// A check runs in small steps (20 pages each) that this page repeats until nothing is left; closing
// the tab pauses it and "Resume" carries on from the saved results.
import { coverageAdvice, daysSince, pagePath } from '../lib/gsc-insights.js';
import { ageLabel } from './data-age.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LABELS = { indexed: 'Indexed', 'not-indexed': 'Not indexed', unknown: 'Unknown / error', pending: 'Not checked yet' };
let site = '', state = null, running = false, stopRequested = false;

async function api(route, body) {
  const r = await fetch('/admin/indexing/api/' + route + (body ? '' : '?site=' + encodeURIComponent(site)), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site, ...body }) } : {});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Google could not be reached. Please try again.');
  return data;
}

function notice(text, tone = '') {
  $('notice').hidden = !text;
  $('notice').className = 'notice ' + tone;
  $('notice').textContent = text || '';
}

const stuck = (p) => p.status !== 'indexed' && daysSince(p.firstSeen) >= 7;
const fmtDate = (v) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

function render() {
  const pages = state?.pages || [], count = (s) => pages.filter(p => p.status === s).length;
  const age = ageLabel(state?.lastChecked, { staleDays: 7, oldDays: 30 });
  $('age').textContent = age ? `Last checked ${age.text}` : 'Not checked yet';
  $('age').className = 'age ' + (age?.tone || 'old');
  $('stats').innerHTML = [
    ['indexed', 'Indexed', count('indexed')], ['not-indexed', 'Not indexed', count('not-indexed')], ['stuck', 'Not indexed after 7+ days', pages.filter(stuck).length],
    ['pending', 'Not checked yet', count('pending')], ['unknown', 'Unknown / error', count('unknown')],
  ].map(([key, label, n]) => `<button class="stat" type="button" data-status-filter="${key}"><div class="label">${label}</div><div class="value">${n}</div></button>`).join('');
  document.querySelectorAll('[data-status-filter]').forEach(b => b.addEventListener('click', () => { $('status').value = b.dataset.statusFilter; applyFilters(); }));
  $('rows').innerHTML = pages.map(p => {
    const advice = coverageAdvice(p), days = daysSince(p.firstSeen);
    return `<tr data-status="${p.status}" data-stuck="${stuck(p)}" data-search="${esc(`${p.url} ${p.coverageState || ''}`.toLowerCase())}">
      <td data-label="Page"><a class="url" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(pagePath(p.url, site))}</a>${p.status !== 'indexed' && days != null ? `<span class="muted small">In sitemap ${days === 0 ? 'since today' : `for ${days} day${days === 1 ? '' : 's'}`}</span>` : ''}</td>
      <td data-label="Status"><span class="pill ${p.status}">${LABELS[p.status] || p.status}</span></td>
      <td data-label="Why">${p.status === 'pending' ? '<span class="muted">-</span>' : esc(p.coverageState || '-')}${advice && p.status !== 'pending' ? `<span class="advice">${esc(advice)}</span>` : ''}</td>
      <td data-label="Last crawl" class="muted">${fmtDate(p.lastCrawlTime)}</td>
      <td data-label="Canonical">${p.googleCanonical && p.googleCanonical !== p.url ? `<a class="url" href="${esc(p.googleCanonical)}" target="_blank" rel="noopener">${esc(pagePath(p.googleCanonical, site))}</a>` : p.googleCanonical ? '<span class="muted">Same page</span>' : '-'}</td>
      <td data-label="Checked" class="muted">${fmtDate(p.inspectedAt)}</td></tr>`;
  }).join('');
  $('empty').hidden = pages.length > 0;
  applyFilters();
  const run = state?.run;
  $('progress').hidden = !run?.running;
  if (run?.running) {
    const total = pages.length, left = run.remaining;
    $('progress-copy').textContent = `${left} page${left === 1 ? '' : 's'} left to check${running ? '…' : '. The check is paused.'}`;
    $('progress-bar').style.width = total ? `${Math.round(100 * (1 - left / total))}%` : '0%';
    $('resume').hidden = running;
  }
  $('check-problems').disabled = $('check-all').disabled = running;
}

function applyFilters() {
  const q = $('search').value.trim().toLowerCase(), status = $('status').value;
  for (const row of $('rows').rows) {
    const matches = !status || (status === 'stuck' ? row.dataset.stuck === 'true' : row.dataset.status === status);
    row.style.display = (!q || row.dataset.search.includes(q)) && matches ? '' : 'none';
  }
}

async function loop() {
  if (running) return;
  running = true; stopRequested = false; render();
  try {
    while (state?.run?.running && !stopRequested) state = await api('step', {}), render();
    if (!stopRequested) notice('Check complete.');
  } catch (error) { notice(error.message, 'error'); }
  finally { running = false; render(); }
}

async function start(mode) {
  notice(mode === 'all' ? 'Reading the sitemap and starting a full check…' : 'Reading the sitemap and checking new and problem pages…');
  try { state = await api('start', { mode }); notice(''); render(); loop(); }
  catch (error) { notice(error.message, 'error'); }
}

async function load() {
  notice('');
  try { state = await api('status'); render(); if (state.run?.running && !state.run.error) loop(); else if (state.run?.error) notice(state.run.error, 'error'); }
  catch (error) { notice(error.message, 'error'); }
}

async function init() {
  $('search').addEventListener('input', applyFilters);
  $('status').addEventListener('change', applyFilters);
  $('check-problems').addEventListener('click', () => start('problems'));
  $('check-all').addEventListener('click', () => start('all'));
  $('resume').addEventListener('click', loop);
  $('stop').addEventListener('click', async () => { stopRequested = true; try { state = await api('stop', {}); } catch {} notice('Check stopped. Results so far are saved.'); render(); });
  $('site').addEventListener('change', () => {
    site = $('site').value;
    try { localStorage.setItem('gsc-site', site); } catch {}
    history.replaceState(null, '', '?site=' + encodeURIComponent(site));
    load();
  });
  try {
    const r = await fetch('/admin/gsc/api/sites'), data = await r.json();
    if (!r.ok) throw new Error(data.error);
    let saved = new URLSearchParams(location.search).get('site');
    try { saved ||= localStorage.getItem('gsc-site'); } catch {}
    site = data.sites.some(s => s.site === saved) ? saved : data.defaultSite;
    $('site').innerHTML = data.sites.map(s => `<option value="${esc(s.site)}"${s.site === site ? ' selected' : ''}>${esc(s.site.replace('sc-domain:', ''))}</option>`).join('');
  } catch (error) {
    notice(error?.message || 'Search Console properties could not be loaded.', 'error');
    site = 'sc-domain:nc-digital.co.uk';
    $('site').innerHTML = `<option value="${site}">nc-digital.co.uk</option>`;
  }
  load();
}

init();
