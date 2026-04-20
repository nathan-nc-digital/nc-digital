import { test, expect } from '@playwright/test';

test('nav renders logo link', async ({ page }) => {
  await page.goto('/');
  const logo = page.locator('nav a[href="/"]');
  await expect(logo).toBeVisible();
  await expect(logo).toContainText('NC Digital');
});

test('nav has Services link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav a[href="/services"]')).toBeVisible();
});

test('nav has Work link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav a[href="/portfolio"]')).toBeVisible();
});

test('nav has Blog link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav a[href="/blog"]')).toBeVisible();
});

test('nav has Contact CTA', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav a[href="/contact"]')).toBeVisible();
});
