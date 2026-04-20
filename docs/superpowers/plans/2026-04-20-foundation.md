# NC Digital — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the NC Digital Astro 5 site with full design system, layout components, Keystatic CMS config, and a working homepage — deployed to Cloudflare Pages.

**Architecture:** Astro 5 with `output: 'hybrid'` (all pages prerendered; Keystatic UI routes SSR in dev only). Tailwind CSS v4 for utilities with a `.site-pad` CSS class for horizontal padding. All content in Keystatic collections stored as Markdoc files.

**Tech Stack:** Astro 5, Keystatic, Tailwind CSS v4, @fontsource/sora, @astrojs/markdoc, @astrojs/react, @astrojs/sitemap, @astrojs/cloudflare, Cloudflare Pages

---

## File Map

```
src/
  components/
    BaseHead.astro          # <head> with SEO meta, fonts, canonical
    Nav.astro               # Site navigation
    Footer.astro            # Site footer
  layouts/
    BaseLayout.astro        # Wraps every page: BaseHead + Nav + slot + Footer
  pages/
    index.astro             # Homepage
    keystatic/
      [...params].astro     # Keystatic CMS UI (dev only)
    api/
      keystatic/
        [...params].ts      # Keystatic API routes (dev only)
  styles/
    global.css              # CSS variables, .site-pad, base styles
  content/
    blog/                   # .mdoc files (populated in Plan 2)
    portfolio/              # .mdoc files (populated in Plan 2)
    services/               # .mdoc files (populated in Plan 2)
    locations/              # .mdoc files (populated in Plan 2)
    settings/               # siteSettings singleton JSON
keystatic.config.ts         # All Keystatic collections + singleton
astro.config.mjs            # Astro + integrations config
tailwind.config.mjs         # Tailwind v4 config
public/
  _headers                  # Cloudflare cache headers
  robots.txt
```

---

## Task 1: Scaffold Astro Project

**Files:**
- Create: project root (run in `C:\Users\NathanConstanceRhysW\Desktop\NC Digital New Site`)

- [ ] **Step 1: Initialise Astro**

```bash
npm create astro@latest . -- --template minimal --typescript strict --no-install --no-git
```

Expected: Astro scaffold created with `src/pages/index.astro`, `astro.config.mjs`, `tsconfig.json`.

- [ ] **Step 2: Install core dependencies**

```bash
npm install
npm install @astrojs/react @astrojs/markdoc @astrojs/sitemap @astrojs/cloudflare
npm install @keystatic/core @keystatic/astro
npm install @fontsource/sora
npm install tailwindcss @astrojs/tailwind
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 4: Verify install**

```bash
npm run dev
```

Expected: Dev server running at `http://localhost:4321`. No errors.

- [ ] **Step 5: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold Astro 5 project"
```

---

## Task 2: Configure astro.config.mjs

**Files:**
- Modify: `astro.config.mjs`

- [ ] **Step 1: Replace with full config**

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import markdoc from '@astrojs/markdoc';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';
import keystatic from '@keystatic/astro';

export default defineConfig({
  site: 'https://nc-digital.co.uk',
  output: 'hybrid',
  integrations: [
    react(),
    markdoc(),
    sitemap(),
    tailwind({ applyBaseStyles: false }),
    ...(process.env.NODE_ENV !== 'production' ? [keystatic()] : []),
  ],
  image: {
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
});
```

- [ ] **Step 2: Verify build still works**

```bash
npm run dev
```

Expected: No errors in terminal.

- [ ] **Step 3: Commit**

```bash
git add astro.config.mjs
git commit -m "chore: configure Astro integrations"
```

---

## Task 3: Set Up Global CSS Design System

**Files:**
- Create: `src/styles/global.css`
- Modify: `src/pages/index.astro` (import global.css)

- [ ] **Step 1: Create global.css**

```css
/* src/styles/global.css */
@import '@fontsource/sora/400.css';
@import '@fontsource/sora/500.css';
@import '@fontsource/sora/600.css';
@import '@fontsource/sora/700.css';
@import '@fontsource/sora/800.css';
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg:           #0c1115;
  --bg-2:         #0e1418;
  --bg-3:         #10171c;
  --bg-4:         #151b1f;
  --border:       #1b2227;
  --border-2:     #2a343c;
  --purple:       #8750f7;
  --purple-dark:  #2a1454;
  --purple-light: #9b8dff;
  --text:         #dddddd;
  --text-muted:   #747779;
  --white:        #ffffff;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  background-color: var(--bg);
  color: var(--text);
  font-family: 'Sora', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  color: var(--white);
  font-family: 'Sora', sans-serif;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

h1 { font-size: clamp(2.5rem, 5vw, 3.75rem); font-weight: 800; }
h2 { font-size: clamp(1.75rem, 3.5vw, 2.625rem); font-weight: 700; }
h3 { font-size: clamp(1.25rem, 2.5vw, 1.75rem); font-weight: 600; }

a { color: var(--purple); text-decoration: none; }
a:hover { color: var(--purple-light); }

.site-pad {
  padding-left: clamp(1rem, 5vw, 4rem);
  padding-right: clamp(1rem, 5vw, 4rem);
}

.container {
  max-width: 1280px;
  margin-left: auto;
  margin-right: auto;
}

.eyebrow {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--purple);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--purple);
  color: var(--white);
  font-family: 'Sora', sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}

.btn-primary:hover {
  background: var(--purple-light);
  color: var(--white);
  transform: translateY(-1px);
}

.btn-outline {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  color: var(--white);
  font-family: 'Sora', sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  border: 1px solid var(--border-2);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}

.btn-outline:hover {
  border-color: var(--purple);
  color: var(--purple);
}

.card {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.5rem;
  transition: border-color 0.2s, transform 0.2s;
}

.card:hover {
  border-color: var(--purple);
  transform: translateY(-2px);
}

.divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 0;
}
```

- [ ] **Step 2: Configure tailwind.config.mjs**

```js
// tailwind.config.mjs
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 3: Write a test that verifies CSS variables are defined**

Create `tests/design-system.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('CSS variables are defined on :root', async ({ page }) => {
  await page.goto('/');
  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  );
  expect(bg).toBe('#0c1115');
});

test('body uses Sora font', async ({ page }) => {
  await page.goto('/');
  const font = await page.evaluate(() =>
    getComputedStyle(document.body).fontFamily
  );
  expect(font.toLowerCase()).toContain('sora');
});
```

- [ ] **Step 4: Configure Playwright**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:4321',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 5: Run tests (expect fail — index.astro doesn't import global.css yet)**

```bash
npx playwright test tests/design-system.spec.ts
```

Expected: FAIL — CSS variables not found.

- [ ] **Step 6: Import global.css in index.astro**

Replace `src/pages/index.astro` with:

```astro
---
import '../styles/global.css';
---
<html lang="en">
  <head><meta charset="UTF-8" /><title>NC Digital</title></head>
  <body>
    <h1>NC Digital</h1>
  </body>
</html>
```

- [ ] **Step 7: Run tests (expect pass)**

```bash
npx playwright test tests/design-system.spec.ts
```

Expected: 2 passed.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: add CSS design system with NC Digital colour palette and Sora font"
```

---

## Task 4: BaseHead Component

**Files:**
- Create: `src/components/BaseHead.astro`

- [ ] **Step 1: Write a failing test**

Add to `tests/design-system.spec.ts`:

```ts
test('page has correct meta description', async ({ page }) => {
  await page.goto('/');
  const desc = await page.locator('meta[name="description"]').getAttribute('content');
  expect(desc).toBeTruthy();
});

test('page has canonical link', async ({ page }) => {
  await page.goto('/');
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(canonical).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx playwright test tests/design-system.spec.ts
```

Expected: 2 new tests FAIL.

- [ ] **Step 3: Create BaseHead.astro**

```astro
---
// src/components/BaseHead.astro
export interface Props {
  title: string;
  description: string;
  image?: string;
  canonical?: string;
}

const {
  title,
  description,
  image = '/og-default.png',
  canonical = Astro.url.href,
} = Astro.props;

const siteTitle = title.includes('NC Digital') ? title : `${title} | NC Digital`;
---
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{siteTitle}</title>
<meta name="description" content={description} />
<link rel="canonical" href={canonical} />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:url" content={canonical} />
<meta property="og:title" content={siteTitle} />
<meta property="og:description" content={description} />
<meta property="og:image" content={new URL(image, Astro.site).href} />

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content={siteTitle} />
<meta name="twitter:description" content={description} />
<meta name="twitter:image" content={new URL(image, Astro.site).href} />

<!-- Favicon -->
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />

<!-- Fonts preload -->
<link rel="preload" as="font" type="font/woff2"
  href="/fonts/sora-latin-400-normal.woff2" crossorigin />
<link rel="preload" as="font" type="font/woff2"
  href="/fonts/sora-latin-700-normal.woff2" crossorigin />
```

- [ ] **Step 4: Update index.astro to use BaseHead**

```astro
---
import BaseHead from '../components/BaseHead.astro';
import '../styles/global.css';
---
<html lang="en">
  <head>
    <BaseHead
      title="NC Digital"
      description="Affordable web design and local SEO for South Wales small businesses."
    />
  </head>
  <body>
    <h1>NC Digital</h1>
  </body>
</html>
```

- [ ] **Step 5: Run tests**

```bash
npx playwright test tests/design-system.spec.ts
```

Expected: All 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/components/BaseHead.astro src/pages/index.astro
git commit -m "feat: add BaseHead component with SEO meta, OG tags, canonical"
```

---

## Task 5: Nav Component

**Files:**
- Create: `src/components/Nav.astro`
- Create: `tests/nav.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/nav.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('nav renders logo link', async ({ page }) => {
  await page.goto('/');
  const logo = page.locator('nav a[href="/"]');
  await expect(logo).toBeVisible();
  await expect(logo).toContainText('NC Digital');
});

test('nav has Services link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav a[href="/services"]')).toBeVisible();
});

test('nav has Work link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav a[href="/portfolio"]')).toBeVisible();
});

test('nav has Blog link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav a[href="/blog"]')).toBeVisible();
});

test('nav has Contact CTA button', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav a[href="/contact"].btn-primary')).toBeVisible();
});
```

- [ ] **Step 2: Run to verify all fail**

```bash
npx playwright test tests/nav.spec.ts
```

Expected: All 5 FAIL.

- [ ] **Step 3: Create Nav.astro**

```astro
---
// src/components/Nav.astro
const navLinks = [
  { href: '/services', label: 'Services' },
  { href: '/portfolio', label: 'Work' },
  { href: '/blog', label: 'Blog' },
  { href: '/about', label: 'About' },
];

const currentPath = Astro.url.pathname;
---
<nav style={`background: var(--bg); border-bottom: 1px solid var(--border);`}>
  <div class="container site-pad" style="display:flex; align-items:center; justify-content:space-between; height:72px;">

    <a href="/" style="font-size:1.125rem; font-weight:800; color:var(--white); letter-spacing:-0.02em;">
      NC Digital
    </a>

    <ul style="display:flex; align-items:center; gap:2rem; list-style:none; margin:0; padding:0;" class="desktop-nav">
      {navLinks.map(({ href, label }) => (
        <li>
          <a
            href={href}
            style={`font-size:0.9375rem; font-weight:500; color:${currentPath.startsWith(href) ? 'var(--purple)' : 'var(--text-muted)'}; transition:color 0.2s;`}
            onmouseover="this.style.color='var(--white)'"
            onmouseout={`this.style.color='${currentPath.startsWith(href) ? 'var(--purple)' : 'var(--text-muted)'}'`}
          >
            {label}
          </a>
        </li>
      ))}
      <li>
        <a href="/contact" class="btn-primary" style="padding:0.625rem 1.25rem; font-size:0.875rem;">
          Get in touch
        </a>
      </li>
    </ul>

  </div>
</nav>
```

- [ ] **Step 4: Add Nav to index.astro**

```astro
---
import BaseHead from '../components/BaseHead.astro';
import Nav from '../components/Nav.astro';
import '../styles/global.css';
---
<html lang="en">
  <head>
    <BaseHead
      title="NC Digital"
      description="Affordable web design and local SEO for South Wales small businesses."
    />
  </head>
  <body>
    <Nav />
    <main>
      <h1>NC Digital</h1>
    </main>
  </body>
</html>
```

- [ ] **Step 5: Run tests**

```bash
npx playwright test tests/nav.spec.ts
```

Expected: All 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/components/Nav.astro src/pages/index.astro tests/nav.spec.ts
git commit -m "feat: add Nav component with links and CTA"
```

---

## Task 6: Footer Component

**Files:**
- Create: `src/components/Footer.astro`
- Create: `tests/footer.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/footer.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('footer renders company name', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer')).toContainText('NC Digital');
});

test('footer has services links', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer a[href="/services"]')).toBeVisible();
});

test('footer shows South Wales location', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer')).toContainText('South Wales');
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx playwright test tests/footer.spec.ts
```

Expected: All 3 FAIL.

- [ ] **Step 3: Create Footer.astro**

```astro
---
// src/components/Footer.astro
const year = new Date().getFullYear();

const services = [
  { href: '/services/web-development', label: 'Web Development' },
  { href: '/services/local-seo-google-ranking', label: 'Local SEO' },
  { href: '/services/website-maintenance-packages', label: 'Maintenance' },
  { href: '/services/website-hosting-security', label: 'Hosting & Security' },
  { href: '/services/professional-mailboxes-email-setup', label: 'Business Email' },
];

const locations = [
  { href: '/web-design-cardiff', label: 'Web Design Cardiff' },
  { href: '/web-design-swansea', label: 'Web Design Swansea' },
  { href: '/web-design-merthyr-tydfil', label: 'Web Design Merthyr Tydfil' },
  { href: '/seo-cardiff', label: 'SEO Cardiff' },
  { href: '/seo-south-wales', label: 'SEO South Wales' },
];
---
<footer style="background:var(--bg-2); border-top:1px solid var(--border); margin-top:5rem;">

  <div class="container site-pad" style="padding-top:3.5rem; padding-bottom:3.5rem;">

    <div style="display:grid; grid-template-columns:1.5fr 1fr 1fr; gap:3rem; margin-bottom:3rem;">

      <!-- Brand column -->
      <div>
        <a href="/" style="font-size:1.25rem; font-weight:800; color:var(--white); display:block; margin-bottom:1rem;">
          NC Digital
        </a>
        <p style="color:var(--text-muted); font-size:0.9375rem; line-height:1.7; max-width:280px;">
          Affordable web design and local SEO for South Wales small businesses.
          Based in Merthyr Tydfil, serving clients across Wales.
        </p>
      </div>

      <!-- Services column -->
      <div>
        <h4 style="font-size:0.75rem; font-weight:600; letter-spacing:0.15em; text-transform:uppercase; color:var(--purple); margin-bottom:1rem;">
          Services
        </h4>
        <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.625rem;">
          {services.map(({ href, label }) => (
            <li>
              <a href={href} style="color:var(--text-muted); font-size:0.9375rem; transition:color 0.2s;"
                onmouseover="this.style.color='var(--white)'"
                onmouseout="this.style.color='var(--text-muted)'">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <!-- Locations column -->
      <div>
        <h4 style="font-size:0.75rem; font-weight:600; letter-spacing:0.15em; text-transform:uppercase; color:var(--purple); margin-bottom:1rem;">
          Areas We Cover
        </h4>
        <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.625rem;">
          {locations.map(({ href, label }) => (
            <li>
              <a href={href} style="color:var(--text-muted); font-size:0.9375rem; transition:color 0.2s;"
                onmouseover="this.style.color='var(--white)'"
                onmouseout="this.style.color='var(--text-muted)'">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>

    </div>

    <hr class="divider" />

    <div style="display:flex; align-items:center; justify-content:space-between; padding-top:1.5rem; flex-wrap:wrap; gap:1rem;">
      <p style="color:var(--text-muted); font-size:0.875rem;">
        © {year} NC Digital. All rights reserved.
      </p>
      <a href="/privacy-policy" style="color:var(--text-muted); font-size:0.875rem; transition:color 0.2s;"
        onmouseover="this.style.color='var(--white)'"
        onmouseout="this.style.color='var(--text-muted)'">
        Privacy Policy
      </a>
    </div>

  </div>

</footer>
```

- [ ] **Step 4: Run tests**

```bash
npx playwright test tests/footer.spec.ts
```

Expected: All 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/Footer.astro tests/footer.spec.ts
git commit -m "feat: add Footer component with services and location links"
```

---

## Task 7: BaseLayout Component

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Create BaseLayout.astro**

```astro
---
// src/layouts/BaseLayout.astro
import BaseHead from '../components/BaseHead.astro';
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
import '../styles/global.css';

export interface Props {
  title: string;
  description: string;
  image?: string;
  canonical?: string;
}

const { title, description, image, canonical } = Astro.props;
---
<!doctype html>
<html lang="en-GB">
  <head>
    <BaseHead {title} {description} {image} {canonical} />
  </head>
  <body>
    <Nav />
    <main>
      <slot />
    </main>
    <Footer />
  </body>
</html>
```

- [ ] **Step 2: Simplify index.astro to use BaseLayout**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout
  title="NC Digital — Web Design & SEO South Wales"
  description="Affordable web design and local SEO for South Wales small businesses. Based in Merthyr Tydfil."
>
  <p style="color:var(--text); padding:2rem;">Coming soon.</p>
</BaseLayout>
```

- [ ] **Step 3: Run all tests**

```bash
npx playwright test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/BaseLayout.astro src/pages/index.astro
git commit -m "feat: add BaseLayout wrapping nav, main slot, and footer"
```

---

## Task 8: Keystatic Configuration

**Files:**
- Create: `keystatic.config.ts`
- Create: `src/pages/keystatic/[...params].astro`
- Create: `src/pages/api/keystatic/[...params].ts`

- [ ] **Step 1: Create keystatic.config.ts**

```ts
// keystatic.config.ts
import { config, collection, singleton, fields } from '@keystatic/core';

export default config({
  storage: { kind: 'local' },

  ui: {
    brand: { name: 'NC Digital' },
  },

  collections: {

    blog: collection({
      label: 'Blog Posts',
      slugField: 'title',
      path: 'src/content/blog/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        pubDate: fields.date({ label: 'Published Date' }),
        description: fields.text({ label: 'Excerpt', multiline: true }),
        heroImage: fields.image({
          label: 'Hero Image',
          directory: 'src/assets/blog',
          publicPath: '../../assets/blog/',
        }),
        category: fields.select({
          label: 'Category',
          options: [
            { label: 'Web Design', value: 'web-design' },
            { label: 'SEO', value: 'seo' },
            { label: 'Business', value: 'business' },
            { label: 'News', value: 'news' },
          ],
          defaultValue: 'web-design',
        }),
        metaTitle: fields.text({ label: 'Meta Title' }),
        metaDescription: fields.text({ label: 'Meta Description', multiline: true }),
        content: fields.markdoc({ label: 'Content' }),
      },
    }),

    portfolio: collection({
      label: 'Portfolio',
      slugField: 'title',
      path: 'src/content/portfolio/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Project Name' } }),
        client: fields.text({ label: 'Client Name' }),
        services: fields.multiselect({
          label: 'Services Provided',
          options: [
            { label: 'Web Design', value: 'web-design' },
            { label: 'Web Development', value: 'web-development' },
            { label: 'Local SEO', value: 'seo' },
            { label: 'Hosting', value: 'hosting' },
          ],
        }),
        heroImage: fields.image({
          label: 'Project Image',
          directory: 'src/assets/portfolio',
          publicPath: '../../assets/portfolio/',
        }),
        summary: fields.text({ label: 'Short Summary', multiline: true }),
        metaTitle: fields.text({ label: 'Meta Title' }),
        metaDescription: fields.text({ label: 'Meta Description', multiline: true }),
        content: fields.markdoc({ label: 'Case Study Content' }),
      },
    }),

    services: collection({
      label: 'Services',
      slugField: 'title',
      path: 'src/content/services/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Service Name' } }),
        headline: fields.text({ label: 'Hero Headline' }),
        description: fields.text({ label: 'Short Description', multiline: true }),
        features: fields.array(
          fields.text({ label: 'Feature' }),
          { label: 'Key Features', itemLabel: props => props.value }
        ),
        metaTitle: fields.text({ label: 'Meta Title' }),
        metaDescription: fields.text({ label: 'Meta Description', multiline: true }),
        content: fields.markdoc({ label: 'Page Content' }),
      },
    }),

    locations: collection({
      label: 'Location Pages',
      slugField: 'title',
      path: 'src/content/locations/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Page Title' } }),
        town: fields.text({ label: 'Town / City' }),
        county: fields.text({ label: 'County' }),
        serviceType: fields.select({
          label: 'Service Type',
          options: [
            { label: 'Web Design', value: 'web-design' },
            { label: 'SEO', value: 'seo' },
            { label: 'Both', value: 'both' },
          ],
          defaultValue: 'web-design',
        }),
        headline: fields.text({ label: 'Hero Headline' }),
        metaTitle: fields.text({ label: 'Meta Title' }),
        metaDescription: fields.text({ label: 'Meta Description', multiline: true }),
        content: fields.markdoc({ label: 'Page Content' }),
      },
    }),

  },

  singletons: {

    siteSettings: singleton({
      label: 'Site Settings',
      path: 'src/content/settings',
      schema: {
        heroHeadline: fields.text({ label: 'Hero Headline' }),
        heroSubtext: fields.text({ label: 'Hero Subtext', multiline: true }),
        heroCTAPrimary: fields.text({ label: 'Primary CTA Text' }),
        heroCTASecondary: fields.text({ label: 'Secondary CTA Text' }),
        aboutText: fields.text({ label: 'About Section Text', multiline: true }),
        phone: fields.text({ label: 'Phone Number' }),
        email: fields.text({ label: 'Email Address' }),
        address: fields.text({ label: 'Address' }),
        facebookUrl: fields.url({ label: 'Facebook URL' }),
        instagramUrl: fields.url({ label: 'Instagram URL' }),
        linkedinUrl: fields.url({ label: 'LinkedIn URL' }),
      },
    }),

  },
});
```

- [ ] **Step 2: Create Keystatic CMS page route**

```astro
---
// src/pages/keystatic/[...params].astro
export const prerender = false;

if (import.meta.env.PROD) {
  return Astro.redirect('/404');
}

import { makeKeystaticrouteHandler } from '@keystatic/astro/route';
import config from '../../../keystatic.config';

const handler = makeKeystaticrouteHandler({ config });
const response = await handler(Astro.request);

if (response instanceof Response) {
  return response;
}
---
```

Wait — the Keystatic Astro integration handles routing automatically via `keystatic()` in astro.config.mjs. Replace the above with the simpler approach:

```astro
---
// src/pages/keystatic/[...params].astro
export const prerender = false;

if (import.meta.env.PROD) {
  return Astro.redirect('/404');
}
---
```

The `keystatic()` integration in `astro.config.mjs` handles all routing automatically.

- [ ] **Step 3: Create Keystatic API route**

```ts
// src/pages/api/keystatic/[...params].ts
export const prerender = false;

export async function all({ request }: { request: Request }) {
  if (import.meta.env.PROD) {
    return new Response('Not found', { status: 404 });
  }
  const { makeKeystaticrouteHandler } = await import('@keystatic/astro/api');
  const config = (await import('../../../../keystatic.config')).default;
  return makeKeystaticrouteHandler({ config })(request);
}
```

- [ ] **Step 4: Create initial siteSettings content**

Create `src/content/settings/index.json`:

```json
{
  "heroHeadline": "Websites that rank. Businesses that grow.",
  "heroSubtext": "Affordable web design and local SEO for South Wales small businesses.",
  "heroCTAPrimary": "Get your free plan",
  "heroCTASecondary": "See our work",
  "aboutText": "NC Digital is a web design and SEO agency based in Merthyr Tydfil, South Wales. We help local businesses get found online with affordable, high-quality websites.",
  "phone": "07XXX XXXXXX",
  "email": "nathan@nc-digital.co.uk",
  "address": "Merthyr Tydfil, South Wales",
  "facebookUrl": null,
  "instagramUrl": null,
  "linkedinUrl": null
}
```

- [ ] **Step 5: Verify dev server still works**

```bash
npm run dev
```

Expected: Dev server at `http://localhost:4321`. Visit `http://localhost:4321/keystatic` — Keystatic UI loads showing NC Digital brand.

- [ ] **Step 6: Commit**

```bash
git add keystatic.config.ts src/pages/keystatic src/pages/api src/content/settings
git commit -m "feat: add Keystatic config with all collections and siteSettings singleton"
```

---

## Task 9: Homepage

**Files:**
- Modify: `src/pages/index.astro`
- Create: `tests/homepage.spec.ts`

- [ ] **Step 1: Write failing homepage tests**

Create `tests/homepage.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('homepage has hero headline', async ({ page }) => {
  await page.goto('/');
  const h1 = page.locator('h1');
  await expect(h1).toBeVisible();
  const text = await h1.textContent();
  expect(text!.length).toBeGreaterThan(10);
});

test('homepage has primary CTA button linking to free plan', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a[href="/free-website-plan"]').first()).toBeVisible();
});

test('homepage has secondary CTA linking to portfolio', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a[href="/portfolio"]').first()).toBeVisible();
});

test('homepage has services section', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#services')).toBeVisible();
});

test('homepage has portfolio section', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#work')).toBeVisible();
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx playwright test tests/homepage.spec.ts
```

Expected: All 5 FAIL.

- [ ] **Step 3: Build full homepage**

Replace `src/pages/index.astro` with:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { createReader } from '@keystatic/core/reader';
import config from '../../keystatic.config';

const reader = createReader(process.cwd(), config);
const settings = await reader.singletons.siteSettings.read();
const portfolioEntries = await reader.collections.portfolio.all();
const blogEntries = (await reader.collections.blog.all())
  .sort((a, b) => {
    const dateA = a.entry.pubDate ? new Date(a.entry.pubDate).getTime() : 0;
    const dateB = b.entry.pubDate ? new Date(b.entry.pubDate).getTime() : 0;
    return dateB - dateA;
  })
  .slice(0, 3);

const stats = [
  { value: '50+', label: 'Sites Built' },
  { value: '100', label: 'Lighthouse Score' },
  { value: '5★', label: 'Google Reviews' },
  { value: 'Wales', label: 'Locally Based' },
];

const services = [
  { icon: '⬡', title: 'Web Development', desc: 'Fast, custom-built sites', href: '/services/web-development' },
  { icon: '◈', title: 'Local SEO', desc: 'Rank in your area', href: '/services/local-seo-google-ranking' },
  { icon: '◉', title: 'Maintenance', desc: 'Always online, always updated', href: '/services/website-maintenance-packages' },
  { icon: '◎', title: 'Hosting & Security', desc: 'Fast, secure, managed', href: '/services/website-hosting-security' },
  { icon: '✉', title: 'Business Email', desc: 'Professional mailboxes', href: '/services/professional-mailboxes-email-setup' },
];
---

<BaseLayout
  title="NC Digital — Web Design & SEO South Wales"
  description={settings?.heroSubtext ?? 'Affordable web design and local SEO for South Wales small businesses.'}
>

  <!-- HERO -->
  <section style="padding:5rem 0 4rem; position:relative; overflow:hidden;">
    <!-- Purple glow -->
    <div style="position:absolute; top:-100px; right:0; width:600px; height:600px; background:radial-gradient(circle, #8750f720 0%, transparent 70%); pointer-events:none;"></div>

    <div class="container site-pad" style="display:grid; grid-template-columns:1fr 1fr; gap:4rem; align-items:center;">

      <!-- Left: text -->
      <div>
        <p class="eyebrow" style="margin-bottom:1rem;">Web Design · SEO · South Wales</p>
        <h1 style="margin-bottom:1.25rem;">
          {settings?.heroHeadline ?? 'Websites that rank. Businesses that grow.'}
        </h1>
        <p style="color:var(--text-muted); font-size:1.125rem; line-height:1.7; margin-bottom:2rem; max-width:480px;">
          {settings?.heroSubtext ?? 'Affordable web design and local SEO for South Wales small businesses.'}
        </p>
        <div style="display:flex; gap:1rem; flex-wrap:wrap;">
          <a href="/free-website-plan" class="btn-primary">
            {settings?.heroCTAPrimary ?? 'Get your free plan'} →
          </a>
          <a href="/portfolio" class="btn-outline">
            {settings?.heroCTASecondary ?? 'See our work'}
          </a>
        </div>
      </div>

      <!-- Right: photo -->
      <div style="position:relative; display:flex; justify-content:center;">
        <div style="position:absolute; inset:0; background:radial-gradient(circle at center, #8750f730 0%, transparent 70%); border-radius:50%;"></div>
        <div style="width:380px; height:420px; border-radius:16px; background:var(--bg-2); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
          <!-- Replace this div with <Image> once Nathan's photo is added to src/assets/nathan.jpg -->
          <p style="color:var(--text-muted); font-size:0.875rem; text-align:center; padding:2rem;">
            Add photo to<br/><code>src/assets/nathan.jpg</code>
          </p>
        </div>
      </div>

    </div>
  </section>

  <!-- STATS BAR -->
  <section style="border-top:1px solid var(--border); border-bottom:1px solid var(--border); padding:2rem 0; background:var(--bg-2);">
    <div class="container site-pad" style="display:grid; grid-template-columns:repeat(4,1fr); gap:1rem;">
      {stats.map(({ value, label }) => (
        <div style="text-align:center;">
          <div style="font-size:1.75rem; font-weight:800; color:var(--purple);">{value}</div>
          <div style="font-size:0.875rem; color:var(--text-muted); margin-top:0.25rem;">{label}</div>
        </div>
      ))}
    </div>
  </section>

  <!-- SERVICES -->
  <section id="services" style="padding:5rem 0;">
    <div class="container site-pad">
      <p class="eyebrow" style="margin-bottom:0.75rem;">What we do</p>
      <h2 style="margin-bottom:3rem; max-width:500px;">Everything your business needs to grow online</h2>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); gap:1.25rem;">
        {services.map(({ icon, title, desc, href }) => (
          <a href={href} class="card" style="display:block; text-decoration:none;">
            <div style="font-size:1.5rem; margin-bottom:1rem; color:var(--purple);">{icon}</div>
            <h3 style="font-size:1rem; font-weight:600; color:var(--white); margin-bottom:0.5rem;">{title}</h3>
            <p style="font-size:0.875rem; color:var(--text-muted); margin:0;">{desc}</p>
          </a>
        ))}
      </div>
    </div>
  </section>

  <!-- PORTFOLIO -->
  <section id="work" style="padding:5rem 0; background:var(--bg-2);">
    <div class="container site-pad">
      <div style="display:flex; align-items:flex-end; justify-content:space-between; margin-bottom:3rem;">
        <div>
          <p class="eyebrow" style="margin-bottom:0.75rem;">Our work</p>
          <h2 style="margin:0;">Recent projects</h2>
        </div>
        <a href="/portfolio" class="btn-outline" style="font-size:0.875rem;">View all →</a>
      </div>

      {portfolioEntries.length > 0 ? (
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:1.25rem;">
          {portfolioEntries.slice(0, 3).map(({ slug, entry }) => (
            <a href={`/portfolio/${slug}`} class="card" style="display:block; text-decoration:none;">
              <div style="background:var(--bg-3); border-radius:6px; height:180px; margin-bottom:1rem; display:flex; align-items:center; justify-content:center;">
                <span style="color:var(--text-muted); font-size:0.875rem;">Project image</span>
              </div>
              <h3 style="font-size:1rem; font-weight:600; color:var(--white); margin-bottom:0.5rem;">{entry.client}</h3>
              <p style="font-size:0.875rem; color:var(--text-muted); margin:0;">{entry.summary}</p>
            </a>
          ))}
        </div>
      ) : (
        <p style="color:var(--text-muted);">Portfolio entries coming soon.</p>
      )}
    </div>
  </section>

  <!-- BLOG PREVIEW -->
  <section style="padding:5rem 0;">
    <div class="container site-pad">
      <div style="display:flex; align-items:flex-end; justify-content:space-between; margin-bottom:3rem;">
        <div>
          <p class="eyebrow" style="margin-bottom:0.75rem;">Insights</p>
          <h2 style="margin:0;">Latest from the blog</h2>
        </div>
        <a href="/blog" class="btn-outline" style="font-size:0.875rem;">All posts →</a>
      </div>

      {blogEntries.length > 0 ? (
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:1.25rem;">
          {blogEntries.map(({ slug, entry }) => (
            <a href={`/blog/${slug}`} class="card" style="display:block; text-decoration:none;">
              <div style="background:var(--bg-3); border-radius:6px; height:160px; margin-bottom:1rem;"></div>
              <p style="font-size:0.75rem; color:var(--purple); font-weight:600; margin-bottom:0.5rem; text-transform:uppercase; letter-spacing:0.1em;">{entry.category}</p>
              <h3 style="font-size:1rem; font-weight:600; color:var(--white); margin-bottom:0.5rem; line-height:1.4;">{entry.title}</h3>
              <p style="font-size:0.875rem; color:var(--text-muted); margin:0;">{entry.description}</p>
            </a>
          ))}
        </div>
      ) : (
        <p style="color:var(--text-muted);">Blog posts coming soon.</p>
      )}
    </div>
  </section>

  <!-- CTA BANNER -->
  <section style="padding:5rem 0; background:var(--bg-2); border-top:1px solid var(--border);">
    <div class="container site-pad" style="text-align:center;">
      <p class="eyebrow" style="margin-bottom:1rem;">Ready to grow?</p>
      <h2 style="margin-bottom:1rem;">Let's build your online presence</h2>
      <p style="color:var(--text-muted); font-size:1.125rem; margin-bottom:2rem; max-width:500px; margin-left:auto; margin-right:auto;">
        Get a free website plan with no commitment. We'll show you exactly what we'd build and what it would cost.
      </p>
      <a href="/free-website-plan" class="btn-primary" style="font-size:1rem; padding:1rem 2rem;">
        Get your free plan →
      </a>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 4: Run homepage tests**

```bash
npx playwright test tests/homepage.spec.ts
```

Expected: All 5 passed.

- [ ] **Step 5: Run full test suite**

```bash
npx playwright test
```

Expected: All tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro tests/homepage.spec.ts
git commit -m "feat: add full homepage with hero, stats, services, portfolio, blog preview, CTA"
```

---

## Task 10: Cloudflare Pages Config

**Files:**
- Create: `public/_headers`
- Create: `public/robots.txt`
- Create: `public/favicon.svg`

- [ ] **Step 1: Create `public/_headers`**

```
/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/
  Cache-Control: public, max-age=0, must-revalidate
```

- [ ] **Step 2: Create `public/robots.txt`**

```
User-agent: *
Allow: /

Sitemap: https://nc-digital.co.uk/sitemap-index.xml
```

- [ ] **Step 3: Create `public/favicon.svg`** (simple purple NC monogram)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#8750f7"/>
  <text x="16" y="22" font-family="sans-serif" font-size="14" font-weight="800" fill="white" text-anchor="middle">NC</text>
</svg>
```

- [ ] **Step 4: Create `public/_redirects`** (Cloudflare Pages URL migrations)

```
/website-design-cardiff-uk/   /web-design-cardiff   301
/digital-services/            /services             301
/seo-web-design/              /services             301
/free-website-plan/           /free-website-plan    301
/web-design-offer/            /free-website-plan    301
```

- [ ] **Step 5: Verify build succeeds**

```bash
npm run build
```

Expected: Build completes with no errors. `dist/` directory created.

- [ ] **Step 6: Commit**

```bash
git add public/
git commit -m "chore: add Cloudflare Pages headers, redirects, robots.txt, favicon"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npx playwright test
```

Expected: All tests pass.

- [ ] **Step 2: Run Astro type check**

```bash
npx astro check
```

Expected: No errors.

- [ ] **Step 3: Run production build**

```bash
npm run build && npm run preview
```

Expected: Preview server at `http://localhost:4321`. Homepage visible with nav, hero, stats, services, portfolio, blog, CTA, footer.

- [ ] **Step 4: Check Keystatic UI in dev**

```bash
npm run dev
```

Visit `http://localhost:4321/keystatic` — should show NC Digital CMS with all 4 collections and the siteSettings singleton.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "chore: foundation complete — Astro 5 + Keystatic + design system ready for Plan 2"
```

---

## After Plan 1

Proceed to **Plan 2: Content & Pages** which covers:
- All dynamic pages (blog, portfolio, services, locations)
- Static pages (about, contact, free-website-plan, privacy)
- WordPress migration script
- JSON-LD structured data
- Sitemap configuration
