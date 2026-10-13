# plumberwebsitedesign.co.uk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch plumberwebsitedesign.co.uk, a static Astro lead site selling websites to UK plumbers, with enquiries landing in the NC Digital CRM.

**Architecture:** NC Digital's public enquiry endpoints get a strict CORS allowlist for the plumber origins (new module `src/lib/enquiry-cors.js`). The plumber site is a separate Astro static project on Cloudflare Workers static assets. Its form posts cross-origin to `https://nc-digital.co.uk/api/enquiries`.

**Tech Stack:** Astro 7.3.2, @astrojs/sitemap 3.7.4, @fontsource/sora, plain CSS tokens, Cloudflare Workers (wrangler 4), node:test.

Spec: `docs/superpowers/specs/2026-10-08-plumber-website-design-site-design.md`

**Facts found while planning:**
- `src/lib/crm.js` and `tests/unit/crm.test.js` have uncommitted user edits, so don't modify them. The CORS change goes into a new module plus `src/lib/crm-api.js`, which has no pending edits.
- `normaliseEnquiry` requires `from_page` to start with `/`. The plumber form sends the path, and `handleEnquiry` prefixes the allowlisted origin so the CRM shows the full URL.
- NC Digital shows no phone number, only `info@nc-digital.co.uk`. The plumber site config has `phone: ''`, and call links render only when it is set.

---

## Part 1: NC Digital enquiry CORS (this repo)

### Task 1: enquiry-cors module (TDD)

**Files:**
- Create: `src/lib/enquiry-cors.js`
- Test: `tests/unit/enquiry-cors.test.js`

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { enquiryOrigin, withCors, preflight, ENQUIRY_ORIGINS } from '../../src/lib/enquiry-cors.js';

const req = (url, origin, method = 'POST') => new Request(url, { method, headers: origin ? { Origin: origin } : {} });

test('own origin is accepted and not treated as external', () => {
  assert.deepEqual(enquiryOrigin(req('https://nc-digital.co.uk/api/enquiries', 'https://nc-digital.co.uk')), { origin: 'https://nc-digital.co.uk', external: false });
});
test('plumber origins are accepted as external', () => {
  for (const o of ['https://plumberwebsitedesign.co.uk', 'https://www.plumberwebsitedesign.co.uk']) {
    assert.deepEqual(enquiryOrigin(req('https://nc-digital.co.uk/api/enquiries', o)), { origin: o, external: true });
  }
});
test('unknown and missing origins are rejected with 403', () => {
  for (const o of ['https://evil.example', 'https://plumberwebsitedesign.co.uk.evil.example', null]) {
    assert.throws(() => enquiryOrigin(req('https://nc-digital.co.uk/api/enquiries', o)), e => e.status === 403);
  }
});
test('withCors adds headers only for external origins', () => {
  const ext = withCors(Response.json({ ok: 1 }), 'https://plumberwebsitedesign.co.uk');
  assert.equal(ext.headers.get('Access-Control-Allow-Origin'), 'https://plumberwebsitedesign.co.uk');
  assert.equal(ext.headers.get('Vary'), 'Origin');
  const own = withCors(Response.json({ ok: 1 }), null);
  assert.equal(own.headers.get('Access-Control-Allow-Origin'), null);
});
test('preflight answers allowlisted origins and refuses others', () => {
  const ok = preflight(req('https://nc-digital.co.uk/api/enquiries', 'https://plumberwebsitedesign.co.uk', 'OPTIONS'));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Methods'), 'GET, POST');
  assert.equal(ok.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  const bad = preflight(req('https://nc-digital.co.uk/api/enquiries', 'https://evil.example', 'OPTIONS'));
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});
test('allowlist is exactly the plumber domains', () => {
  assert.deepEqual([...ENQUIRY_ORIGINS].sort(), ['https://plumberwebsitedesign.co.uk', 'https://www.plumberwebsitedesign.co.uk']);
});
```

- [ ] **Step 2:** `node --test tests/unit/enquiry-cors.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement**

```js
import { crmError } from './crm.js';

// Partner sites allowed to post to the public enquiry endpoints. Admin/CRM routes stay same-origin only.
export const ENQUIRY_ORIGINS = new Set(['https://plumberwebsitedesign.co.uk', 'https://www.plumberwebsitedesign.co.uk']);

export function enquiryOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin === new URL(request.url).origin) return { origin, external: false };
  if (origin && ENQUIRY_ORIGINS.has(origin)) return { origin, external: true };
  throw crmError('Refresh the page and try again.', 403);
}

function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
}

export function withCors(response, origin) {
  if (!origin || !ENQUIRY_ORIGINS.has(origin)) return response;
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  return res;
}

export function preflight(request) {
  const origin = request.headers.get('Origin');
  if (!origin || !ENQUIRY_ORIGINS.has(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
```

- [ ] **Step 4:** Rerun. Expected: all PASS.

### Task 2: wire into handleEnquiry

**Files:** Modify `src/lib/crm-api.js` (`handleEnquiry`). Test: append to `tests/unit/enquiry-cors.test.js`.

- [ ] **Step 1: Failing integration tests.** These call `handleEnquiry` with a fake D1 (copy the `database()` helper pattern from `tests/unit/crm.test.js`, migrations 0001, 0015–0021):
  - POST from `https://plumberwebsitedesign.co.uk` with `from_page: '/pricing/'` returns 201 and the ACAO header. The stored ticket has `source_page === 'https://plumberwebsitedesign.co.uk/pricing/'`.
  - POST from `https://evil.example` returns 403.
  - OPTIONS from the plumber origin returns 204.
  - GET `/api/enquiries/config` from the plumber origin returns ACAO.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** In `handleEnquiry`:

```js
export async function handleEnquiry(request, env) {
  const corsOrigin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return preflight(request);
  return withCors(await enquiryResponse(request, env), corsOrigin);
}
async function enquiryResponse(request, env) {
  try {
    const url = new URL(request.url);
    if (url.pathname === '/api/enquiries/config' && request.method === 'GET') return crmResponse({ enabled: env.CRM_ENABLED === 'true' });
    if (url.pathname !== '/api/enquiries' || request.method !== 'POST') throw crmError('Not found.', 404);
    const { origin, external } = enquiryOrigin(request);
    ...unchanged...
    const data = normaliseEnquiry(raw);
    if (external) data.source_page = origin + (data.source_page || '/');
    ...unchanged...
```

  `sameOrigin` stays imported (it is still used elsewhere in the file).
- [ ] **Step 4:** Run `node --test tests/unit/enquiry-cors.test.js` and `npm run crm:test`. Expected: all PASS (existing same-origin tests are unchanged).
- [ ] **Step 5: Commit** only `src/lib/enquiry-cors.js`, `src/lib/crm-api.js`, `tests/unit/enquiry-cors.test.js`.
- [ ] **Step 6: Deploy** with `npm run build && npx wrangler deploy`. Then `curl -i -X OPTIONS https://nc-digital.co.uk/api/enquiries -H "Origin: https://plumberwebsitedesign.co.uk"`. Expected: 204 with ACAO.

---

## Part 2: Plumber site (new repo `C:\Users\NathanConstanceRhysW\Desktop\Plumber Website Design`)

### File map

```
package.json, astro.config.mjs, wrangler.toml, .gitignore, tsconfig.json
public/robots.txt, public/favicon.svg, public/_headers
src/site.ts                       site config: name, url, email, phone, plans, trades
src/styles/global.css             tokens (navy/copper), base, layout utilities
src/layouts/Base.astro            <head>, SEO meta, canonical, JSON-LD slot, header, footer, mobile CTA bar
src/components/Header.astro       logo + nav
src/components/Footer.astro       links, "A service by NC Digital" credit
src/components/Logo.astro         SVG wordmark
src/components/CtaBand.astro      final call-to-action band
src/components/Pricing.astro      monthly / outright toggle (data from site.ts)
src/components/Faq.astro          accordion (details/summary) + FAQPage JSON-LD
src/components/EnquiryForm.astro  cross-origin form → NC Digital CRM
src/components/CaseStudy.astro    image + text block
src/components/TradeCards.astro
src/components/Schema.astro       JSON-LD helper
src/assets/work/*.jpeg            copied from NC Digital portfolio (Pro Tech, IR Energy, Electrician Merthyr, M&J Roofing)
src/pages/index.astro, pricing.astro, gas-engineer-website-design.astro, heating-engineer-website-design.astro,
  bathroom-fitter-website-design.astro, seo-for-plumbers.astro, work.astro, about.astro, free-audit.astro,
  contact.astro, thank-you.astro, privacy-policy.astro, terms.astro, 404.astro
```

### Task 3: Scaffold
- [ ] Create `package.json` (astro 7.3.2, @astrojs/sitemap 3.7.4, @fontsource/sora; scripts dev/build/preview/deploy), `astro.config.mjs` (`site: 'https://plumberwebsitedesign.co.uk'`, `trailingSlash: 'always'`, sitemap excluding /thank-you/), `wrangler.toml` (name `plumber-website-design`, `[assets] directory="./dist"`, `not_found_handling="404-page"`, `html_handling="force-trailing-slash"`), `.gitignore`.
- [ ] `npm install` then `git init`. Commit.

### Task 4: Config, tokens, layout, shared components
- [ ] `src/site.ts`: plans `starter £59`, `pro £99`, `growth £159`, outright `£795 + £20/mo`, feature lists from the spec, `email: 'info@nc-digital.co.uk'`, `phone: ''`, `enquiryApi: 'https://nc-digital.co.uk/api/enquiries'`.
- [ ] Tokens: `--navy-950 #0b1524`, `--navy-900 #10203a`, `--navy-700 #1d3557`, `--copper #c8793a`, `--copper-light #e3a36b`, `--paper #f7f4ef`, `--ink #14202e`, `--muted #5b6675`. Dark sections are navy; content sections are paper. Light and dark tones are both used, by section rather than by theme.
- [ ] Base layout: title/description/canonical/OG props, `jsonLd` prop, skip link, sticky mobile CTA bar (Quote, plus Call if phone set).
- [ ] Build passes. Commit.

### Task 5: Enquiry form
- [ ] Fields: name, email, phone, business name, trade (select: Plumber / Gas engineer / Heating engineer / Bathroom fitter / Other), current website (optional URL → `website_url`), message, honeypot `botcheck`, hidden `service`, hidden `lead_source=plumberwebsitedesign.co.uk`.
- [ ] Script: GET config (disabled → show "email info@nc-digital.co.uk"), POST JSON with `from_page = location.pathname`, `submission_key = crypto.randomUUID()` (regenerated on input), redirect to `/thank-you/` on success, inline error with mailto fallback otherwise.
- [ ] Commit.

### Task 6: Pages
Each page has a unique title (≤60 chars) and meta description (≤155), one H1, a `Service` JSON-LD on trade pages, BreadcrumbList on inner pages, and a CTA band. All copy is original.
- [ ] Home: hero, trust bar, Pro Tech case study, three problems, trade cards, pricing, about Nathan, FAQ (9 Qs), CTA + form.
- [ ] Pricing: full comparison table for monthly vs outright, what's included, plan FAQ (6 Qs).
- [ ] Gas / Heating / Bathroom: trade-specific needs (Gas Safe number & badge, boiler service and CP12 reminders; heat pump/MCS and BUS grant pages, IR Energy proof; before/after gallery and project pages), recommended plan.
- [ ] SEO for plumbers: what we do, IR Energy +76% clicks / +164% impressions / 50 enquiries in 3 months, Google Business Profile.
- [ ] Work: Pro Tech (lead), IR Energy, Electrician Merthyr Tydfil, M&J Roofing, each with a link to the live site.
- [ ] About, Free audit (form variant with URL required), Contact, Thank you (noindex), Privacy, Terms, 404.
- [ ] Commit after each group.

### Task 7: Verify & deploy
- [ ] `npm run build`, then check dist for every page, one `<h1>` each, and no broken internal links (script).
- [ ] Lighthouse mobile on `/` and `/pricing/`. Targets: performance ≥95, SEO 100, accessibility ≥95.
- [ ] `npx wrangler deploy`, attach the custom domains plumberwebsitedesign.co.uk + www (dashboard, or `routes` with `custom_domain = true`), and add a www→apex redirect rule.
- [ ] Send a live test enquiry and confirm the CRM ticket's `source_page` starts with `https://plumberwebsitedesign.co.uk/`. Close the test ticket.
- [ ] Submit the sitemap in Search Console (Nathan).
