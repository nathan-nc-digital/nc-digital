import { test, expect } from '@playwright/test';

test('portfolio listing page loads', async ({ page }) => {
  await page.goto('/portfolio');
  await expect(page.locator('h1')).toBeVisible();
});

test('portfolio listing shows case studies', async ({ page }) => {
  await page.goto('/portfolio');
  await expect(page.locator('a[href="/portfolio/ds-carpentry"]').first()).toBeVisible();
});

test('individual portfolio page loads', async ({ page }) => {
  await page.goto('/portfolio/ds-carpentry');
  await expect(page.locator('h1')).toBeVisible();
});
