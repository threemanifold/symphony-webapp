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

test('walkthrough: multi-turn Claude AI responses with sidebar and search', async ({ page }) => {
  const now = '2026-05-14T12:00:00.000Z';
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, ChatMessage[]>();
  let nextConversation = 1;
  let nextMessage = 1;

  // Simulate Claude-style contextual replies that reference prior turns
  const claudeReplies: Record<number, string> = {
    1: 'My name is Claude, made by Anthropic. How can I help you today?',
    2: 'As I mentioned, my name is Claude — I am an AI assistant made by Anthropic. Is there something specific you would like to explore?',
    3: 'Great question! As an AI, I was trained on a large dataset of text. I am happy to help with writing, analysis, coding, and much more.',
  };
  let replyIndex = 1;

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
      const id = `conv-${nextConversation}`;
      const title = nextConversation === 1 ? 'AI Identity Chat' : 'Second Chat';
      const conversation: Conversation = { id, title, created_at: now, updated_at: now };
      nextConversation += 1;
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

  // Route: chat send — returns contextual Claude-style replies
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
      id: `msg-${nextMessage++}`,
      conversation_id: conversation.id,
      role: 'user',
      content: body.message,
      created_at: now,
    };
    const reply = claudeReplies[replyIndex] ?? 'I understand. How can I help further?';
    replyIndex += 1;
    const assistantMessage: ChatMessage = {
      id: `msg-${nextMessage++}`,
      conversation_id: conversation.id,
      role: 'assistant',
      content: reply,
      created_at: now,
    };
    const threadMessages = [
      ...(messages.get(conversation.id) ?? []),
      userMessage,
      assistantMessage,
    ];

    conversation.updated_at = now;
    conversations.delete(conversation.id);
    conversations.set(conversation.id, conversation);
    messages.set(conversation.id, threadMessages);

    await route.fulfill({
      contentType: 'application/json',
      json: { conversation, messages: threadMessages, reply: assistantMessage },
    });
  });

  // ── Navigate to app ──────────────────────────────────────────────
  await page.goto('/');
  await page.waitForTimeout(500);

  // ── Start a new conversation ─────────────────────────────────────
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(500);

  // Turn 1: ask Claude its name
  await page.getByLabel('Message').fill('What is your name?');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(800);

  // Turn 2: follow-up that requires contextual awareness
  await page.getByLabel('Message').fill('Can you repeat what your name is?');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(800);

  // Turn 3: a third turn
  await page.getByLabel('Message').fill('Tell me more about yourself.');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(800);

  // ── Create a second conversation so sidebar is populated ─────────
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(500);

  // ── Verify sidebar shows both conversations ──────────────────────
  await expect(page.getByRole('button', { name: 'Open AI Identity Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Second Chat' })).toBeVisible();
  await page.waitForTimeout(500);

  // ── Search: filter by title ──────────────────────────────────────
  await page.getByLabel('Search conversations').fill('AI Identity');
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Open AI Identity Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Second Chat' })).toHaveCount(0);
  await page.waitForTimeout(500);

  // ── Clear search — both conversations return ─────────────────────
  await page.getByLabel('Search conversations').fill('');
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Open AI Identity Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Second Chat' })).toBeVisible();

  // ── Switch back to the multi-turn conversation ───────────────────
  await page.getByRole('button', { name: 'Open AI Identity Chat' }).click();
  await page.waitForTimeout(500);

  // Final assertions: all three reply turns are visible
  await expect(page.getByText('My name is Claude, made by Anthropic.')).toBeVisible();
  await expect(page.getByText('As I mentioned, my name is Claude')).toBeVisible();
  await expect(page.getByText('As an AI, I was trained on a large dataset')).toBeVisible();

  await page.waitForTimeout(1500);
});
