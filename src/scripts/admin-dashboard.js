// Admin home: everything that needs attention today, from one /admin/dashboard/api/summary call.
import { ageLabel } from './data-age.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (v) => (v == null ? '—' : '$' + Number(v).toFixed(2));
const num = (v) => Math.round(v || 0).toLocaleString('en-GB');
const when = (v) => { const a = ageLabel(v, { staleDays: 999, oldDays: 999 }); return a ? a.text.split(' · ')[1] : ''; };
const shortDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const pct = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
const change = (a, b) => { const p = pct(a, b); return p == null ? '' : `<span class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '+' : ''}${p}%</span>`; };
const reportLink = (x) => (x.kind === 'audit' ? `/admin/website-audit/?report=${encodeURIComponent(x.id)}` : `/admin/analytics-reports/?report=${encodeURIComponent(x.id)}`);
const kindLabel = (x) => (x.kind === 'audit' ? 'Website review' : 'SEO report');

function card(label, value, note, href, tone = '') {
  return `<a class="card ${tone}" href="${href}"><span class="card-label">${label}</span><strong>${value}</strong><span class="card-note">${note}</span></a>`;
}

function list(items, empty) {
  return items.length ? `<ul class="list">${items.join('')}</ul>` : `<p class="none">${empty}</p>`;
}

function spendHtml(s) {
  const width = Math.min(100, s.budget ? s.month / s.budget * 100 : 0);
  return `<div class="spend ${s.level}">
    <div class="spend-top"><strong>${money(s.month)}</strong><span>of ${money(s.budget)} monthly budget</span></div>
    <div class="meter"><span style="width:${width}%"></span></div>
    <p class="spend-note">${s.level === 'over' ? 'Over budget this month. Check before running more paid lookups.' : s.level === 'near' ? 'Close to this month’s budget.' : 'Within budget.'} Balance left on the account: <strong>${money(s.balance)}</strong>${s.balanceCheckedAt ? ` <span class="muted">(checked ${esc(when(s.balanceCheckedAt))})</span>` : ''}.</p>
    ${list(s.byTool.map(t => `<li><span>${esc(t.label)} <span class="muted">· ${t.lookups} lookup${t.lookups === 1 ? '' : 's'}</span></span><strong>${money(t.cost)}</strong></li>`), 'No paid lookups recorded this month yet.')}
    <form id="budget-form" class="budget"><label for="budget">Monthly budget ($)</label><input id="budget" type="number" min="1" max="10000" step="1" value="${s.budget}"/><button type="submit">Save</button></form>
    ${s.since === '2026-09-01' ? '<p class="muted small">Tracking started on 24 Sep 2026, so this month only counts lookups from then on.</p>' : ''}
  </div>`;
}

function render(d) {
  const s = d.search, ix = d.indexing, dueClients = d.seoClients.filter(c => c.due);
  const opened = d.shares.opened, unopened = d.shares.unopened;
  $('cards').innerHTML = [
    card('New enquiries', d.enquiries.newCount, d.enquiries.newCount ? 'Waiting for a reply' : 'All caught up', '/admin/crm/inbox/', d.enquiries.newCount ? 'alert' : ''),
    card('Tasks due', d.tasks.length, d.tasks.length ? 'Today or overdue' : 'Nothing due', '/admin/crm/', d.tasks.some(t => t.dueDate < new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })) ? 'alert' : ''),
    card('Opened reports', opened.length, 'Viewed in the last 7 days', '#shares', opened.length ? 'good' : ''),
    card('SEO reports due', dueClients.length, `${d.seoClients.length} saved client${d.seoClients.length === 1 ? '' : 's'}`, '#clients', dueClients.length ? 'warn' : ''),
    card('Pages not indexed', ix.notIndexed, ix.lastChecked ? `Checked ${esc(when(ix.lastChecked))}` : 'Not checked yet', '/admin/indexing/', ix.stuck ? 'warn' : ''),
    card('DataForSEO this month', money(d.spend.month), `Budget ${money(d.spend.budget)}`, '#spend', d.spend.level === 'over' ? 'alert' : d.spend.level === 'near' ? 'warn' : ''),
  ].join('');

  $('enquiries').innerHTML = list(d.enquiries.recent.map(t => `<li><a href="/admin/crm/inbox/?ticket=${encodeURIComponent(t.id)}"><span><strong>${esc(t.name || 'Unknown')}</strong>${t.company ? ` · ${esc(t.company)}` : ''}<span class="sub">${esc(t.subject || '')}</span></span></a><span class="tag ${t.status}">${t.status === 'new' ? 'New' : 'Open'}</span></li>`), 'No open enquiries.');
  $('tasks').innerHTML = list(d.tasks.map(t => `<li><a href="${t.ticketId ? `/admin/crm/inbox/?ticket=${encodeURIComponent(t.ticketId)}` : '/admin/crm/'}"><span>${esc(t.title)}</span></a><span class="tag ${t.dueDate < new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) ? 'late' : ''}">${shortDate(t.dueDate)}</span></li>`), 'No tasks due today.');
  $('shares').innerHTML = `<div class="split"><div><h3>Opened in the last 7 days <span class="muted">· good time to follow up</span></h3>${list(opened.map(x => `<li><a href="${reportLink(x)}"><span><strong>${esc(x.name)}</strong><span class="sub">${kindLabel(x)} · ${x.views} view${x.views === 1 ? '' : 's'}</span></span></a><span class="tag good">${esc(when(x.viewedAt))}</span></li>`), 'No reports opened this week.')}</div>
    <div><h3>Shared but not opened yet</h3>${list(unopened.map(x => `<li><a href="${reportLink(x)}"><span><strong>${esc(x.name)}</strong><span class="sub">${kindLabel(x)}</span></span></a><span class="tag">Shared ${esc(when(x.sharedAt))}</span></li>`), 'Every report shared in the last 30 days has been opened.')}</div></div>`;
  $('clients').innerHTML = d.seoClients.length ? list(d.seoClients.map(c => `<li><a href="/admin/analytics-reports/"><span><strong>${esc(c.name)}</strong><span class="sub">${c.lastReport ? `Last report ${esc(when(c.lastReport))}` : 'No report yet'}</span></span></a><span class="tag ${c.due ? 'warn' : 'good'}">${c.due ? 'Due this month' : 'Done'}</span></li>`), '') : '<p class="none">No saved SEO clients yet. Add them on the <a href="/admin/analytics-reports/">SEO reports</a> page for one-click monthly reports.</p>';

  const searchAge = s ? ageLabel(s.generatedAt, { staleDays: 2, oldDays: 7 }) : null;
  $('search').innerHTML = s ? `<div class="metrics">
      <div><span>Clicks</span><strong>${num(s.current.clicks)}</strong>${change(s.current.clicks, s.previous.clicks)}</div>
      <div><span>Impressions</span><strong>${num(s.current.impressions)}</strong>${change(s.current.impressions, s.previous.impressions)}</div>
      <div><span>Avg position</span><strong>${s.current.position.toFixed(1)}</strong><span class="muted">was ${s.previous.position.toFixed(1)}</span></div>
    </div><p class="muted small">Last 28 days vs the 28 before · ${s.gained} searches moved up, ${s.lost} moved down this week · <span class="${searchAge?.tone}">data from ${esc(searchAge?.text || '')}</span></p>`
    : '<p class="none">No Search Console data saved yet. <a href="/admin/gsc/">Open Search Console insights</a> to load it.</p>';
  $('indexing').innerHTML = ix.total ? `<div class="metrics">
      <div><span>Indexed</span><strong>${ix.indexed}</strong><span class="muted">of ${ix.total}</span></div>
      <div><span>Not indexed</span><strong class="${ix.notIndexed ? 'down' : ''}">${ix.notIndexed}</strong></div>
      <div><span>Stuck 7+ days</span><strong class="${ix.stuck ? 'down' : ''}">${ix.stuck}</strong></div>
    </div>${ix.stuckPages.length ? `<h3>Still not indexed after a week</h3>${list(ix.stuckPages.map(p => `<li><a href="/admin/indexing/"><span>${esc(new URL(p.url).pathname)}<span class="sub">${esc(p.coverageState || 'Not checked yet')}</span></span></a></li>`), '')}` : ''}
    ${ix.pending ? `<p class="muted small">${ix.pending} page${ix.pending === 1 ? '' : 's'} not checked yet.</p>` : ''}`
    : '<p class="none">No indexing check has run yet. <a href="/admin/indexing/">Run the first check</a>.</p>';
  $('spend').innerHTML = spendHtml(d.spend);
  $('budget-form').addEventListener('submit', saveBudget);
  $('updated').textContent = 'Updated ' + new Date(d.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

async function saveBudget(event) {
  event.preventDefault();
  const r = await fetch('/admin/dashboard/api/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ budget: Number($('budget').value) }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { $('notice').hidden = false; $('notice').textContent = data.error || 'The budget could not be saved.'; return; }
  $('spend').innerHTML = spendHtml(data);
  $('budget-form').addEventListener('submit', saveBudget);
}

async function load() {
  const hour = new Date().getHours();
  $('greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, Nathan.`;
  $('today').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  try {
    const r = await fetch('/admin/dashboard/api/summary'), data = await r.json();
    if (!r.ok) throw new Error(data.error);
    render(data);
  } catch (error) {
    $('notice').hidden = false;
    $('notice').textContent = error.message || 'The dashboard could not load. Please refresh.';
  }
}

$('reload').addEventListener('click', load);
load();
