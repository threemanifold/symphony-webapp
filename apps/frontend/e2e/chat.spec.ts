import { test, expect } from '@playwright/test';

test('user can send a message and see the assistant reply', async ({ page }) => {
  await page.route('**/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: {
          role: 'assistant',
          content: 'Hello! I can hear you loud and clear.',
        },
      }),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Symphony Chat' })).toBeVisible();

  await page.getByLabel('Message').fill('Hi Symphony, are you there?');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Send' }).click();

  const messages = page.locator('.chat-history p');
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0)).toContainText('You: Hi Symphony, are you there?');
  await expect(messages.nth(1)).toContainText('Symphony: Hello! I can hear you loud and clear.');

  await page.waitForTimeout(1500);
});
