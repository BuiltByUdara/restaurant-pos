import { test, expect, type Page } from '@playwright/test';
async function login(page: Page, email = 'owner@example.test') {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Test-password-only-123!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
}
test('owner manages categories, modifiers, priced items and safe archiving', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Menu collection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'House beef burger', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Desserts');
  await page.getByLabel('Description', { exact: true }).fill('A sweet finish');
  await page.getByRole('button', { name: 'Save category', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Modifiers', exact: true }).click();
  await page.getByRole('button', { name: 'Add modifier group', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Sweet extras');
  await page.getByLabel('Option 1', { exact: true }).fill('Ice cream');
  await page.getByLabel('Extra (LKR)', { exact: true }).fill('125.50');
  await page.getByRole('button', { name: 'Add option', exact: true }).click();
  await page.getByLabel('Option 2', { exact: true }).fill('Chocolate sauce');
  await page.getByLabel('Extra (LKR)', { exact: true }).nth(1).fill('50');
  await page.getByLabel('Maximum choices', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save modifier group', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu items', exact: true }).click();
  await page.getByRole('button', { name: 'Add menu item', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Chocolate tart');
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Desserts' });
  await page.getByLabel('Price (LKR)', { exact: true }).fill('900.25');
  await page.getByLabel('Description', { exact: true }).fill('Dark chocolate and buttery pastry');
  await page.getByLabel('Sweet extras', { exact: true }).check();
  await page.getByRole('button', { name: 'Save menu item', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Chocolate tart', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/phase2-menu.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Mark Chocolate tart unavailable', exact: true }).click();
  const item = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Chocolate tart', exact: true }) });
  await expect(item.getByText('Unavailable', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Chocolate tart', exact: true }).click();
  await page.getByLabel('Price (LKR)', { exact: true }).fill('950.25');
  await page.getByRole('button', { name: 'Save menu item', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(item).toContainText('950.25');
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await page.getByRole('button', { name: 'Archive Desserts', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('used by active menu items');
  await page.getByRole('button', { name: 'Keep record', exact: true }).click();
  await page.getByRole('button', { name: 'Menu items', exact: true }).click();
  await page.getByRole('button', { name: 'Archive Chocolate tart', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chocolate tart', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await page.getByRole('button', { name: 'Archive Desserts', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Desserts', exact: true })).toHaveCount(0);
});
test('floor plan stays synchronized across terminals and detects stale dialogs', async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Floor plan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'T01, 2 seats, Available', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/phase2-floor.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Add floor', exact: true }).click();
  await page.getByLabel('Floor name', { exact: true }).fill('Patio');
  await page.getByRole('button', { name: 'Save floor', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Patio', exact: true }).click();
  await page.getByRole('button', { name: 'Add table', exact: true }).click();
  await page.getByLabel('Table name', { exact: true }).fill('P01');
  await page.getByLabel('Seats', { exact: true }).fill('2');
  await page.getByLabel('Shape', { exact: true }).selectOption('round');
  await page.getByRole('button', { name: 'Save table', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const second = await context.newPage();
  await second.goto('/tables');
  await second.getByRole('button', { name: 'Patio', exact: true }).click();
  await expect(second.getByText('Live connection', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'P01, 2 seats, Available', exact: true }).click();
  await page.getByRole('button', { name: 'Reserve table', exact: true }).click();
  await expect(
    second.getByRole('button', { name: 'P01, 2 seats, Reserved', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'P01, 2 seats, Reserved', exact: true }).click();
  await page.getByRole('button', { name: 'Seat guests', exact: true }).click();
  await expect(
    second.getByRole('button', { name: 'P01, 2 seats, Occupied', exact: true }),
  ).toBeVisible();
  await second.getByRole('button', { name: 'P01, 2 seats, Occupied', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Edit table', exact: true })).toBeDisabled();
  await second.getByRole('button', { name: 'Make available', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'P01, 2 seats, Available', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'P01, 2 seats, Available', exact: true }).click();
  await second.getByRole('button', { name: 'P01, 2 seats, Available', exact: true }).click();
  await second.getByRole('button', { name: 'Reserve table', exact: true }).click();
  await expect(second.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Seat guests', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed on another device');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'P01, 2 seats, Reserved', exact: true }).click();
  await page.getByRole('button', { name: 'Make available', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'P01, 2 seats, Available', exact: true }).click();
  await page.getByRole('button', { name: 'Edit table', exact: true }).click();
  await page.getByLabel('Floor', { exact: true }).selectOption({ label: 'Main dining' });
  await page.getByLabel('Column (1–8)', { exact: true }).fill('8');
  await page.getByLabel('Row (1–6)', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save table', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Main dining', exact: true }).click();
  await page.getByRole('button', { name: 'P01, 2 seats, Available', exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Patio', exact: true }).click();
  await page.getByRole('button', { name: 'Archive Patio', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Patio', exact: true })).toHaveCount(0);
  await second.close();
});
test('cashier browses menu on tablet without configuration controls', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await login(page, 'cashier@example.test');
  await page.goto('/menu');
  await expect(page.getByRole('heading', { name: 'House beef burger', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add menu item', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Edit House beef burger', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Search menu records', { exact: true }).fill('latte');
  await expect(page.getByRole('heading', { name: 'Iced latte', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'House beef burger', exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel('Search menu records', { exact: true }).fill('');
  await expect(page.getByRole('heading', { name: 'House beef burger', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/phase2-tablet-menu.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto('/tables');
  await expect(page.getByRole('button', { name: 'Add table', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'T01, 2 seats, Available', exact: true }).click();
  await page.getByRole('button', { name: 'Seat guests', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'T01, 2 seats, Occupied', exact: true }),
  ).toBeVisible();
});
