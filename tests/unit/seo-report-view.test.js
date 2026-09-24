import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsReport, reportPeriods } from '../../src/lib/analytics-report.js';
import { enquiries, seoWins, seoReportHtml, parseWork } from '../../src/lib/seo-report-view.js';

const input = { property: 'properties/1', site: 'sc-domain:ir-energy.co.uk', period: '6', country: 'all' };
const state = { input, property: { id: input.property, name: 'IR Energy', timeZone: 'Europe/London' }, periods: reportPeriods(input, 'Europe/London', new Date('2026-09-09T12:00Z')), warnings: [], stage: 1, stages: [] };
const ga = (current, previous) => ({ rows: [{ dimensions: { dateRange: 'current' }, metrics: current }, { dimensions: { dateRange: 'previous' }, metrics: previous }] });
const dim = (name, rows) => ({ rows: rows.flatMap(([key, cur, prev]) => [{ dimensions: { dateRange: 'current', [name]: key }, metrics: cur }, ...(prev ? [{ dimensions: { dateRange: 'previous', [name]: key }, metrics: prev }] : [])]) });
const q = (key, clicks, impressions, position) => ({ keys: [key], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });
const totals = { sessions: 2450, activeUsers: 1561, newUsers: 1537, screenPageViews: 4700, engagementRate: 0.556, keyEvents: 0, sessionKeyEventRate: 0, userEngagementDuration: 90000 };
const before = { sessions: 1055, activeUsers: 571, newUsers: 572, screenPageViews: 2688, engagementRate: 0.509, keyEvents: 0, sessionKeyEventRate: 0, userEngagementDuration: 41000 };
const data = {
  overview: ga(totals, before), organic: ga({ ...totals, sessions: 1226 }, { ...before, sessions: 463 }),
  channels: dim('sessionDefaultChannelGroup', [['Organic Search', { sessions: 1226 }, { sessions: 463 }], ['Direct', { sessions: 675 }, { sessions: 344 }], ['Unassigned', { sessions: 63 }, null], ['AI Assistant', { sessions: 3 }, null]]),
  landing: dim('landingPage', [['/', { sessions: 1596 }, { sessions: 743 }], ['(not set)', { sessions: 211 }, null], ['/contact', { sessions: 71 }, { sessions: 23 }]]),
  events: dim('eventName', [['page_view', { eventCount: 4700 }, { eventCount: 2688 }], ['form_start', { eventCount: 111 }, { eventCount: 26 }], ['phone_click', { eventCount: 13 }, { eventCount: 4 }], ['email_click', { eventCount: 2 }, { eventCount: 3 }], ['form_submit', { eventCount: 1 }, { eventCount: 3 }]]),
  gscCurrentTotals: { rows: [q('', 894, 116066, 21.4)] }, gscPreviousTotals: { rows: [q('', 431, 27333, 37.3)] },
  gscCurrentQueries: { rows: [q('ir energy ltd', 226, 614, 1.1), q('ir energy', 217, 1141, 3.1), q('solar panels merthyr tydfil', 3, 185, 7.4), q('battery storage cardiff', 2, 57, 5.7), q('internal wall insulation installers', 4, 300, 12), q('rare query', 0, 3, 5)] },
  gscPreviousQueries: { rows: [q('ir energy ltd', 123, 357, 1.1), q('ir energy', 156, 837, 3.8), q('internal wall insulation installers', 1, 200, 29.7)] },
  gscCurrentPages: { rows: [q('https://ir-energy.co.uk/', 432, 8774, 22.3), q('https://ir-energy.co.uk/green-homes-wales-scheme/', 31, 10821, 11.7), q('https://ir-energy.co.uk/battery-storage-installation-in-cardiff/', 17, 6919, 15.3)] },
  gscPreviousPages: { rows: [q('https://ir-energy.co.uk/', 249, 3669, 11.8)] },
};
const report = buildAnalyticsReport(state, data);

test('enquiries come from phone taps, email clicks and forms, and imported WordPress forms replace GA form events', () => {
  const fromGa = enquiries(report);
  assert.deepEqual(fromGa.current, { phone: 13, email: 2, form: 1, total: 16 }, 'form_start is not an enquiry');
  assert.deepEqual(fromGa.previous, { phone: 4, email: 3, form: 3, total: 10 });
  const withForms = enquiries(report, { current: 6, previous: 2 });
  assert.deepEqual(withForms.current, { phone: 13, email: 2, form: 6, total: 21 });
  assert.equal(withForms.formsSource, 'wordpress');
  assert.equal(enquiries({ ...report, data: {} }).anything, false);
});

test('SEO wins separate name searches from service searches and find new searches, gains and pages', () => {
  const wins = seoWins(report);
  assert.equal(wins.brand.current, 443);
  assert.equal(wins.service.current, 9);
  assert.deepEqual(wins.newSearches.map(x => x.key), ['solar panels merthyr tydfil', 'battery storage cardiff'], 'brand and very rare searches excluded');
  assert.deepEqual(wins.improved.map(x => x.key), ['internal wall insulation installers']);
  assert.deepEqual(wins.newPages.map(x => x.path), ['/green-homes-wales-scheme/', '/battery-storage-installation-in-cardiff/'], 'home page is never a new page');
  assert.equal(seoWins({ ...report, input: { ...report.input, site: '' } }), null);
});

test('the client report follows the Word report layout: before → after figures and What This Means for each section', () => {
  const work = 'New Pillar Pages:\nRenewable Energy Installers Newport\nRenewable Energy Installers Swansea\n\nNew Service Pages – Newport:\nSolar Panel Installation\nBattery Storage\nEV Charger Installation';
  const html = seoReportHtml({ report, notes: 'Next: more Cardiff pages.', work }, { forms: { current: 6, previous: 2 } });
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /IR Energy SEO Report 01\/03\/2026 – 31\/08\/2026/);
  assert.match(text, /Google Search Console Performance/);
  assert.match(text, /Search Performance \(1 Mar – 31 Aug vs Previous Period\)/);
  assert.match(text, /Clicks: 431 → 894 \(\+107%\)/);
  assert.match(text, /Impressions: 27\.3K → 116\.1K \(\+325%\)/);
  assert.match(text, /Average CTR: 1\.6% → 0\.8%/);
  assert.match(text, /Average Position: 37\.3 → 21\.4/);
  assert.match(text, /What This Means Search visibility and clicks both grew/);
  assert.match(text, /average position improved from 37\.3 to 21\.4/);
  assert.match(text, /Organic Traffic Performance \(Google Analytics\)/);
  assert.match(text, /Sessions: 463 → 1,226 \(\+165%\)/);
  assert.match(text, /Engagement Rate: 50\.9% → 55\.6%/);
  assert.match(text, /Lead Activity \(Website Enquiries\)/);
  assert.match(text, /Form Submissions: 6 Phone Clicks: 13 Email Clicks: 2 Total Enquiry Actions: 21/);
  assert.match(text, /SEO Pages Created &amp; Optimised/);
  assert.match(text, /New Pillar Pages Renewable Energy Installers Newport Renewable Energy Installers Swansea/);
  assert.match(text, /2 New Pillar Pages 3 New Service Pages – Newport Total: 5 SEO-focused pages/);
  assert.match(text, /Keyword Ranking Breakdown \(Google Search Console\)/);
  assert.match(text, /5 keywords ranking on page 1 \(positions 1–10\), compared with 2 in the previous period/);
  assert.match(text, /New Keywords Now Ranking solar panels merthyr tydfil \(position 7\)/);
  assert.match(text, /Biggest Ranking Improvements internal wall insulation installers: 30 → 12/);
  assert.match(text, /Notes &amp; Next Steps Next: more Cardiff pages\./);
  for (const hidden of ['properties/1', 'does not establish its cause', '(not set)', 'Unassigned', 'GA4']) assert.ok(!html.includes(hidden), hidden);
  assert.doesNotMatch(seoReportHtml({ report, notes: '' }), /SEO Pages Created|Notes &amp; Next Steps/, 'empty sections are left out');
  const script = seoReportHtml({ report: { ...report, property: { ...report.property, name: '<script>x</script>' } }, notes: '<img src=x>', work: '<b>page</b>' });
  assert.doesNotMatch(script, /<script>|<img|<b>page/, 'names, notes and work are escaped');
});

test('What This Means reads correctly when visibility grows but clicks dip, and when nothing changed', () => {
  const dip = { ...report, cards: report.cards.map(c => c.source === 'gsc' && c.key === 'clicks' ? { ...c, current: 132, previous: 145 } : c.source === 'gsc' && c.key === 'impressions' ? { ...c, current: 17700, previous: 10400 } : c.source === 'gsc' && c.key === 'position' ? { ...c, current: 24.1, previous: 19.9 } : c) };
  const text = seoReportHtml({ report: dip, notes: '' }).replace(/<[^>]+>/g, ' ');
  assert.match(text, /Clicks:\s+145 → 132 \(-9%\)/);
  assert.match(text, /Impressions:\s+10\.4K → 17\.7K \(\+70%\)/);
  assert.match(text, /common during phases of rapid keyword expansion/);
  assert.match(text, /appearing for many new, broader searches/);
  const flat = { ...report, cards: report.cards.map(c => c.source === 'gsc' ? { ...c, current: c.previous } : c) };
  const steady = seoReportHtml({ report: flat, notes: '' }).replace(/<[^>]+>/g, ' ');
  assert.match(steady, /\(no change\)/);
  assert.match(steady, /Search visibility held steady/);
  assert.doesNotMatch(steady, /\(\+0%\)|was lower/);
});

test('work lists group by lines ending in a colon', () => {
  assert.deepEqual(parseWork('Home page rewrite\n\nNew Pages:\n- Solar Cardiff\n* Solar Newport\nEmpty group:\n'), [{ title: 'Pages created and optimised', items: ['Home page rewrite'] }, { title: 'New Pages', items: ['Solar Cardiff', 'Solar Newport'] }]);
  assert.deepEqual(parseWork(''), []);
});
