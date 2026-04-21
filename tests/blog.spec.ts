import { test, expect } from '@playwright/test';

test('blog listing loads at /blog', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.locator('h1')).toBeVisible();
});

test('blog listing shows at least one post', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.locator('a[href^="/blog/"]').first()).toBeVisible();
});

test('individual blog post loads', async ({ page }) => {
  await page.goto('/blog/why-your-business-needs-a-website');
  await expect(page.locator('h1')).toBeVisible();
});

test('blog post has meta description', async ({ page }) => {
  await page.goto('/blog/why-your-business-needs-a-website');
  const desc = await page.locator('meta[name="description"]').getAttribute('content');
  expect(desc).toBeTruthy();
});
