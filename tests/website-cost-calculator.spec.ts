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
  await page.getByText('5–10 pages — from £599').click();
  await page.getByText('No thanks — save £100').click();
  await page.getByText('Online shop (+£500)').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£999 inc. VAT');
  await page.getByText('Online shop (+£500)').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£499 inc. VAT');
});

test('1-page tier does not offer the online shop add-on', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await expect(page.getByText('Online shop (+£500)')).toHaveCount(0);
  await expect(page.getByText('Booking system (+£300)')).toBeVisible();
  await expect(page.getByText('New logo / branding (+£200)')).toBeVisible();
});

test('online shop add-on is available for multi-page tiers', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();
  await page.getByText('No thanks — save £100').click();
  await expect(page.getByText('Online shop (+£500)')).toBeVisible();
});

test('switching from a multi-page tier down to 1 page clears a previously selected online shop add-on', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();
  await page.getByText('No thanks — save £100').click();
  await page.getByText('Online shop (+£500)').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£999 inc. VAT');

  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByText('1 page — from £200').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£200 inc. VAT');
  await expect(page.getByText('Online shop (+£500)')).toHaveCount(0);
});

test('continuing from add-ons goes to the hosting step, then to the result screen', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Do you need hosting & domain too?')).toBeVisible();
  await page.getByText("No thanks — I'll sort my own hosting & domain").click();
  await expect(page.getByText('Your estimate')).toBeVisible();
});

test('result screen shows the deposit and hosting payment terms', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText("No thanks — I'll sort my own hosting & domain").click();
  await expect(page.getByText('50% deposit to start the website build')).toBeVisible();
  await expect(page.getByText('Hosting & domain (if selected) is paid before going live too.')).toBeVisible();
});

test('result screen shows an itemised breakdown and total, with no hosting section when hosting is declined', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();
  await page.getByText('No thanks — save £100').click();
  await page.getByText('Booking system (+£300)').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText("No thanks — I'll sort my own hosting & domain").click();

  const homepageLine = page.locator('.qcc-breakdown li', { hasText: '5–10 pages (no custom homepage)' });
  await expect(homepageLine).toContainText('£499');

  const bookingLine = page.locator('.qcc-breakdown li', { hasText: 'Booking system' });
  await expect(bookingLine).toContainText('£300');

  await expect(page.locator('.qcc-breakdown-total')).toHaveCount(1);
  const totalLine = page.locator('.qcc-breakdown-total');
  await expect(totalLine).toContainText('£799 inc. VAT');
  await expect(page.locator('.qcc-hosting-block')).toHaveCount(0);
});

test('selecting annual hosting shows a separate hosting total, without changing the website build total', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£200 inc. VAT');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Annual hosting & domain — £240/year').click();

  // Website build total is unaffected by hosting.
  const buildTotal = page.locator('.qcc-breakdown-total').first();
  await expect(buildTotal).toContainText('£200 inc. VAT');

  // Hosting is shown as its own separate section/total.
  await expect(page.locator('.qcc-hosting-block .qcc-subheading')).toHaveText('Hosting & Domain');
  const hostingTotal = page.locator('.qcc-hosting-block .qcc-breakdown-total');
  await expect(hostingTotal).toContainText('£240/year inc. VAT');
});

test('selecting monthly hosting shows the correct separate monthly total', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Monthly hosting & domain — £25/month').click();

  const hostingTotal = page.locator('.qcc-hosting-block .qcc-breakdown-total');
  await expect(hostingTotal).toContainText('£25/month inc. VAT');
});

test('back button from the result screen returns to the hosting step with the answer preserved', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Annual hosting & domain — £240/year').click();
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByText('Do you need hosting & domain too?')).toBeVisible();
  await expect(page.getByLabel('Annual hosting & domain — £240/year')).toBeChecked();
});

test('back button returns to the previous step with the answer preserved', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();
  await page.getByText('No thanks — save £100').click();
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByText('Want a custom-designed homepage?')).toBeVisible();
  await expect(page.getByLabel('No thanks — save £100')).toBeChecked();
});

test('result screen has a lead capture form', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText("No thanks — I'll sort my own hosting & domain").click();
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
  await page.getByText("No thanks — I'll sort my own hosting & domain").click();
  await page.getByLabel('Name').fill('Test User');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByRole('button', { name: 'Send me this quote' }).click();
  await expect(page).toHaveURL(/\/thank-you\/?$/);
});

test('submitting with hosting selected includes it in the Web3Forms request', async ({ page }) => {
  let capturedBody = '';
  await page.route('https://api.web3forms.com/submit', async (route) => {
    capturedBody = route.request().postData() || '';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Annual hosting & domain — £240/year').click();
  await page.getByLabel('Name').fill('Test User');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByRole('button', { name: 'Send me this quote' }).click();
  await expect(page).toHaveURL(/\/thank-you\/?$/);

  expect(capturedBody).toContain('Annual hosting & domain');
  expect(capturedBody).toContain('£240/year');
});

test('shows an inline error if submission fails', async ({ page }) => {
  await page.route('https://api.web3forms.com/submit', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Bad request' }) });
  });
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText("No thanks — I'll sort my own hosting & domain").click();
  await page.getByLabel('Name').fill('Test User');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByRole('button', { name: 'Send me this quote' }).click();
  await expect(page.locator('.qcc-error')).toBeVisible();
});

test('error banner clears after navigating back from a failed submission', async ({ page }) => {
  await page.route('https://api.web3forms.com/submit', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Bad request' }) });
  });
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText("No thanks — I'll sort my own hosting & domain").click();
  await page.getByLabel('Name').fill('Test User');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByRole('button', { name: 'Send me this quote' }).click();
  await expect(page.locator('.qcc-error')).toBeVisible();

  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByText('Do you need hosting & domain too?')).toBeVisible();
  await expect(page.locator('.qcc-error')).toHaveCount(0);
});

test('selecting the 11–20 page tier shows £699, and no custom homepage reduces it to £599', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('11–20 pages — from £699').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£699 inc. VAT');

  await expect(page.getByText('Want a custom-designed homepage?')).toBeVisible();
  await page.getByText('No thanks — save £100').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£599 inc. VAT');
});

test('selecting the 20+ page tier shows £899, and no custom homepage reduces it to £799', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('20+ pages — from £899').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£899 inc. VAT');

  await expect(page.getByText('Want a custom-designed homepage?')).toBeVisible();
  await page.getByText('No thanks — save £100').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£799 inc. VAT');
});

test('selecting the logo/branding add-on increases the total by £200', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('1 page — from £200').click();
  await page.getByText('New logo / branding (+£200)').click();
  await expect(page.locator('#qcc-total-value')).toHaveText('£400 inc. VAT');

  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText("No thanks — I'll sort my own hosting & domain").click();
  const logoLine = page.locator('.qcc-breakdown li', { hasText: 'New logo / branding' });
  await expect(logoLine).toContainText('£200');

  const totalLine = page.locator('.qcc-breakdown-total');
  await expect(totalLine).toContainText('£400 inc. VAT');
});

test('homepage step info icon reveals an explanation on click and hides on outside click', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();

  const infoBtn = page.getByRole('button', { name: 'More information' });
  const tooltip = infoBtn.locator('.qcc-tooltip');
  await expect(tooltip).toBeHidden();

  await infoBtn.click();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('custom homepage is designed from scratch');

  await page.locator('.qcc-intro').click();
  await expect(tooltip).toBeHidden();
});

test('homepage step info icon reveals an explanation on hover', async ({ page }) => {
  await page.goto('/website-cost-calculator');
  await page.getByText('5–10 pages — from £599').click();

  const infoBtn = page.getByRole('button', { name: 'More information' });
  const tooltip = infoBtn.locator('.qcc-tooltip');
  await expect(tooltip).toBeHidden();

  await infoBtn.hover();
  await expect(tooltip).toBeVisible();
});
