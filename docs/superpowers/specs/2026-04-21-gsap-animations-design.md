# GSAP Animations — Design Spec

**Date:** 2026-04-21
**Project:** NC Digital Astro 5 site
**Goal:** Add confident, scroll-triggered GSAP animations across all pages without overwhelming the content.

---

## Approach

A single `src/scripts/animations.ts` module loaded in `BaseLayout.astro`. It auto-wires animations by querying `[data-animate]` attributes in the DOM — no per-page animation code required. Adding animations to new pages is just a matter of adding the attribute to markup.

Dependencies: `gsap` npm package + `ScrollTrigger` plugin (both from the `gsap` package).

---

## Animation Catalogue

| `data-animate` value | Effect | Trigger |
|---|---|---|
| `fade-up` | Opacity 0→1, translateY 30px→0 | ScrollTrigger (once) |
| `fade-in` | Opacity 0→1, no movement | ScrollTrigger (once) |
| `stagger` | Parent marker — children fade-up 0.1s apart | ScrollTrigger (once) |
| `counter` | Number increments from 0 to its text value | ScrollTrigger (once) |

**Hero elements** (first visible section on any page) animate on page load, not scroll. Everything else is scroll-triggered.

**`prefers-reduced-motion`:** If set, all animations are skipped entirely — elements render at their final state immediately.

**Duration:** 0.6s for most animations. Stagger children: 0.4s each, 0.1s apart. Counter: 1.5s ease-out.

**Easing:** `power2.out` for fade-up/fade-in. `power1.out` for counters.

---

## Per-Page Animation Map

### Homepage (`index.astro`)
- Hero eyebrow, h1, subtext, CTA buttons: sequential `fade-up` on page load (0.15s between each)
- Hero image: `fade-in` on page load
- Stats bar values: `counter` on scroll
- Services section heading: `fade-up` on scroll
- Services card grid: `stagger` on scroll
- Portfolio section heading: `fade-up` on scroll
- Portfolio card grid: `stagger` on scroll
- Blog section heading: `fade-up` on scroll
- Blog card grid: `stagger` on scroll
- CTA banner heading + text + button: `fade-up` on scroll

### Service listing (`/services`)
- Heading block: `fade-up` on load
- Card grid: `stagger` on scroll

### Service detail (`/services/[slug]`)
- Eyebrow + h1 + description + CTA: sequential `fade-up` on load
- Body content: `fade-up` on scroll
- Sidebar card: `fade-in` on scroll

### Portfolio listing (`/portfolio`)
- Heading block: `fade-up` on load
- Card grid: `stagger` on scroll

### Portfolio detail (`/portfolio/[slug]`)
- Eyebrow + h1 + tags + summary: `fade-up` on load
- Body content: `fade-up` on scroll
- CTA banner: `fade-up` on scroll

### Blog listing (`/blog`)
- Heading block: `fade-up` on load
- Card grid: `stagger` on scroll

### Blog post (`/blog/[slug]`)
- Category + h1 + date: `fade-up` on load
- Article body: `fade-up` on scroll
- CTA banner: `fade-up` on scroll

### Location pages (`/[location]`)
- Eyebrow + h1 + description + CTAs: `fade-up` on load
- Body content: `fade-up` on scroll
- Sidebar card: `fade-in` on scroll

### About (`/about`)
- Eyebrow + h1 + paragraphs + buttons: `fade-up` on load
- Nathan photo: `fade-in` on load
- "Why NC Digital" cards: `stagger` on scroll

### Contact (`/contact`)
- Eyebrow + h1 + intro: `fade-up` on load
- Contact details: `stagger` on scroll
- Form card: `fade-up` on scroll

### Free Website Plan (`/free-website-plan`)
- Eyebrow + h1 + subtext + checklist: `fade-up` on load
- Form card: `fade-up` on scroll

### Privacy Policy (`/privacy-policy`)
- h1: `fade-up` on load
- Each section block: `fade-up` on scroll

### Nav
- Fades in on every page load (opacity 0→1, 0.3s, no movement)

---

## File Changes

**New:**
- `src/scripts/animations.ts` — the global animation engine

**Modified:**
- `src/layouts/BaseLayout.astro` — add `<script>` import for animations.ts
- `src/pages/index.astro` — add `data-animate` attributes
- `src/pages/about.astro`
- `src/pages/contact.astro`
- `src/pages/free-website-plan.astro`
- `src/pages/privacy-policy.astro`
- `src/pages/services/index.astro`
- `src/pages/services/[slug].astro`
- `src/pages/portfolio/index.astro`
- `src/pages/portfolio/[slug].astro`
- `src/pages/blog/[...page].astro`
- `src/pages/blog/[slug].astro`
- `src/pages/[location].astro`
- `src/components/Nav.astro`

---

## Implementation Notes

- GSAP is loaded as an npm dependency (`gsap`), not a CDN — bundled by Vite, no extra network request
- `ScrollTrigger.refresh()` called after fonts load to prevent offset errors
- Hero detection: elements inside the first `<section>` on the page animate on load; all others use ScrollTrigger
- Counter animation: reads the text content of the element, strips non-numeric characters, animates to that value
- The `data-animate` attributes don't affect layout or appearance — safe to add without visual side effects if JS is disabled (elements simply appear at full opacity)
