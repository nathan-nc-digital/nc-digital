// Client-facing SEO report: a plain-English summary of a completed Analytics + Search Console
// report. The detailed tables stay in the admin page for Nathan; this is what the client reads.

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => v == null ? '—' : Math.round(Number(v)).toLocaleString('en-GB');
const day = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const short = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

// GA rows grouped by a dimension into { key, current, previous } metric pairs.
function gaPairs(report, kind, dimension) {
  const groups = new Map();
  for (const r of report.data?.[kind]?.rows || []) {
    const period = r.dimensions?.dateRange; if (!['current', 'previous'].includes(period)) continue;
    const key = r.dimensions[dimension], item = groups.get(key) || { key, current: null, previous: null };
    item[period] = r.metrics; groups.set(key, item);
  }
  return [...groups.values()];
}
// Search Console rows (queries or pages) matched across both periods.
function searchPairs(report, kind) {
  const groups = new Map();
  for (const period of ['Current', 'Previous']) for (const r of report.data?.['gsc' + period + kind]?.rows || []) {
    const key = r.keys?.[0]; if (!key) continue;
    const item = groups.get(key) || { key }; item[period.toLowerCase()] = r; groups.set(key, item);
  }
  return [...groups.values()];
}
const card = (report, source, key) => report.cards?.find(c => c.source === source && c.key === key) || null;

// ---- Enquiries: phone taps, email clicks and form submissions recorded by GA4, plus website form
// entries imported from WordPress. Imported forms replace GA's form events so nothing is counted twice.
const PHONE = /phone|call|tel(?!e)|whatsapp/i, EMAIL = /e-?mail|mailto/i, FORM = /form_submit|generate_lead|submit|enquir|contact_form|lead/i;
export function enquiries(report, forms = null) {
  const chosen = report.client?.enquiryEvents?.length ? new Set(report.client.enquiryEvents.map(e => e.toLowerCase())) : null;
  const events = gaPairs(report, 'events', 'eventName').filter(e => !chosen || chosen.has(String(e.key).toLowerCase()));
  // With a saved list, each chosen event counts: phone/email by name, anything else as a form enquiry.
  const sum = (re, period, exclude) => events.filter(e => chosen ? (re === FORM ? !PHONE.test(e.key) && !EMAIL.test(e.key) : re.test(e.key)) : re.test(e.key) && !(exclude && exclude.test(e.key))).reduce((s, e) => s + (e[period]?.eventCount || 0), 0);
  const imported = Boolean(forms && Number.isFinite(forms.current));
  const result = period => {
    const phone = sum(PHONE, period, /form/i), email = sum(EMAIL, period, /form/i);
    const form = imported ? (period === 'current' ? forms.current : Number.isFinite(forms.previous) ? forms.previous : null) : sum(FORM, period, /start|view|abandon/i);
    return { phone, email, form, total: phone + email + (form || 0) };
  };
  const current = result('current'), previous = result('previous');
  return { current, previous, formsSource: imported ? 'wordpress' : 'analytics', anything: current.total > 0 || previous.total > 0 || imported };
}

// ---- SEO wins from Search Console: brand vs service searches, new searches, ranking gains, new pages.
function brandTest(report) {
  const words = [report.property?.name, report.client?.name, ...(report.client?.brandTerms || []), String(report.input?.site || '').replace(/^sc-domain:|^https?:\/\/(www\.)?/g, '').split('.')[0]];
  const stems = words.filter(Boolean).map(w => String(w).toLowerCase().replace(/\b(ltd|limited|ga4|website|uk)\b/g, '').replace(/[^a-z0-9]/g, '')).filter(s => s.length >= 3);
  return q => { const compact = String(q).toLowerCase().replace(/[^a-z0-9]/g, ''); return stems.some(s => compact.includes(s)); };
}
export function seoWins(report) {
  if (!report.input?.site) return null;
  const isBrand = brandTest(report), queries = searchPairs(report, 'Queries'), pages = searchPairs(report, 'Pages');
  const service = queries.filter(q => !isBrand(q.key));
  const clicks = (list, p) => list.reduce((s, q) => s + (q[p]?.clicks || 0), 0);
  const newSearches = service.filter(q => q.current && !q.previous && q.current.impressions >= 10 && q.current.position <= 20)
    .sort((a, b) => b.current.clicks - a.current.clicks || b.current.impressions - a.current.impressions).slice(0, 6);
  const improved = service.filter(q => q.current && q.previous && q.previous.position - q.current.position >= 3 && q.current.position <= 30)
    .sort((a, b) => (b.previous.position - b.current.position) - (a.previous.position - a.current.position)).slice(0, 6);
  const path = u => { try { return new URL(u).pathname; } catch { return u; } };
  const newPages = pages.filter(p => p.current && !p.previous && path(p.key) !== '/' && (p.current.clicks > 0 || p.current.impressions >= 50))
    .sort((a, b) => b.current.clicks - a.current.clicks || b.current.impressions - a.current.impressions).slice(0, 5).map(p => ({ ...p, path: path(p.key) }));
  return {
    brand: { current: clicks(queries.filter(q => isBrand(q.key)), 'current'), previous: clicks(queries.filter(q => isBrand(q.key)), 'previous') },
    service: { current: clicks(service, 'current'), previous: clicks(service, 'previous') },
    newSearches, improved, newPages,
  };
}

// ---- Where visitors came from, in plain English.
const CHANNELS = { 'Organic Search': 'Search engines (Google, Bing)', Direct: 'Typed in the address or a bookmark', 'Organic Social': 'Social media', 'Paid Social': 'Social media adverts', 'Paid Search': 'Google Ads', Referral: 'Links from other websites', Email: 'Email', 'AI Assistant': 'AI assistants such as ChatGPT', 'Organic Video': 'Video (e.g. YouTube)', Display: 'Display adverts', 'Organic Maps': 'Google Maps' };

function change(cur, prev, { lowerIsBetter = false } = {}) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return { cls: 'flat', text: '' };
  if (cur === prev) return { cls: 'flat', text: 'no change' };
  const better = lowerIsBetter ? cur < prev : cur > prev;
  if (lowerIsBetter) return { cls: better ? 'up' : 'down', text: `${better ? 'improved' : 'dropped'} from ${prev.toFixed(1)}` };
  if (prev === 0) return { cls: 'up', text: 'up from 0' };
  const pct = Math.round(Math.abs(cur - prev) / prev * 100);
  return { cls: better ? 'up' : 'down', text: `${better ? 'up' : 'down'} ${pct}% from ${num(prev)}` };
}
function headline(report, name) {
  const clicks = card(report, 'gsc', 'clicks'), sessions = card(report, 'ga', 'sessions');
  const [c, label] = clicks?.current != null ? [clicks, 'visits from Google searches'] : [sessions, 'visits to the website'];
  if (c?.current == null) return `Here is how ${name}’s website performed this period.`;
  if (c.previous > 0 && c.current >= c.previous * 2) return `More people found ${name} this period: ${num(c.current)} ${label}, ${c.current >= c.previous * 2.9 ? 'around ' + Math.floor(c.current / c.previous) + ' times' : 'more than double'} the ${num(c.previous)} in the previous period.`;
  if (c.previous > 0 && c.current > c.previous) return `More people found ${name} this period: ${num(c.current)} ${label}, up ${Math.round((c.current - c.previous) / c.previous * 100)}% from ${num(c.previous)}.`;
  return `${name} had ${num(c.current)} ${label} this period, compared with ${num(c.previous)} in the previous period.`;
}

// ---- Visits month by month: Search Console clicks (or GA sessions without it), previous period in grey.
const MONTH = m => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
export function monthlyVisits(report) {
  const add = (map, month, period, n) => { const x = map.get(month) || { month, period, value: 0 }; x.value += n || 0; map.set(month, x); };
  const months = new Map();
  let source = 'google';
  for (const period of ['Previous', 'Current']) for (const r of report.data?.['gsc' + period + 'Trend']?.rows || []) { const d = r.keys?.[0]; if (/^\d{4}-\d{2}/.test(d || '')) add(months, d.slice(0, 7), period.toLowerCase(), r.clicks); }
  if (!months.size) {
    source = 'website';
    for (const r of report.data?.trend?.rows || []) { const d = String(r.dimensions?.date || '').replace(/^(\d{4})(\d{2})\d{2}$/, '$1-$2'); if (/^\d{4}-\d{2}$/.test(d) && ['current', 'previous'].includes(r.dimensions?.dateRange)) add(months, d, r.dimensions.dateRange, r.metrics?.sessions); }
  }
  return { source, months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) };
}
function chartHtml(report) {
  const { source, months } = monthlyVisits(report);
  if (months.length < 2) return '';
  const max = Math.max(1, ...months.map(m => m.value));
  return `<div class="sr-sub"><h4>${source === 'google' ? 'Clicks from Google, month by month' : 'Website visits, month by month'}</h4><div class="sr-chart" role="img" aria-label="${source === 'google' ? 'Google visits' : 'Website visits'} for each month">${months.map(m => `<div class="sr-col ${m.period}"><b>${num(m.value)}</b><i style="height:${Math.max(2, Math.round(m.value / max * 100))}%"></i><span>${esc(MONTH(m.month))}</span></div>`).join('')}</div><p class="sr-note">Purple bars are this period; grey bars are the previous period. Part months show only the days included.</p></div>`;
}

// ---- Google positions for the client's chosen searches, compared with their previous report.
function rankingsHtml(report) {
  const r = report.rankings; if (!r?.current?.length) return '';
  const pos = p => p ? '#' + p : 'Not in top 50', cls = p => !p ? 'bad' : p <= 3 ? 'good' : p <= 10 ? 'ok' : 'bad';
  const move = (now, before) => {
    if (before === undefined) return '<span class="sr-move new">Not in last report</span>';
    if (before == null && now == null) return '<span class="sr-move flat">No change</span>';
    if (before == null) return '<span class="sr-move up">New: now ranking</span>';
    if (now == null) return '<span class="sr-move down">Dropped out of top 50</span>';
    if (now === before) return '<span class="sr-move flat">No change</span>';
    return `<span class="sr-move ${now < before ? 'up' : 'down'}">${now < before ? '▲ up' : '▼ down'} ${Math.abs(before - now)} place${Math.abs(before - now) === 1 ? '' : 's'}</span>`;
  };
  const rows = r.current.filter(x => !x.error);
  if (!rows.length) return '';
  const top10 = rows.filter(x => x.position && x.position <= 10).length;
  return `<div class="sr-sub"><h4>Your Key Searches${r.locationName ? ` (checked from ${esc(r.locationName.split(',')[0])})` : ''}</h4><p class="sr-lead"><strong>${top10} of ${rows.length}</strong> of your key searches are on the first page of Google${r.locationName ? ` in ${esc(r.locationName.split(',')[0])}` : ''}.</p>
  <div class="sr-table-wrap"><table class="sr-table"><thead><tr><th>Search</th><th>Position now</th>${r.previous ? '<th>Last report</th>' : ''}<th>Change</th></tr></thead><tbody>${rows.map(x => { const before = r.previous ? r.previous[x.keyword] : undefined; return `<tr><td>${esc(x.keyword)}</td><td><b class="sr-pos ${cls(x.position)}">${pos(x.position)}</b></td>${r.previous ? `<td>${before === undefined ? '—' : pos(before)}</td>` : ''}<td>${r.previous ? move(x.position, before) : '<span class="sr-move new">First check</span>'}</td></tr>`; }).join('')}</tbody></table></div>
  <p class="sr-note">Positions come from a Google search made${r.locationName ? ` in ${esc(r.locationName.split(',')[0])}` : ''} on ${esc(new Date(r.checkedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}. They move day to day, so look at the trend over several months.</p></div>`;
}

// ---- What the public link may show: only the figures this report uses, never IDs, warnings or spend.
const PUBLIC_DATA = ['events', 'organic', 'channels', 'landing', 'trend', 'gscCurrentTotals', 'gscPreviousTotals', 'gscCurrentQueries', 'gscPreviousQueries', 'gscCurrentPages', 'gscPreviousPages', 'gscCurrentTrend', 'gscPreviousTrend'];
export function seoClientView(current) {
  const r = current.report || {};
  return {
    type: 'seo', notes: current.notes || '', work: current.work || '', forms: current.forms ? { current: current.forms.current, previous: current.forms.previous } : null,
    report: {
      property: { name: r.client?.name || r.property?.name || '' }, input: { site: r.input?.site || '' }, periods: r.periods,
      cards: (r.cards || []).map(c => ({ key: c.key, label: c.label, type: c.type, source: c.source, current: c.current, previous: c.previous })),
      data: Object.fromEntries(PUBLIC_DATA.filter(k => r.data?.[k]).map(k => [k, { rows: r.data[k].rows || [] }])),
      client: r.client ? { name: r.client.name, brandTerms: r.client.brandTerms || [], enquiryEvents: r.client.enquiryEvents || [] } : null,
      rankings: r.rankings ? { current: r.rankings.current.map(x => ({ keyword: x.keyword, position: x.position ?? null, error: x.error ? true : undefined })), previous: r.rankings.previous, checkedAt: r.rankings.checkedAt, locationName: r.rankings.locationName } : null,
    },
  };
}

// ---- The email that goes out with an SEO report link (the CRM adds the sign-off and signature).
export function seoEmailCopy(current, name, url) {
  const report = current.report, client = report.client?.name || report.property?.name || 'your business', first = String(name || '').trim().split(/\s+/)[0];
  const p = report.periods, period = short(p.current.startDate) === short(p.current.endDate) ? short(p.current.endDate) : `${short(p.current.startDate)} to ${short(p.current.endDate)}`;
  return [`Hi${first ? ' ' + first : ''},`, '', `Here is your SEO report for ${period}.`, '', headline(report, client), '', 'You can see the full report here:', url, '', 'It also covers what we worked on and what comes next. Any questions, just reply to this email.'].join('\n');
}

// ---- SEO pages created & optimised: Nathan lists the work, one page per line. A line ending in a
// colon (or starting with #) starts a group, e.g. "New Service Pages – Newport:".
export function parseWork(text) {
  const groups = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*•]\s*/, '').trim(); if (!line) continue;
    if (/:$/.test(line) || /^#/.test(line)) { groups.push({ title: line.replace(/^#+\s*/, '').replace(/:$/, '').trim(), items: [] }); continue; }
    if (!groups.length) groups.push({ title: 'Pages created and optimised', items: [] });
    groups.at(-1).items.push(line);
  }
  return groups.filter(g => g.items.length);
}

// Numbers as Nathan writes them: 10.4K from ten thousand, whole numbers below.
const big = v => v == null ? '—' : v >= 10000 ? (Math.round(v / 100) / 10).toLocaleString('en-GB') + 'K' : Math.round(v).toLocaleString('en-GB');
const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
const secsText = v => v == null ? '—' : Math.round(v) >= 60 ? `${Math.floor(Math.round(v) / 60)}m ${Math.round(v) % 60}s` : Math.round(v) + 's';
const dmy = s => s.split('-').reverse().join('/');
const dm = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function delta(prev, cur) {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) return '';
  if (Math.round(cur) === Math.round(prev)) return ' (no change)';
  const d = (cur - prev) / prev * 100, r = Math.abs(d) >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
  return ` (${d >= 0 ? '+' : ''}${r}%)`;
}
const line = (label, prev, cur, fmt, withDelta = true) => `<li><strong>${label}:</strong> ${fmt(prev)} → ${fmt(cur)}${withDelta ? delta(prev, cur) : ''}</li>`;
const means = paragraphs => `<h4>What This Means</h4>${paragraphs.filter(Boolean).map(p => `<p>${p}</p>`).join('')}`;
const up = (a, b) => a != null && b != null && b > a, down = (a, b) => a != null && b != null && b < a;

function searchMeaning(c, name) {
  const [cl, im, pos] = [c.clicks, c.impressions, c.position];
  const out = [];
  if (up(im.previous, im.current) && down(cl.previous, cl.current)) out.push(`Search visibility increased during the reporting period, with impressions growing by ${Math.round((im.current - im.previous) / im.previous * 100)}%. This indicates that the website is now appearing in a wider range of relevant Google searches.`, 'While clicks were slightly lower during this period, this is common during phases of rapid keyword expansion, where Google begins testing the website across broader and more competitive search terms.');
  else if (up(im.previous, im.current) && !down(cl.previous, cl.current)) out.push(`Search visibility and clicks both grew during the reporting period. More people are seeing ${name} in Google and choosing to visit the website.`);
  else if (!up(im.previous, im.current) && up(cl.previous, cl.current)) out.push('Clicks increased even though the website appeared in slightly fewer searches, which shows it is being shown for more relevant searches and more people are choosing to visit.');
  else if (im.previous != null && Math.round(im.current) === Math.round(im.previous)) out.push('Search visibility held steady during the reporting period.');
  else if (im.previous != null) out.push('Search visibility was lower during this reporting period. We are monitoring the affected searches and pages, and the work planned for the next period focuses on rebuilding and growing this visibility.');
  if (down(pos.previous, pos.current)) out.push(`The average position improved from ${pos.previous.toFixed(1)} to ${pos.current.toFixed(1)}, meaning the website is appearing higher in Google results on average.`);
  else if (up(pos.previous, pos.current) && up(im.previous, im.current)) out.push('The average position moved slightly because the website is now appearing for many new, broader searches, which naturally start lower down before they build up.');
  out.push('Search demand can fluctuate month to month depending on seasonality and market trends, so visibility growth is often a stronger long-term indicator than short-term click changes alone.');
  return out;
}
function trafficMeaning(o) {
  const s = o.sessions, e = o.engagementRate, out = [];
  if (up(s.previous, s.current)) out.push(`Organic traffic continued to grow during the reporting period, with visits from search engines increasing${up(o.engagedSessions.previous, o.engagedSessions.current) ? ' and engaged sessions rising alongside them' : ''}.`);
  else if (down(s.previous, s.current)) out.push('Organic traffic was slightly lower during this reporting period. Month-to-month changes are normal, and the longer-term trend is the more reliable measure.');
  else out.push('Organic traffic held steady during the reporting period.');
  if (e.current != null) out.push(e.current >= 0.5 ? 'Engagement remained strong overall, showing that visitors are actively interacting with the website after arriving through search.' : 'We are keeping an eye on engagement to make sure visitors find what they need when they arrive from search.');
  return out;
}

function searchSection(report) {
  const c = k => ({ previous: card(report, 'gsc', k)?.previous ?? null, current: card(report, 'gsc', k)?.current ?? null });
  const cl = c('clicks'); if (cl.current == null) return '';
  const im = c('impressions'), ctr = c('ctr'), pos = c('position'), p = report.periods;
  return `<section class="sr-section"><h3>Google Search Console Performance</h3><h4>Search Performance (${dm(p.current.startDate)} – ${dm(p.current.endDate)} vs Previous Period)</h4>
  <ul class="sr-metrics">${line('Clicks', cl.previous, cl.current, big)}${line('Impressions', im.previous, im.current, big)}${line('Average CTR', ctr.previous, ctr.current, pct, false)}${line('Average Position', pos.previous, pos.current, v => v == null ? '—' : v.toFixed(1), false)}</ul>
  ${chartHtml(report)}${means(searchMeaning({ clicks: cl, impressions: im, position: pos }, esc(report.client?.name || report.property?.name || 'the business')))}</section>`;
}
function trafficSection(report) {
  // Organic search visits and engagement, read from the Analytics organic totals for both periods.
  const rows = report.data?.organic?.rows || [], m = period => rows.find(r => r.dimensions?.dateRange === period)?.metrics || null;
  const cur = m('current'), prev = m('previous'); if (!cur || cur.sessions == null) return '';
  const pair = f => ({ previous: prev ? f(prev) : null, current: f(cur) });
  const s = pair(x => x.sessions), engaged = pair(x => x.engagedSessions ?? null), rate = pair(x => x.engagementRate ?? null);
  const time = pair(x => x.activeUsers > 0 && x.userEngagementDuration != null ? x.userEngagementDuration / x.activeUsers : null), p = report.periods;
  return `<section class="sr-section"><h3>Organic Traffic Performance (Google Analytics)</h3><h4>${dm(p.current.startDate)} – ${dm(p.current.endDate)} vs Previous Period</h4>
  <ul class="sr-metrics">${line('Sessions', s.previous, s.current, big)}${engaged.current != null ? line('Engaged Sessions', engaged.previous, engaged.current, big) : ''}${rate.current != null ? line('Engagement Rate', rate.previous, rate.current, pct, false) : ''}${time.current != null ? line('Average Engagement Time', time.previous, time.current, secsText, false) : ''}</ul>
  ${means(trafficMeaning({ sessions: s, engagedSessions: engaged, engagementRate: rate }))}</section>`;
}
function leadsSection(report, forms) {
  const e = enquiries(report, forms); if (!e.anything) return '';
  const p = report.periods, c = e.current;
  const items = [c.form != null && c.form > 0 || e.formsSource === 'wordpress' ? `<li><strong>Form Submissions:</strong> ${c.form ?? 0}</li>` : '', c.phone ? `<li><strong>Phone Clicks:</strong> ${c.phone}</li>` : '', c.email ? `<li><strong>Email Clicks:</strong> ${c.email}</li>` : ''].filter(Boolean);
  const text = c.total > 0 ? ['The website continued to generate enquiry activity throughout the reporting period, with users actively ' + [c.form ? 'submitting forms' : '', c.phone ? 'making direct phone contact' : '', c.email ? 'sending emails' : ''].filter(Boolean).join(' and ') + ' through the website.', 'This demonstrates that SEO is contributing not only to increased visibility, but also to measurable customer engagement and lead generation.'] : ['No enquiry actions were recorded through the website during this period.'];
  return `<section class="sr-section"><h3>Lead Activity (Website Enquiries)</h3><h4>${dm(p.current.startDate)} – ${dm(p.current.endDate)} ${p.current.endDate.slice(0, 4)}</h4><ul class="sr-metrics">${items.join('')}<li><strong>Total Enquiry Actions: ${c.total}</strong>${e.previous.total != null && (e.previous.total > 0 || c.total > 0) ? ` (previous period: ${e.previous.total})` : ''}</li></ul>${means(text)}</section>`;
}
function workSection(report, work) {
  const groups = parseWork(work); if (!groups.length) return '';
  const name = esc(report.client?.name || report.property?.name || 'the business'), total = groups.reduce((s, g) => s + g.items.length, 0);
  return `<section class="sr-section"><h3>SEO Pages Created &amp; Optimised</h3><p>During this reporting period, additional SEO-focused pages were created and optimised to expand visibility and target new local search opportunities.</p>
  ${groups.map(g => `<h4>${esc(g.title)}</h4><ul class="sr-pages-list">${g.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
  <h4>Total SEO Pages This Period</h4><ul class="sr-metrics">${groups.length > 1 ? groups.map(g => `<li><strong>${g.items.length}</strong> ${esc(g.title)}</li>`).join('') : ''}<li><strong>Total: ${total} SEO-focused page${total === 1 ? '' : 's'}</strong></li></ul>
  ${means([`These pages expand ${name}’s local search coverage, increasing opportunities to rank for high-intent searches related to its services.`, 'This location and service based SEO structure helps strengthen topical authority within Google while creating more opportunities for long-term traffic growth and enquiries.'])}</section>`;
}
function keywordSection(report) {
  const wins = seoWins(report), queries = searchPairs(report, 'Queries').filter(q => q.current && q.current.impressions > 0);
  const tracked = rankingsHtml(report);
  if (!queries.length && !tracked) return '';
  const band = (a, b) => queries.filter(q => q.current.position >= a && q.current.position < b + 1).length;
  const page1 = band(1, 10), top3 = band(1, 3), page2 = band(11, 20), prevPage1 = searchPairs(report, 'Queries').filter(q => q.previous && q.previous.impressions > 0 && q.previous.position < 11).length;
  const newList = wins?.newSearches?.length ? `<h4>New Keywords Now Ranking</h4><ul class="sr-pages-list">${wins.newSearches.map(q => `<li>${esc(q.key)} (position ${q.current.position.toFixed(0)})</li>`).join('')}</ul>` : '';
  const improved = wins?.improved?.length ? `<h4>Biggest Ranking Improvements</h4><ul class="sr-pages-list">${wins.improved.map(q => `<li>${esc(q.key)}: ${q.previous.position.toFixed(0)} → ${q.current.position.toFixed(0)}</li>`).join('')}</ul>` : '';
  return `<section class="sr-section"><h3>Keyword Ranking Breakdown (Google Search Console)</h3>${queries.length ? `<h4>Page 1 Keyword Rankings</h4><ul class="sr-metrics"><li><strong>${page1} keyword${page1 === 1 ? '' : 's'} ranking on page 1</strong> (positions 1–10)${prevPage1 ? `, compared with ${prevPage1} in the previous period` : ''}</li><li><strong>${top3}</strong> in the top 3 positions</li><li><strong>${page2}</strong> on page 2 (positions 11–20), close to breaking onto page 1</li></ul>` : ''}${newList}${improved}${tracked}
  ${queries.length ? means([page1 ? `${page1} keyword${page1 === 1 ? ' is' : 's are'} now ranking on the first page of Google, where the large majority of clicks happen.` : 'No keywords are ranking on the first page of Google yet; building these up is the focus of the ongoing SEO work.', page2 ? `A further ${page2} keyword${page2 === 1 ? ' is' : 's are'} on page 2, ${page2 === 1 ? 'the next opportunity' : 'the next opportunities'} to move onto page 1.` : '', 'Based on the searches Google Search Console reports for the period.']) : ''}</section>`;
}

export function seoReportHtml(current, { forms = null } = {}) {
  const report = current.report, p = report.periods, name = esc(report.client?.name || report.property?.name || 'Your business');
  const notes = current.notes ? `<section class="sr-section"><h3>Notes &amp; Next Steps</h3><div class="sr-notes">${esc(current.notes)}</div></section>` : '';
  return `<article class="sr-doc"><div class="sr-top"><div class="sr-brand">NC <span>Digital</span></div><small>SEO REPORT</small></div>
  <h2>${name} SEO Report ${dmy(p.current.startDate)} – ${dmy(p.current.endDate)}</h2>
  ${searchSection(report)}${trafficSection(report)}${leadsSection(report, forms)}${workSection(report, current.work)}${keywordSection(report)}${notes}
  <footer class="sr-footer"><span>NC Digital · Website design &amp; SEO</span><span>nc-digital.co.uk</span></footer></article>`;
}
