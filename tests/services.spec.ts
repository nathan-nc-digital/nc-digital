import { test, expect } from '@playwright/test';

test('services listing page loads', async ({ page }) => {
  await page.goto('/services');
  await expect(page.locator('h1')).toBeVisible();
});

test('services listing links to individual service', async ({ page }) => {
  await page.goto('/services');
  await expect(page.locator('a[href="/services/web-development"]').first()).toBeVisible();
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
