import { expect, test } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

test('walkthrough: chat create and delete', async ({ page }) => {
  const now = '2026-05-11T12:00:00.000Z';
  const conversations = new Map<string, Conversation>();

  await page.route('**/chat', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        conversation: conversations.values().next().value,
        messages: [],
        reply: {
          role: 'assistant',
          content: '',
        },
      },
    });
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

    if (request.method() === 'POST') {
      const conversation: Conversation = {
        id: 'chat-create-delete',
        title: 'New chat',
        created_at: now,
        updated_at: now,
      };

      conversations.set(conversation.id, conversation);

      await route.fulfill({
        contentType: 'application/json',
        json: { conversation, messages: [] },
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(500);

  const deleteButton = page.getByRole('button', { name: 'Delete New chat' });
  await deleteButton.scrollIntoViewIfNeeded();
  await deleteButton.click();
  await page.waitForTimeout(500);

  await page.waitForTimeout(1500);

  await expect(page.getByText('No conversations yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open New chat' })).toHaveCount(
    0,
  );
});
