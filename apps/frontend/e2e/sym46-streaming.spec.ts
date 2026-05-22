import { expect, test } from '@playwright/test';

import {
  createConversation,
  mockChatApi,
  mockStreamingChat,
  openApp,
  paced,
} from './chat-helpers';

const STREAMING_REPLY =
  'Streaming is a technique where the server sends data incrementally, token by token, so the user sees text appear in real time rather than waiting for the full response.';

const NOW = '2026-05-14T12:00:00.000Z';
const AFTER = '2026-05-14T13:00:00.000Z';

test('walkthrough: streaming tokens appear incrementally and sidebar reorders after stream', async ({
  page,
}) => {
  const mock = await mockChatApi(page, {
    now: NOW,
    conversationTitles: ['Older Chat', 'Streaming Demo Chat'],
    sortConversations: true,
  });
  await mockStreamingChat(page, {
    conversations: mock.conversations,
    messages: mock.messages,
    reply: STREAMING_REPLY,
    now: NOW,
    after: AFTER,
  });

  await openApp(page);

  await paced(() => createConversation(page), page, 600);
  await paced(() => createConversation(page), page, 600);

  await page.getByLabel('Message').fill('Explain streaming to me.');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Streaming is a technique')).toBeVisible({
    timeout: 5000,
  });
  await page.waitForTimeout(1000);

  await expect(
    page.getByText('rather than waiting for the full response'),
  ).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);

  const sidebarItems = page.getByRole('button', { name: /Open / });
  await expect(sidebarItems.first()).toContainText('Streaming Demo Chat');
  await page.waitForTimeout(500);

  await expect(page.getByText(STREAMING_REPLY.slice(0, 60))).toBeVisible();

  await page.waitForTimeout(1500);
});
