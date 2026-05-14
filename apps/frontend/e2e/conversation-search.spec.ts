import { expect, test } from '@playwright/test';

type ChatMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

/**
 * Shared mock setup: seeds three conversations with distinct titles and
 * message content, wires all API routes, then navigates to the app root.
 */
async function setupSearchFixture(page: import('@playwright/test').Page) {
  const now = '2026-05-14T10:00:00.000Z';

  const seedConversations: Conversation[] = [
    { id: 'conv-alpha', title: 'Alpha Project', created_at: now, updated_at: now },
    { id: 'conv-beta',  title: 'Beta Discussion', created_at: now, updated_at: now },
    { id: 'conv-gamma', title: 'Gamma Notes', created_at: now, updated_at: now },
  ];

  const seedMessages: Record<string, ChatMessage[]> = {
    'conv-alpha': [
      {
        id: 'msg-alpha-1',
        conversation_id: 'conv-alpha',
        role: 'user',
        content: 'Hello from Alpha',
        created_at: now,
      },
      {
        id: 'msg-alpha-2',
        conversation_id: 'conv-alpha',
        role: 'assistant',
        content: 'Alpha assistant reply',
        created_at: now,
      },
    ],
    'conv-beta': [
      {
        id: 'msg-beta-1',
        conversation_id: 'conv-beta',
        role: 'user',
        content: 'Hello from Beta',
        created_at: now,
      },
    ],
    'conv-gamma': [],
  };

  const conversations = new Map<string, Conversation>(
    seedConversations.map((c) => [c.id, c]),
  );
  const messages = new Map<string, ChatMessage[]>(
    Object.entries(seedMessages),
  );
  let nextConversation = seedConversations.length + 1;

  // Route: single conversation (GET / DELETE)
  await page.route('**/conversations/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const conversationId = url.pathname.split('/').at(-1) ?? '';

    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          conversation: conversations.get(conversationId),
          messages: messages.get(conversationId) ?? [],
        },
      });
      return;
    }

    if (request.method() === 'DELETE') {
      conversations.delete(conversationId);
      messages.delete(conversationId);
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fallback();
  });

  // Route: conversation list (GET) and create (POST)
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
      const id = `conv-new-${nextConversation++}`;
      const conversation: Conversation = {
        id,
        title: 'New chat',
        created_at: now,
        updated_at: now,
      };
      conversations.set(id, conversation);
      messages.set(id, []);

      await route.fulfill({
        contentType: 'application/json',
        json: { conversation, messages: [] },
      });
      return;
    }

    await route.fallback();
  });

  // Route: chat send
  await page.route('**/chat', async (route) => {
    const body = route.request().postDataJSON() as {
      conversation_id: string;
      message: string;
    };
    const conversation = conversations.get(body.conversation_id);

    if (!conversation) {
      await route.fulfill({ status: 404 });
      return;
    }

    const userMessage: ChatMessage = {
      id: `msg-sent-${Date.now()}`,
      conversation_id: conversation.id,
      role: 'user',
      content: body.message,
      created_at: now,
    };
    const assistantMessage: ChatMessage = {
      id: `msg-reply-${Date.now()}`,
      conversation_id: conversation.id,
      role: 'assistant',
      content: `Reply to: ${body.message}`,
      created_at: now,
    };
    const threadMessages = [
      ...(messages.get(conversation.id) ?? []),
      userMessage,
      assistantMessage,
    ];
    messages.set(conversation.id, threadMessages);

    await route.fulfill({
      contentType: 'application/json',
      json: { conversation, messages: threadMessages, reply: assistantMessage },
    });
  });

  await page.goto('/');
  await page.waitForTimeout(500);
}

test('search: filters sidebar by conversation title', async ({ page }) => {
  await setupSearchFixture(page);

  // All three conversations visible initially
  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Gamma Notes' })).toBeVisible();

  // Type a partial title that matches only Alpha Project
  await page.getByLabel('Search conversations').fill('alpha');
  await page.waitForTimeout(300);

  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Gamma Notes' })).toHaveCount(0);
});

test('search: opens a matching conversation when clicked', async ({ page }) => {
  await setupSearchFixture(page);

  // Filter to Beta Discussion
  await page.getByLabel('Search conversations').fill('beta');
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Open Beta Discussion' }).click();
  await page.waitForTimeout(500);

  // Conversation header should show the opened conversation title
  await expect(page.getByRole('heading', { name: 'Beta Discussion' })).toBeVisible();
});

test('search: no-match copy appears when nothing matches', async ({ page }) => {
  await setupSearchFixture(page);

  await page.getByLabel('Search conversations').fill('zzznomatch');
  await page.waitForTimeout(300);

  await expect(page.getByText('No conversations match this search.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toHaveCount(0);
});

test('search: clearing search restores the full conversation list', async ({ page }) => {
  await setupSearchFixture(page);

  // Narrow the list
  await page.getByLabel('Search conversations').fill('alpha');
  await page.waitForTimeout(300);
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toHaveCount(0);

  // Clear the search field
  await page.getByLabel('Search conversations').fill('');
  await page.waitForTimeout(300);

  // All conversations should be visible again
  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Gamma Notes' })).toBeVisible();
});

test('search: create/select/delete lifecycle works with search UI present', async ({
  page,
}) => {
  await setupSearchFixture(page);

  // Search is present but empty — full list visible
  await expect(page.getByLabel('Search conversations')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toBeVisible();

  // Create a new conversation
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(500);

  // New chat should appear in the sidebar and be selected
  await expect(page.getByRole('button', { name: 'Open New chat' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();

  // Select Alpha Project
  await page.getByRole('button', { name: 'Open Alpha Project' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: 'Alpha Project' })).toBeVisible();

  // Delete Alpha Project
  await page.getByRole('button', { name: 'Delete Alpha Project' }).click();
  await page.waitForTimeout(500);

  await page.waitForTimeout(1000);

  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toBeVisible();
});

test('search: case-insensitive title filtering', async ({ page }) => {
  await setupSearchFixture(page);

  // Search with uppercase — should still match
  await page.getByLabel('Search conversations').fill('GAMMA');
  await page.waitForTimeout(300);

  await expect(page.getByRole('button', { name: 'Open Gamma Notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Alpha Project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Beta Discussion' })).toHaveCount(0);
});
