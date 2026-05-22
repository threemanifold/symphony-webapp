import { expect, test } from '@playwright/test';

import {
  createConversation,
  deleteConversation,
  mockChatApi,
  openApp,
  openConversation,
  searchConversations,
} from './chat-helpers';

const NOW = '2026-05-14T10:00:00.000Z';
const seedConversations = [
  { id: 'conv-alpha', title: 'Alpha Project', created_at: NOW, updated_at: NOW },
  { id: 'conv-beta', title: 'Beta Discussion', created_at: NOW, updated_at: NOW },
  { id: 'conv-gamma', title: 'Gamma Notes', created_at: NOW, updated_at: NOW },
];
const seedMessages = {
  'conv-alpha': [
    {
      id: 'msg-alpha-1',
      conversation_id: 'conv-alpha',
      role: 'user' as const,
      content: 'Hello from Alpha',
      created_at: NOW,
    },
    {
      id: 'msg-alpha-2',
      conversation_id: 'conv-alpha',
      role: 'assistant' as const,
      content: 'Alpha assistant reply',
      created_at: NOW,
    },
  ],
  'conv-beta': [
    {
      id: 'msg-beta-1',
      conversation_id: 'conv-beta',
      role: 'user' as const,
      content: 'Hello from Beta',
      created_at: NOW,
    },
  ],
};

async function setupSearchFixture(page: Parameters<typeof mockChatApi>[0]) {
  await mockChatApi(page, {
    now: NOW,
    conversations: seedConversations,
    messages: seedMessages,
    defaultNewTitle: 'New chat',
  });
  await openApp(page);
}

test('search: filters sidebar by conversation title', async ({ page }) => {
  await setupSearchFixture(page);

  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Gamma Notes' })).toBeVisible();

  await searchConversations(page, 'alpha');

  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Gamma Notes' })).toHaveCount(0);
});

test('search: opens a matching conversation when clicked', async ({ page }) => {
  await setupSearchFixture(page);

  await searchConversations(page, 'beta');
  await openConversation(page, 'Beta Discussion');

  await expect(page.getByRole('heading', { name: 'Beta Discussion' })).toBeVisible();
});

test('search: no-match copy appears when nothing matches', async ({ page }) => {
  await setupSearchFixture(page);

  await searchConversations(page, 'zzznomatch');

  await expect(page.getByText('No conversations match this search.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toHaveCount(0);
});

test('search: clearing search restores the full conversation list', async ({ page }) => {
  await setupSearchFixture(page);

  await searchConversations(page, 'alpha');
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toHaveCount(0);

  await searchConversations(page, '');

  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Gamma Notes' })).toBeVisible();
});

test('search: create/select/delete lifecycle works with search UI present', async ({
  page,
}) => {
  await setupSearchFixture(page);

  await expect(page.getByLabel('Search conversations')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toBeVisible();

  await createConversation(page);

  await expect(page.getByRole('button', { name: 'Open New chat' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();

  await openConversation(page, 'Alpha Project');
  await expect(page.getByRole('heading', { name: 'Alpha Project' })).toBeVisible();

  await deleteConversation(page, 'Alpha Project');

  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toBeVisible();
});

test('search: case-insensitive title filtering', async ({ page }) => {
  await setupSearchFixture(page);

  await searchConversations(page, 'GAMMA');

  await expect(page.getByRole('button', { name: 'Open Gamma Notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toHaveCount(0);
});
