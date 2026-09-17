import { test, expect } from '@playwright/test';
import sharp from 'sharp';

const services = ['facebook', 'linkedin', 'instagram', 'twitter', 'googlebusiness'];
const imageKey = 'a6e7c3ab-8483-4f73-a5e6-2b1862239f21.jpg';
test('compose, upload, customise, schedule and display confirmed results', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let payload: any;
  let sends = 0;
  let submitted: any = null;
  const testImage = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#9863ed' } }).png().toBuffer();
  await page.route('**/admin/social/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status')) return route.fulfill({ json: { connected: true, storageReady: true, uploadsReady: true } });
    if (path.endsWith('/channels')) return route.fulfill({ json: { channels: services.map(service => ({ id: service, name: 'NC Digital', service, provider: ['facebook', 'instagram'].includes(service) ? 'meta' : 'buffer' })) } });
    if (path.endsWith('/upload')) {
      expect(route.request().headers()['content-type']).toBe('image/jpeg');
      expect(route.request().postDataBuffer()!.length).toBeGreaterThan(100);
      return route.fulfill({ json: { key: imageKey, url: `/social-media/${imageKey}` } });
    }
    if (path.endsWith('/posts') && route.request().method() === 'GET') return route.fulfill({ json: { posts: submitted ? [submitted] : [] } });
    if (path.endsWith('/posts')) {
      payload = route.request().postDataJSON();
      submitted = { ...payload, createdAt: new Date().toISOString(), deliveries: services.map(service => ({ service, channel_id: service, channel_name: 'NC Digital', status: 'scheduled', remote_id: service, provider: ['facebook', 'instagram'].includes(service) ? 'meta' : 'buffer' })) };
      return route.fulfill({ json: { post: submitted } });
    }
    if (path.endsWith('/send')) { sends++; return route.fulfill({ json: { post: submitted } }); }
    if (path.endsWith('/refresh')) {
      submitted.deliveries.forEach((delivery: any) => { delivery.status = 'sent'; });
      return route.fulfill({ json: { post: submitted } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.route('**/social-media/*.jpg', route => route.fulfill({ contentType: 'image/png', body: testImage }));
  await page.goto('/admin/social/');
  await expect(page.getByText('Connected. Choose the accounts you want to publish to.')).toBeVisible();
  await page.getByLabel('Caption', { exact: true }).fill('Our latest website launch');
  await page.getByLabel('Website link', { exact: false }).fill('https://example.com');
  for (const label of ['Facebook', 'LinkedIn', 'Instagram', 'X', 'Google Business Profile']) await page.getByRole('checkbox', { name: `Publish to ${label}`, exact: true }).check();
  await page.locator('#images').setInputFiles({ name: 'launch.png', mimeType: 'image/png', buffer: testImage });
  await expect(page.locator('#image-list img')).toHaveCount(1);
  const xPreview = page.locator('.preview').filter({ has: page.locator('strong', { hasText: /^X$/ }) });
  await xPreview.locator('summary').click();
  await xPreview.getByLabel('X caption').fill('New site, now live.');
  await expect(xPreview.locator('.preview-text')).toContainText('New site, now live.');
  await page.getByRole('radio', { name: 'Schedule', exact: true }).check();
  await page.locator('#due-at').fill('2099-08-01T12:00');
  await page.screenshot({ path: '.tmp/social-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Schedule selected accounts' }).click();
  await expect(page.locator('#history .badge')).toHaveCount(5);
  expect(payload.overrides.twitter).toBe('New site, now live.');
  expect(payload.images).toEqual([imageKey]); expect(payload.channelIds).toHaveLength(5);
  expect(payload.mode).toBe('schedule'); expect(payload.dueAt).toMatch(/^2099-08-01T/); expect(sends).toBe(1);
  await expect(page.locator('#history .badge.sent')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel queued Facebook / Instagram' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Meta Business Suite' }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Check publishing status' }).click();
  await expect(page.locator('#history .badge.sent')).toHaveCount(5);
  expect(sends).toBe(1); expect(errors).toEqual([]);
});

test('unconnected setup keeps publishing disabled and preserves a draft on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/admin/social/api/status', route => route.fulfill({ json: { connected: false, storageReady: false, uploadsReady: false } }));
  await page.goto('/admin/social/');
  await expect(page.locator('#notice')).toContainText('Setup needed');
  await expect(page.locator('#publish')).toBeDisabled();
  await expect(page.locator('#images')).toBeDisabled();
  await page.locator('#caption').fill('Draft for our next launch');
  await page.reload();
  await expect(page.locator('#caption')).toHaveValue('Draft for our next launch');
  await expect(page.locator('.preview')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/social-mobile.png', fullPage: true });
});
