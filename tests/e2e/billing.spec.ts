import { test, expect } from '@playwright/test';
test('cashier opens shift, settles an order, views receipt and reconciles cash', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Test-password-only-123!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
  await page.getByRole('button', { name: /Crispy fries/ }).click();
  await page.getByRole('button', { name: 'Save order', exact: true }).click();
  await page.getByRole('button', { name: 'Submit order', exact: true }).first().click();
  for (const status of ['PREPARING', 'READY', 'SERVED'])
    await page.getByRole('button', { name: status, exact: true }).first().click();
  await page.getByRole('link', { name: 'Cashier', exact: true }).click();
  await page.getByLabel('Opening cash').fill('1000');
  await page.getByRole('button', { name: 'Open shift', exact: true }).click();
  await page
    .getByRole('button', { name: /subtotal/ })
    .first()
    .click();
  await page.getByLabel('Amount to apply').fill('650');
  await page.getByLabel('Cash received').fill('1000');
  await page.getByRole('button', { name: 'Record cash payment', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Payment recorded');
  await page
    .getByRole('button', { name: /^Bill #/ })
    .first()
    .click();
  await expect(page.locator('#receipt')).toContainText('COMPLETED');
  await expect(page.locator('#receipt')).toContainText('Crispy fries');
  await page.getByLabel('Refund amount').fill('100');
  await page.getByLabel('Refund reason').fill('Returned dish');
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: /^Refund payment/ })
    .first()
    .click();
  await expect(page.locator('#receipt')).toContainText('Returned dish');
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole('button', { name: 'Print receipt', exact: true }).click();
  await page.getByLabel('Counted cash').fill('1550');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Close shift', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Shift closed');
  await page.screenshot({ path: 'test-results/phase5-cashier.png', fullPage: true });
});
