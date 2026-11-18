import { test, expect } from '@playwright/test';
test('owner manages staff, settings and exports database-backed reports', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Test-password-only-123!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await page.getByRole('link', { name: 'Your team', exact: true }).click();
  await page.getByLabel('Staff name', { exact: true }).fill('Report Tester');
  await page.getByLabel('Staff email').fill('reports@example.test');
  await page.getByLabel('New password', { exact: true }).fill('Staff-browser-test-123!');
  await page.getByRole('button', { name: 'Save staff', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Report Tester', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('name', { exact: true }).fill('Gather Test Restaurant');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/reporting/settings') && r.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByLabel('name', { exact: true })).toHaveValue('Gather Test Restaurant');
  await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
  await page.getByRole('button', { name: /Crispy fries/ }).click();
  await page.getByRole('button', { name: 'Save order', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Order details/ })).toBeVisible();
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sales dashboard & reports' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cash collected', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export orders CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('orders.csv');
  await page.screenshot({ path: 'test-results/phase7-reports.png', fullPage: true });
});
