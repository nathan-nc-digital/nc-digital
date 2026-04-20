import { test, expect } from '@playwright/test';

test('CSS variables are defined on :root', async ({ page }) => {
  await page.goto('/');
  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  );
  expect(bg).toBe('#0c1115');
});

test('body uses Sora font', async ({ page }) => {
  await page.goto('/');
  const font = await page.evaluate(() =>
    getComputedStyle(document.body).fontFamily
  );
  expect(font.toLowerCase()).toContain('sora');
});

test('page has meta description', async ({ page }) => {
  await page.goto('/');
  const desc = await page.locator('meta[name="description"]').getAttribute('content');
  expect(desc).toBeTruthy();
});

test('page has canonical link', async ({ page }) => {
  await page.goto('/');
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(canonical).toBeTruthy();
});
