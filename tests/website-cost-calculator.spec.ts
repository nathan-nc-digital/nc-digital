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
