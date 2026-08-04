import { expect, test } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

test('walkthrough: rename conversation from sidebar and persist across reload', async ({
  page,
}) => {
  const now = '2026-05-11T12:00:00.000Z';
  const conversations = new Map<string, Conversation>();

  conversations.set('sym238-existing', {
    id: 'sym238-existing',
    title: 'Draft product notes',
    created_at: now,
    updated_at: now,
  });

  await page.route('**/conversations/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const conversationId = url.pathname.split('/').at(-1) ?? '';

    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          conversation: conversations.get(conversationId),
          messages: [],
        },
      });
      return;
    }

    if (request.method() === 'PATCH') {
      const conversation = conversations.get(conversationId);
      if (!conversation) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          json: { detail: 'Conversation not found.' },
        });
        return;
      }
      const body = (await request.postDataJSON()) as { title: string };
      const updated: Conversation = {
        ...conversation,
        title: body.title,
        updated_at: new Date().toISOString(),
      };
      conversations.set(conversationId, updated);
      await route.fulfill({
        contentType: 'application/json',
        json: updated,
      });
      return;
    }

    if (request.method() === 'DELETE') {
      conversations.delete(conversationId);
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fallback();
  });

  await page.route('**/conversations', async (route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { conversations: Array.from(conversations.values()) },
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);

  await expect(
    page.getByRole('button', { name: 'Open Draft product notes' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Draft product notes' }),
  ).toBeVisible();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Rename Draft product notes' }).click();
  await page.waitForTimeout(500);

  const renameInput = page.getByLabel('New title for Draft product notes');
  await renameInput.fill('Q3 launch brief');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(700);

  await expect(
    page.getByRole('button', { name: 'Open Q3 launch brief' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Q3 launch brief' }),
  ).toBeVisible();
  await page.waitForTimeout(500);

  await page.reload();
  await page.waitForTimeout(700);

  await expect(
    page.getByRole('button', { name: 'Open Q3 launch brief' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Q3 launch brief' }),
  ).toBeVisible();

  await page.waitForTimeout(1500);
});
