import { test, expect } from '@playwright/test';
test('owner can sign in, view staff, reload, change theme and sign out', async ({ page }) => {
  await page.goto('/team');
  await expect(page).toHaveURL(/login/);
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
  await page.getByLabel('Email address').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Test-password-only-123!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await expect(page.getByText('Live connection', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Your team', exact: true }).click();
  await expect(page.getByRole('cell', { name: /Test Cashier cashier@example.test/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your team', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({
    path: 'test-results/team-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ready for service?' })).toBeVisible();
});
test('cashier sees restricted staff route and can lock on a tablet', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/login');
  await page.getByLabel('Email address').fill('cashier@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Test-password-only-123!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-tablet.png', fullPage: true });
  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await expect(page.getByText('Your workspace is locked. Sign in to continue.')).toBeVisible();
});
test('idle workspace locks after five minutes and stays locked on reload', async ({ page }) => {
  await page.clock.install();
  await page.goto('/login');
  await page.getByLabel('Email address').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Test-password-only-123!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.clock.fastForward(5 * 60 * 1000 + 1);
  await expect(page).toHaveURL(/login/);
  await page.reload();
  await expect(page.getByText('Your workspace is locked. Sign in to continue.')).toBeVisible();
});
