import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const URL = 'https://electricianmerthyrtydfil.co.uk/';
const SLUG = 'electrician-merthyr-tydfil';
const PROJECT_NAME = 'Electrician Merthyr Tydfil';

const outputDir = path.resolve('src/assets/portfolio', PROJECT_NAME);
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch();

// 1. Homepage hero — header + hero only, no scroll
console.log('Capturing homepage hero...');
const heroCtx = await browser.newContext({ viewport: { width: 1440, height: 680 } });
const heroPage = await heroCtx.newPage();
await heroPage.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await heroPage.waitForTimeout(1500);
await heroPage.screenshot({ path: path.join(outputDir, `${SLUG}-homepage.jpeg`), fullPage: false, type: 'jpeg', quality: 90 });
await heroCtx.close();
console.log('  Done.');

// 2. Services page — scroll past hero, capture one viewport
console.log('Capturing services...');
const svcCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const svcPage = await svcCtx.newPage();
await svcPage.goto(URL + 'services/', { waitUntil: 'networkidle', timeout: 30000 });
await svcPage.waitForTimeout(1500);
await svcPage.evaluate(() => window.scrollTo(0, 400));
await svcPage.waitForTimeout(300);
await svcPage.screenshot({ path: path.join(outputDir, `${SLUG}-services.jpeg`), fullPage: false, type: 'jpeg', quality: 90 });
await svcCtx.close();
console.log('  Done.');

// 3. Contact page — viewport shot
console.log('Capturing contact...');
const ctxCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ctxPage = await ctxCtx.newPage();
await ctxPage.goto(URL + 'contact/', { waitUntil: 'networkidle', timeout: 30000 });
await ctxPage.waitForTimeout(1500);
await ctxPage.screenshot({ path: path.join(outputDir, `${SLUG}-contact.jpeg`), fullPage: false, type: 'jpeg', quality: 90 });
await ctxCtx.close();
console.log('  Done.');

// 4. Mobile — hero viewport only
console.log('Capturing mobile...');
const mobCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mobPage = await mobCtx.newPage();
await mobPage.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await mobPage.waitForTimeout(1500);
await mobPage.screenshot({ path: path.join(outputDir, `${SLUG}-mobile.jpeg`), fullPage: false, type: 'jpeg', quality: 90 });
await mobCtx.close();
console.log('  Done.');

// 5. Tablet — hero viewport only
console.log('Capturing tablet...');
const tabCtx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
const tabPage = await tabCtx.newPage();
await tabPage.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await tabPage.waitForTimeout(1500);
await tabPage.screenshot({ path: path.join(outputDir, `${SLUG}-tablet.jpeg`), fullPage: false, type: 'jpeg', quality: 90 });
await tabCtx.close();
console.log('  Done.');

// 6. Portfolio grid thumbnail (same as homepage hero)
console.log('Saving thumbnail...');
fs.copyFileSync(
  path.join(outputDir, `${SLUG}-homepage.jpeg`),
  path.resolve('src/assets/portfolio', `${SLUG}.jpeg`)
);
console.log('  Done.');

await browser.close();
console.log('\nAll screenshots saved.');
