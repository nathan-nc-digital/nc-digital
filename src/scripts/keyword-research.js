const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? esc(u.href) : '#'; } catch { return '#'; } };
const fmt = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('en-GB').format(value);
const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Date unavailable' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const title = value => value.replace(/\b\p{L}/gu, c => c.toUpperCase());
let current = null, busy = false, locationVersion = 0;
async function api(path, body) {
  const response = await fetch(`/admin/keyword-research/api/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
  if (response.status === 401) throw new Error('Your admin session has expired. Refresh and sign in again.');
  let data; try { data = await response.json(); } catch { throw new Error('The server did not return a report. Check saved research before retrying.'); }
  if (!response.ok) throw new Error(data.error || 'Research is temporarily unavailable.');
  return data;
}
function notice(message, kind = '') { $('notice').hidden = !message; $('notice').className = `notice ${kind}`; $('notice').textContent = message; }
function setBusy(value) { busy = value; $('research-fields').disabled = value; for (const id of ['load-report', 'refresh-report']) $(id).disabled = value; $('research-button').textContent = value ? 'Researching…' : 'Research keywords ↗'; }
async function history() {
  const { reports } = await api('history');
  $('saved').innerHTML = '<option value="">Choose a previous report…</option>' + reports.map(r => `<option value="${esc(r.id)}">${esc(title(r.query))} · ${esc(date(r.created_at))}${r.status !== 'complete' ? ` · ${esc(r.status)}` : ''}</option>`).join('');
}
function fields() { return { query: $('query').value, location: $('location').value, service: $('service').value, website: $('website').value, services: $('services').value }; }
function fill(input) { $('query').value = title(input.query); $('location').value = input.location.name; $('service').value = input.service; $('website').value = input.website; $('services').value = input.extra.join(', '); }
async function research(input) {
  if (busy) return;
  setBusy(true); notice('Checking local Google results and gathering keyword data. This usually takes 20–60 seconds. Your report will be saved automatically.', 'loading');
  try { const result = await api('research', input); render(result); notice(result.cached ? 'Opened saved research. No new API lookup was made.' : 'Research saved. Review the keyword evidence and confirm the client’s services before building the page plan.'); await history(); $('saved').value = result.id; }
  catch (e) { notice(e.name === 'TimeoutError' ? 'The request timed out. Check saved research before starting another paid lookup.' : e.message, 'error'); }
  finally { setBusy(false); }
}
function render(result) {
  current = result;
  const r = result.report;
  $('report').hidden = false; $('empty').hidden = true;
  fill(r.input);
  $('report-title').textContent = title(r.input.query);
  $('report-meta').textContent = `${date(r.fetchedAt)} · ${r.input.location.name} · ${r.keywords.length} phrases · Reported API cost: $${r.cost.usd.toFixed(4)} USD${r.warnings.length ? ' (partial results; failed call charges may be missing)' : ''}`;
  $('warnings').innerHTML = r.warnings.map(x => `<p class="notice warn">${esc(x)}</p>`).join('');
  const main = r.keywords.find(x => x.keyword === r.input.query) || r.keywords[0];
  const local = r.keywords.filter(x => x.local);
  const stat = (label, value, note) => `<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;
  $('summary').innerHTML = stat('Local keyword targets', local.length, `${local.filter(x => x.volume !== null).length} with reported volume`) + stat('Main phrase · UK searches / mo', fmt(main?.volume), 'Estimated demand for this exact phrase') + stat('Main phrase · SEO difficulty', fmt(main?.difficulty), '0–100 · not advertising competition') + stat('Suggested page groups', r.pages.length, 'Review services before creating pages');
  $('recommendation').innerHTML = `<p class="eyebrow">START WITH THE MAIN SERVICE PAGE</p><h3 class="keyword-main">${esc(r.input.query)}</h3><p>Use this topic in the page title, main heading and natural copy. Cover close variants on the same page, then consider separate pages for distinct services.</p><p>${main?.volume === null ? 'Search volume is unreported for this phrase. Keep it as the core service target, but do not treat that as proof of demand.' : `${fmt(main?.volume)} estimated UK searches per month for this phrase. This is not a forecast of visits or enquiries.`}</p>`;
  $('methodology').textContent = r.methodology;
  $('filter').value = ''; $('scope').value = 'all'; $('sort').value = 'priority';
  renderRows(); renderTrend(main); renderPages(); renderCompetitors(); renderQuestions();
  const u = new URL(location.href); u.searchParams.set('report', result.id); window.history.replaceState(null, '', u);
}
function filteredRows() {
  if (!current) return [];
  const filter = $('filter').value.toLowerCase(); const scope = $('scope').value;
  return current.report.keywords.filter(x => x.keyword.includes(filter) && (scope === 'all' || (scope === 'local' ? x.local : !x.local))).sort((a, b) => $('sort').value === 'volume' ? (b.volume ?? -1) - (a.volume ?? -1) : $('sort').value === 'difficulty' ? (a.difficulty ?? 101) - (b.difficulty ?? 101) : b.score - a.score);
}
function renderRows() {
  const rows = filteredRows(); $('row-count').textContent = `${rows.length} keywords`;
  $('keyword-rows').innerHTML = rows.length ? rows.map(x => `<tr><td><button class="trend-select" type="button" data-keyword="${esc(x.keyword)}" title="Show search trend">${esc(x.keyword)}</button><small>${esc(x.reason)}</small><small>${esc(x.origin)}${x.updatedAt ? ` · Metrics updated ${esc(date(x.updatedAt))}` : ''}</small></td><td><span class="badge ${esc(x.priority.toLowerCase().replaceAll(' ', '-'))}">${esc(x.priority)}</span><small>Planning score ${x.score}/100</small></td><td>${fmt(x.volume)}</td><td>${fmt(x.difficulty)}</td><td>${x.cpc === null ? '—' : '$' + x.cpc.toFixed(2)}</td><td>${x.adsCompetition === null ? '—' : Math.round(x.adsCompetition * 100) + '%'}</td><td>${esc(title(x.intent))}<small>${esc(x.intentSource)}</small></td></tr>`).join('') : '<tr><td colspan="7" class="no-results">No keywords match these filters.</td></tr>';
}
function renderTrend(row) {
  if (!row) return;
  const months = row.monthly;
  const max = Math.max(1, ...months.map(x => x.volume || 0));
  $('trend').innerHTML = `<p class="trend-title">${esc(row.keyword)}</p>` + (months.length ? `<div class="chart" role="img" aria-label="Monthly search volume for ${esc(row.keyword)}: ${esc(months.map(x => `${x.year}-${String(x.month).padStart(2, '0')}: ${fmt(x.volume)}`).join(', '))}">${months.map(x => `<div class="chart-col"><div class="chart-bar ${x.volume === null ? 'missing' : ''}" style="height:${x.volume === null ? 3 : Math.max(2, x.volume / max * 100)}%" title="${x.year}-${x.month}: ${fmt(x.volume)} searches"></div></div>`).join('')}</div><div class="chart-labels">${months.map(x => `<span>${new Date(x.year, x.month - 1).toLocaleString('en-GB', { month: 'short' })}</span>`).join('')}</div><p class="hint">${months[0].year}-${String(months[0].month).padStart(2, '0')} to ${months.at(-1).year}-${String(months.at(-1).month).padStart(2, '0')} · Select any keyword to see its trend.</p>` : '<p class="muted">Monthly history is not reported for this phrase. Select another keyword in the table to check its trend.</p>');
}
function renderPages() {
  $('page-plan').innerHTML = current.report.pages.map((p, i) => `<article class="panel page-card"><span class="badge">${esc(p.type)}</span><h3>${esc(p.cluster)}</h3><p class="path">${esc(p.path)}</p><p>${esc(p.evidence)}</p><dl><dt>Primary keyword</dt><dd>${esc(p.primary)} <span class="hint">· ${fmt(p.volume)} UK searches / mo</span></dd><dt>Supporting keywords · same page</dt><dd class="supporting-tags">${p.supporting.length ? p.supporting.map(x => `<span>${esc(x)}</span>`).join('') : '<span>No additional variants returned</span>'}</dd><dt>Draft SEO title</dt><dd>${esc(p.title)}</dd><dt>Suggested H1</dt><dd>${esc(p.h1)}</dd></dl><details><summary>Suggested content sections</summary><ul>${p.sections.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details><button type="button" class="button quiet copy-page" data-page="${i}">Copy page brief</button></article>`).join('');
}
function renderCompetitors() {
  const r = current.report;
  $('competitor-intro').innerHTML = `<h3>Who ranks for “${esc(r.input.query)}”?</h3><p>Google desktop results from ${esc(r.serp.location)} · ${esc(date(r.serp.checkedAt || r.fetchedAt))}. This is one search snapshot, not ongoing rank tracking.</p>${r.input.website ? `<p><strong>${esc(r.input.website)}</strong>: ${!r.serp.available ? 'rank check unavailable.' : r.clientRanking ? `found at organic position ${r.clientRanking}.` : 'not found in the returned top 10 organic results. This does not mean the site is unindexed.'}</p>` : ''}<p class="hint">Search features: ${r.serp.features.length ? r.serp.features.map(x => esc(x.replaceAll('_', ' '))).join(' · ') : 'Not available'}</p>`;
  $('competitors').innerHTML = r.organic.length ? r.organic.map(x => `<article class="panel competitor"><span class="rank">${fmt(x.position)}</span><div><small>${esc(x.domain)}</small><h3><a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)} ↗</a></h3><p>${esc(x.description)}</p></div></article>`).join('') : '<p class="notice">No organic competitors were returned for this search. Check the report warnings.</p>';
}
function renderQuestions() {
  const r = current.report;
  const drafts = [`Which ${r.input.service} services do you offer in ${title(r.input.town)}?`, 'How do customers request a quote, and what affects the price?', 'Which nearby areas do you actually cover?', 'What qualifications, guarantees and recent projects can you show?', 'What are your real opening hours and response times?'];
  $('questions').innerHTML = `<div class="view-intro"><h3>Answer the questions behind the search</h3><p>Use questions to shape useful content. Only publish answers that accurately describe the client’s business.</p></div><div class="question-grid"><section class="panel"><p class="eyebrow">OBSERVED IN GOOGLE</p><h3>People also ask</h3>${r.questions.length ? `<ul>${r.questions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>No People also ask questions were returned in this search snapshot.</p>'}<h3>Related searches</h3>${r.relatedSearches.length ? `<ul>${r.relatedSearches.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>No related searches were returned.</p>'}</section><section class="panel"><p class="eyebrow">EDITORIAL SUGGESTIONS · NOT SEARCH DATA</p><h3>Ask the client</h3><ul>${drafts.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>For each real service, add original project photos, relevant reviews and a clear enquiry route. Use one page for close variants; avoid near-identical town pages.</p></section></div>`;
}
function pageText(p) { return `${p.cluster}\nSuggested page: ${p.path}\nType: ${p.type}\nPrimary: ${p.primary}\nUK searches/month: ${fmt(p.volume)}\nSupporting: ${p.supporting.join(', ')}\nSEO title: ${p.title}\nH1: ${p.h1}\nSections:\n${p.sections.map(x => '- ' + x).join('\n')}\nEvidence: ${p.evidence}`; }
function download(content, type, extension) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = `${current.report.input.query.replace(/[^a-z0-9]+/g, '-')}-${extension === 'csv' ? 'keywords' : 'brief'}.${extension}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function csvCell(value) { let s = String(value ?? ''); if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }
$('research-form').addEventListener('submit', e => { e.preventDefault(); research(fields()); });
$('example').addEventListener('click', () => { $('query').value = 'Plumber Merthyr Tydfil'; for (const id of ['location', 'service', 'website', 'services']) $(id).value = ''; $('query').focus(); });
$('query').addEventListener('input', () => { $('location').value = ''; $('service').value = ''; });
$('location').addEventListener('input', async () => { const version = ++locationVersion; const q = $('location').value; if (q.length < 2) return; try { const r = await api(`locations?q=${encodeURIComponent(q)}`); if (version === locationVersion) $('locations').innerHTML = r.locations.map(x => `<option value="${esc(x.name)}">${esc(x.type)}</option>`).join(''); } catch {} });
$('load-report').addEventListener('click', async () => { if (busy || !$('saved').value) return; setBusy(true); try { const r = await api(`report?id=${encodeURIComponent($('saved').value)}`); if (!r.report) throw new Error(r.error || 'This report has not completed. Wait a moment, then reopen it.'); render(r); notice('Opened saved research. No new API lookup was made.'); } catch (e) { notice(e.message, 'error'); } finally { setBusy(false); } });
$('refresh-report').addEventListener('click', () => { if (current) research({ ...current.report.input, location: current.report.input.location.name, services: current.report.input.extra.join(', '), refresh: true }); });
for (const id of ['filter', 'scope', 'sort']) $(id).addEventListener('input', renderRows);
$('keyword-rows').addEventListener('click', e => { const b = e.target.closest('[data-keyword]'); if (b) renderTrend(current.report.keywords.find(x => x.keyword === b.dataset.keyword)); });
$('page-plan').addEventListener('click', async e => { const b = e.target.closest('[data-page]'); if (!b) return; try { await navigator.clipboard.writeText(pageText(current.report.pages[Number(b.dataset.page)])); b.textContent = 'Copied'; } catch { notice('Clipboard access was unavailable. Use Download brief instead.', 'error'); } });
const tabs = [...document.querySelectorAll('[data-tab]')];
function selectTab(b) { for (const tab of tabs) { const active = b === tab; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; $(`${tab.dataset.tab}-panel`).hidden = !active; } }
tabs.forEach((b, i) => { b.addEventListener('click', () => selectTab(b)); b.addEventListener('keydown', e => { let next; if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length]; if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length]; if (e.key === 'Home') next = tabs[0]; if (e.key === 'End') next = tabs.at(-1); if (next) { e.preventDefault(); selectTab(next); next.focus(); } }); });
$('export-csv').addEventListener('click', () => { if (!current) return; const head = ['Keyword', 'Priority', 'Planning score', 'UK monthly searches', 'SEO difficulty (0-100)', 'CPC (USD)', 'Ads competition (0-1)', 'Intent', 'Intent source', 'Page group', 'Reason', 'Metric source', 'Metric update', 'Report date', 'Volume geography']; const rows = filteredRows().map(x => [x.keyword, x.priority, x.score, x.volume, x.difficulty, x.cpc, x.adsCompetition, x.intent, x.intentSource, x.cluster, x.reason, x.origin, x.updatedAt, current.report.fetchedAt, 'United Kingdom']); download('\uFEFF' + [head, ...rows].map(x => x.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8', 'csv'); });
$('export-brief').addEventListener('click', () => { if (!current) return; const r = current.report; download(`# ${title(r.input.query)} — website brief\n\nResearched: ${r.fetchedAt}\nGoogle location: ${r.input.location.name}\nVolume geography: United Kingdom. CPC currency: USD.\nReported API cost: $${r.cost.usd.toFixed(4)} USD\n\n${r.methodology}\n\n${r.warnings.length ? 'Warnings:\n' + r.warnings.join('\n') + '\n\n' : ''}${r.pages.map(p => '## ' + pageText(p)).join('\n\n')}\n\n## Google competitors\n${r.organic.map(x => `${x.position}. ${x.title}\n${x.url}`).join('\n\n')}\n\n## Observed Google questions\n${r.questions.join('\n') || 'None returned.'}\n\nSources:\nhttps://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live/\nhttps://docs.dataforseo.com/v3/serp/google/organic/live/advanced/\n`, 'text/markdown;charset=utf-8', 'md'); });
$('print').addEventListener('click', () => window.print());
async function init() {
  try { const status = await api('status'); $('connection').textContent = status.connected ? 'DataForSEO connected' : 'DataForSEO not connected'; $('research-button').disabled = !status.connected || !status.storageReady; if (!status.connected || !status.storageReady) notice('The research connection is not ready yet. Your saved reports remain available when storage is connected.', 'error'); if (status.storageReady) { await history(); const id = new URL(location.href).searchParams.get('report'); if (id) { const r = await api(`report?id=${encodeURIComponent(id)}`); if (r.report) { render(r); $('saved').value = id; } else notice(r.error || 'This research is still in progress. Open it again shortly.'); } } }
  catch (e) { $('connection').textContent = 'Connection unavailable'; notice(e.message, 'error'); }
}
init();
