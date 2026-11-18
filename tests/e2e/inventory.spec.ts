import { test, expect } from '@playwright/test';
test('inventory receives purchases, saves recipes and deducts submitted orders', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Test-password-only-123!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Lime juice');
  await page.getByLabel('Unit', { exact: true }).selectOption('ml');
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lime juice', exact: true })).toBeVisible();
  await page.getByLabel('Supplier name').fill('Fresh supplier');
  await page.getByLabel('Contact', { exact: true }).fill('Local delivery');
  await page.getByRole('button', { name: 'Add supplier', exact: true }).click();
  await page.getByLabel('Menu item', { exact: true }).selectOption({ label: 'Fresh lime soda' });
  await page.getByLabel('Ingredient', { exact: true }).selectOption({ label: 'Lime juice (ml)' });
  await page.getByLabel('Quantity', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Add line', exact: true }).click();
  await page.getByRole('button', { name: 'Save recipe', exact: true }).click();
  await page.getByLabel('Supplier', { exact: true }).selectOption({ label: 'Fresh supplier' });
  await page.getByRole('button', { name: 'Create purchase order', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Receive full order', exact: true }).click();
  await expect(page.getByText('100 ml', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
  await page.getByRole('button', { name: /Fresh lime soda/ }).click();
  await page.getByRole('button', { name: 'Save order', exact: true }).click();
  await page.getByRole('button', { name: 'Submit order', exact: true }).first().click();
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.getByText('0 ml', { exact: true })).toBeVisible();
  await expect(page.getByText(/CONSUME -100/)).toBeVisible();
  await page.reload();
  await expect(page.getByText('0 ml', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/phase6-inventory.png', fullPage: true });
});
