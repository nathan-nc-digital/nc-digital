import { test, expect } from '@playwright/test';

test('homepage has hero headline', async ({ page }) => {
  await page.goto('/');
  const h1 = page.locator('h1');
  await expect(h1).toBeVisible();
  const text = await h1.textContent();
  expect(text!.length).toBeGreaterThan(10);
});

test('homepage has primary CTA linking to free plan', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a[href="/free-website-plan"]').first()).toBeVisible();
});

test('homepage has link to portfolio', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a[href="/portfolio"]').first()).toBeVisible();
});

test('homepage has services section', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#services')).toBeVisible();
});

test('homepage has work section', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#work')).toBeVisible();
});
