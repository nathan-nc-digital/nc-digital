# plumberwebsitedesign.co.uk — Design

Date: 2026-10-08
Status: Approved approach (Option A). Awaiting spec review.

## Purpose

A lead generation site at **plumberwebsitedesign.co.uk** that sells websites to UK plumbers, gas engineers, heating engineers and bathroom fitters. It is a sub-brand: "Plumber Website Design — by NC Digital". Enquiries feed the existing NC Digital CRM.

Keyword data (DataForSEO, UK, Oct 2026): "plumber website design" / "plumbing website design" 480/mo, CPC ~£7, KD 0. "websites for plumbers" 480/mo, KD 36. Page 1 is mostly US listicles. The closest UK specialist is plumberwebdesign.co.uk.

## Competitor boundary

plumberwebdesign.co.uk (Plumber Web Design, Andover) is a **structural reference only**. Its domain is four letters away from ours, so to avoid passing-off and copyright problems:

- No copied text, headings, FAQs, images, layout, colour scheme, logo style or tier names (Apprentice / Journeyman / Master).
- Our own brand name, palette, copy and design.
- Ideas we keep, because they are common industry patterns: per-trade service pages, three tiers, founder-led positioning, a free audit offer, FAQ content.

What makes us different: a **real plumbing case study** (Pro Tech Plumbing and Bathrooms, Caerphilly) where they show demo sites only. Also Nathan's track record (building websites since 2008, NC Digital), real trade portfolio and a buy-outright option.

## Architecture

- **New standalone project:** `C:\Users\NathanConstanceRhysW\Desktop\Plumber Website Design`, its own git repo.
- **Stack:** Astro (same major version as NC Digital), static output, Markdoc not needed in v1 (pages are .astro). Plain CSS with tokens, no Tailwind (avoids the known Tailwind v4 padding issue).
- **Hosting:** Cloudflare Workers static assets, custom domain plumberwebsitedesign.co.uk with `www` redirected to the apex.
- **No server code** in the new site. The form posts directly to NC Digital.

### Enquiry flow

1. The form on plumberwebsitedesign.co.uk sends `POST https://nc-digital.co.uk/api/enquiries` (JSON, same payload shape as `src/components/EnquiryForm.astro`), with:
   - `service`: e.g. "Plumber website: Pro plan" (from the page/plan context)
   - `source_page`: full URL on plumberwebsitedesign.co.uk
   - `subject`: "New enquiry from Plumber Website Design"
   - honeypot `botcheck`, and a client-generated `submission_key`, as the NC Digital form already does
2. Before submitting, the form checks `GET https://nc-digital.co.uk/api/enquiries/config`. If the CRM is disabled it shows the email fallback.
3. The ticket arrives in the existing CRM inbox. Its `source_page` shows the plumber domain.

### Required change in NC Digital (this repo)

`sameOrigin()` in `src/lib/crm.js` currently rejects any Origin other than its own. Change:

- Add an allowlist: own origin + `https://plumberwebsitedesign.co.uk` + `https://www.plumberwebsitedesign.co.uk`. Allowlisted origins only; no wildcard.
- `/api/enquiries` and `/api/enquiries/config` answer `OPTIONS` preflight, and add `Access-Control-Allow-Origin: <matching origin>`, `Vary: Origin`, `Access-Control-Allow-Methods: GET, POST`, `Access-Control-Allow-Headers: Content-Type` for allowlisted origins only.
- Admin/CRM routes keep strict same-origin checks. Only the public enquiry endpoints change.
- Unit tests in `tests/unit/crm.test.js`: allowlisted origin accepted, unknown origin rejected (403), preflight returns the correct headers, admin routes still same-origin only.
- Rate limiting and duplicate protection are unchanged.

## Brand & design

- Name: **Plumber Website Design**, tagline "by NC Digital".
- Palette: deep navy base + copper/brass accent (pipework nod), off-white surfaces. Distinct from NC Digital purple/black and from the competitor's blueprint style.
- Type: one sans for headings and body, self-hosted via @fontsource. No external font CDN.
- Tone: plain-spoken, trade-friendly, first person from Nathan ("you'll deal with me, the person who builds it").
- Mobile first; sticky call / quote bar on mobile.

## Pages (v1)

| Route | Main keyword / purpose |
|---|---|
| `/` | plumber website design, web design for plumbers |
| `/pricing/` | plumber website cost; full plan comparison |
| `/gas-engineer-website-design/` | gas engineer websites (Gas Safe display, CP12/boiler service booking) |
| `/heating-engineer-website-design/` | heating engineer and heat pump websites |
| `/bathroom-fitter-website-design/` | bathroom fitter websites (gallery-led) |
| `/seo-for-plumbers/` | seo for plumbers |
| `/work/` | Pro Tech Plumbing case study first, then other NC Digital trade sites as proof |
| `/about/` | Nathan, building websites since 2008, Merthyr Tydfil, serving UK |
| `/free-audit/` | audit request form (URL + contact) |
| `/contact/` | enquiry form, phone, email |
| `/privacy-policy/`, `/terms/` | legal |
| `/404` | not found |

Out of scope for v1: town pages, blog, AI chatbot / voice add-ons.

### Homepage sections

1. Hero: H1 on "plumber website design", sub-line, primary CTA (Get a quote), secondary CTA (Free audit), phone.
2. Trust bar: since 2008, real trade clients, UK-wide, monthly or outright.
3. Case study: Pro Tech Plumbing (screenshot, what was built, link to live site).
4. Problems: why plumber sites lose jobs (not found on Google, poor on mobile, no clear way to call).
5. Trade cards linking to the three trade pages and SEO.
6. Pricing: monthly / buy-outright toggle.
7. About Nathan.
8. FAQ (8–10 questions, original wording) with FAQPage schema.
9. Final CTA + enquiry form.

## Pricing

Monthly (12-month minimum, then 30 days' notice; hosting, SSL and domain included):

| Plan | Price | Includes |
|---|---|---|
| Starter | £59/mo | 5 pages, mobile-first, basic local SEO, contact form, Google Business Profile setup, Analytics + Search Console |
| Pro | £99/mo | 10 pages, service + area pages, advanced local SEO, monthly GBP posts, review request setup |
| Growth | £159/mo | 20+ pages, 2 blog posts/month, GBP management, review management, quarterly SEO report |

Buy outright: **from £795**, plus **£20/mo** hosting & care (updates, backups, small edits). The client owns the site from launch.

Ownership on monthly plans: the client owns the site and content after the 12-month minimum.

## SEO

- Unique title/meta per page; canonical URLs; `@astrojs/sitemap`; robots.txt.
- Schema: `ProfessionalService` (NC Digital as parent organisation), `Service` per trade page, `FAQPage` on home and pricing, `BreadcrumbList`.
- Footer credit: "A service by NC Digital" → https://nc-digital.co.uk/ (dofollow). NC Digital's Pro Tech portfolio page can link back later (separate change, not v1).
- Images: Astro image optimisation, WebP/AVIF, explicit dimensions.

## Assets needed

- Pro Tech Plumbing screenshots: reuse from NC Digital `src/assets/portfolio/` (Nathan's own work).
- Logo: simple wordmark built in SVG.
- Phone number and email to show: **to confirm with Nathan before launch** (default: NC Digital's existing contact details).

## Testing & launch

- `astro build` passes with no warnings about missing images/links.
- Link check across all pages.
- Lighthouse (mobile) on `/` and `/pricing/`: target ≥ 95 performance, 100 SEO, ≥ 95 accessibility.
- NC Digital: CRM unit tests pass; deploy; then send a real test enquiry from the staging/live plumber site and confirm the ticket appears in the CRM with the plumber `source_page`.
- Deploy the plumber site with `wrangler deploy`, attach the custom domain, confirm apex + www redirect, then submit the sitemap in Search Console.
