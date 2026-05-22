import { expect, test } from '@playwright/test';

import {
  createConversation,
  mockChatApi,
  openApp,
  openConversation,
  paced,
  searchConversations,
  sendChatMessage,
} from './chat-helpers';

test('walkthrough: multi-turn Claude AI responses with sidebar and search', async ({
  page,
}) => {
  const claudeReplies: Record<number, string> = {
    1: 'My name is Claude, made by Anthropic. How can I help you today?',
    2: 'As I mentioned, my name is Claude - I am an AI assistant made by Anthropic. Is there something specific you would like to explore?',
    3: 'Great question! As an AI, I was trained on a large dataset of text. I am happy to help with writing, analysis, coding, and much more.',
  };

  await mockChatApi(page, {
    now: '2026-05-14T12:00:00.000Z',
    conversationTitles: ['AI Identity Chat', 'Second Chat'],
    replyFactory: ({ turn }) =>
      claudeReplies[turn] ?? 'I understand. How can I help further?',
  });

  await openApp(page);

  await paced(() => createConversation(page), page);
  await paced(() => sendChatMessage(page, 'What is your name?'), page, 800);
  await paced(
    () => sendChatMessage(page, 'Can you repeat what your name is?'),
    page,
    800,
  );
  await paced(() => sendChatMessage(page, 'Tell me more about yourself.'), page, 800);

  await paced(() => createConversation(page), page);

  await expect(page.getByRole('button', { name: 'Open AI Identity Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Second Chat' })).toBeVisible();
  await page.waitForTimeout(500);

  await paced(() => searchConversations(page, 'AI Identity'), page);
  await expect(page.getByRole('button', { name: 'Open AI Identity Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Second Chat' })).toHaveCount(0);
  await page.waitForTimeout(500);

  await searchConversations(page, '');
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Open AI Identity Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Second Chat' })).toBeVisible();

  await paced(() => openConversation(page, 'AI Identity Chat'), page);

  await expect(page.getByText('My name is Claude, made by Anthropic.')).toBeVisible();
  await expect(page.getByText('As I mentioned, my name is Claude')).toBeVisible();
  await expect(page.getByText('As an AI, I was trained on a large dataset')).toBeVisible();

  await page.waitForTimeout(1500);
});
