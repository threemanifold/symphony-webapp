import { expect, test } from '@playwright/test';

import {
  createConversation,
  deleteConversation,
  mockChatApi,
  openApp,
  paced,
} from './chat-helpers';

test('walkthrough: chat create and delete', async ({ page }) => {
  await mockChatApi(page, {
    now: '2026-05-11T12:00:00.000Z',
    defaultNewTitle: 'New chat',
  });

  await openApp(page, { clearStorage: true });
  await paced(() => createConversation(page), page);
  await paced(() => deleteConversation(page, 'New chat'), page);
  await page.waitForTimeout(1500);

  await expect(page.getByText('No conversations yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open New chat' })).toHaveCount(
    0,
  );
});
