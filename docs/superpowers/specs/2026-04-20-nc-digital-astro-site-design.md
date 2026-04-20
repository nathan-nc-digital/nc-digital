# NC Digital — New Site Design Spec

**Date:** 2026-04-20  
**Project:** NC Digital website rebuild  
**Replacing:** WordPress site at nc-digital.co.uk  

---

## 1. Goals

- Replace the existing WordPress site with a fast, modern Astro 5 site
- Achieve perfect Lighthouse scores (zero client JS, self-hosted fonts, optimised images)
- Make all content easily updatable by Claude via Keystatic collections
- Preserve SEO equity — keep existing URLs, 301 redirect anything that moves
- Deploy to Cloudflare Pages (free tier, global edge CDN)

---

## 2. Stack

| Layer | Technology |
|---|---|
| Framework | Astro 5 (`output: 'hybrid'` — all pages prerendered; Keystatic UI routes are SSR in dev only) |
| CMS | Keystatic (file-based, dev-only — not accessible in production) |
| Styling | Tailwind CSS v4 + `.site-pad` for horizontal padding |
| Fonts | Sora via `@fontsource/sora` (self-hosted) |
| Images | Astro `<Image />` → Sharp → WebP/AVIF |
| Deployment | Cloudflare Pages |
| Content format | Markdoc (`.mdoc`) |

---

## 3. Design System

### Colours
```css
--bg:          #0c1115   /* page background */
--bg-2:        #0e1418   /* card/section backgrounds */
--border:      #1b2227   /* subtle borders */
--purple:      #8750f7   /* primary accent */
--purple-dark: #2a1454   /* hover states, gradients */
--text:        #dddddd   /* body text */
--text-muted:  #747779   /* secondary text */
--white:       #ffffff   /* headings, labels */
```

### Typography
- Font: Sora (all weights via `@fontsource/sora`)
- H1: ~60px, weight 800
- H2: ~42px, weight 700
- H3: ~28px, weight 600
- Body: 16–18px, weight 400
- Eyebrow labels: 12px, weight 600, letter-spacing wide, purple

### Layout
- Max width: 1280px, centred
- Horizontal padding: `.site-pad` CSS class (not Tailwind `px-` responsive classes)

---

## 4. Homepage Design

**Hero — Split layout**
- Left: eyebrow label → H1 headline → subtext → two CTAs ("Get your free plan" + "See our work")
- Right: Nathan's photo with subtle purple radial glow behind it

**Below hero (in order):**
1. Stats bar — key numbers in purple (sites built, Lighthouse score, etc.)
2. Services preview — 3-column card grid, dark `#0e1418` background, purple icons
3. Portfolio strip — horizontal scroll or grid of case study cards
4. Blog preview — 3 latest posts
5. CTA banner — "Ready to grow?" with contact button

---

## 5. Content Structure (Keystatic)

### Collections

**`blog`** — path: `src/content/blog/*`
- `title` (slug field)
- `pubDate` (date)
- `description` (text, multiline)
- `heroImage` (image → `src/assets/blog/`)
- `category` (select)
- `tags` (multiselect)
- `metaTitle` (text)
- `metaDescription` (text, multiline)
- `content` (Markdoc)

**`portfolio`** — path: `src/content/portfolio/*`
- `title` (slug field)
- `client` (text)
- `services` (multiselect)
- `heroImage` (image → `src/assets/portfolio/`)
- `summary` (text, multiline)
- `metaTitle`, `metaDescription`
- `content` (Markdoc)

**`services`** — path: `src/content/services/*`
- `title` (slug field)
- `headline` (text)
- `description` (text, multiline)
- `icon` (text — icon name or SVG)
- `features` (array of text)
- `metaTitle`, `metaDescription`
- `content` (Markdoc)

**`locations`** — path: `src/content/locations/*`
- `title` (slug field)
- `town` (text)
- `county` (text)
- `serviceType` (select: `web-design` | `seo` | `both`)
- `headline` (text)
- `metaTitle`, `metaDescription`
- `content` (Markdoc)

### Singleton

**`siteSettings`** — path: `src/content/settings`
- `heroHeadline`, `heroSubtext`, `heroCTAPrimary`, `heroCTASecondary`
- `aboutText`
- `phone`, `email`, `address`
- `facebookUrl`, `instagramUrl`, `linkedinUrl`

---

## 6. Pages & Routing

| Route | Type | Source |
|---|---|---|
| `/` | Static | Homepage |
| `/services` | Static | Lists all services |
| `/services/[slug]` | Dynamic | `services` collection |
| `/portfolio` | Static | Grid of case studies |
| `/portfolio/[slug]` | Dynamic | `portfolio` collection |
| `/blog` | Static (paginated) | Blog listing |
| `/blog/[slug]` | Dynamic | `blog` collection |
| `/[location-slug]` | Dynamic | `locations` collection |
| `/about` | Static | About Nathan |
| `/contact` | Static | Contact form + details |
| `/free-website-plan` | Static | Lead gen page |
| `/privacy-policy` | Static | Legal |

---

## 7. SEO Strategy

### Per-page
- `metaTitle` and `metaDescription` fields on every Keystatic collection entry
- Astro `<SEO>` head component used on all pages
- Canonical URLs set automatically

### Technical SEO
- `@astrojs/sitemap` — auto-generates `/sitemap.xml` on build
- `public/robots.txt`
- `LocalBusiness` JSON-LD on homepage and all location pages
- `BlogPosting` JSON-LD on blog posts

### URL preservation
- All existing blog post slugs preserved exactly (no redirects needed)
- All location page slugs preserved exactly (e.g. `/web-design-cardiff`, `/seo-swansea`)
- ~5–10 pages need `_redirects` entries (slugs that change, e.g. `/website-design-cardiff-uk/` → `/web-design-cardiff`)

### Cloudflare caching (`_headers`)
```
/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/*.html
  Cache-Control: public, max-age=0, must-revalidate
```

---

## 8. WordPress Migration

1. Export all posts from WordPress (WP All Export → JSON/CSV)
2. Run one-off Node script to convert to `.mdoc` files in `src/content/blog/`
3. Download all post images → `src/assets/blog/`
4. Verify slugs match — no redirects needed if slugs are unchanged
5. Manually review and update `metaTitle` / `metaDescription` per post

---

## 9. Out of Scope

- Contact form backend (use a third-party like Formspree or Web3Forms — static site)
- E-commerce
- User accounts / login
- Comments on blog posts
- Dark/light mode toggle (dark only)
