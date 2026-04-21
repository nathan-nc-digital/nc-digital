import { test, expect } from '@playwright/test';

test('about page loads', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('h1')).toBeVisible();
});

test('contact page loads', async ({ page }) => {
  await page.goto('/contact');
  await expect(page.locator('h1')).toBeVisible();
});

test('contact page has form', async ({ page }) => {
  await page.goto('/contact');
  await expect(page.locator('form')).toBeVisible();
});

test('free website plan page loads', async ({ page }) => {
  await page.goto('/free-website-plan');
  await expect(page.locator('h1')).toBeVisible();
});

test('privacy policy page loads', async ({ page }) => {
  await page.goto('/privacy-policy');
  await expect(page.locator('h1')).toBeVisible();
});
