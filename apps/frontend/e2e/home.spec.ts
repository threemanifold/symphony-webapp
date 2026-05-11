import { test, expect } from '@playwright/test';

test('home page loads and renders the React root', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator('#root')).toBeVisible();
  await page.waitForTimeout(1500);
});
