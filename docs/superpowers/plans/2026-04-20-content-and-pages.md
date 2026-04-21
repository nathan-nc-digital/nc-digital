# NC Digital — Content & Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all content pages (services, portfolio, blog, locations, static pages), add JSON-LD structured data, and create a WordPress migration script.

**Architecture:** All dynamic pages use Astro's `getStaticPaths()` with Keystatic's `createReader` to generate static HTML at build time. Location pages sit at the root level (`/[location].astro`) — static routes take priority so `/about`, `/contact` etc. are unaffected. Contact form uses Web3Forms (free, no backend).

**Tech Stack:** Astro 5.18.1, Keystatic `createReader`, Playwright tests, Web3Forms, Node.js migration script

---

## Codebase Context (read before starting)

- `src/layouts/BaseLayout.astro` — wraps all pages, accepts `title`, `description`, optional `image`, `canonical`
- `keystatic.config.ts` — defines collections: `blog`, `portfolio`, `services`, `locations`; singleton: `siteSettings`
- `createReader(process.cwd(), config)` from `@keystatic/core/reader` — reads content at build time
- CSS variables: `--bg`, `--bg-2`, `--bg-3`, `--border`, `--purple` (#8750f7), `--white`, `--text`, `--text-muted`
- CSS classes: `.container`, `.site-pad`, `.eyebrow`, `.btn-primary`, `.btn-outline`, `.card`, `.divider`
- 17 existing Playwright tests must keep passing throughout

---

## File Map

```
src/
  pages/
    services/
      index.astro             # Services listing
      [slug].astro            # Individual service
    portfolio/
      index.astro             # Portfolio listing
      [slug].astro            # Individual portfolio case study
    blog/
      [...page].astro         # Blog listing (paginated: /blog/, /blog/2/ etc.)
      [slug].astro            # Individual blog post
    [location].astro          # Location pages (dynamic, root level)
    about.astro
    contact.astro
    free-website-plan.astro
    privacy-policy.astro
  components/
    JsonLD.astro              # JSON-LD <script type="application/ld+json">
  content/
    services/                 # 5 .mdoc files (seeded in Task 1)
    portfolio/                # 5 .mdoc files (seeded in Task 2)
scripts/
  migrate-wordpress.mjs       # WP XML → Markdoc conversion script
tests/
  services.spec.ts
  portfolio.spec.ts
  blog.spec.ts
  locations.spec.ts
  static-pages.spec.ts
```

---

## Task 1: Services Pages + Seed Content

**Files:**
- Create: `src/content/services/web-development/index.mdoc`
- Create: `src/content/services/local-seo-google-ranking/index.mdoc`
- Create: `src/content/services/website-maintenance-packages/index.mdoc`
- Create: `src/content/services/website-hosting-security/index.mdoc`
- Create: `src/content/services/professional-mailboxes-email-setup/index.mdoc`
- Create: `src/pages/services/index.astro`
- Create: `src/pages/services/[slug].astro`
- Create: `tests/services.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/services.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('services listing page loads', async ({ page }) => {
  await page.goto('/services');
  await expect(page.locator('h1')).toBeVisible();
});

test('services listing links to individual service', async ({ page }) => {
  await page.goto('/services');
  await expect(page.locator('a[href="/services/web-development"]')).toBeVisible();
});

test('individual service page loads', async ({ page }) => {
  await page.goto('/services/web-development');
  await expect(page.locator('h1')).toBeVisible();
});

test('service page has meta description', async ({ page }) => {
  await page.goto('/services/web-development');
  const desc = await page.locator('meta[name="description"]').getAttribute('content');
  expect(desc).toBeTruthy();
});
```

- [ ] **Step 2: Run — all 4 must FAIL**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/services.spec.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create service content files**

Create `src/content/services/web-development/index.mdoc`:

```
---
title: Web Development
headline: Fast, custom websites built to convert
description: We design and build professional websites for South Wales small businesses. Every site is custom-built, mobile-first, and optimised for speed and search engines.
features:
  - Custom design tailored to your brand
  - Mobile-first, fully responsive
  - Built for speed — under 2 second load times
  - On-page SEO included as standard
  - Handover with full training
metaTitle: Web Development South Wales | NC Digital
metaDescription: Professional web development for South Wales businesses. Custom-built websites that load fast, rank well, and convert visitors into customers.
---

## What's included

Every website we build includes everything your business needs to succeed online from day one.

We don't use page builders or templates — every site is custom-designed to match your brand and built to perform.

## Our process

1. **Discovery** — We learn about your business, goals, and customers
2. **Design** — Wireframes and visual designs for your approval
3. **Build** — Development with regular check-ins
4. **Launch** — Testing, deployment, and handover training
5. **Support** — Ongoing support and maintenance available
```

Create `src/content/services/local-seo-google-ranking/index.mdoc`:

```
---
title: Local SEO & Google Ranking
headline: Get found by customers in your area
description: Local SEO helps your business appear at the top of Google when people in your area search for what you offer. We handle everything from Google Business Profile to on-page SEO.
features:
  - Google Business Profile setup and optimisation
  - On-page SEO for all key pages
  - Local keyword research and targeting
  - Monthly ranking reports
  - Citation building across directories
metaTitle: Local SEO South Wales | NC Digital
metaDescription: Local SEO services for South Wales businesses. Get found on Google by customers in your area with our proven local search optimisation service.
---

## Why local SEO matters

When someone in Cardiff searches "web designer near me" or "plumber Merthyr Tydfil", Google shows local businesses first. Local SEO puts your business in those results.

## What we do

We optimise your entire online presence for local search — from your website to your Google Business Profile to your presence in local directories.
```

Create `src/content/services/website-maintenance-packages/index.mdoc`:

```
---
title: Website Maintenance Packages
headline: Keep your website fast, secure, and up to date
description: Our maintenance packages ensure your website is always running at its best. We handle updates, backups, security monitoring, and content changes so you don't have to.
features:
  - Monthly WordPress/CMS updates
  - Daily automated backups
  - Security monitoring and malware scanning
  - Uptime monitoring with instant alerts
  - Content updates included
metaTitle: Website Maintenance Packages South Wales | NC Digital
metaDescription: Website maintenance packages for South Wales businesses. Keep your site fast, secure, and up to date with our affordable monthly plans.
---

## Why website maintenance matters

An unmaintained website is a security risk. Outdated plugins and themes are the most common cause of hacked websites.

Our maintenance packages keep your site protected, performing, and always up to date.
```

Create `src/content/services/website-hosting-security/index.mdoc`:

```
---
title: Website Hosting & Security
headline: Fast, secure hosting managed for you
description: We provide managed website hosting on fast, reliable servers with full security included. Your website will load quickly, stay online, and be protected from threats.
features:
  - UK-based managed hosting
  - SSL certificate included
  - Cloudflare CDN for fast loading
  - Daily backups
  - 99.9% uptime guarantee
metaTitle: Website Hosting & Security South Wales | NC Digital
metaDescription: Managed website hosting and security for South Wales businesses. Fast, reliable hosting with SSL, CDN, and daily backups included.
---

## Managed hosting, zero headaches

We take care of everything — server setup, security, backups, and performance. You just focus on your business.
```

Create `src/content/services/professional-mailboxes-email-setup/index.mdoc`:

```
---
title: Professional Mailboxes & Email Setup
headline: Look professional with a branded email address
description: Stop using Gmail or Hotmail for your business. We set up professional email addresses using your domain name, configured to work on all your devices.
features:
  - Custom domain email (you@yourbusiness.co.uk)
  - Setup on all your devices
  - Microsoft 365 or Google Workspace
  - Spam filtering included
  - Migration from existing email
metaTitle: Business Email Setup South Wales | NC Digital
metaDescription: Professional business email setup for South Wales companies. Get a branded email address that builds trust with customers.
---

## Why professional email matters

Customers trust businesses with professional email addresses. A branded email address makes your business look established and credible.
```

- [ ] **Step 4: Create `src/pages/services/index.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../../keystatic.config';

const reader = createReader(process.cwd(), config);
const services = await reader.collections.services.all();
---

<BaseLayout
  title="Our Services | NC Digital"
  description="Web design, local SEO, website maintenance, hosting, and professional email for South Wales businesses."
>

  <section style="padding:4rem 0 2rem;">
    <div class="container site-pad">
      <p class="eyebrow" style="margin-bottom:0.75rem;">What we offer</p>
      <h1 style="margin-bottom:1rem; max-width:600px;">Services built for South Wales businesses</h1>
      <p style="color:var(--text-muted); font-size:1.125rem; max-width:560px; line-height:1.7;">
        Everything your business needs to get online, get found, and grow — from a single agency in Merthyr Tydfil.
      </p>
    </div>
  </section>

  <section style="padding:3rem 0 5rem;">
    <div class="container site-pad">
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px,1fr)); gap:1.5rem;">
        {services.map(({ slug, entry }) => (
          <a href={`/services/${slug}`} class="card" style="display:block; text-decoration:none;">
            <h2 style="font-size:1.25rem; font-weight:700; color:var(--white); margin-bottom:0.75rem;">{entry.title}</h2>
            <p style="color:var(--text-muted); font-size:0.9375rem; line-height:1.6; margin-bottom:1.25rem;">{entry.description}</p>
            <ul style="list-style:none; padding:0; margin:0 0 1.5rem; display:flex; flex-direction:column; gap:0.375rem;">
              {entry.features.slice(0, 3).map((f: string) => (
                <li style="font-size:0.875rem; color:var(--text-muted); display:flex; gap:0.5rem;">
                  <span style="color:var(--purple);">✓</span> {f}
                </li>
              ))}
            </ul>
            <span style="color:var(--purple); font-size:0.9375rem; font-weight:600;">Learn more →</span>
          </a>
        ))}
      </div>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 5: Create `src/pages/services/[slug].astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../../keystatic.config';

export async function getStaticPaths() {
  const reader = createReader(process.cwd(), config);
  const services = await reader.collections.services.all();
  return services.map(({ slug }) => ({ params: { slug } }));
}

const { slug } = Astro.params;
const reader = createReader(process.cwd(), config);
const service = await reader.collections.services.read(slug!);

if (!service) {
  return Astro.redirect('/services');
}

const { Content } = await service.content();
---

<BaseLayout
  title={service.metaTitle || `${service.title} | NC Digital`}
  description={service.metaDescription || service.description}
>

  <section style="padding:4rem 0 3rem; position:relative; overflow:hidden;">
    <div style="position:absolute; top:0; right:0; width:400px; height:400px; background:radial-gradient(circle, #8750f720 0%, transparent 70%); pointer-events:none;"></div>
    <div class="container site-pad">
      <a href="/services" style="color:var(--text-muted); font-size:0.875rem; display:inline-flex; align-items:center; gap:0.375rem; margin-bottom:2rem;">
        ← All services
      </a>
      <p class="eyebrow" style="margin-bottom:0.75rem;">Our services</p>
      <h1 style="margin-bottom:1rem; max-width:640px;">{service.headline}</h1>
      <p style="color:var(--text-muted); font-size:1.125rem; max-width:560px; line-height:1.7; margin-bottom:2rem;">
        {service.description}
      </p>
      <a href="/contact" class="btn-primary">Get a quote →</a>
    </div>
  </section>

  <section style="padding:3rem 0;">
    <div class="container site-pad" style="display:grid; grid-template-columns:2fr 1fr; gap:4rem; align-items:start;">

      <div style="color:var(--text); line-height:1.8; font-size:1rem;">
        <Content />
      </div>

      <aside>
        <div class="card">
          <h3 style="font-size:1rem; font-weight:700; color:var(--white); margin-bottom:1rem;">What's included</h3>
          <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.625rem;">
            {service.features.map((f: string) => (
              <li style="font-size:0.9375rem; color:var(--text-muted); display:flex; gap:0.625rem; align-items:flex-start;">
                <span style="color:var(--purple); flex-shrink:0; margin-top:2px;">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <div style="margin-top:1.5rem; padding-top:1.5rem; border-top:1px solid var(--border);">
            <a href="/free-website-plan" class="btn-primary" style="width:100%; justify-content:center;">Get started →</a>
          </div>
        </div>
      </aside>

    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 6: Run tests — all 4 must pass**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/services.spec.ts 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site"
git add src/content/services/ src/pages/services/ tests/services.spec.ts
git commit -m "feat: add services pages with seed content"
```

---

## Task 2: Portfolio Pages + Seed Content

**Files:**
- Create: `src/content/portfolio/ds-carpentry/index.mdoc`
- Create: `src/content/portfolio/mj-roofing/index.mdoc`
- Create: `src/content/portfolio/ak-promotions/index.mdoc`
- Create: `src/content/portfolio/ir-energy/index.mdoc`
- Create: `src/content/portfolio/creative-redevelopments/index.mdoc`
- Create: `src/pages/portfolio/index.astro`
- Create: `src/pages/portfolio/[slug].astro`
- Create: `tests/portfolio.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/portfolio.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('portfolio listing page loads', async ({ page }) => {
  await page.goto('/portfolio');
  await expect(page.locator('h1')).toBeVisible();
});

test('portfolio listing shows case studies', async ({ page }) => {
  await page.goto('/portfolio');
  await expect(page.locator('a[href="/portfolio/ds-carpentry"]')).toBeVisible();
});

test('individual portfolio page loads', async ({ page }) => {
  await page.goto('/portfolio/ds-carpentry');
  await expect(page.locator('h1')).toBeVisible();
});
```

- [ ] **Step 2: Run — all 3 must FAIL**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/portfolio.spec.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create portfolio content files**

Create `src/content/portfolio/ds-carpentry/index.mdoc`:

```
---
title: DS Carpentry
client: DS Carpentry
services:
  - web-design
  - web-development
  - seo
summary: A professional website for a local carpentry business in South Wales, showcasing their work and generating leads from local searches.
metaTitle: DS Carpentry Website | NC Digital Portfolio
metaDescription: Web design case study for DS Carpentry — a professional site built to generate leads from local Google searches in South Wales.
---

## The brief

DS Carpentry needed a professional online presence to compete with larger companies and capture leads from local Google searches.

## What we built

A clean, mobile-first website with a portfolio gallery, service pages, and a contact form. The site ranks for key local search terms in South Wales.

## Results

- First page of Google for key carpentry searches in the local area
- Consistent flow of enquiries through the contact form
- Professional credibility matching their quality of work
```

Create `src/content/portfolio/mj-roofing/index.mdoc`:

```
---
title: MJ Roofing
client: MJ Roofing
services:
  - web-design
  - web-development
summary: A lead-generating website for a South Wales roofing contractor, built to rank locally and convert visitors into enquiries.
metaTitle: MJ Roofing Website | NC Digital Portfolio
metaDescription: Web design case study for MJ Roofing — a fast, mobile-first website that ranks locally and generates consistent leads.
---

## The brief

MJ Roofing were relying entirely on word of mouth. They needed a website that would bring in new customers from Google.

## What we built

A fast, professional website with clear service pages, a gallery, and a prominent call to action. Built with local SEO from the ground up.

## Results

- Ranking for roofing searches across South Wales
- Professional platform that builds trust with potential customers
- Regular stream of enquiries from Google
```

Create `src/content/portfolio/ak-promotions/index.mdoc`:

```
---
title: AK Promotions
client: AK Promotions
services:
  - web-design
  - web-development
summary: A vibrant website for a South Wales promotions and events company, showcasing their portfolio and making it easy for clients to get in touch.
metaTitle: AK Promotions Website | NC Digital Portfolio
metaDescription: Web design case study for AK Promotions — a bold, modern website for a South Wales events and promotions business.
---

## The brief

AK Promotions needed a website that matched their energy and helped potential clients understand the range of services they offer.

## What we built

A bold, modern website with a showcase of past events, service listings, and a clear contact journey.
```

Create `src/content/portfolio/ir-energy/index.mdoc`:

```
---
title: IR Energy
client: IR Energy
services:
  - web-design
  - web-development
  - seo
summary: A professional website for an energy services company in South Wales, with clear service pages and local SEO targeting.
metaTitle: IR Energy Website | NC Digital Portfolio
metaDescription: Web design case study for IR Energy — a professional services website with strong local SEO performance in South Wales.
---

## The brief

IR Energy needed a credible online presence that communicated their expertise and generated local enquiries.

## What we built

A clean, professional website with service pages, clear calls to action, and local SEO targeting key search terms in their area.
```

Create `src/content/portfolio/creative-redevelopments/index.mdoc`:

```
---
title: Creative Redevelopments
client: Creative Redevelopments
services:
  - web-design
  - web-development
summary: A portfolio website for a South Wales property development and renovation company, showcasing their projects and craftsmanship.
metaTitle: Creative Redevelopments Website | NC Digital Portfolio
metaDescription: Web design case study for Creative Redevelopments — a stunning portfolio website for a South Wales property renovation company.
---

## The brief

Creative Redevelopments needed a website that did justice to the quality of their renovation work and helped attract higher-value clients.

## What we built

A visually-led portfolio website with before/after project galleries and a professional, trust-building design.
```

- [ ] **Step 4: Create `src/pages/portfolio/index.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../../keystatic.config';

const reader = createReader(process.cwd(), config);
const projects = await reader.collections.portfolio.all();
---

<BaseLayout
  title="Our Work | NC Digital"
  description="Web design and SEO case studies from NC Digital. See how we've helped South Wales businesses grow online."
>

  <section style="padding:4rem 0 2rem;">
    <div class="container site-pad">
      <p class="eyebrow" style="margin-bottom:0.75rem;">Case studies</p>
      <h1 style="margin-bottom:1rem;">Our recent work</h1>
      <p style="color:var(--text-muted); font-size:1.125rem; max-width:520px; line-height:1.7;">
        Real websites. Real results. Here's a selection of projects we've built for South Wales businesses.
      </p>
    </div>
  </section>

  <section style="padding:2rem 0 5rem;">
    <div class="container site-pad">
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px,1fr)); gap:1.5rem;">
        {projects.map(({ slug, entry }) => (
          <a href={`/portfolio/${slug}`} class="card" style="display:block; text-decoration:none;">
            <div style="background:var(--bg-3); border-radius:6px; height:200px; margin-bottom:1.25rem; display:flex; align-items:center; justify-content:center;">
              <span style="color:var(--text-muted); font-size:0.875rem;">{entry.client}</span>
            </div>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.75rem;">
              {entry.services.map((s: string) => (
                <span style="font-size:0.75rem; font-weight:600; color:var(--purple); background:var(--bg-3); padding:0.25rem 0.625rem; border-radius:4px; text-transform:uppercase; letter-spacing:0.05em;">
                  {s.replace('-', ' ')}
                </span>
              ))}
            </div>
            <h2 style="font-size:1.125rem; font-weight:700; color:var(--white); margin-bottom:0.5rem;">{entry.client}</h2>
            <p style="color:var(--text-muted); font-size:0.9375rem; line-height:1.6; margin:0;">{entry.summary}</p>
          </a>
        ))}
      </div>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 5: Create `src/pages/portfolio/[slug].astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../../keystatic.config';

export async function getStaticPaths() {
  const reader = createReader(process.cwd(), config);
  const projects = await reader.collections.portfolio.all();
  return projects.map(({ slug }) => ({ params: { slug } }));
}

const { slug } = Astro.params;
const reader = createReader(process.cwd(), config);
const project = await reader.collections.portfolio.read(slug!);

if (!project) {
  return Astro.redirect('/portfolio');
}

const { Content } = await project.content();
---

<BaseLayout
  title={project.metaTitle || `${project.client} | NC Digital`}
  description={project.metaDescription || project.summary}
>

  <section style="padding:4rem 0 3rem;">
    <div class="container site-pad">
      <a href="/portfolio" style="color:var(--text-muted); font-size:0.875rem; display:inline-flex; gap:0.375rem; margin-bottom:2rem;">
        ← All work
      </a>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;">
        {project.services.map((s: string) => (
          <span style="font-size:0.75rem; font-weight:600; color:var(--purple); background:var(--bg-2); border:1px solid var(--border); padding:0.25rem 0.75rem; border-radius:4px; text-transform:uppercase; letter-spacing:0.05em;">
            {s.replace('-', ' ')}
          </span>
        ))}
      </div>
      <h1 style="margin-bottom:1rem;">{project.client}</h1>
      <p style="color:var(--text-muted); font-size:1.125rem; max-width:600px; line-height:1.7;">{project.summary}</p>
    </div>
  </section>

  <section style="padding:2rem 0 5rem;">
    <div class="container site-pad">
      <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:12px; height:400px; margin-bottom:3rem; display:flex; align-items:center; justify-content:center;">
        <p style="color:var(--text-muted);">Add project image to src/assets/portfolio/{slug}.jpg</p>
      </div>

      <div style="max-width:720px; color:var(--text); line-height:1.8; font-size:1rem;">
        <Content />
      </div>
    </div>
  </section>

  <section style="padding:4rem 0; background:var(--bg-2); border-top:1px solid var(--border);">
    <div class="container site-pad" style="text-align:center;">
      <h2 style="margin-bottom:1rem;">Want results like this?</h2>
      <p style="color:var(--text-muted); margin-bottom:2rem;">Get a free website plan — no commitment, no sales pressure.</p>
      <a href="/free-website-plan" class="btn-primary">Get your free plan →</a>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 6: Run tests — all 3 must pass**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/portfolio.spec.ts 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site"
git add src/content/portfolio/ src/pages/portfolio/ tests/portfolio.spec.ts
git commit -m "feat: add portfolio pages with 5 case studies"
```

---

## Task 3: Blog Pages (Listing + Individual Post)

**Files:**
- Create: `src/pages/blog/[...page].astro`
- Create: `src/pages/blog/[slug].astro`
- Create: `tests/blog.spec.ts`
- Create: `src/content/blog/why-your-business-needs-a-website/index.mdoc` (one seed post for testing)

- [ ] **Step 1: Write failing tests**

Create `tests/blog.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('blog listing loads at /blog', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.locator('h1')).toBeVisible();
});

test('blog listing shows at least one post', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.locator('a[href^="/blog/"]').first()).toBeVisible();
});

test('individual blog post loads', async ({ page }) => {
  await page.goto('/blog/why-your-business-needs-a-website');
  await expect(page.locator('h1')).toBeVisible();
});

test('blog post has meta description', async ({ page }) => {
  await page.goto('/blog/why-your-business-needs-a-website');
  const desc = await page.locator('meta[name="description"]').getAttribute('content');
  expect(desc).toBeTruthy();
});
```

- [ ] **Step 2: Run — all 4 must FAIL**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/blog.spec.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create seed blog post**

Create `src/content/blog/why-your-business-needs-a-website/index.mdoc`:

```
---
title: Why Your Business Needs a Website in 2025
pubDate: 2025-01-15
description: If your business doesn't have a website, you're invisible to the majority of your potential customers. Here's why having a professional website matters more than ever.
category: web-design
metaTitle: Why Your Business Needs a Website in 2025 | NC Digital
metaDescription: No website means no online presence. Discover why every South Wales business needs a professional website in 2025 and how to get started.
---

## The world searches online first

Before most people buy anything or hire anyone, they Google it. If your business doesn't appear in those results, a competitor's does.

A website isn't just a digital brochure — it's your most powerful sales tool, working for you 24 hours a day.

## What a website does for your business

A professional website builds credibility, generates leads, and helps you compete with larger businesses in your area.

Without one, you're relying entirely on word of mouth — which limits how fast you can grow.

## Getting started

You don't need a huge budget to get online. A well-built, five-page website can transform how potential customers find and perceive your business.

[Get a free website plan](/free-website-plan) to see exactly what we'd build for your business.
```

- [ ] **Step 4: Create `src/pages/blog/[...page].astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../../keystatic.config';

export async function getStaticPaths({ paginate }: { paginate: Function }) {
  const reader = createReader(process.cwd(), config);
  const allPosts = (await reader.collections.blog.all())
    .filter(post => post.entry.pubDate)
    .sort((a, b) =>
      new Date(b.entry.pubDate!).getTime() - new Date(a.entry.pubDate!).getTime()
    );
  return paginate(allPosts, { pageSize: 12 });
}

const { page } = Astro.props as {
  page: {
    data: Array<{ slug: string; entry: { title: string; description: string; pubDate: string; category: string } }>;
    url: { prev?: string; next?: string };
    currentPage: number;
    lastPage: number;
  }
};

const isFirstPage = page.currentPage === 1;
const pageTitle = isFirstPage ? 'Blog | NC Digital' : `Blog — Page ${page.currentPage} | NC Digital`;
const pageDesc = 'Web design and SEO tips, guides, and news for South Wales small businesses.';
---

<BaseLayout title={pageTitle} description={pageDesc}>

  <section style="padding:4rem 0 2rem;">
    <div class="container site-pad">
      <p class="eyebrow" style="margin-bottom:0.75rem;">Insights</p>
      <h1 style="margin-bottom:1rem;">Web design & SEO tips for South Wales businesses</h1>
      <p style="color:var(--text-muted); font-size:1.125rem; max-width:560px; line-height:1.7;">
        Practical advice on websites, SEO, and growing your business online.
      </p>
    </div>
  </section>

  <section style="padding:2rem 0 4rem;">
    <div class="container site-pad">
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px,1fr)); gap:1.5rem; margin-bottom:3rem;">
        {page.data.map(({ slug, entry }) => (
          <a href={`/blog/${slug}`} class="card" style="display:block; text-decoration:none;">
            <div style="background:var(--bg-3); border-radius:6px; height:180px; margin-bottom:1.25rem;"></div>
            <p style="font-size:0.75rem; color:var(--purple); font-weight:600; margin-bottom:0.5rem; text-transform:uppercase; letter-spacing:0.1em;">
              {entry.category?.replace('-', ' ')}
            </p>
            <h2 style="font-size:1rem; font-weight:600; color:var(--white); margin-bottom:0.625rem; line-height:1.4;">{entry.title}</h2>
            <p style="color:var(--text-muted); font-size:0.9375rem; line-height:1.6; margin:0;">{entry.description}</p>
          </a>
        ))}
      </div>

      {(page.url.prev || page.url.next) && (
        <div style="display:flex; justify-content:center; gap:1rem;">
          {page.url.prev && (
            <a href={page.url.prev} class="btn-outline">← Newer posts</a>
          )}
          {page.url.next && (
            <a href={page.url.next} class="btn-outline">Older posts →</a>
          )}
        </div>
      )}
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 5: Create `src/pages/blog/[slug].astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../../keystatic.config';

export async function getStaticPaths() {
  const reader = createReader(process.cwd(), config);
  const posts = await reader.collections.blog.all();
  return posts.map(({ slug }) => ({ params: { slug } }));
}

const { slug } = Astro.params;
const reader = createReader(process.cwd(), config);
const post = await reader.collections.blog.read(slug!);

if (!post) {
  return Astro.redirect('/blog');
}

const { Content } = await post.content();

const formattedDate = post.pubDate
  ? new Date(post.pubDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  : '';
---

<BaseLayout
  title={post.metaTitle || `${post.title} | NC Digital`}
  description={post.metaDescription || post.description}
>

  <article>

    <section style="padding:4rem 0 3rem;">
      <div class="container site-pad" style="max-width:800px;">
        <a href="/blog" style="color:var(--text-muted); font-size:0.875rem; display:inline-flex; gap:0.375rem; margin-bottom:2rem;">
          ← All posts
        </a>
        <p style="font-size:0.75rem; color:var(--purple); font-weight:600; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:0.75rem;">
          {post.category?.replace('-', ' ')}
        </p>
        <h1 style="margin-bottom:1rem; line-height:1.2;">{post.title}</h1>
        {formattedDate && (
          <p style="color:var(--text-muted); font-size:0.9375rem;">{formattedDate}</p>
        )}
      </div>
    </section>

    <section style="padding:0 0 5rem;">
      <div class="container site-pad" style="max-width:800px;">
        <div style="background:var(--bg-2); border-radius:10px; height:400px; margin-bottom:3rem;"></div>

        <div style="color:var(--text); line-height:1.85; font-size:1.0625rem;">
          <Content />
        </div>
      </div>
    </section>

  </article>

  <section style="padding:4rem 0; background:var(--bg-2); border-top:1px solid var(--border);">
    <div class="container site-pad" style="text-align:center;">
      <h2 style="margin-bottom:1rem;">Ready to grow your business online?</h2>
      <p style="color:var(--text-muted); margin-bottom:2rem;">Get a free website plan with no commitment.</p>
      <a href="/free-website-plan" class="btn-primary">Get your free plan →</a>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 6: Run tests — all 4 must pass**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/blog.spec.ts 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site"
git add src/pages/blog/ src/content/blog/ tests/blog.spec.ts
git commit -m "feat: add blog listing (paginated) and individual post pages"
```

---

## Task 4: Location Pages

**Files:**
- Create: `src/pages/[location].astro`
- Create: `src/content/locations/web-design-cardiff/index.mdoc` (seed — one entry for testing)
- Create: `tests/locations.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/locations.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('location page loads', async ({ page }) => {
  await page.goto('/web-design-cardiff');
  await expect(page.locator('h1')).toBeVisible();
});

test('location page has meta description', async ({ page }) => {
  await page.goto('/web-design-cardiff');
  const desc = await page.locator('meta[name="description"]').getAttribute('content');
  expect(desc).toBeTruthy();
});

test('location page has CTA', async ({ page }) => {
  await page.goto('/web-design-cardiff');
  await expect(page.locator('a[href="/free-website-plan"]')).toBeVisible();
});
```

- [ ] **Step 2: Run — all 3 must FAIL**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/locations.spec.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create seed location entry**

Create `src/content/locations/web-design-cardiff/index.mdoc`:

```
---
title: Web Design Cardiff
town: Cardiff
county: Cardiff
serviceType: web-design
headline: Professional web design in Cardiff
metaTitle: Web Design Cardiff | NC Digital
metaDescription: Professional web design for Cardiff businesses. Custom-built, fast-loading websites that rank on Google and convert visitors into customers.
---

## Web design for Cardiff businesses

NC Digital provides professional web design services to businesses across Cardiff and the Vale of Glamorgan.

We build fast, mobile-first websites that are designed to rank on Google and turn visitors into enquiries.

## Why choose NC Digital for your Cardiff website?

We're a South Wales-based agency, so we understand the local market. Every website we build is custom-designed for your business — no templates, no shortcuts.

## What's included

Every Cardiff web design project includes:

- Custom design tailored to your brand
- Mobile-first, fully responsive layout
- On-page SEO as standard
- Fast loading speeds
- Google Analytics setup
- Training on how to use your site

[Get a free website plan](/free-website-plan) to see what we'd build for your Cardiff business.
```

- [ ] **Step 4: Create `src/pages/[location].astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../keystatic.config';

export async function getStaticPaths() {
  const reader = createReader(process.cwd(), config);
  const locations = await reader.collections.locations.all();
  return locations.map(({ slug }) => ({ params: { location: slug } }));
}

const { location } = Astro.params;
const reader = createReader(process.cwd(), config);
const page = await reader.collections.locations.read(location!);

if (!page) {
  return Astro.redirect('/');
}

const { Content } = await page.content();

const serviceLabel = page.serviceType === 'seo'
  ? 'Local SEO'
  : page.serviceType === 'both'
  ? 'Web Design & SEO'
  : 'Web Design';
---

<BaseLayout
  title={page.metaTitle || `${serviceLabel} ${page.town} | NC Digital`}
  description={page.metaDescription || `Professional ${serviceLabel.toLowerCase()} for ${page.town} businesses. NC Digital — based in South Wales.`}
>

  <section style="padding:4rem 0 3rem; position:relative; overflow:hidden;">
    <div style="position:absolute; top:0; right:0; width:400px; height:400px; background:radial-gradient(circle, #8750f720 0%, transparent 70%); pointer-events:none;"></div>
    <div class="container site-pad">
      <p class="eyebrow" style="margin-bottom:0.75rem;">{serviceLabel} · {page.town}</p>
      <h1 style="margin-bottom:1rem; max-width:640px;">{page.headline}</h1>
      <p style="color:var(--text-muted); font-size:1.125rem; max-width:560px; line-height:1.7; margin-bottom:2rem;">
        {page.metaDescription}
      </p>
      <div style="display:flex; gap:1rem; flex-wrap:wrap;">
        <a href="/free-website-plan" class="btn-primary">Get your free plan →</a>
        <a href="/portfolio" class="btn-outline">See our work</a>
      </div>
    </div>
  </section>

  <section style="padding:2rem 0 5rem;">
    <div class="container site-pad" style="display:grid; grid-template-columns:2fr 1fr; gap:4rem; align-items:start;">

      <div style="color:var(--text); line-height:1.85; font-size:1rem;">
        <Content />
      </div>

      <aside>
        <div class="card">
          <h3 style="font-size:1rem; font-weight:700; color:var(--white); margin-bottom:0.75rem;">
            Get a free plan
          </h3>
          <p style="color:var(--text-muted); font-size:0.9375rem; line-height:1.6; margin-bottom:1.25rem;">
            See exactly what we'd build for your {page.town} business — free, no obligation.
          </p>
          <a href="/free-website-plan" class="btn-primary" style="width:100%; justify-content:center; display:flex;">
            Get started →
          </a>
          <div style="margin-top:1rem; padding-top:1rem; border-top:1px solid var(--border);">
            <a href="mailto:nathan@nc-digital.co.uk" style="color:var(--text-muted); font-size:0.875rem; display:block; margin-bottom:0.375rem;">
              nathan@nc-digital.co.uk
            </a>
          </div>
        </div>
      </aside>

    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 5: Run tests — all 3 must pass**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/locations.spec.ts 2>&1 | tail -10
```

- [ ] **Step 6: Run all tests to check for regressions**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test 2>&1 | tail -10
```

Expected: All tests pass (17 existing + new).

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site"
git add src/pages/\[location\].astro src/content/locations/ tests/locations.spec.ts
git commit -m "feat: add location pages (dynamic, root-level routing)"
```

---

## Task 5: Static Pages (About, Contact, Free Plan, Privacy)

**Files:**
- Create: `src/pages/about.astro`
- Create: `src/pages/contact.astro`
- Create: `src/pages/free-website-plan.astro`
- Create: `src/pages/privacy-policy.astro`
- Create: `tests/static-pages.spec.ts`

**Note on contact form:** Uses Web3Forms (free static-site form service). Nathan needs to sign up at web3forms.com and get an access key. Placeholder key used in the code — replace `YOUR_WEB3FORMS_ACCESS_KEY` with the real key.

- [ ] **Step 1: Write failing tests**

Create `tests/static-pages.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('about page loads', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('h1')).toBeVisible();
});

test('contact page loads', async ({ page }) => {
  await page.goto('/contact');
  await expect(page.locator('h1')).toBeVisible();
});

test('contact page has form', async ({ page }) => {
  await page.goto('/contact');
  await expect(page.locator('form')).toBeVisible();
});

test('free website plan page loads', async ({ page }) => {
  await page.goto('/free-website-plan');
  await expect(page.locator('h1')).toBeVisible();
});

test('privacy policy page loads', async ({ page }) => {
  await page.goto('/privacy-policy');
  await expect(page.locator('h1')).toBeVisible();
});
```

- [ ] **Step 2: Run — all 5 must FAIL**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/static-pages.spec.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create `src/pages/about.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../keystatic.config';

const reader = createReader(process.cwd(), config);
const settings = await reader.singletons.siteSettings.read();
---

<BaseLayout
  title="About NC Digital | Web Design & SEO South Wales"
  description="NC Digital is a web design and SEO agency based in Merthyr Tydfil, South Wales. We help local businesses grow online."
>

  <section style="padding:5rem 0 3rem; position:relative; overflow:hidden;">
    <div style="position:absolute; top:0; right:0; width:400px; height:400px; background:radial-gradient(circle, #8750f720 0%, transparent 70%); pointer-events:none;"></div>
    <div class="container site-pad" style="display:grid; grid-template-columns:1fr 1fr; gap:4rem; align-items:center;">

      <div>
        <p class="eyebrow" style="margin-bottom:0.75rem;">About</p>
        <h1 style="margin-bottom:1.25rem;">Hi, I'm Nathan</h1>
        <p style="color:var(--text-muted); font-size:1.125rem; line-height:1.7; margin-bottom:1.5rem;">
          {settings?.aboutText ?? 'NC Digital is a web design and SEO agency based in Merthyr Tydfil, South Wales. I help local businesses get found online with affordable, high-quality websites.'}
        </p>
        <p style="color:var(--text-muted); font-size:1.0625rem; line-height:1.7; margin-bottom:2rem;">
          I started NC Digital because I saw too many South Wales businesses losing customers to competitors with better websites. I wanted to change that — making professional web design and SEO accessible to businesses of all sizes.
        </p>
        <div style="display:flex; gap:1rem;">
          <a href="/free-website-plan" class="btn-primary">Work with me →</a>
          <a href="/portfolio" class="btn-outline">See my work</a>
        </div>
      </div>

      <div style="position:relative; display:flex; justify-content:center;">
        <div style="position:absolute; inset:0; background:radial-gradient(circle at center, #8750f730 0%, transparent 70%); border-radius:50%;"></div>
        <div style="width:380px; height:420px; border-radius:16px; background:var(--bg-2); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; position:relative;">
          <p style="color:var(--text-muted); font-size:0.875rem; text-align:center; padding:2rem;">
            Add photo to<br/><code>src/assets/nathan.jpg</code>
          </p>
        </div>
      </div>

    </div>
  </section>

  <section style="padding:4rem 0 5rem; background:var(--bg-2); border-top:1px solid var(--border);">
    <div class="container site-pad">
      <p class="eyebrow" style="margin-bottom:0.75rem; text-align:center;">Why NC Digital</p>
      <h2 style="text-align:center; margin-bottom:3rem;">What makes us different</h2>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px,1fr)); gap:1.5rem;">
        {[
          { title: 'Local knowledge', desc: 'Based in Merthyr Tydfil, we understand South Wales businesses and their customers.' },
          { title: 'No long contracts', desc: 'Monthly rolling agreements. We keep your business because our work is good, not because you\'re locked in.' },
          { title: 'Real results', desc: 'We measure success by leads and rankings, not just how the website looks.' },
          { title: 'Personal service', desc: 'You\'ll always deal directly with Nathan — no account managers, no handoffs.' },
        ].map(({ title, desc }) => (
          <div class="card">
            <h3 style="font-size:1rem; font-weight:700; color:var(--white); margin-bottom:0.75rem;">{title}</h3>
            <p style="color:var(--text-muted); font-size:0.9375rem; line-height:1.6; margin:0;">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 4: Create `src/pages/contact.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../keystatic.config';

const reader = createReader(process.cwd(), config);
const settings = await reader.singletons.siteSettings.read();
---

<BaseLayout
  title="Contact NC Digital | Web Design & SEO South Wales"
  description="Get in touch with NC Digital. Web design and local SEO for South Wales businesses. Based in Merthyr Tydfil."
>

  <section style="padding:4rem 0 5rem;">
    <div class="container site-pad" style="display:grid; grid-template-columns:1fr 1fr; gap:4rem; align-items:start;">

      <div>
        <p class="eyebrow" style="margin-bottom:0.75rem;">Get in touch</p>
        <h1 style="margin-bottom:1rem;">Let's talk about your project</h1>
        <p style="color:var(--text-muted); font-size:1.125rem; line-height:1.7; margin-bottom:2rem;">
          Whether you need a new website, want to improve your Google rankings, or just have a question — I'd love to hear from you.
        </p>

        <div style="display:flex; flex-direction:column; gap:1.25rem;">
          {settings?.email && (
            <div style="display:flex; gap:1rem; align-items:center;">
              <div style="width:40px; height:40px; background:var(--bg-2); border:1px solid var(--border); border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--purple); font-size:1.25rem; flex-shrink:0;">✉</div>
              <div>
                <p style="color:var(--text-muted); font-size:0.8125rem; margin-bottom:0.125rem;">Email</p>
                <a href={`mailto:${settings.email}`} style="color:var(--white); font-weight:500;">{settings.email}</a>
              </div>
            </div>
          )}
          {settings?.phone && settings.phone !== '07XXX XXXXXX' && (
            <div style="display:flex; gap:1rem; align-items:center;">
              <div style="width:40px; height:40px; background:var(--bg-2); border:1px solid var(--border); border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--purple); font-size:1.25rem; flex-shrink:0;">☏</div>
              <div>
                <p style="color:var(--text-muted); font-size:0.8125rem; margin-bottom:0.125rem;">Phone</p>
                <a href={`tel:${settings.phone}`} style="color:var(--white); font-weight:500;">{settings.phone}</a>
              </div>
            </div>
          )}
          <div style="display:flex; gap:1rem; align-items:center;">
            <div style="width:40px; height:40px; background:var(--bg-2); border:1px solid var(--border); border-radius:8px; display:flex; align-items:center; justify-content:center; color:var(--purple); font-size:1.25rem; flex-shrink:0;">⌖</div>
            <div>
              <p style="color:var(--text-muted); font-size:0.8125rem; margin-bottom:0.125rem;">Based in</p>
              <p style="color:var(--white); font-weight:500; margin:0;">Merthyr Tydfil, South Wales</p>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="padding:2rem;">
        <h2 style="font-size:1.25rem; margin-bottom:1.5rem;">Send a message</h2>

        <form action="https://api.web3forms.com/submit" method="POST" style="display:flex; flex-direction:column; gap:1.25rem;">
          <input type="hidden" name="access_key" value="YOUR_WEB3FORMS_ACCESS_KEY" />
          <input type="hidden" name="subject" value="New enquiry from NC Digital website" />
          <input type="hidden" name="redirect" value="https://nc-digital.co.uk/contact?success=true" />

          <div>
            <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">Your name</label>
            <input type="text" name="name" required
              style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none;"
              placeholder="John Smith" />
          </div>

          <div>
            <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">Email address</label>
            <input type="email" name="email" required
              style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none;"
              placeholder="john@yourbusiness.co.uk" />
          </div>

          <div>
            <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">What do you need help with?</label>
            <select name="service"
              style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none;">
              <option value="new-website">New website</option>
              <option value="seo">Local SEO</option>
              <option value="maintenance">Website maintenance</option>
              <option value="other">Something else</option>
            </select>
          </div>

          <div>
            <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">Message</label>
            <textarea name="message" required rows="4"
              style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none; resize:vertical;"
              placeholder="Tell me about your business and what you're looking for..."></textarea>
          </div>

          <button type="submit" class="btn-primary" style="justify-content:center;">
            Send message →
          </button>
        </form>
      </div>

    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 5: Create `src/pages/free-website-plan.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout
  title="Free Website Plan | NC Digital"
  description="Get a free, no-obligation website plan for your South Wales business. See exactly what we'd build and what it would cost."
>

  <section style="padding:5rem 0 3rem; position:relative; overflow:hidden;">
    <div style="position:absolute; top:-100px; right:0; width:500px; height:500px; background:radial-gradient(circle, #8750f720 0%, transparent 70%); pointer-events:none;"></div>
    <div class="container site-pad" style="max-width:760px;">
      <p class="eyebrow" style="margin-bottom:0.75rem;">No obligation · No cost</p>
      <h1 style="margin-bottom:1.25rem;">Get your free website plan</h1>
      <p style="color:var(--text-muted); font-size:1.125rem; line-height:1.7; margin-bottom:1.5rem;">
        Tell me about your business and I'll put together a personalised website plan — including what pages I'd build, what it would look like, and exactly what it would cost. No strings attached.
      </p>
      <div style="display:flex; gap:1.5rem; margin-bottom:3rem;">
        {['Free — no obligation', 'Delivered within 48 hours', 'Includes full cost breakdown'].map(item => (
          <div style="display:flex; align-items:center; gap:0.5rem; color:var(--text-muted); font-size:0.9375rem;">
            <span style="color:var(--purple);">✓</span> {item}
          </div>
        ))}
      </div>
    </div>
  </section>

  <section style="padding:0 0 5rem;">
    <div class="container site-pad" style="max-width:760px;">
      <div class="card" style="padding:2.5rem;">
        <h2 style="font-size:1.25rem; margin-bottom:1.5rem;">Tell me about your business</h2>

        <form action="https://api.web3forms.com/submit" method="POST" style="display:flex; flex-direction:column; gap:1.25rem;">
          <input type="hidden" name="access_key" value="YOUR_WEB3FORMS_ACCESS_KEY" />
          <input type="hidden" name="subject" value="Free website plan request from NC Digital" />
          <input type="hidden" name="redirect" value="https://nc-digital.co.uk/free-website-plan?success=true" />

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.25rem;">
            <div>
              <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">Your name</label>
              <input type="text" name="name" required
                style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none;"
                placeholder="John Smith" />
            </div>
            <div>
              <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">Email address</label>
              <input type="email" name="email" required
                style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none;"
                placeholder="john@yourbusiness.co.uk" />
            </div>
          </div>

          <div>
            <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">Business name</label>
            <input type="text" name="business"
              style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none;"
              placeholder="Your Business Ltd" />
          </div>

          <div>
            <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">What does your business do?</label>
            <input type="text" name="business_type"
              style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none;"
              placeholder="e.g. Plumber in Cardiff, Hairdresser in Swansea" />
          </div>

          <div>
            <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">Do you currently have a website?</label>
            <select name="has_website"
              style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none;">
              <option value="no">No, I need a new website</option>
              <option value="yes-redesign">Yes, but I want to improve it</option>
              <option value="yes-seo">Yes, I need help getting found on Google</option>
            </select>
          </div>

          <div>
            <label style="display:block; font-size:0.875rem; color:var(--text-muted); margin-bottom:0.375rem;">Anything else you'd like to share?</label>
            <textarea name="message" rows="3"
              style="width:100%; background:var(--bg); border:1px solid var(--border-2); border-radius:6px; padding:0.75rem 1rem; color:var(--white); font-family:'Sora',sans-serif; font-size:0.9375rem; outline:none; resize:vertical;"
              placeholder="Budget, timeline, specific features..."></textarea>
          </div>

          <button type="submit" class="btn-primary" style="justify-content:center; font-size:1rem; padding:1rem 2rem;">
            Get my free plan →
          </button>
        </form>
      </div>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 6: Create `src/pages/privacy-policy.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout
  title="Privacy Policy | NC Digital"
  description="NC Digital privacy policy — how we collect, use, and protect your personal information."
>

  <section style="padding:4rem 0 5rem;">
    <div class="container site-pad" style="max-width:800px;">
      <h1 style="margin-bottom:0.5rem;">Privacy Policy</h1>
      <p style="color:var(--text-muted); margin-bottom:3rem;">Last updated: April 2026</p>

      <div style="color:var(--text); line-height:1.85; font-size:1rem; display:flex; flex-direction:column; gap:2rem;">

        <div>
          <h2 style="font-size:1.25rem; margin-bottom:0.75rem;">Who we are</h2>
          <p>NC Digital is a web design and SEO agency based in Merthyr Tydfil, South Wales. Our website address is nc-digital.co.uk. You can contact us at nathan@nc-digital.co.uk.</p>
        </div>

        <div>
          <h2 style="font-size:1.25rem; margin-bottom:0.75rem;">What data we collect</h2>
          <p>When you fill in a contact form or request a free website plan, we collect your name, email address, and any information you choose to share about your business. We use this information solely to respond to your enquiry.</p>
        </div>

        <div>
          <h2 style="font-size:1.25rem; margin-bottom:0.75rem;">How we use your data</h2>
          <p>Your data is used only to respond to your enquiry or provide the service you've requested. We do not sell, share, or rent your data to any third parties.</p>
        </div>

        <div>
          <h2 style="font-size:1.25rem; margin-bottom:0.75rem;">Cookies</h2>
          <p>This website does not use tracking cookies. We may use essential cookies for the operation of contact forms.</p>
        </div>

        <div>
          <h2 style="font-size:1.25rem; margin-bottom:0.75rem;">Your rights</h2>
          <p>Under GDPR, you have the right to access, correct, or delete any personal data we hold about you. To exercise these rights, contact us at nathan@nc-digital.co.uk.</p>
        </div>

        <div>
          <h2 style="font-size:1.25rem; margin-bottom:0.75rem;">Contact</h2>
          <p>For any privacy-related questions, email nathan@nc-digital.co.uk.</p>
        </div>

      </div>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 7: Run tests — all 5 must pass**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test tests/static-pages.spec.ts 2>&1 | tail -10
```

- [ ] **Step 8: Run full test suite**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test 2>&1 | tail -10
```

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site"
git add src/pages/about.astro src/pages/contact.astro src/pages/free-website-plan.astro src/pages/privacy-policy.astro tests/static-pages.spec.ts
git commit -m "feat: add about, contact, free-website-plan, and privacy policy pages"
```

---

## Task 6: JSON-LD Structured Data

**Files:**
- Create: `src/components/JsonLD.astro`
- Modify: `src/layouts/BaseLayout.astro` (add JsonLD slot)
- Modify: `src/pages/index.astro` (add LocalBusiness JSON-LD)
- Modify: `src/pages/[location].astro` (add LocalBusiness JSON-LD)
- Modify: `src/pages/blog/[slug].astro` (add BlogPosting JSON-LD)

- [ ] **Step 1: Create `src/components/JsonLD.astro`**

```astro
---
export interface Props {
  schema: Record<string, unknown>;
}
const { schema } = Astro.props;
---
<script type="application/ld+json" set:html={JSON.stringify(schema)} />
```

- [ ] **Step 2: Add LocalBusiness JSON-LD to homepage**

In `src/pages/index.astro`, add this import at the top of the frontmatter:

```astro
import JsonLD from '../components/JsonLD.astro';
```

And add this inside the `<BaseLayout>` block, before the HERO section:

```astro
<JsonLD schema={{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "NC Digital",
  "description": "Web design and local SEO for South Wales small businesses.",
  "url": "https://nc-digital.co.uk",
  "email": "nathan@nc-digital.co.uk",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Merthyr Tydfil",
    "addressRegion": "South Wales",
    "addressCountry": "GB"
  },
  "areaServed": {
    "@type": "State",
    "name": "South Wales"
  },
  "serviceType": ["Web Design", "Local SEO", "Website Maintenance"]
}} />
```

- [ ] **Step 3: Add LocalBusiness JSON-LD to location pages**

In `src/pages/[location].astro`, add this import at the top of the frontmatter:

```astro
import JsonLD from '../components/JsonLD.astro';
```

And add inside `<BaseLayout>`, before the hero section:

```astro
<JsonLD schema={{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "NC Digital",
  "description": `${serviceLabel} for ${page.town} businesses.`,
  "url": `https://nc-digital.co.uk/${location}`,
  "email": "nathan@nc-digital.co.uk",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Merthyr Tydfil",
    "addressRegion": "South Wales",
    "addressCountry": "GB"
  },
  "areaServed": {
    "@type": "City",
    "name": page.town
  }
}} />
```

- [ ] **Step 4: Add BlogPosting JSON-LD to blog post page**

In `src/pages/blog/[slug].astro`, add this import:

```astro
import JsonLD from '../../components/JsonLD.astro';
```

And add inside `<BaseLayout>`, before the `<article>` tag:

```astro
<JsonLD schema={{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": post.title,
  "description": post.description,
  "datePublished": post.pubDate ?? undefined,
  "author": {
    "@type": "Person",
    "name": "Nathan Constance",
    "url": "https://nc-digital.co.uk/about"
  },
  "publisher": {
    "@type": "Organization",
    "name": "NC Digital",
    "url": "https://nc-digital.co.uk"
  },
  "url": Astro.url.href
}} />
```

- [ ] **Step 5: Verify build succeeds**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npm run build 2>&1 | tail -15
```

Expected: Build completes, no errors.

- [ ] **Step 6: Verify JSON-LD renders in HTML**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npm run build && grep -l "application/ld+json" dist/*.html dist/**/*.html 2>/dev/null | head -5
```

Expected: `dist/index.html` listed (has LocalBusiness JSON-LD).

- [ ] **Step 7: Run all tests**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test 2>&1 | tail -10
```

All tests must pass.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site"
git add src/components/JsonLD.astro src/pages/index.astro src/pages/\[location\].astro src/pages/blog/\[slug\].astro
git commit -m "feat: add JSON-LD structured data (LocalBusiness, BlogPosting)"
```

---

## Task 7: WordPress Migration Script

**Files:**
- Create: `scripts/migrate-wordpress.mjs`

This script converts a WordPress XML export (WXR format) into Markdoc files for the Keystatic blog collection.

**How Nathan exports from WordPress:**
1. WordPress Admin → Tools → Export → Posts → Download Export File
2. Save the `.xml` file as `scripts/wordpress-export.xml`
3. Run `node scripts/migrate-wordpress.mjs`
4. Blog posts appear in `src/content/blog/`

- [ ] **Step 1: Create `scripts/migrate-wordpress.mjs`**

```js
#!/usr/bin/env node
/**
 * WordPress XML (WXR) → Keystatic Markdoc migration script
 *
 * Usage:
 *   1. Export posts from WordPress: Admin → Tools → Export → Posts
 *   2. Save the .xml file as scripts/wordpress-export.xml
 *   3. Run: node scripts/migrate-wordpress.mjs
 *
 * Output: src/content/blog/<slug>/index.mdoc for each published post
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const XML_FILE = join(__dirname, 'wordpress-export.xml');
const OUTPUT_DIR = join(ROOT, 'src/content/blog');

if (!existsSync(XML_FILE)) {
  console.error(`\nError: ${XML_FILE} not found.`);
  console.error('Export your WordPress posts and save the .xml file as scripts/wordpress-export.xml\n');
  process.exit(1);
}

const xml = readFileSync(XML_FILE, 'utf-8');

// Extract all <item> blocks
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

console.log(`Found ${items.length} items in WordPress export\n`);

let created = 0;
let skipped = 0;

for (const item of items) {
  // Only process published posts
  const status = item.match(/<wp:status><!\[CDATA\[(.*?)\]\]><\/wp:status>/)?.[1]
    ?? item.match(/<wp:status>(.*?)<\/wp:status>/)?.[1];
  if (status !== 'publish') { skipped++; continue; }

  // Only process posts (not pages)
  const postType = item.match(/<wp:post_type><!\[CDATA\[(.*?)\]\]><\/wp:post_type>/)?.[1]
    ?? item.match(/<wp:post_type>(.*?)<\/wp:post_type>/)?.[1];
  if (postType !== 'post') { skipped++; continue; }

  const title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]
    ?? item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim();

  if (!title) { skipped++; continue; }

  // Get slug from wp:post_name, fallback to slugifying title
  const wpSlug = (item.match(/<wp:post_name><!\[CDATA\[(.*?)\]\]><\/wp:post_name>/)?.[1]
    ?? item.match(/<wp:post_name>(.*?)<\/wp:post_name>/)?.[1] ?? '').trim();

  const slug = wpSlug || title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) { skipped++; continue; }

  // Published date
  const rawDate = item.match(/<wp:post_date><!\[CDATA\[(.*?)\]\]><\/wp:post_date>/)?.[1]
    ?? item.match(/<wp:post_date>(.*?)<\/wp:post_date>/)?.[1] ?? '';
  const pubDate = rawDate ? rawDate.split(' ')[0] : '';

  // Excerpt / description
  const excerpt = (item.match(/<excerpt:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/excerpt:encoded>/)?.[1]
    ?? '').trim().replace(/<[^>]+>/g, '').substring(0, 300);

  // Body content — convert basic HTML to Markdown
  const rawContent = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1] ?? '';
  const content = htmlToMarkdown(rawContent);

  // Determine category from WordPress categories
  const cats = [...item.matchAll(/<category domain="category"[^>]*><!\[CDATA\[(.*?)\]\]><\/category>/g)]
    .map(m => m[1].toLowerCase());

  let category = 'web-design';
  if (cats.some(c => c.includes('seo'))) category = 'seo';
  else if (cats.some(c => c.includes('business'))) category = 'business';
  else if (cats.some(c => c.includes('news'))) category = 'news';

  // Build frontmatter
  const frontmatter = [
    `title: ${JSON.stringify(title)}`,
    pubDate ? `pubDate: ${pubDate}` : null,
    excerpt ? `description: ${JSON.stringify(excerpt)}` : null,
    `category: ${category}`,
    `metaTitle: ${JSON.stringify(title + ' | NC Digital')}`,
    excerpt ? `metaDescription: ${JSON.stringify(excerpt.substring(0, 160))}` : null,
  ].filter(Boolean).join('\n');

  const mdoc = `---\n${frontmatter}\n---\n\n${content}\n`;

  const dir = join(OUTPUT_DIR, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.mdoc'), mdoc, 'utf-8');

  console.log(`✓ ${slug}`);
  created++;
}

console.log(`\nDone! Created ${created} posts, skipped ${items.length - created}.\n`);
console.log(`Posts are in src/content/blog/ — review and edit them before going live.\n`);

/**
 * Convert basic WordPress HTML to Markdown
 */
function htmlToMarkdown(html) {
  if (!html) return '';
  return html
    // Headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n')
    // Bold / italic
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    // Links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    // Lists
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) =>
      inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n').trim() + '\n\n'
    )
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
      let i = 1;
      return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${i++}. $1\n`).trim() + '\n\n';
    })
    // Paragraphs
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&nbsp;/g, ' ')
    // Clean up excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 2: Verify the script is valid JavaScript**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && node --check scripts/migrate-wordpress.mjs && echo "Script syntax OK"
```

Expected: `Script syntax OK`

- [ ] **Step 3: Test the script shows correct error with missing XML**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && node scripts/migrate-wordpress.mjs 2>&1
```

Expected: Error message about missing `scripts/wordpress-export.xml`.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site"
git add scripts/migrate-wordpress.mjs
git commit -m "feat: add WordPress to Markdoc migration script"
```

---

## Task 8: Final Build Verification

- [ ] **Step 1: Run complete test suite**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx playwright test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 2: Run Astro type check**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npx astro check 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 3: Run production build**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site" && npm run build 2>&1 | tail -20
```

Expected: Build completes, lists pages generated (index, services, portfolio, blog, locations, static pages).

- [ ] **Step 4: Count generated pages**

```bash
find "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site/dist" -name "index.html" | wc -l
```

Expected: At least 15 pages (homepage + 5 services + 5 portfolio + 1 blog + 1 blog post + 1 location + static pages).

- [ ] **Step 5: Final commit**

```bash
cd "C:/Users/NathanConstanceRhysW/Desktop/NC Digital New Site"
git add .
git commit -m "chore: Plan 2 complete — all pages, JSON-LD, and migration script"
```

---

## After Plan 2

The site is now fully built with all pages. Next steps for Nathan:

1. **Add your photo:** Copy `nathan.jpg` to `src/assets/nathan.jpg`
2. **Web3Forms key:** Sign up at web3forms.com, replace `YOUR_WEB3FORMS_ACCESS_KEY` in `contact.astro` and `free-website-plan.astro`
3. **Migrate blog posts:** Export from WordPress, run `node scripts/migrate-wordpress.mjs`
4. **Add remaining location pages:** Use Keystatic UI at `/keystatic` to add entries for each location
5. **Deploy to Cloudflare Pages:** Connect your git repo in the Cloudflare dashboard (build command: `npm run build`, output: `dist`)
6. **Update phone number:** Edit `src/content/settings/index.json` via Keystatic to add real phone number
