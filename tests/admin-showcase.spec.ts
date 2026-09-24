import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const services = ['facebook', 'instagram', 'linkedin', 'twitter', 'googlebusiness'];
const manifest = JSON.parse(await readFile('public/admin/showcase/priva-cy/social-draft.json', 'utf8'));
const key = (i: number) => `a6e7c3ab-8483-4f73-a5e6-${String(i).padStart(12, '0')}.jpg`;
async function mockPublisher(page: any, failSecond = false) {
  const uploads: Buffer[] = [];
  const sends: string[] = [];
  let failed = false;
  await page.route('**/admin/social/api/**', async (route: any) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status')) return route.fulfill({ json: { connected: true, storageReady: true, uploadsReady: true } });
    if (path.endsWith('/channels')) return route.fulfill({ json: { channels: services.map(service => ({ id: service, service, name: 'NC Digital' })) } });
    if (path.endsWith('/upload')) {
      uploads.push(route.request().postDataBuffer());
      if (failSecond && uploads.length === 2 && !failed) { failed = true; return route.fulfill({ status: 500, json: { error: 'Test upload failure' } }); }
      return route.fulfill({ json: { key: key(uploads.length) } });
    }
    if (route.request().method() === 'POST') sends.push(path);
    return route.fulfill({ json: { posts: [] } });
  });
  const preview = await readFile('public/admin/showcase/priva-cy/desktop-branded.png');
  await page.route('**/social-media/*.jpg', (route: any) => route.fulfill({ contentType: 'image/png', body: preview }));
  return { uploads, sends };
}

test('gallery switches sets and transfers images and all platform captions without publishing', async ({ page }) => {
  const { uploads, sends } = await mockPublisher(page);
  await page.goto('/admin/showcase/priva-cy/');
  await expect(page.locator('#gallery img')).toHaveCount(4);
  await expect(page.locator('#gallery img').first()).toHaveAttribute('src', 'desktop-branded.png');
  await page.getByRole('button', { name: 'Clean for portfolio' }).click();
  await expect(page.locator('#gallery img').first()).toHaveAttribute('src', 'desktop.png');
  await expect(page.locator('#download-set')).toHaveAttribute('href', 'priva-cy-mockups.zip');
  await page.getByRole('button', { name: 'Branded for socials' }).click();
  for (const service of services) {
    await page.locator('#platform').selectOption(service);
    await expect(page.locator('#caption-preview')).toHaveValue(service === 'googlebusiness' ? manifest.overrides[service] : `${manifest.overrides[service]}\n\n${manifest.link}`);
  }
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#download-set').click();
  expect((await downloadEvent).suggestedFilename()).toBe('priva-cy-social-branded.zip');
  await page.screenshot({ path: '.tmp/showcase-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/showcase-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Open in Social Posts' }).click();
  await expect(page.locator('#notice')).toContainText('Showcase imported', { timeout: 30000 });
  expect(uploads).toHaveLength(4);
  const metadata = await sharp(uploads[0]).metadata();
  expect(metadata.height! / metadata.width!).toBeCloseTo(1.25, 2);
  await expect(page.locator('#image-list img')).toHaveCount(4);
  await expect(page.locator('.preview')).toHaveCount(5);
  for (const service of services) {
    const text = service === 'googlebusiness' ? manifest.overrides[service] : `${manifest.overrides[service]}\n\n${manifest.link}`;
    expect(await page.locator('.preview-text').allTextContents()).toContain(text);
  }
  await expect(page.locator('#publish')).toBeDisabled();
  expect(sends).toEqual([]);
  await page.screenshot({ path: '.tmp/showcase-composer-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.locator('#image-list img')).toHaveCount(4);
  expect(uploads).toHaveLength(4);
  expect(sends).toEqual([]);
});

test('cancel preserves the previous draft; failed import preserves it and retry reuses successful uploads', async ({ page }) => {
  const { uploads, sends } = await mockPublisher(page, true);
  await page.goto('/admin/social/');
  await expect(page.locator('#notice')).toContainText('Connected');
  await page.locator('#caption').fill('Existing work to keep');
  const dismissed = new Promise<void>(resolve => page.once('dialog', async dialog => { await dialog.dismiss(); resolve(); }));
  await page.goto('/admin/social/?showcase=priva-cy');
  await dismissed;
  await expect(page.locator('#caption')).toHaveValue('Existing work to keep');
  await expect(page.locator('#showcase-import')).toBeVisible();
  expect(uploads).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#showcase-import').click();
  await expect(page.locator('#notice')).toContainText('Test upload failure');
  await expect(page.locator('#caption')).toHaveValue('Existing work to keep');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nc-social-draft-v1')!).caption)).toBe('Existing work to keep');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#showcase-import').click();
  await expect(page.locator('#notice')).toContainText('Showcase imported');
  expect(uploads).toHaveLength(5);
  expect(sends).toEqual([]);
});

test('invalid showcase path is rejected before fetching images', async ({ page }) => {
  const { uploads } = await mockPublisher(page);
  await page.goto('/admin/social/?showcase=..%2Fsocial');
  await expect(page.locator('#notice')).toContainText('Invalid showcase link');
  expect(uploads).toHaveLength(0);
});

test('Milne has its own sections, downloads and captions, and imports the correct project', async ({ page }) => {
  const milne = JSON.parse(await readFile('public/admin/showcase/milne-industrial/social-draft.json', 'utf8'));
  const { uploads, sends } = await mockPublisher(page);
  await page.goto('/admin/showcase/milne-industrial/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Milne Industrial.');
  await expect(page.locator('#gallery h2')).toHaveText(milne.galleryLabels);
  await expect(page.locator('#download-set')).toHaveAttribute('href', 'milne-industrial-social-branded.zip');
  await expect(page.locator('#caption-preview')).toHaveValue(/Milne supplied the design/);
  await page.waitForFunction(() => [...document.querySelectorAll('#gallery img')].every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0));
  await page.screenshot({ path: '.tmp/milne-gallery-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Clean for portfolio' }).click();
  await expect(page.locator('#download-set')).toHaveAttribute('href', 'milne-industrial-mockups.zip');
  await expect(page.locator('#gallery a[download]').first()).toHaveAttribute('download', 'milne-industrial-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/milne-gallery-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Open in Social Posts' }).click();
  await expect(page.locator('#notice')).toContainText('Showcase imported', { timeout: 30000 });
  await expect(page.locator('#caption')).toHaveValue(milne.caption);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nc-social-draft-v1')!));
  expect(saved.overrides).toEqual(milne.overrides);
  expect(uploads).toHaveLength(4);
  expect(sends).toEqual([]);
  await expect(page.locator('#image-list img')).toHaveCount(4);
});
