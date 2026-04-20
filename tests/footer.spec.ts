import { test, expect } from '@playwright/test';

test('footer renders company name', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer')).toContainText('NC Digital');
});

test('footer has services link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer a[href="/services"]')).toBeVisible();
});

test('footer shows South Wales', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer')).toContainText('South Wales');
});
