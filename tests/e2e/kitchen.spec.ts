import { test, expect } from '@playwright/test';
test('submitted ticket survives reload and preparation synchronizes with POS', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Test-password-only-123!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await page.getByRole('link', { name: 'Kitchen', exact: true }).click();
  const pos = await context.newPage();
  await pos.goto('/pos');
  await pos.getByRole('button', { name: /Crispy fries/ }).click();
  await pos.getByLabel('Preparation notes').fill('Kitchen integration test');
  await pos.getByRole('button', { name: 'Save order', exact: true }).click();
  await pos.getByRole('button', { name: 'Submit order', exact: true }).first().click();
  const ticket = page.getByRole('article').filter({ hasText: 'Kitchen integration test' });
  await expect(ticket).toBeVisible();
  await page.reload();
  await ticket.getByRole('button', { name: 'Start preparing' }).click();
  await ticket.getByRole('button', { name: 'Mark ready' }).click();
  await expect(ticket.getByText('READY', { exact: true })).toBeVisible();
  await expect(pos.getByRole('button', { name: 'SERVED', exact: true }).first()).toBeVisible();
  await pos.getByRole('button', { name: 'SERVED', exact: true }).first().click();
  await expect(ticket).toHaveCount(0);
  await page.getByRole('button', { name: 'Completed tickets', exact: true }).click();
  await expect(ticket.getByText('SERVED', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/phase4-kitchen.png', fullPage: true });
});
