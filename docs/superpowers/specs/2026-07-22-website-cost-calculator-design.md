# Website Cost Calculator — Design

## Purpose

A dedicated page Nathan can send people to when they ask for a quote. It walks the visitor through a short wizard about their website needs and shows a running price total that updates live as they answer — landing on an instant estimate they can then submit as a lead.

Scope: **website builds only** (pages + custom homepage option + a small set of add-ons). Other services (SEO, hosting, maintenance, standalone logo work, email setup) are out of scope for this calculator.

## Pricing model

All prices are **inclusive of VAT** and are shown to the visitor exactly as given — no ex-VAT conversion, no "+ VAT" suffix. Labelled as `"£599 inc. VAT"` style on the price display.

### Base tiers (by page count)

| Pages | Custom homepage included? | Price |
|---|---|---|
| 1 page | Not offered — this tier has no homepage-design option | £200 |
| 5–10 pages | Yes | £599 |
| 5–10 pages | No (−£100) | £499 |
| 11–20 pages | Yes | £699 |
| 11–20 pages | No (−£100) | £599 |
| 20+ pages | Yes | £899 |
| 20+ pages | No (−£100) | £799 |

Each of these 7 price points is a **hardcoded, precomputed value** in code (not derived at runtime via subtraction), so the numbers always exactly match what Nathan specified. No floating-point/rounding logic anywhere in this feature.

### Add-ons (stack additively on top of the base tier)

| Add-on | Price |
|---|---|
| Online shop / e-commerce | +£500 |
| Booking / appointment system | +£300 |
| New logo / branding design | +£200 |

Add-ons are available regardless of page tier, including the 1-page tier.

Running total = base tier price (with/without custom homepage) + sum of selected add-ons. Simple integer addition, no VAT math involved anywhere in this feature.

## Question flow

A step wizard, visually consistent with the existing `free-website-plan.astro` quiz (same purple shell/card treatment, same Back/Next pattern), but with one key difference: a **running price total pinned in the header** throughout, so the number visibly changes as the visitor answers.

1. **"How many pages do you need?"** — single choice: `1 page` / `5–10 pages` / `11–20 pages` / `20+ pages`.
   - Header price total appears as soon as this is answered (defaulting to the "with custom homepage" price for that tier, since that's the default in the pricing table above).
2. **"Want a custom-designed homepage?"** — single choice: `Yes` / `No (save £100)`.
   - **Skipped entirely** if step 1 answered `1 page` — that tier jumps straight to step 3.
3. **"Anything else you need?"** — multi-select: `Online shop`, `Booking system`, `New logo / branding`, or `None of these`.
4. **Result screen**:
   - Itemised price breakdown (base tier line, homepage adjustment line if applicable, one line per selected add-on, then a total).
   - Disclaimer text: *"This is an instant estimate. Your final price will be confirmed once we understand your project fully — no obligation."*
   - Contact form: name, email, phone (mirrors the fields already used in `EnquiryForm.astro` / the free-website-plan lead form).

Back button available at every step (steps 2–4), consistent with the existing quiz's `makeBackButton()` pattern. Going back preserves previously entered answers.

## Lead submission

- Submits via Web3Forms using the site's existing access key (`623d4393-90f3-4de8-b0c0-646e1d8ff1c3`), same as `EnquiryForm.astro` and `free-website-plan.astro`.
- On success, redirects to `/thank-you/`.
- On failure, shows an inline error message (same UX as the existing forms), no lead is lost silently.
- Email subject/body sent to Nathan includes: page tier selected, custom homepage y/n, each add-on selected, the total estimate, and the visitor's contact details — everything needed to follow up without re-deriving it from scratch.
- Honeypot field included (matching the `company` honeypot pattern in `free-website-plan.astro`) for basic spam protection.

## Page & site integration

- New page: **`src/pages/website-cost-calculator.astro`**, at the URL `/website-cost-calculator/`.
- Implemented as a self-contained Astro page with a vanilla JS state machine in an inline `<script>`, following the exact structural pattern of `free-website-plan.astro` (no new dependencies, no shared component extraction — this is the only calculator on the site).
- **Footer integration**: add a "Website Cost Calculator" link to the "Company" list in `Footer.astro`, styled the same as the existing highlighted "Free Website Plan" entry.
- **Not** added to the main nav or wired into other existing CTA buttons — Nathan will share the link directly for now.

## Out of scope (explicitly, for this iteration)

- SEO, hosting, maintenance, and email-setup pricing (calculator is website-build-only).
- Ex-VAT price display / VAT toggle.
- Wiring this into nav or other site CTAs.
- Editing/managing pricing via Keystatic CMS — prices are hardcoded in the page for now, consistent with how other one-off pricing (e.g. `web-design-offer.astro`) is currently handled in this codebase.
