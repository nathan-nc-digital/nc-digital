import { test, expect } from '@playwright/test';
import { buildReport, mapKeyword } from '../src/lib/keyword-planner.js';
const id = '11111111-1111-4111-8111-111111111111';
const input = { query: 'plumber merthyr tydfil', service: 'plumber', town: 'merthyr tydfil', location: { name: 'Merthyr Tydfil,Merthyr Tydfil,Wales,United Kingdom', code: 1007443 }, extra: [], website: 'client.example', refresh: false };
const report = buildReport(input, [mapKeyword({ keyword: input.query, keyword_info: { search_volume: 260, cpc: 4.93, monthly_searches: [{ year: 2026, month: 6, search_volume: 210 }, { year: 2026, month: 7, search_volume: 260 }] }, keyword_properties: { keyword_difficulty: 0 } }), mapKeyword({ keyword: 'emergency plumber merthyr tydfil' }), mapKeyword({ keyword: 'plumber', keyword_info: { search_volume: 100000 } })], { items: [{ type: 'organic', title: '<img src=x onerror=alert(1)>Plumbing company', rank_group: 1, domain: 'plumber.example', url: 'javascript:alert(1)' }, { type: 'people_also_ask', items: [{ title: 'How much does a plumber cost?' }] }] }, [], .04, 4);
for (const width of [1440, 390]) {
  test(`research, filters, page plan, export and saved report at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); let paid = 0; const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/admin/keyword-research/api/**', async route => {
      const path = new URL(route.request().url()).pathname.split('/').pop();
      if (path === 'research') { paid++; expect(route.request().postDataJSON().query).toBe('Plumber Merthyr Tydfil'); return route.fulfill({ json: { id, report, cached: false } }); }
      if (path === 'status') return route.fulfill({ json: { connected: true, storageReady: true } });
      if (path === 'history') return route.fulfill({ json: { reports: [{ id, query: input.query, created_at: report.fetchedAt, status: 'complete' }] } });
      if (path === 'report') return route.fulfill({ json: { id, report, status: 'complete' } });
      return route.fulfill({ json: { locations: [] } });
    });
    await page.goto('/admin/keyword-research/'); await expect(page.getByText('DataForSEO connected')).toBeVisible();
    await page.getByRole('button', { name: 'Try: Plumber Merthyr Tydfil' }).click(); await page.getByRole('button', { name: 'Research keywords' }).click();
    await expect(page.locator('#report-title')).toHaveText('Plumber Merthyr Tydfil'); await expect(page.locator('#keyword-rows tr')).toHaveCount(3);
    await expect(page.locator('#trend')).toContainText('2026-06 to 2026-07');
    await page.locator('#scope').selectOption('local'); await expect(page.locator('#keyword-rows tr')).toHaveCount(2);
    await page.locator('#filter').fill('emergency'); await expect(page.locator('#keyword-rows tr')).toHaveCount(1); await expect(page.locator('#keyword-rows')).toContainText('Validate with client');
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export keywords' }).click(); const download = await downloadPromise; expect(download.suggestedFilename()).toMatch(/keywords.csv$/);
    const content = await (await download.createReadStream())!.toArray(); expect(Buffer.concat(content).toString()).toContain('emergency plumber merthyr tydfil');
    await page.getByRole('tab', { name: 'Website plan' }).click(); await expect(page.locator('#page-plan')).toContainText('Draft SEO title'); await expect(page.locator('#page-plan')).not.toContainText('100,000');
    await page.getByRole('tab', { name: 'Local competitors' }).click(); await expect(page.locator('#competitors img')).toHaveCount(0); await expect(page.locator('#competitors a')).toHaveAttribute('href', '#');
    await page.getByRole('tab', { name: 'Questions & content' }).click(); await expect(page.locator('#questions')).toContainText('how much does a plumber cost?');
    await page.locator('#saved').selectOption(id); await page.getByRole('button', { name: 'Open report' }).click(); await expect(page.locator('#notice')).toContainText('No new API lookup'); expect(paid).toBe(1);
    await page.getByRole('tab', { name: 'Keywords', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
    await page.screenshot({ path: `.tmp/keyword-ui-${width}.png`, fullPage: true });
  });
}
test('failed lookup leaves an actionable error and restores the form', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: route.request().method() === 'POST' ? 502 : 200, json: route.request().method() === 'POST' ? { error: 'DataForSEO needs account credit.' } : { connected: true, storageReady: true, reports: [] } }));
  await page.goto('/admin/keyword-research/'); await page.locator('#query').fill('Plumber Merthyr Tydfil'); await page.getByRole('button', { name: 'Research keywords' }).click(); await expect(page.locator('#notice')).toContainText('needs account credit'); await expect(page.getByRole('button', { name: 'Research keywords' })).toBeEnabled(); await expect(page.locator('#report')).toBeHidden();
});
