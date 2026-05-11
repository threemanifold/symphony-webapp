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

test('walkthrough: chat create and delete', async ({ page }) => {
  const now = '2026-05-11T12:00:00.000Z';
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, ChatMessage[]>();

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
        id: 'chat-1',
        title: 'New chat',
        created_at: now,
        updated_at: now,
      };
      conversations.set(conversation.id, conversation);
      messages.set(conversation.id, []);

      await route.fulfill({
        contentType: 'application/json',
        json: { conversation, messages: [] },
      });
      return;
    }

    await route.fallback();
  });

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
      id: 'message-1',
      conversation_id: conversation.id,
      role: 'user',
      content: body.message,
      created_at: now,
    };
    const assistantMessage: ChatMessage = {
      id: 'message-2',
      conversation_id: conversation.id,
      role: 'assistant',
      content: 'Reply for New chat',
      created_at: now,
    };
    const threadMessages = [userMessage, assistantMessage];
    messages.set(conversation.id, threadMessages);

    await route.fulfill({
      contentType: 'application/json',
      json: {
        conversation,
        messages: threadMessages,
        reply: assistantMessage,
      },
    });
  });

  await page.goto('/');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Delete New chat' }).click();
  await page.waitForTimeout(500);

  await page.waitForTimeout(1500);

  await expect(page.getByText('No conversations yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open New chat' })).toHaveCount(
    0,
  );
});
