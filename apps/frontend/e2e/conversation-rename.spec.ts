import { expect, test } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

test('walkthrough: rename conversation', async ({ page }) => {
  const conversation: Conversation = {
    id: 'chat-rename',
    title: 'Project kickoff',
    created_at: '2026-05-22T08:00:00.000Z',
    updated_at: '2026-05-22T08:00:00.000Z',
  };

  await page.route('**/conversations', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { conversations: [conversation] },
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/conversations/**', async (route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { conversation, messages: [] },
      });
      return;
    }

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { title: string };
      conversation.title = body.title.trim();
      conversation.updated_at = '2026-05-22T08:05:00.000Z';

      await route.fulfill({
        contentType: 'application/json',
        json: { conversation, messages: [] },
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Rename' }).click();
  await page.waitForTimeout(500);

  await page.getByLabel('Conversation title').fill('Research synthesis');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);

  await page.reload();
  await page.waitForTimeout(1500);

  await expect(page.getByRole('heading', { name: 'Research synthesis' }))
    .toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Research synthesis' }))
    .toBeVisible();
});
