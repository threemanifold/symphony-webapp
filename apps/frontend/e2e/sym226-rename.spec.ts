import { expect, test } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

test('walkthrough: rename conversation from sidebar', async ({ page }) => {
  const conversations = new Map<string, Conversation>();
  conversations.set('sym226-conversation', {
    id: 'sym226-conversation',
    title: 'Untitled brainstorm',
    created_at: '2026-05-11T12:00:00.000Z',
    updated_at: '2026-05-11T12:00:00.000Z',
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
      const body = JSON.parse(request.postData() ?? '{}') as {
        title: string;
      };
      const conversation = conversations.get(conversationId);
      if (!conversation) {
        await route.fulfill({ status: 404 });
        return;
      }

      const updated: Conversation = {
        ...conversation,
        title: body.title,
        updated_at: '2026-05-11T12:05:00.000Z',
      };
      conversations.set(conversationId, updated);

      await route.fulfill({
        contentType: 'application/json',
        json: updated,
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/conversations', async (route) => {
    if (route.request().method() === 'GET') {
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
  await page.waitForTimeout(800);

  // (1) affordance is discoverable in the sidebar
  const renameButton = page.getByRole('button', {
    name: 'Rename Untitled brainstorm',
  });
  await renameButton.scrollIntoViewIfNeeded();
  await renameButton.click();
  await page.waitForTimeout(500);

  // (2) rename happens; both sidebar and header should reflect the new title
  const renameInput = page.getByRole('textbox', {
    name: 'Rename Untitled brainstorm',
  });
  await renameInput.fill('Weekly planning notes');
  await page.waitForTimeout(500);
  await renameInput.press('Enter');
  await page.waitForTimeout(800);

  await expect(
    page.getByRole('button', { name: 'Open Weekly planning notes' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Weekly planning notes' }),
  ).toBeVisible();

  // (3) full page reload — new title still shows in both sidebar + header
  await page.reload();
  await page.waitForTimeout(800);

  await expect(
    page.getByRole('button', { name: 'Open Weekly planning notes' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Weekly planning notes' }),
  ).toBeVisible();

  await page.waitForTimeout(1500);
});
