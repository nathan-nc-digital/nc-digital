// How far through a website audit is, as a percentage. Each step is weighted by roughly how long
// it takes (a Google speed test is far slower than a page check). Totals are upper bounds until a
// step's real size is known, so the percentage only moves forward and reaches 100 when complete.
const WEIGHT = { robots: 1, page: 2, link: 1, https: 1, sitemap: 1, speed: 12, keywords: 3, ranking: 4 };
const ORDER = ['robots', 'pages', 'links', 'https', 'sitemap', 'speed-mobile', 'speed-desktop', 'keywords', 'rankings', 'done'];
const MAX_LINKS = 20, MAX_SITEMAPS = 4, MAX_RANKINGS = 8;

export function auditProgress(report) {
  if (!report) return 0;
  if (report.status === 'complete') return 100;
  const at = ORDER.indexOf(report.phase), past = phase => at > ORDER.indexOf(phase);
  const pagesDone = (report.pages?.length || 0) + (report.skipped?.length || 0);
  const pagesTotal = past('pages') ? pagesDone : Math.max(pagesDone, report.maxPages || 10);
  const linksDone = report.linkChecks?.length || 0;
  const linksTotal = past('links') ? linksDone : report.phase === 'links' ? linksDone + (report.queue?.length || 0) : MAX_LINKS;
  const sitemapDone = report.sitemap?.tried?.length || 0;
  const sitemapTotal = past('sitemap') ? sitemapDone : report.phase === 'sitemap' ? sitemapDone + (report.queue?.length || 0) : MAX_SITEMAPS;
  const speedDone = (report.speed?.mobile ? 1 : 0) + (report.speed?.desktop ? 1 : 0);
  const local = report.local, keywords = local?.keywords || [];
  const rankingsDone = keywords.filter(k => k.checked || k.checkError).length;
  const rankingsTotal = past('rankings') ? rankingsDone : report.phase === 'rankings' ? rankingsDone + (local?.queue?.length || 0) : MAX_RANKINGS;
  let done = (past('robots') ? WEIGHT.robots : 0) + pagesDone * WEIGHT.page + linksDone * WEIGHT.link
    + (past('https') ? WEIGHT.https : 0) + sitemapDone * WEIGHT.sitemap + speedDone * WEIGHT.speed;
  let total = WEIGHT.robots + pagesTotal * WEIGHT.page + linksTotal * WEIGHT.link + WEIGHT.https + sitemapTotal * WEIGHT.sitemap + 2 * WEIGHT.speed;
  if (local) {
    done += (keywords.length ? WEIGHT.keywords : 0) + rankingsDone * WEIGHT.ranking;
    total += WEIGHT.keywords + rankingsTotal * WEIGHT.ranking;
  }
  return Math.max(1, Math.min(99, Math.floor((done / total) * 100)));
}
