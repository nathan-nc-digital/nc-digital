import { test, expect } from '@playwright/test';

const NATHAN_JOBS = [
  { id: 1, client_name: 'Smith Plumbing', notes: 'New site', status: 'not_started', eta: null, assigned_to: 'ben' },
  { id: 2, client_name: 'Davies Electrical', notes: '', status: 'doing', eta: '2026-08-01', assigned_to: 'nathan' },
  { id: 3, client_name: 'Evans Landscaping', notes: '', status: 'done', eta: null, assigned_to: 'ben' },
];

const BEN_JOBS = [
  { id: 1, client_name: 'Smith Plumbing', notes: 'New site', status: 'not_started', eta: null, assigned_to: 'ben' },
];

async function mockWhoamiAndList(page, role, jobs) {
  await page.route('/admin/jobs/api/whoami', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role }) }));
  await page.route('/admin/jobs/api/list', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs }) }));
}

test('nathan sees the Add job button and every job, including assignee tags', async ({ page }) => {
  await mockWhoamiAndList(page, 'nathan', NATHAN_JOBS);
  await page.goto('/admin/jobs');
  await expect(page.getByRole('button', { name: '+ Add job' })).toBeVisible();
  await expect(page.getByText('Smith Plumbing')).toBeVisible();
  await expect(page.getByText('Davies Electrical')).toBeVisible();
  await expect(page.getByText('Evans Landscaping')).toBeVisible();
  await expect(page.locator('.jb-card-assignee').first()).toBeVisible();
});

test('ben does not see the Add job button, assignee tags, or delete, and only sees his own jobs', async ({ page }) => {
  await mockWhoamiAndList(page, 'ben', BEN_JOBS);
  await page.goto('/admin/jobs');
  await expect(page.getByRole('button', { name: '+ Add job' })).toHaveCount(0);
  await expect(page.getByText('Smith Plumbing')).toBeVisible();
  await expect(page.locator('.jb-card-assignee')).toHaveCount(0);
  await expect(page.locator('.jb-card-delete')).toHaveCount(0);
});

test('clicking Start moves a not-started job to Doing', async ({ page }) => {
  await mockWhoamiAndList(page, 'ben', BEN_JOBS);

  let updateBody = null;
  await page.route('/admin/jobs/api/update', async route => {
    updateBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/admin/jobs');
  await expect(page.locator('#col-not_started .jb-card')).toHaveCount(1);

  await page.route('/admin/jobs/api/list', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jobs: [{ ...BEN_JOBS[0], status: 'doing' }] }),
  }));

  await page.getByRole('button', { name: 'Start' }).click();
  expect(updateBody).toEqual({ id: 1, status: 'doing' });
  await expect(page.locator('#col-doing .jb-card')).toHaveCount(1);
  await expect(page.locator('#col-not_started .jb-card')).toHaveCount(0);
});

test('clicking Mark done moves a doing job to Done', async ({ page }) => {
  const doingJob = [{ id: 2, client_name: 'Davies Electrical', notes: '', status: 'doing', eta: null, assigned_to: 'nathan' }];
  await mockWhoamiAndList(page, 'nathan', doingJob);

  let updateBody = null;
  await page.route('/admin/jobs/api/update', async route => {
    updateBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/admin/jobs');
  await page.route('/admin/jobs/api/list', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jobs: [{ ...doingJob[0], status: 'done' }] }),
  }));

  await page.getByRole('button', { name: 'Mark done' }).click();
  expect(updateBody).toEqual({ id: 2, status: 'done' });
  await expect(page.locator('#col-done .jb-card')).toHaveCount(1);
});

test('a done job has no Start/Mark done button', async ({ page }) => {
  const doneJob = [{ id: 3, client_name: 'Evans Landscaping', notes: '', status: 'done', eta: null, assigned_to: 'ben' }];
  await mockWhoamiAndList(page, 'ben', doneJob);
  await page.goto('/admin/jobs');
  await expect(page.locator('#col-done .jb-card-btn')).toHaveCount(0);
});

test('nathan can open the add-job modal and submit a new job', async ({ page }) => {
  await mockWhoamiAndList(page, 'nathan', []);

  let createBody = null;
  await page.route('/admin/jobs/api/create', async route => {
    createBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/admin/jobs');
  await expect(page.locator('#col-not_started .jb-empty')).toBeVisible();

  await page.getByRole('button', { name: '+ Add job' }).click();
  await page.locator('#addClientName').fill('Jones Roofing');
  await page.locator('#addNotes').fill('Rebuild homepage');
  await page.locator('#addAssignedTo').selectOption('ben');

  await page.route('/admin/jobs/api/list', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jobs: [{ id: 4, client_name: 'Jones Roofing', notes: 'Rebuild homepage', status: 'not_started', eta: null, assigned_to: 'ben' }] }),
  }));

  await page.getByRole('button', { name: 'Save job' }).click();

  expect(createBody).toMatchObject({ client_name: 'Jones Roofing', notes: 'Rebuild homepage', assigned_to: 'ben' });
  await expect(page.getByText('Jones Roofing')).toBeVisible();
});

test('shows an error banner if the board fails to load', async ({ page }) => {
  await page.route('/admin/jobs/api/whoami', route =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorised' }) }));
  await page.goto('/admin/jobs');
  await expect(page.locator('#errorBanner')).toBeVisible();
});
