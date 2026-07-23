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
