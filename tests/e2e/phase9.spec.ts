import { test, expect } from '@playwright/test';
test('phase 9 splits and merges orders, then retries a durable kitchen print', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/login');
  await page.getByLabel('Email address').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Test-password-only-123!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
  await page.getByRole('button', { name: /Crispy fries/ }).click();
  await page.getByRole('button', { name: /Crispy fries/ }).click();
  await page.getByRole('button', { name: 'Save order', exact: true }).click();
  await page.getByLabel('Split quantity 1').fill('1');
  await page.getByRole('button', { name: 'Split selected items' }).click();
  await expect(page.getByRole('button', { name: 'Details', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  await page.getByLabel('Merge source order').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Merge into this order' }).click();
  await expect(page.getByRole('button', { name: 'Submit order', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Submit order', exact: true }).click();
  await page.getByRole('link', { name: 'Kitchen', exact: true }).click();
  await page.getByRole('button', { name: 'Queue kitchen ticket' }).click();
  await page.getByRole('link', { name: 'Print queue', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open print dialog' })).toBeVisible();
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole('button', { name: 'Open print dialog' }).click();
  await expect(page.locator('#queued-document')).toContainText('1 x Crispy fries');
  expect(
    (await page.locator('#queued-document').innerText()).match(/1 x Crispy fries/g),
  ).toHaveLength(2);
  await page.getByRole('button', { name: 'Retry print job' }).click();
  await page.getByRole('button', { name: 'Open print dialog' }).click();
  await page.getByRole('button', { name: 'Confirm paper output' }).click();
  await expect(page.getByText(/Staff confirmed/)).toBeVisible();
  await expect(page.getByText(/Attempts: 2/)).toBeVisible();
  await page.screenshot({ path: 'test-results/phase9-print-queue.png', fullPage: true });
});
