import { test, expect } from '@playwright/test';

test('location page loads', async ({ page }) => {
  await page.goto('/web-design-cardiff');
  await expect(page.locator('h1')).toBeVisible();
});

test('location page has meta description', async ({ page }) => {
  await page.goto('/web-design-cardiff');
  const desc = await page.locator('meta[name="description"]').getAttribute('content');
  expect(desc).toBeTruthy();
});

test('location page has CTA', async ({ page }) => {
  await page.goto('/web-design-cardiff');
  await expect(page.locator('a[href="/free-website-plan"]').first()).toBeVisible();
});
