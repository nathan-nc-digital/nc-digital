# Website Cost Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/website-cost-calculator/`, a step-wizard page where visitors answer a few questions about their website and see a live, running price total — ending in an itemised estimate and a lead-capture form.

**Architecture:** A single self-contained Astro page (`src/pages/website-cost-calculator.astro`) with an inline vanilla-JS state machine, following the exact structural pattern already used by `src/pages/free-website-plan.astro` (no new dependencies, no shared component extraction — this is the only calculator on the site). A hardcoded `PRICING` config drives a pure `computeBreakdown(answers)` function; the UI is a `render()` function that wipes and rebuilds a root `<div>` on every state change, matching the existing quiz's pattern exactly.

**Tech Stack:** Astro 5, vanilla JS (no framework), Web3Forms (existing site-wide access key), Playwright for e2e tests (existing `tests/*.spec.ts` convention, run against `npm run dev` on `http://localhost:4321`).

**Reference spec:** `docs/superpowers/specs/2026-07-22-website-cost-calculator-design.md`

**Note on scope:** the spec's Step 3 wording ("Online shop, Booking system, New logo/branding, or None of these") is implemented as three checkboxes with no explicit "None" option — leaving all three unchecked and clicking Continue is equivalent to choosing "none of these" and is always allowed. This is a deliberate simplification; flagging it here for visibility rather than silently deviating from the spec.

---

## Pricing reference (do not deviate from these numbers)

| Pages | With custom homepage | Without (−£100) |
|---|---|---|
| 1 page | £200 *(no homepage option)* | — |
| 5–10 pages | £599 | £499 |
| 11–20 pages | £699 | £599 |
| 20+ pages | £899 | £799 |

Add-ons: Online shop +£500 · Booking system +£300 · New logo/branding +£200. All prices inclusive of VAT, displayed as-is with an "inc. VAT" suffix.

---

### Task 1: Scaffold the page and the first question (page count)

**Files:**
- Create: `src/pages/website-cost-calculator.astro`
- Test: `tests/website-cost-calculator.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/website-cost-calculator.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('website cost calculator page loads', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByText('How many pages do you need?')).toBeVisible();
});

test('selecting a page tier shows the price total', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£599 inc. VAT');
});

test('selecting the 1-page tier shows £200', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£200 inc. VAT');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/website-cost-calculator.spec.ts`
Expected: FAIL — page doesn't exist yet (404 / `h1` not found).

- [ ] **Step 3: Create the page**

Create `src/pages/website-cost-calculator.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout
  title="Website Cost Calculator | NC Digital"
  description="Get an instant website price estimate for your South Wales business. Answer a few quick questions and see your price update live."
>

  <section style="padding:4rem 0 6rem;">
    <div class="container site-pad" style="max-width:900px;">
      <p data-animate="fade-up" class="eyebrow" style="margin-bottom:0.75rem; text-align:center;">Instant estimate · No obligation</p>
      <h1 data-animate="fade-up" style="margin-bottom:1.25rem; text-align:center;">What would your website cost?</h1>
      <div id="qcc-root">
        <noscript>Please enable JavaScript to use this calculator.</noscript>
      </div>
    </div>
  </section>

  <style is:global>
    .qcc-shell {
      max-width: 640px;
      margin: 0 auto;
      background: var(--purple);
      border: none;
      border-radius: 12px;
      padding: 2.5rem;
    }

    .qcc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.75rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid rgba(255,255,255,0.2);
      flex-wrap: wrap;
    }
    .qcc-intro { color: rgba(255,255,255,0.75); font-size: 0.875rem; line-height: 1.6; margin: 0; max-width: 360px; }
    .qcc-total-badge {
      font-size: 1.375rem; font-weight: 800; color: #fff;
      background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3);
      border-radius: 8px; padding: 0.5rem 1rem; white-space: nowrap;
    }

    .qcc-card { margin: 0; padding: 0; background: none; border: none; border-radius: 0; }
    .qcc-card h3 { margin: 0 0 1rem; font-size: 0.875rem; font-weight: 600; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 0.05em; }

    .qcc-question-form { display: flex; flex-direction: column; gap: 0.5rem; }
    .qcc-option {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.75rem 1rem; border: 1px solid rgba(255,255,255,0.25); border-radius: 6px;
      background: rgba(255,255,255,0.12); cursor: pointer; color: #fff; font-size: 0.9375rem;
      transition: border-color 0.15s, background 0.15s;
    }
    .qcc-option:hover { border-color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.2); }
    .qcc-option input { accent-color: #fff; flex-shrink: 0; }

    @media (max-width: 640px) {
      .qcc-shell { padding: 1.5rem; }
      .qcc-header { flex-direction: column; align-items: flex-start; }
    }
  </style>

  <script>
    (function () {
      const PRICING = {
        tiers: [
          { key: '1',     label: '1 page',      base: 200, homepageOptional: false },
          { key: '5-10',  label: '5–10 pages',  base: 599, withoutHomepage: 499, homepageOptional: true },
          { key: '11-20', label: '11–20 pages', base: 699, withoutHomepage: 599, homepageOptional: true },
          { key: '20+',   label: '20+ pages',   base: 899, withoutHomepage: 799, homepageOptional: true },
        ],
        addons: [
          { key: 'shop',    label: 'Online shop',        price: 500 },
          { key: 'booking', label: 'Booking system',      price: 300 },
          { key: 'logo',    label: 'New logo / branding', price: 200 },
        ],
      };

      function getTier(key) {
        return PRICING.tiers.find(function (t) { return t.key === key; });
      }

      function computeBreakdown(answers) {
        const lines = [];
        let total = 0;
        if (!answers.pages) return { lines: lines, total: 0 };
        const tier = getTier(answers.pages);
        if (tier.homepageOptional && answers.homepage === 'no') {
          lines.push({ label: tier.label + ' (no custom homepage)', price: tier.withoutHomepage });
          total += tier.withoutHomepage;
        } else {
          lines.push({ label: tier.label, price: tier.base });
          total += tier.base;
        }
        answers.addons.forEach(function (key) {
          const addon = PRICING.addons.find(function (a) { return a.key === key; });
          lines.push({ label: addon.label, price: addon.price });
          total += addon.price;
        });
        return { lines: lines, total: total };
      }

      function stepsForAnswers(answers) {
        if (!answers.pages) return ['pages'];
        return ['pages'];
      }

      const root = document.getElementById('qcc-root');
      if (!root) return;

      const state = {
        stepIndex: 0,
        answers: { pages: null, homepage: null, addons: [] },
      };

      render();

      function render() {
        root.innerHTML = '';
        const shell = document.createElement('div');
        shell.className = 'qcc-shell';

        shell.appendChild(renderHeader());

        const steps = stepsForAnswers(state.answers);
        const stepKey = steps[state.stepIndex];
        shell.appendChild(renderStep(stepKey));

        root.appendChild(shell);
      }

      function renderHeader() {
        const header = document.createElement('div');
        header.className = 'qcc-header';
        const title = document.createElement('p');
        title.className = 'qcc-intro';
        title.textContent = 'Answer a few quick questions to get an instant website estimate.';
        header.appendChild(title);

        if (state.answers.pages) {
          const badge = document.createElement('div');
          badge.className = 'qcc-total-badge';
          badge.id = 'qcc-total-value';
          badge.textContent = '£' + computeBreakdown(state.answers).total + ' inc. VAT';
          header.appendChild(badge);
        }
        return header;
      }

      function renderStep(stepKey) {
        return renderPagesStep();
      }

      function renderPagesStep() {
        const card = document.createElement('section');
        card.className = 'qcc-card';
        const title = document.createElement('h3');
        title.textContent = 'How many pages do you need?';
        card.appendChild(title);

        const form = document.createElement('div');
        form.className = 'qcc-question-form';
        PRICING.tiers.forEach(function (tier) {
          const label = document.createElement('label');
          label.className = 'qcc-option';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = 'pages';
          input.value = tier.key;
          input.checked = state.answers.pages === tier.key;
          input.addEventListener('change', function () {
            state.answers.pages = tier.key;
            state.answers.homepage = null;
            state.stepIndex += 1;
            render();
          });
          const text = document.createElement('span');
          text.textContent = tier.label + ' — from £' + tier.base;
          label.appendChild(input);
          label.appendChild(text);
          form.appendChild(label);
        });
        card.appendChild(form);
        return card;
      }
    })();
  </script>

</BaseLayout>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test tests/website-cost-calculator.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pages/website-cost-calculator.astro tests/website-cost-calculator.spec.ts
git commit -m "feat: scaffold website cost calculator with page-count step"
```

---

### Task 2: Full wizard flow — custom homepage, add-ons, result breakdown, back navigation

This task expands the state machine to the complete branching flow: `pages` → (`homepage` unless 1-page) → `addons` → `result`, with a Back button from step 2 onward and the header total updating live throughout.

**Files:**
- Modify: `src/pages/website-cost-calculator.astro`
- Test: `tests/website-cost-calculator.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/website-cost-calculator.spec.ts`:

```ts
test('choosing no custom homepage reduces the total', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();
  await expect(page.getByText('Want a custom-designed homepage?')).toBeVisible();
  await page.getByText('No thanks — save £100').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£499 inc. VAT');
});

test('1-page tier skips the homepage question and goes straight to add-ons', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await expect(page.getByText('Anything else you need?')).toBeVisible();
});

test('selecting add-ons increases the total, and unchecking removes it', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByText('Online shop (+£500)').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£700 inc. VAT');
  await page.getByText('Online shop (+£500)').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£200 inc. VAT');
});

test('continuing from add-ons with nothing selected shows the result screen', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Your estimate')).toBeVisible();
});

test('result screen shows an itemised breakdown and total', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();
  await page.getByText('No thanks — save £100').click();
  await page.getByText('Booking system (+£300)').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const homepageLine = page.locator('.qcc-breakdown li', { hasText: '5–10 pages (no custom homepage)' });
  await expect(homepageLine).toContainText('£499');

  const bookingLine = page.locator('.qcc-breakdown li', { hasText: 'Booking system' });
  await expect(bookingLine).toContainText('£300');

  const totalLine = page.locator('.qcc-breakdown-total');
  await expect(totalLine).toContainText('£799 inc. VAT');
});

test('back button returns to the previous step with the answer preserved', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();
  await page.getByText('No thanks — save £100').click();
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByText('Want a custom-designed homepage?')).toBeVisible();
  await expect(page.getByLabel('No thanks — save £100')).toBeChecked();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/website-cost-calculator.spec.ts`
Expected: FAIL — homepage/add-ons/result steps don't exist yet (`renderStep` only ever returns the pages step).

- [ ] **Step 3: Replace `stepsForAnswers` and `renderStep`**

In `src/pages/website-cost-calculator.astro`, replace:

```js
      function stepsForAnswers(answers) {
        if (!answers.pages) return ['pages'];
        return ['pages'];
      }
```

with:

```js
      function stepsForAnswers(answers) {
        if (!answers.pages) return ['pages'];
        return answers.pages === '1' ? ['pages', 'addons', 'result'] : ['pages', 'homepage', 'addons', 'result'];
      }
```

Replace:

```js
      function renderStep(stepKey) {
        return renderPagesStep();
      }
```

with:

```js
      function renderStep(stepKey) {
        if (stepKey === 'pages') return renderPagesStep();
        if (stepKey === 'homepage') return renderHomepageStep();
        if (stepKey === 'addons') return renderAddonsStep();
        return renderResultStep();
      }
```

- [ ] **Step 4: Add `renderHomepageStep`, `renderAddonsStep`, `renderResultStep`, and `makeBackButton`**

Immediately after the closing `}` of `renderPagesStep()` (still inside the top-level IIFE, before the final `})();`), add:

```js
      function renderHomepageStep() {
        const card = document.createElement('section');
        card.className = 'qcc-card';
        const title = document.createElement('h3');
        title.textContent = 'Want a custom-designed homepage?';
        card.appendChild(title);

        const form = document.createElement('div');
        form.className = 'qcc-question-form';
        const options = [
          { value: 'yes', label: 'Yes — include a custom homepage design' },
          { value: 'no',  label: 'No thanks — save £100' },
        ];
        options.forEach(function (opt) {
          const label = document.createElement('label');
          label.className = 'qcc-option';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = 'homepage';
          input.value = opt.value;
          input.checked = state.answers.homepage === opt.value;
          input.addEventListener('change', function () {
            state.answers.homepage = opt.value;
            state.stepIndex += 1;
            render();
          });
          const text = document.createElement('span');
          text.textContent = opt.label;
          label.appendChild(input);
          label.appendChild(text);
          form.appendChild(label);
        });
        card.appendChild(form);

        const actions = document.createElement('div');
        actions.className = 'qcc-actions';
        actions.appendChild(makeBackButton());
        card.appendChild(actions);
        return card;
      }

      function renderAddonsStep() {
        const card = document.createElement('section');
        card.className = 'qcc-card';
        const title = document.createElement('h3');
        title.textContent = 'Anything else you need?';
        card.appendChild(title);

        const form = document.createElement('div');
        form.className = 'qcc-question-form';
        PRICING.addons.forEach(function (addon) {
          const label = document.createElement('label');
          label.className = 'qcc-option';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.name = 'addons';
          input.value = addon.key;
          input.checked = state.answers.addons.includes(addon.key);
          input.addEventListener('change', function () {
            if (input.checked) {
              state.answers.addons.push(addon.key);
            } else {
              state.answers.addons = state.answers.addons.filter(function (k) { return k !== addon.key; });
            }
            render();
          });
          const text = document.createElement('span');
          text.textContent = addon.label + ' (+£' + addon.price + ')';
          label.appendChild(input);
          label.appendChild(text);
          form.appendChild(label);
        });
        card.appendChild(form);

        const actions = document.createElement('div');
        actions.className = 'qcc-actions';
        actions.appendChild(makeBackButton());
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'qcc-button';
        next.textContent = 'Continue';
        next.addEventListener('click', function () {
          state.stepIndex += 1;
          render();
        });
        actions.appendChild(next);
        card.appendChild(actions);
        return card;
      }

      function renderResultStep() {
        const card = document.createElement('section');
        card.className = 'qcc-card';

        const breakdown = computeBreakdown(state.answers);

        const title = document.createElement('h3');
        title.textContent = 'Your estimate';
        card.appendChild(title);

        const list = document.createElement('ul');
        list.className = 'qcc-breakdown';
        breakdown.lines.forEach(function (line) {
          const li = document.createElement('li');
          const label = document.createElement('span');
          label.textContent = line.label;
          const price = document.createElement('span');
          price.textContent = '£' + line.price;
          li.appendChild(label);
          li.appendChild(price);
          list.appendChild(li);
        });
        const totalLi = document.createElement('li');
        totalLi.className = 'qcc-breakdown-total';
        const totalLabel = document.createElement('span');
        totalLabel.textContent = 'Total';
        const totalPrice = document.createElement('span');
        totalPrice.textContent = '£' + breakdown.total + ' inc. VAT';
        totalLi.appendChild(totalLabel);
        totalLi.appendChild(totalPrice);
        list.appendChild(totalLi);
        card.appendChild(list);

        const disclaimer = document.createElement('p');
        disclaimer.className = 'qcc-disclaimer';
        disclaimer.textContent = 'This is an instant estimate. Your final price will be confirmed once we understand your project fully — no obligation.';
        card.appendChild(disclaimer);

        const actions = document.createElement('div');
        actions.className = 'qcc-actions';
        actions.appendChild(makeBackButton());
        card.appendChild(actions);

        return card;
      }

      function makeBackButton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qcc-button qcc-button-secondary';
        btn.textContent = '← Back';
        btn.addEventListener('click', function () {
          state.stepIndex = Math.max(0, state.stepIndex - 1);
          render();
        });
        return btn;
      }
```

- [ ] **Step 5: Add the missing CSS**

In the `<style is:global>` block, immediately before the closing `@media (max-width: 640px) {` block, add:

```css
    .qcc-actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.2); }
    .qcc-button {
      appearance: none; border: none; border-radius: 6px; padding: 0.75rem 1.5rem;
      background: #fff; color: var(--purple); font: inherit; font-size: 0.9375rem; font-weight: 700;
      cursor: pointer; transition: opacity 0.2s, transform 0.1s;
    }
    .qcc-button:hover { opacity: 0.92; transform: translateY(-1px); }
    .qcc-button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .qcc-button-secondary { background: transparent; color: rgba(255,255,255,0.8); border: 1px solid rgba(255,255,255,0.35); }
    .qcc-button-secondary:hover { color: #fff; border-color: rgba(255,255,255,0.7); background: transparent; transform: none; }

    .qcc-breakdown { list-style: none; margin: 0 0 1.25rem; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .qcc-breakdown li { display: flex; justify-content: space-between; gap: 1rem; color: rgba(255,255,255,0.85); font-size: 0.9375rem; padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.15); }
    .qcc-breakdown-total { color: #fff !important; font-weight: 800; font-size: 1.0625rem; border-bottom: none !important; }

    .qcc-disclaimer { color: rgba(255,255,255,0.65); font-size: 0.8125rem; line-height: 1.6; margin: 0 0 1.5rem; }
```

Also update the mobile media query to stack actions:

```css
    @media (max-width: 640px) {
      .qcc-shell { padding: 1.5rem; }
      .qcc-header { flex-direction: column; align-items: flex-start; }
      .qcc-actions { flex-direction: column; }
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx playwright test tests/website-cost-calculator.spec.ts`
Expected: PASS (all tests from Task 1 and Task 2)

- [ ] **Step 7: Commit**

```bash
git add src/pages/website-cost-calculator.astro tests/website-cost-calculator.spec.ts
git commit -m "feat: add homepage, add-ons and result steps to cost calculator"
```

---

### Task 3: Lead capture form and Web3Forms submission

**Files:**
- Modify: `src/pages/website-cost-calculator.astro`
- Test: `tests/website-cost-calculator.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/website-cost-calculator.spec.ts`:

```ts
test('result screen has a lead capture form', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('form.qcc-lead-form')).toBeVisible();
  await expect(page.getByLabel('Name')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('submitting the lead form redirects to the thank-you page', async ({ page }) => {
  await page.route('https://api.web3forms.com/submit', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Name').fill('Test User');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByRole('button', { name: 'Send me this quote' }).click();
  await expect(page).toHaveURL(/\/thank-you\/?$/);
});

test('shows an inline error if submission fails', async ({ page }) => {
  await page.route('https://api.web3forms.com/submit', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Bad request' }) });
  });
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Name').fill('Test User');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByRole('button', { name: 'Send me this quote' }).click();
  await expect(page.locator('.qcc-error')).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/website-cost-calculator.spec.ts`
Expected: FAIL — no lead form exists on the result screen yet.

- [ ] **Step 3: Add the lead form and submission logic**

In `renderResultStep()`, replace:

```js
        const disclaimer = document.createElement('p');
        disclaimer.className = 'qcc-disclaimer';
        disclaimer.textContent = 'This is an instant estimate. Your final price will be confirmed once we understand your project fully — no obligation.';
        card.appendChild(disclaimer);

        const actions = document.createElement('div');
        actions.className = 'qcc-actions';
        actions.appendChild(makeBackButton());
        card.appendChild(actions);

        return card;
      }
```

with:

```js
        const disclaimer = document.createElement('p');
        disclaimer.className = 'qcc-disclaimer';
        disclaimer.textContent = 'This is an instant estimate. Your final price will be confirmed once we understand your project fully — no obligation.';
        card.appendChild(disclaimer);

        card.appendChild(renderLeadForm(breakdown));

        const actions = document.createElement('div');
        actions.className = 'qcc-actions';
        actions.style.marginTop = '12px';
        actions.appendChild(makeBackButton());
        card.appendChild(actions);

        return card;
      }

      function renderLeadForm(breakdown) {
        const form = document.createElement('form');
        form.className = 'qcc-lead-form';
        form.addEventListener('submit', function (e) { submitLead(e, breakdown); });

        const fields = [
          { id: 'name',  label: 'Name',  type: 'text',  required: true },
          { id: 'email', label: 'Email', type: 'email', required: true },
          { id: 'phone', label: 'Phone number', type: 'tel', required: false },
        ];
        fields.forEach(function (field) {
          const wrap = document.createElement('label');
          wrap.className = 'qcc-field';
          const lbl = document.createElement('span');
          lbl.textContent = field.label;
          const input = document.createElement('input');
          input.type = field.type;
          input.name = field.id;
          input.required = field.required;
          input.value = state.lead[field.id];
          input.addEventListener('input', function (e) { state.lead[field.id] = e.target.value; });
          wrap.appendChild(lbl);
          wrap.appendChild(input);
          form.appendChild(wrap);
        });

        const honeypot = document.createElement('label');
        honeypot.className = 'qcc-field qcc-honeypot';
        const hpInput = document.createElement('input');
        hpInput.type = 'text';
        hpInput.name = 'company';
        hpInput.tabIndex = -1;
        hpInput.autocomplete = 'off';
        hpInput.setAttribute('aria-hidden', 'true');
        hpInput.addEventListener('input', function (e) { state.lead.company = e.target.value; });
        honeypot.appendChild(hpInput);
        form.appendChild(honeypot);

        const btn = document.createElement('button');
        btn.type = 'submit';
        btn.className = 'qcc-button';
        btn.disabled = state.isSubmitting;
        btn.textContent = state.isSubmitting ? 'Sending…' : 'Send me this quote';
        form.appendChild(btn);

        return form;
      }

      async function submitLead(event, breakdown) {
        event.preventDefault();
        if (state.lead.company) return; // honeypot
        if (!state.lead.name || !state.lead.email) {
          state.error = 'Please fill in your name and email.';
          render();
          return;
        }

        state.error = '';
        state.isSubmitting = true;
        render();

        const messageLines = breakdown.lines.map(function (line) {
          return line.label + ': £' + line.price;
        });
        const message = [
          'Total estimate: £' + breakdown.total + ' inc. VAT',
          '',
          '--- Breakdown ---',
          messageLines.join('\n'),
          '',
          state.lead.phone ? 'Phone: ' + state.lead.phone : '',
        ].filter(function (l) { return l !== undefined && l !== ''; }).join('\n');

        try {
          const formData = new FormData();
          formData.append('access_key', '623d4393-90f3-4de8-b0c0-646e1d8ff1c3');
          formData.append('subject', 'New Quote Calculator Lead — £' + breakdown.total + ' estimate');
          formData.append('name', state.lead.name);
          formData.append('email', state.lead.email);
          formData.append('message', message);
          formData.append('from_page', window.location.pathname);

          const res = await fetch('https://api.web3forms.com/submit', { method: 'POST', body: formData });
          const data = await res.json();

          if (!res.ok || !data.success) throw new Error(data.message || 'Submission failed.');

          window.location.href = '/thank-you/';
          return;
        } catch (err) {
          state.error = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
        } finally {
          state.isSubmitting = false;
          render();
        }
      }
```

- [ ] **Step 4: Add `lead`, `isSubmitting`, `error` to initial state**

Replace:

```js
      const state = {
        stepIndex: 0,
        answers: { pages: null, homepage: null, addons: [] },
      };
```

with:

```js
      const state = {
        stepIndex: 0,
        answers: { pages: null, homepage: null, addons: [] },
        lead: { name: '', email: '', phone: '', company: '' },
        isSubmitting: false,
        error: '',
      };
```

- [ ] **Step 5: Render the error message in `render()`**

Replace:

```js
        const steps = stepsForAnswers(state.answers);
        const stepKey = steps[state.stepIndex];
        shell.appendChild(renderStep(stepKey));

        root.appendChild(shell);
      }
```

with:

```js
        const steps = stepsForAnswers(state.answers);
        const stepKey = steps[state.stepIndex];
        shell.appendChild(renderStep(stepKey));

        if (state.error) {
          const err = document.createElement('p');
          err.className = 'qcc-error';
          err.textContent = state.error;
          shell.appendChild(err);
        }

        root.appendChild(shell);
      }
```

- [ ] **Step 6: Add the remaining CSS**

In the `<style is:global>` block, after `.qcc-disclaimer`, add:

```css
    .qcc-field { display: grid; gap: 0.375rem; margin-bottom: 1rem; }
    .qcc-field > span { font-size: 0.875rem; color: rgba(255,255,255,0.8); }
    .qcc-field input {
      width: 100%; padding: 0.75rem 1rem; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px;
      font: inherit; font-size: 0.9375rem; background: rgba(255,255,255,0.15); color: #fff;
      transition: border-color 0.2s, background 0.2s; box-sizing: border-box;
    }
    .qcc-field input:focus { outline: none; border-color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.2); }
    .qcc-field input::placeholder { color: rgba(255,255,255,0.5); }
    .qcc-honeypot { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

    .qcc-error { margin: 1rem 0 0; color: #fca5a5; font-size: 0.875rem; font-weight: 500; }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx playwright test tests/website-cost-calculator.spec.ts`
Expected: PASS (all tests from Tasks 1–3)

- [ ] **Step 8: Commit**

```bash
git add src/pages/website-cost-calculator.astro tests/website-cost-calculator.spec.ts
git commit -m "feat: add lead capture form and Web3Forms submission to cost calculator"
```

---

### Task 4: Footer integration

**Files:**
- Modify: `src/components/Footer.astro:198`
- Test: `tests/footer.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/footer.spec.ts`:

```ts
test('footer has website cost calculator link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer a[href="/website-cost-calculator/"]')).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/footer.spec.ts`
Expected: FAIL — link doesn't exist.

- [ ] **Step 3: Add the footer link**

In `src/components/Footer.astro`, replace:

```astro
            <li><a href="/free-website-plan/" style="color:var(--purple-light); font-size:0.875rem; font-weight:600;">Free Website Plan</a></li>
```

with:

```astro
            <li><a href="/free-website-plan/" style="color:var(--purple-light); font-size:0.875rem; font-weight:600;">Free Website Plan</a></li>
            <li><a href="/website-cost-calculator/" style="color:var(--purple-light); font-size:0.875rem; font-weight:600;">Website Cost Calculator</a></li>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/footer.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Footer.astro tests/footer.spec.ts
git commit -m "feat: link website cost calculator from footer"
```

---

### Task 5: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full Playwright suite**

Run: `npx playwright test`
Expected: PASS — every test in `tests/`, including all new `website-cost-calculator.spec.ts` and updated `footer.spec.ts` tests, plus every pre-existing test (nothing else should have broken).

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: Build completes with no errors, confirming the new page compiles cleanly for the Cloudflare Workers target.

- [ ] **Step 3: Manual smoke test**

Run `npm run dev`, open `http://localhost:4321/website-cost-calculator/` in a browser, and click through the full flow once for a 5–10 page tier with the custom homepage declined and one add-on selected — confirm the header total updates at every step and matches the pricing reference table above, and that the breakdown on the result screen is correct before submitting.

No commit for this task — it's verification only. If anything fails, fix it in a follow-up commit before considering the feature done.
