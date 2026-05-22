import { expect, test } from '@playwright/test';

import {
  createConversation,
  deleteConversation,
  mockChatApi,
  openApp,
  openConversation,
  paced,
  sendChatMessage,
} from './chat-helpers';

test('walkthrough: multi-chat lifecycle', async ({ page }) => {
  await mockChatApi(page, {
    now: '2026-05-11T12:00:00.000Z',
    conversationTitles: ['Chat A', 'Chat B'],
    replyFactory: ({ conversation }) => `Reply for ${conversation.title}`,
  });

  await openApp(page);

  await paced(() => createConversation(page), page);
  await paced(() => sendChatMessage(page, 'Hello from Chat A'), page);

  await paced(() => createConversation(page), page);
  await paced(() => sendChatMessage(page, 'Hello from Chat B'), page);

  await paced(() => openConversation(page, 'Chat A'), page);
  await paced(() => openConversation(page, 'Chat B'), page);
  await paced(() => deleteConversation(page, 'Chat A'), page);
  await page.waitForTimeout(1500);

  await expect(page.getByRole('button', { name: 'Open Chat B' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Chat A' })).toHaveCount(0);
  await expect(page.getByText('Reply for Chat B')).toBeVisible();
});
