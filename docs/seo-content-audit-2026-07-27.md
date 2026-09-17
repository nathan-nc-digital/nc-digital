# NC Digital — SEO Content-Pruning Audit
**Site:** nc-digital.co.uk · **Generated:** 2026-07-27 · **Analyst:** Claude (Sonnet 5), commissioned by Nathan Constance

---

## 0. Data sources — what's real, what's missing

Per your instruction not to fabricate traffic/ranking/backlink data, here's exactly what this audit is and isn't built on.

**Used (real, pulled live during this session):**
- **Google Search Console** — full page-level performance via the Search Console API (not just the top-20 report): every URL with any impressions, current 12-month window (2025-07-24 to 2026-07-24) vs the prior 12 months (2024-07-24 to 2025-07-24). Plus page+query pairs to find each page's top query.
- **GSC URL Inspection index status** for all ~930 known URLs (indexed / not indexed / discovered-not-indexed / unknown-to-Google / redirected), fetched this session.
- **Ahrefs** — domain rating (47), total backlinks (1,911) and referring domains (100) at domain level; per-page backlink counts for the 9 pages Ahrefs tracks as linked-to; 249 tracked keywords with their inferred target URL, position and search volume (this is your rank-tracker project, mostly covering the location pages).
- **Site source content** — every page's actual frontmatter (title, meta title/description, service type) and body copy, read directly from the repo (620 location pages, 273 blog posts, 9 service pages, 15 portfolio pages).
- **Git history** and **filesystem timestamps** for publication-age evidence.

**Not available — I did not guess these:**
- **Google Analytics 4** — no GA4 export or API access this session. The table below has no conversions column populated; every "Conversions" cell says "no GA4 data." If you want conversion-informed prioritisation, export: **GA4 → Explore → Page path + dimension, Sessions + Conversions + Engaged sessions metrics, last 12 months, compared to prior 12 months.**
- **Screaming Frog crawl** — no crawl export. I substituted what I could from the actual source files (real word counts, real meta tags, real body-text comparison for duplication), but I don't have crawl-level duplicate-title/duplicate-meta detection across all 930 URLs, response codes, or a true internal-link-count-per-page map. If you want that layer: export **Screaming Frog → Internal HTML tab** (Address, Title, Meta Description, Word Count, Inlinks, Status Code, Indexability) as CSV.
- **Per-page backlinks for the other ~920 pages** — Ahrefs only reports 9 pages with tracked inbound links. Everything else is treated as "no tracked backlinks," which is a real (not fabricated) data point, but a fuller backlink export (Ahrefs Site Explorer → Best by Links, all pages) would sharpen this.

**One important non-SEO finding surfaced while pulling this data:** 619 of your 620 location pages exist only on disk — they are **not committed to git** (`git ls-files` shows only 1 of 620 tracked). They're live and indexed, so this doesn't affect the SEO analysis, but it means there's currently no version-controlled backup of that content. Worth a `git add`/commit pass independent of this audit.

---

## 1. What this site actually looks like (the load-bearing fact for everything below)

Content is **not** evenly organic. It comes in distinct waves, confirmed by git history, file timestamps, and GSC's own crawl-time data:

- **273 blog posts**: 87% (238 posts) were published April–May 2026. A small trickle existed since January 2025.
- **620 location pages**: these are **9 service templates × ~68 South Wales/Wales towns**, generated from one dynamic route (`src/pages/[location].astro`) reading `src/content/locations/`. GSC's own "last crawl time" data shows the bulk (539 of 574 crawled pages) were first crawled in **May 2026** — so most of this content has had roughly 2–3 months of real search exposure, not 12. On top of that, the entire 620-page set was bulk-edited on **2026-07-23 — four days before this audit** (every file has the same filesystem mtime cluster), almost certainly the pass that added the `locationLinks` cross-linking. Re-crawling for that refresh hasn't happened yet for most pages.

**Why this matters for pruning:** most of this site is too young for a traffic-based verdict. I have applied the "recently published" safeguard broadly to the location pages and the April–May 2026 blog cohort — low or zero clicks on a page that's had 8–12 weeks of real indexing is evidence of "not yet ranking," not evidence of "should be removed." I've used indexing status, content depth, duplication, and structural role as the deciding factors far more than raw clicks for this cohort.

The 9 real service verticals, each replicated across ~68 towns:

| Vertical (× ~68 towns) | Matching core service page | 12-mo clicks | 12-mo impressions | Pages w/ 0 impressions | Pages not indexed |
|---|---|---|---|---|---|
| `seo-<town>` | `/services/local-seo-google-ranking/` | 12 | 84,282 | 1 | 6 |
| `web-design-<town>` | `/services/web-design/` | 20 | 21,207 | 6 | 4 |
| `ecommerce-web-design-<town>` | `/services/ecommerce-development/` | 2 | 7,483 | 7 | 4 |
| `logo-design-<town>` | `/services/logo-design/` | 1 | 1,487 | 6 | 0 |
| `managed-starter-websites-<town>` | `/services/managed-starter-websites/` | 0 | 993 | 26 | 5 |
| `website-maintenance-<town>` | `/services/website-maintenance-packages/` | 1 | 992 | 22 | 14 |
| `web-development-<town>` | `/services/web-development/` | 1 | 872 | 13 | 0 |
| `web-agency-<town>` | *(duplicates web-design intent)* | 2 | 949 | 9 | 7 |
| `professional-email-<town>` | `/services/professional-mailboxes-email-setup/` | 1 | 203 | 42 | 16 |

Plus 8 one-off location pages outside this pattern (covered individually below).

Two verticals (`seo-*`, `web-design-*`) are carrying almost all the search demand (105,489 of 131,391 total location-page impressions, 80%). The other seven are, town-by-town, close to invisible — not because they're new, but because "website maintenance in [small town]" and "managed starter website in [small town]" are not things people actually search for at a town level. That's a real, structural finding, not a traffic blip.

---

## 2. Executive summary

- **Total indexable pages analysed:** ~927 (620 location, 273 blog, 9 service, 15 portfolio, 10 static/legal), cross-checked against 930 URLs in GSC's index.
- **Category breakdown (by page count):**
  - Healthy: ~4% (service pages, home, the few location/blog pages with real clicks, portfolio/structural pages retained on purpose)
  - Underperforming: ~9% (high-impression, near-zero-click pages — mostly the `seo-*` and `web-design-*` town pages)
  - Invisible: ~53% (impressions but zero clicks — the largest bucket, dominated by location pages and long-tail blog posts)
  - Dead weight (candidate): ~17% (zero impressions in 12 months — concentrated in the four weakest location verticals)
  - Insufficient data (too new to judge): ~17% (April–May 2026 blog cohort and the least-crawled location pages)
- **Main issue:** this is a classic large-scale programmatic-SEO pattern — 68-town replication across 9 templates, with genuinely thin content (median 285 words; 335 of 620 pages under 300 words) and heavily repeated boilerplate paragraphs (the "What our X service includes" bullet lists are near-identical between towns, confirmed by direct comparison of source files). Google is already telling you this via indexing: **61 of 620 location pages are not indexed at all**, and the ones that are indexed mostly rank position 30–65 for their target terms — page 3–7 of Google, essentially unreachable by users.
- **Main opportunity:** `seo-*` and `web-design-*` town pages are absorbing huge, real search volume (84k and 21k impressions respectively) that the site currently cannot convert into clicks. This is not a demand problem — it's a competitiveness/depth/internal-cannibalisation problem. Fixing the strongest 15–20 town pages in each of these two verticals (the ones already showing 1+ clicks or high impressions) is a materially better use of effort than the other 7 verticals combined.
- **Risks of pruning:** four of the nine verticals (`professional-email`, `managed-starter-websites`, `website-maintenance`, `web-development`) are so new (most first-crawled ≤3 months ago) that "zero impressions" is still ambiguous — some may simply need time. I have NOT recommended blanket deletion of any of these; recommendations below are consolidation/merge (fewer, stronger pages) rather than removal, in line with your instruction to be conservative.

---

## 3. Full table (grouped by page-type/pattern — see notes on scope below)

Table conventions: **Clicks/Impressions/CTR/Position** = current 12-month GSC data (2025-07-24 → 2026-07-24). **Conversions** = "no GA4 data" throughout (see §0). **Backlinks** = Ahrefs-tracked links to that exact URL; "0 (untracked)" means Ahrefs reports none, not that none exist. **Publication age** = best available evidence (git history for blog, file mtime + GSC first-crawl for locations — see §1 caveat).

### 3a. Static / structural pages

| URL | Page title | Page type | Index status | Clicks | Impressions | CTR | Avg. position | Conversions | Backlinks | Pub. age | Category | Recommended action | Reason | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | Homepage | Home | Indexed | 137 | 9,788 | 1.4% | 14.2 | no GA4 data | 1,416 | Site launch | Healthy | Keep | Strong performer, primary backlink target, no action needed beyond routine monitoring | Low |
| `/about/` | About | Static/trust | Indexed | 0 | 1 | — | 1.0 | no GA4 data | 0 (untracked) | Site launch | Healthy (structural) | Keep | Trust page, not a traffic play — safeguard applies | Low |
| `/contact/` | Contact | Conversion | Indexed | 0 | 507 | 0% | 14.3 | no GA4 data | 1 | Site launch | Underperforming | Improve title/meta + internal linking | Decent impressions at a good position but zero clicks suggests SERP snippet isn't compelling, or brand-searchers click the homepage instead | Medium |
| `/privacy-policy/` | Privacy Policy | Legal | Crawled, not indexed | 0 | 11 | 0% | 61.5 | no GA4 data | 0 | Site launch | Healthy (structural) | Keep, set to noindex | Legal requirement, not a ranking target — noindex is fine and expected here | Low |
| `/thank-you/` | Thank You | Conversion | Discovered, not indexed | 0 | 0 | — | — | no GA4 data | 0 | Site launch | Healthy (structural) | Keep, ensure noindex | Post-form confirmation page — should never rank; verify it's deliberately noindexed | Low |
| `/free-website-plan/` | Free Website Plan | Conversion/lead magnet | Indexed | 1 | 56 | 1.8% | 28.5 | no GA4 data | 0 | Site launch | Underperforming | Improve internal linking | Lead-gen page with real intent behind it; low impressions suggest it's under-linked from blog/service pages | Medium |
| `/web-design-offer/` | Web Design Offer | Campaign/offer | Inspection error (invalid_grant) | 0 | 5 | 0% | 58.6 | no GA4 data | 0 | Site launch | Insufficient data | Investigate further | Index status couldn't be confirmed this run — re-inspect before deciding anything | Medium |
| `/website-cost-calculator/` | Website Cost Calculator | Interactive tool | Inspection error | 0 | 1 | 0% | 72.0 | no GA4 data | 0 | Site launch | Insufficient data | Investigate further | Same inspection gap; a cost calculator is a strong engagement/link-magnet asset if working — worth checking it's indexable and internally linked | Medium |
| `/faq/` | FAQ | Static | Indexed | 0 | 7 | 0% | 5.3 | no GA4 data | 0 | Site launch | Healthy (structural) | Improve internal linking | Excellent position (5.3) on tiny impressions — it's ranking well for something very low-volume; expand FAQ content and link to it from service pages | Medium |

### 3b. Service pages (9 — the real "hub" pages every location cluster should point to)

| URL | Page title | Index status | Clicks | Impressions | CTR | Avg. position | Backlinks | Top query (impr.) | Category | Recommended action | Reason | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/services/web-design/` | Web Design | Indexed | 2 | 4,090 | 0.05% | 29.3 | 0 | "web design south wales" (539) | Underperforming | Keep and improve | Strongest service page by impressions; position 29 for a page that should be the site's flagship — needs stronger on-page proof (case studies, pricing clarity) and a clear internal-link funnel from all 68 `web-design-<town>` pages | Critical |
| `/services/local-seo-google-ranking/` | Local SEO & Google Ranking | Flagged "unknown to Google" in inspection, but earning real impressions | 1 | 7,043 | 0.01% | 33.2 | 0 | "seo south wales" (1,533) | Underperforming | Improve title/meta + re-inspect indexing | Contradiction between inspection result and live performance data — re-run URL Inspection to confirm current canonical/indexing state before doing anything else | Critical |
| `/services/logo-design/` | Logo Design | Indexed | 1 | 361 | 0.3% | 31.8 | 0 | "logo design swansea" (68) | Underperforming | Improve internal linking | Reasonable position for low competition; strengthen with links from the 68 `logo-design-<town>` pages | Medium |
| `/services/professional-mailboxes-email-setup/` | Professional Mailboxes & Email Setup | Indexed | 0 | 736 | 0% | 26.6 | 0 | "microsoft 365 set up north wales" (90) | Invisible | Improve title and meta description | Decent position, zero clicks — title/snippet likely doesn't match "business email" search phrasing; also cannibalised somewhat by 68 near-empty `professional-email-<town>` pages | High |
| `/services/website-maintenance-packages/` | Website Maintenance Packages | Indexed | 0 | 843 | 0% | 36.1 | 0 | "website maintenance packages wolverhampton" (178) | Invisible | Investigate further | Top query is for a different UK city entirely — check for a templating/data bug pulling in wrong location data or a rogue programmatic result | Critical |
| `/services/website-hosting-security/` | Website Hosting & Security | Indexed | 0 | 259 | 0% | 18.0 | 0 | "website hosting south wales" (68) | Invisible | Improve title and meta description | Good position, zero clicks — classic quick-win candidate | Medium |
| `/services/ecommerce-development/` | Ecommerce Development | Discovered, not indexed | 0 | 717 | 0% | 55.8 | 0 | "online shop design wales" (149) | Invisible | Investigate further, then improve | Not indexed despite impressions being logged (likely indexed status changed recently) — confirm indexing, then treat as underperforming | High |
| `/services/managed-starter-websites/` | Managed Starter Websites | Indexed | 0 | 21 | 0% | 47.5 | 0 | "web hosting management south wales" (85) | Invisible | Merge content review with location cluster | Weakest service page; pairs with the weakest location vertical (see §5) | Medium |
| `/services/web-development/` | Web Development | Crawled, not indexed | 0 | 75 | 0% | 48.1 | 0 | "web development south wales" (8) | Invisible | Merge with `/services/web-design/` | Low distinct demand for "web development" as separate from "web design" in your market; likely cannibalises rather than complements web-design | High |

### 3c. Portfolio pages (15 — retained regardless of clicks; these are trust/proof assets, not traffic plays)

All 15 portfolio pages are indexed, none have tracked backlinks, and only 2 have any clicks (`/portfolio/ak-promotions/`, `/portfolio/sell-my-caravan-right/`, 1–2 clicks each). Per your explicit safeguard, **none are removal candidates** — they support trust/conversion, not organic acquisition. Action for all 15: **Keep**; opportunity is **internal linking** (link each portfolio piece from the matching service page and matching location pages — e.g. `/portfolio/mj-roofing/` should be linked from `/web-design-merthyr-tydfil/` and any roofing-adjacent blog posts) rather than any pruning action. Priority: Medium (linking improvement), not urgent.

### 3d. Blog posts (273)

| Segment | Count | Recommended action | Reason | Priority |
|---|---|---|---|---|
| Posts with clicks > 0 (listed individually below) | 22 | Keep and improve | Real, working content — the highest-leverage improvement target on the whole site | High |
| Zero clicks, meaningful impressions (top 25 shown below; ~198 more in the long tail) | 223 | Improve title/meta on the top-impression subset; monitor the long tail | Impressions prove search demand exists; CTR of 0% across the board points to a systemic title/meta problem, not 223 individual content problems | High (top 25), Low (long tail) |
| Zero impressions in 12 months | 28 | Investigate further, then consolidate or improve | Mix of very new posts (April–May 2026 cohort, too early to judge) and older posts that never gained traction — see individual list | Medium |

**Posts with clicks (the 22 — your actual working content):**

| URL | Clicks | Impressions | Position | Topic |
|---|---|---|---|---|
| `/blog/free-email-vs-business-email-whats-the-difference/` | 3 | 1,422 | 18.7 | Email |
| `/blog/how-many-pages-does-a-small-business-website-need/` | 2 | 129 | 16.8 | Web design |
| `/blog/pay-monthly-website-vs-one-off-cost/` | 2 | 368 | 13.2 | Pricing |
| `/blog/should-your-logo-include-your-business-name/` | 2 | 239 | 8.1 | Logo |
| `/blog/what-happens-if-i-stop-paying-for-my-managed-website/` | 2 | 258 | 7.3 | Managed hosting |
| `/blog/can-you-have-a-professional-email-address-without-paying-monthly/` | 1 | 336 | 9.0 | Email |
| `/blog/does-your-business-email-address-affect-your-seo/` | 1 | 101 | 6.3 | Email/SEO |
| `/blog/does-your-email-address-match-your-website-domain/` | 1 | 143 | 12.3 | Email |
| `/blog/how-many-colours-should-a-logo-have/` | 1 | 210 | 8.7 | Logo |
| `/blog/how-much-does-a-professional-business-email-address-cost/` | 1 | 619 | 11.6 | Email/pricing |
| `/blog/how-much-does-web-design-cost-in-newport/` | 1 | 25 | 12.1 | Web design/local |
| `/blog/how-much-should-a-website-cost-for-a-small-business-in-south-wales/` | 1 | 74 | 13.2 | Pricing |
| `/blog/how-to-start-selling-online-as-a-small-business/` | 1 | 33 | 44.7 | Ecommerce |
| `/blog/is-a-cheap-website-worth-it/` | 1 | 24 | 27.4 | Pricing |
| `/blog/local-web-designer-vs-fiverr/` | 1 | 256 | 11.6 | Web design |
| `/blog/my-website-has-visitors-but-no-enquiries/` | 1 | 5 | 11.4 | CRO |
| `/blog/squarespace-vs-managed-website/` | 1 | 47 | 15.2 | Web design |
| `/blog/website-maintenance-packages-south-wales/` | 1 | 54 | 23.6 | Maintenance/local |
| `/blog/what-is-a-managed-website/` | 1 | 534 | 16.8 | Managed hosting |
| `/blog/what-is-an-ssl-certificate-and-does-your-website-need-one/` | 1 | 47 | 32.3 | Security |
| `/blog/what-to-look-for-when-choosing-a-business-email-provider/` | 1 | 39 | 13.8 | Email |
| `/blog/when-to-upgrade-from-a-starter-website-to-a-custom-build/` | 1 | 16 | 11.6 | Web design |

All 22: **Keep and improve.** These prove the blog's comparison/pricing/email angle works. Priority: High.

**Top 25 zero-click, high-impression posts (quick-win candidates — improve title/meta first):**

`how-much-does-a-professional-logo-design-cost-in-the-uk` (972 impr, pos 46.3) · `ecommerce-web-design-for-south-wales-small-businesses` (643, pos 8.9 — excellent position, wasted) · `what-is-included-in-microsoft-365-for-small-business` (466, pos 18.1) · `is-google-workspace-worth-it-for-a-small-business` (450, pos 25.4) · `how-much-does-website-maintenance-cost-in-the-uk` (348, pos 41.5) · `what-is-managed-website-hosting` (301, pos 60.3) · `wordpress-vs-wix-for-local-businesses-in-wales` (293, pos 18.8) · `how-much-does-an-ecommerce-website-cost-in-the-uk` (271, pos 20.5) · `email-hosting-vs-web-hosting-what-is-the-difference` (258, pos 20.2) · `do-you-need-a-website-maintenance-plan` (243, pos 15.7) · `how-much-does-a-website-cost-for-a-small-business-in-the-uk` (242, pos 23.8) · `what-is-website-hosting-and-how-does-it-work` (230, pos 35.4) · `what-is-seo-and-how-does-it-work-for-small-businesses` (215, pos 45.1) · `common-seo-mistakes-to-avoid-when-hiring-an-agency` (209, pos 10.0 — excellent position, wasted) · `how-to-advertise-your-building-company-online` (191, pos 46.0) · `what-does-a-web-developer-actually-do-for-a-small-business-website` (190, pos 29.6) · `how-to-get-your-business-on-google-maps` (186, pos 32.5) · `what-does-a-starter-business-website-look-like` (186, pos 23.8) · `seo-for-roofers` (179, pos 44.2) · `what-is-a-website-maintenance-plan` (176, pos 20.2) · `how-quickly-can-i-get-a-professional-business-email-address` (163, pos 7.0 — excellent position, wasted) · `shopify-vs-woocommerce-vs-surecart` (153, pos 10.7 — excellent position, wasted) · `how-long-does-it-take-to-build-an-ecommerce-website` (150, pos 10.3 — excellent position, wasted) · `why-web-design-matters-for-merthyr-businesses` (145, pos 45.0) · `what-to-do-after-your-website-goes-live` (142, pos 9.0 — excellent position, wasted)

Note the ones flagged "excellent position, wasted": positions 7–13 with literally 0 clicks is unusual and specifically points to a **title/meta or SERP-snippet problem**, not a ranking problem — these are the single best quick-win opportunity on the entire site. Priority: **Critical** for this sub-group specifically.

**Zero-impression posts (28) — mostly the April/May 2026 cohort, too new to judge**, plus a handful of older ones (`why-every-business-needs-a-website`, `why-your-business-needs-a-website`, `how-an-online-shop-can-free-up-hours-of-your-week`) that have had more time and still show nothing. Action: **Insufficient data** for the recent ones; **Investigate further** for the older repeat-titled pair (`why-every-business-needs-a-website` / `why-your-business-needs-a-website` look like accidental near-duplicates of each other — check whether one should be merged into the other before either gets more time invested). Priority: Medium.

### 3e. Location pages (620) — by service vertical

| Vertical (~68 pages each) | Clicks | Impressions | Zero-impr. pages | Not indexed | Category | Recommended action | Reason | Priority |
|---|---|---|---|---|---|---|---|---|
| `seo-<town>` | 12 | 84,282 | 1 | 6 | Underperforming | Keep and improve top ~20 by impressions; merge weakest into regional pages | Huge real demand, terrible conversion — depth/authority problem, not a demand problem. See §4 cannibalisation | Critical |
| `web-design-<town>` | 20 | 21,207 | 6 | 4 | Underperforming | Keep and improve top ~20; this is your strongest cluster | Best click count of any vertical; genuine local intent (people do search "web design [town]") | Critical |
| `ecommerce-web-design-<town>` | 2 | 7,483 | 7 | 4 | Underperforming | Keep top 10–15 by impressions, merge the rest into `/services/ecommerce-development/` | Moderate demand exists but spread far too thin across 68 near-identical pages | High |
| `logo-design-<town>` | 1 | 1,487 | 6 | 0 | Invisible | Merge into `/services/logo-design/` + 5–6 largest towns only | Low per-town demand for logo design specifically; doesn't need 68 pages | Medium |
| `web-agency-<town>` | 2 | 949 | 9 | 7 | Invisible / duplicate | **Merge into `web-design-<town>` per matching town, 301** | Same search intent as `web-design-<town>` for the same place — direct internal duplication (see §4) | High |
| `website-maintenance-<town>` | 1 | 992 | 22 | 14 | Invisible | Merge into `/services/website-maintenance-packages/` + a handful of largest towns | 22 of 68 have zero impressions and 14 aren't even indexed — weakest signal of genuine demand | High |
| `web-development-<town>` | 1 | 872 | 13 | 0 | Invisible | Merge into `web-design-<town>` per matching town, 301 | "Web development" isn't a distinct search intent from "web design" at town level in this market | High |
| `managed-starter-websites-<town>` | 0 | 993 | 26 | 5 | Invisible/Dead weight | Merge into `/services/managed-starter-websites/` + largest towns only | 26 of 68 (38%) have zero impressions — the weakest performing vertical alongside professional-email | High |
| `professional-email-<town>` | 1 | 203 | 42 | 16 | Dead weight (mostly) | Merge into `/services/professional-mailboxes-email-setup/`, keep only 5–10 largest towns | 42 of 68 (62%) zero impressions, 16 not indexed — clearest case for consolidation on this site | Critical |

**Individual location pages with real clicks (the 25 proof-points worth protecting/expanding):** `web-design-merthyr-tydfil` (13 clicks, 6,483 impr), `seo-cardiff` (1, 17,137 — huge impressions, 1 click, biggest single quick-win target), `seo-newport` (1, 13,710), `seo-mid-wales` (1, 8,953), `seo-north-wales` (1, 10,039), `seo-wales` (1, 7,081), `seo-wrexham` (1, 3,991), `seo-pontypridd` (1, 2,561), `seo-bridgend` (2, 4,700), `seo-aberdare` (2, 1,506), `seo-merthyr-tydfil` (1, 1,290), `web-design-swansea` (1, 4,200), `web-design-cardiff` (2, 1,578), `web-design-aberdare` (1, 1,426), `web-design-caerphilly` (1, 989), `web-design-south-wales` (1, 638), `web-design-vale-of-glamorgan` (1, 358), `ecommerce-web-design-pontypridd` (1, 691), `ecommerce-web-design-caerphilly` (1, 46), `website-maintenance-bridgend` (1, 29, position **2.5** — exceptional, expand this one), `logo-design-hay-on-wye` (1, 4, position 2.5), `web-agency-brecon` (1, 7), `web-agency-builth-wells` (1, 6), `professional-email-abergavenny` (1, 6), `web-development-vale-of-glamorgan` (1, 43). All: **Keep and improve.** Priority: High.

**8 one-off location pages outside the 9×68 pattern:**

| URL | Clicks | Impressions | Index status | Recommended action | Reason | Priority |
|---|---|---|---|---|---|---|
| `/local-seo/` | 0 | 11,120 | (see §4) | **Merge into `/services/local-seo-google-ranking/`, 301** | Second-highest-impression location page on the whole site, and it's a direct duplicate of the actual service page — pure cannibalisation | Critical |
| `/website-design-cardiff-uk/` | 0 | 261 | Not indexed | **Merge into `/web-design-cardiff/`, 301** | Same city, same intent, different URL — unambiguous duplicate | Critical |
| `/creative-web-design/` | 0 | 533 (current), 103 (prior year) | Indexed | Merge into `/services/web-design/`, 301 | Long-standing zero-click generic page; duplicates the service page's intent | High |
| `/seo-web-design/` | 0 | 273 | Not indexed | Merge into `/services/web-design/`, 301 | Hybrid-intent page competing with both `/services/web-design/` and the SEO cluster | Medium |
| `/website-builders-for-small-business/` | 0 | 348 | Indexed | Merge into `/services/managed-starter-websites/`, 301 | Thin, generic, duplicates managed-website intent | Medium |
| `/affordable-small-business-websites/` | 0 | 293 (current), 0 (prior year) | Not indexed | Merge into `/services/managed-starter-websites/` or `/web-design-south-wales/`, 301 | Zero clicks across two full years of data — the longest-standing non-performer on the site | Medium |
| `/website-building-company-near-me/` | 0 | 44 (current), 15 (prior year) | Indexed | Merge into `/web-design-south-wales/`, 301 | Small, persistent zero-click page | Low |
| `/web-design-startups/` | 0 | 51 | Indexed | Merge into `/services/web-design/`, 301 | Niche angle with minimal distinct demand | Low |

---

## 4. Cannibalisation analysis

1. **`/website-design-cardiff-uk/` vs `/web-design-cardiff/`** — identical city, identical intent ("web design in Cardiff"). Two URLs actively splitting whatever authority Cardiff has. **Merge:** `/web-design-cardiff/` is the primary (indexed, has clicks); redirect the other in, 301.
2. **`/local-seo/` vs `/services/local-seo-google-ranking/` vs the 68 `seo-<town>` pages** — a three-tier cannibalisation stack all targeting "local SEO" intent with no clear hierarchy. `/local-seo/` (11,120 impressions, 0 clicks) is a duplicate of the real service page and should not exist as a separate URL. **Primary:** `/services/local-seo-google-ranking/`. Merge `/local-seo/` into it; keep the town pages but make sure each links up to the service page as "the" canonical SEO offer (many already do via body copy — verify consistency).
3. **`web-agency-<town>` vs `web-design-<town>`** (per matching town, ~68 pairs) — same intent, two templates. Confirmed by comparing impressions: `web-design-<town>` consistently outperforms its `web-agency-<town>` counterpart. **Primary:** `web-design-<town>` in every case. Redirect the `web-agency-*` counterpart, 301, per town (not to the homepage — to the matching town's web-design page).
4. **`web-development-<town>` vs `web-design-<town>`** — same pattern, weaker cluster duplicating the stronger one. **Primary:** `web-design-<town>`. Merge per-town.
5. **`/services/website-maintenance-packages/` top query is "website maintenance packages wolverhampton"** — Wolverhampton is not in your service area. This is either a genuine anomalous SERP inclusion or a sign this page/template is pulling in content or structured data that doesn't match your actual location targeting. **Investigate before doing anything else with this page** — Priority Critical, but as an investigation, not a content fix.
6. **Regional roll-ups (`seo-wales`, `seo-north-wales`, `seo-mid-wales`, `seo-south-wales`, `web-design-south-wales`) vs town pages within those regions** — these aren't true cannibalisation (region vs town is a legitimate intent split, and Google is showing both for different query variants), but they do currently lack a clear internal-linking hierarchy. Recommend: keep both tiers, but make sure every town page links up to its region page and the region page links to its top towns — this is a linking fix, not a merge.

---

## 5. Content quality analysis

Directly comparing `seo-aberdare` and `seo-newport` source files: the "What our [X] SEO service includes" bullet list is near word-for-word identical across towns (local keyword research, Google Business Profile optimisation, on-page SEO, local citation building, technical SEO audit, monthly reporting — reworded by only a word or two per page). The only genuinely unique content per page is the opening paragraph, a locally-named "areas we serve" list, and internal links to neighbouring towns.

- **Median location-page length: 285 words.** 335 of 620 pages (54%) are under 300 words. 54 are under 200 words.
- This is consistent with Google's own signal: **61 of 620 location pages aren't indexed at all**, and the indexed ones mostly sit at position 30–65 — Google is already telling you it doesn't see enough unique value to rank most of these competitively.
- This does **not** mean "delete the location pages." It means: the template needs a genuinely unique, substantive section per town (e.g., a real local detail, a client example from that town if one exists, or town-specific stats), not just swapped-in place names — and the weakest, most duplicative instances (the ones with zero impressions in a low-demand vertical) are better consolidated than left to compete against each other and against the real service page.

---

## 6. Pages to improve first

Ranked by realistic upside (impressions × how fixable the gap looks):

1. **`seo-cardiff`** — 17,137 impressions, 1 click, position 51. Biggest raw opportunity on the site if position can be pulled into the top 20.
2. **`/services/web-design/`** and **`web-design-<top 10 towns>`** — your strongest, most legitimately-in-demand cluster; small ranking gains here compound across the whole vertical.
3. **The 25 "excellent position, wasted" blog posts** (§3d) — positions 7–13 with zero clicks is a pure title/meta problem, fixable in an afternoon, not a content problem.
4. **`seo-newport`, `seo-mid-wales`, `seo-north-wales`, `seo-wales`** — each already has 7,000–14,000 impressions; these four alone represent ~40,000 impressions currently converting to 4 clicks total.
5. **`website-maintenance-bridgend`** and **`logo-design-hay-on-wye`** — both already rank position ~2.5. Proof the template *can* rank well; worth understanding why these two succeeded where 130+ siblings didn't (probably lower competition town, not template quality — investigate before assuming it's replicable).

---

## 7. Consolidation opportunities

| Merge these | Into this primary URL | What to carry over |
|---|---|---|
| `web-agency-<town>` (all ~68) | `web-design-<town>` (matching town) | Any unique testimonial/local detail; 301 redirect the rest |
| `web-development-<town>` (all ~68) | `web-design-<town>` (matching town) | Same |
| Bottom ~55 of `professional-email-<town>` (keep only top ~10 by impressions) | `/services/professional-mailboxes-email-setup/` | Fold "areas we cover" into the service page's location list |
| Bottom ~55 of `managed-starter-websites-<town>` | `/services/managed-starter-websites/` | Same pattern |
| Bottom ~50 of `website-maintenance-<town>` | `/services/website-maintenance-packages/` | Same pattern |
| `/local-seo/` | `/services/local-seo-google-ranking/` | Nothing unique to carry — pure duplicate |
| `/website-design-cardiff-uk/` | `/web-design-cardiff/` | Nothing unique to carry |
| `/creative-web-design/`, `/seo-web-design/`, `/web-design-startups/` | `/services/web-design/` | Any distinct phrasing worth folding into the service page's intro |
| `/website-builders-for-small-business/`, `/affordable-small-business-websites/` | `/services/managed-starter-websites/` | Same |
| `/website-building-company-near-me/` | `/web-design-south-wales/` | Nothing unique |

This reduces the location-page count from 620 to roughly **270–300** without touching a single page that has demonstrated any real search interest — every page named above has either zero clicks and zero-to-negligible impressions, or is a confirmed duplicate of a stronger sibling.

---

## 8. Potential removals

**None recommended as outright 410/delete.** Every zero-signal page identified in this audit is a candidate for **merge + 301** into a stronger, closely-related URL (never the homepage), not deletion — because:
- Search demand for the underlying service clearly exists (proven by the service-page and top-town impressions);
- The pages are recent enough that "no traffic yet" is still partly explained by limited indexing time;
- A 301 to a genuinely relevant page preserves any crawl equity and avoids creating 404/410 noise across ~250+ URLs at once.

If, after the consolidation in §7 and a further 3-month observation window, the merged/redirected town pages still show zero uplift on their new destination pages, **then** consider `noindex`-ing rather than 410 for the very smallest towns (sub-5,000 population) where local search volume may never materialise — but that's a decision for late 2026, not now.

---

## 9. Internal linking opportunities

- **Portfolio → location/service pages:** none of the 15 portfolio pages currently appear to be linked from their matching trade/location context (e.g. `/portfolio/mj-roofing/` should be linked from `/web-design-merthyr-tydfil/` and any roofing-related blog content). Portfolio pages have zero tracked backlinks and near-zero organic clicks of their own — their value is entirely as internal trust signals, so route authority *to* them from high-traffic pages, not the other way round.
- **Homepage (9,788 impressions, 137 clicks, DR-carrying page with 1,416 backlinks) → weak service pages:** `/services/web-development/`, `/services/managed-starter-websites/`, `/services/ecommerce-development/` are the weakest-performing service pages and would benefit most from a direct homepage link/mention.
- **Strong town pages → weak sibling verticals:** e.g. `web-design-merthyr-tydfil` (your best-performing location page) should link to `seo-merthyr-tydfil`, `logo-design-merthyr-tydfil`, etc., where they don't already — cross-selling internal links from your one genuinely strong local page.
- **Blog quick-win posts → matching service pages:** several top-impression blog posts (`what-is-a-managed-website`, `do-you-need-a-website-maintenance-plan`, `how-much-does-website-maintenance-cost-in-the-uk`) should link directly to `/services/website-maintenance-packages/` — check this is already happening consistently.

---

## 10. Implementation plan

**Immediate (this week):**
- Re-inspect `/services/local-seo-google-ranking/` and `/services/ecommerce-development/` indexing status — the inspection-vs-performance contradiction needs resolving before any further decisions rely on it.
- Investigate the `/services/website-maintenance-packages/` "Wolverhampton" query anomaly.
- Fix titles/meta descriptions on the 25 "excellent position, wasted" blog posts (§3d) — cheapest, fastest win available.
- Confirm `/thank-you/`, `/web-design-offer/`, `/website-cost-calculator/` are correctly indexable/noindexed as intended (inspection errors this run).
- Commit the 619 untracked location page files to git.

**Next 30 days:**
- Execute the `web-agency-*` → `web-design-*` and `web-development-*` → `web-design-*` 301 consolidations (§4, §7) — highest-confidence, lowest-risk merges on the list.
- Merge the 8 one-off duplicate location pages (§3e) into their named primary URLs.
- Improve internal linking: portfolio pages, homepage → weak service pages, strong town pages → sibling verticals (§9).
- Add genuinely unique per-town content (not just place-name swaps) to the top 20 `seo-<town>` and `web-design-<town>` pages identified in §6.

**Next 60–90 days:**
- Consolidate the bottom ~55 pages each in `professional-email-*`, `managed-starter-websites-*`, and `website-maintenance-*` into their respective service pages, keeping only the top 8–10 towns by impressions as standalone pages.
- Re-pull GSC data to measure whether the redirected URLs' authority is showing up on their destination pages (see §11).
- Revisit the April–May 2026 blog cohort and the least-crawled location pages now that they'll have 5–6 months of real exposure.

**Monitor before deciding (do not touch yet):**
- All location pages first crawled after May 2026 and the entire April–May 2026 blog cohort — genuinely too new for a traffic verdict.
- `/web-design-offer/` and `/website-cost-calculator/` pending re-inspection.

---

## 11. Measurement plan

Re-run the same three data pulls used for this audit (`node scripts/ahrefs-fetch.mjs`, `node scripts/ahrefs-keywords.mjs`, and a full 12-month GSC page-level pull) monthly, tracking:
- **Clicks & impressions** — site-wide and per-vertical (the 9-cluster breakdown in §1 is the right unit to track, not 620 individual pages).
- **CTR** — specifically on the 25 quick-win blog posts post-title/meta-change; a real CTR lift within 2–4 weeks confirms the fix worked.
- **Average position** — on `seo-cardiff` and the top 10 `web-design-<town>` pages named in §6.
- **Indexed page count** — should drop from ~930 toward ~650–700 as consolidation proceeds; a *falling* indexed count here is the success signal, not a warning sign.
- **Crawl errors / 404s** — watch Search Console's Page Indexing report for any spike after the 301 batches go live; a 301 done correctly should show as "Page with redirect," not an error.
- **Cannibalisation** — re-run the page+query GSC pull after each consolidation batch and confirm the merged destination page (not some other page) is now the one Google shows for the target query.
- **Performance of redirected URLs** — for each `web-agency-<town>` → `web-design-<town>` redirect, check within 4–8 weeks whether the destination town page's impressions/position improved (evidence the merge helped) or stayed flat (evidence it was truly dead weight either way).
- **Organic conversions** — once GA4 access is available, this should replace clicks as the primary prioritisation signal; recommend setting that up before the 60–90 day consolidation phase so you're not deciding blind on the bigger cuts.
