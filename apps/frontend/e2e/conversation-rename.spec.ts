import { expect, test } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ChatMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

test('conversation rename persists across reload and rejects blank titles', async ({
  page,
}) => {
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, ChatMessage[]>();
  const createdAt = '2026-08-02T12:00:00.000Z';
  const autoTitledAt = '2026-08-02T12:01:00.000Z';
  const renamedAt = '2026-08-02T12:02:00.000Z';
  const conversationId = 'rename-persistence-conversation';
  const generatedTitle = 'Travel planning ideas';
  const renamedTitle = 'August travel plan';

  await page.route('**/conversations/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.pathname.split('/').at(-1) ?? '';
    const conversation = conversations.get(id);

    if (request.method() === 'GET') {
      if (!conversation) {
        await route.fulfill({ status: 404 });
        return;
      }

      await route.fulfill({
        contentType: 'application/json',
        json: {
          conversation,
          messages: messages.get(id) ?? [],
        },
      });
      return;
    }

    if (request.method() === 'PATCH') {
      if (!conversation) {
        await route.fulfill({ status: 404 });
        return;
      }

      const body = JSON.parse(request.postData() ?? '{}') as {
        title: string;
      };
      const updatedConversation: Conversation = {
        ...conversation,
        title: body.title,
        updated_at: renamedAt,
      };
      conversations.set(id, updatedConversation);

      await route.fulfill({
        contentType: 'application/json',
        json: updatedConversation,
      });
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
        id: conversationId,
        title: 'New chat',
        created_at: createdAt,
        updated_at: createdAt,
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
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      conversation_id: string;
      message: string;
    };
    const conversation = conversations.get(body.conversation_id);

    if (!conversation) {
      await route.fulfill({ status: 404 });
      return;
    }

    const threadMessages: ChatMessage[] = [
      ...(messages.get(conversation.id) ?? []),
      {
        id: 'rename-user-message',
        conversation_id: conversation.id,
        role: 'user',
        content: body.message,
        created_at: autoTitledAt,
      },
      {
        id: 'rename-assistant-message',
        conversation_id: conversation.id,
        role: 'assistant',
        content: 'Those ideas are ready to organize.',
        created_at: autoTitledAt,
      },
    ];
    messages.set(conversation.id, threadMessages);
    conversations.set(conversation.id, {
      ...conversation,
      title: generatedTitle,
      updated_at: autoTitledAt,
    });

    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        `data: ${JSON.stringify('Those ideas are ready to organize.')}\n\n` +
        'data: [DONE]\n\n',
    });
  });

  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  await expect(page.getByText('No conversations yet.')).toBeVisible();
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'New chat' }),
  ).toBeVisible();

  await page.getByLabel('Message').fill('Plan a late summer trip');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(
    page.getByRole('button', { name: `Open ${generatedTitle}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: generatedTitle }),
  ).toBeVisible();

  await page.getByRole('button', { name: `Rename ${generatedTitle}` }).click();
  const renameInput = page.getByRole('textbox', {
    name: `Rename ${generatedTitle}`,
  });
  await renameInput.fill(renamedTitle);
  await renameInput.press('Enter');

  await expect(
    page.getByRole('button', { name: `Open ${renamedTitle}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: renamedTitle }),
  ).toBeVisible();

  await page.reload();

  await expect(
    page.getByRole('button', { name: `Open ${renamedTitle}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: renamedTitle }),
  ).toBeVisible();

  await page.getByRole('button', { name: `Rename ${renamedTitle}` }).click();
  const blankRenameInput = page.getByRole('textbox', {
    name: `Rename ${renamedTitle}`,
  });
  await blankRenameInput.fill('   ');
  await blankRenameInput.press('Enter');

  await expect(page.getByRole('alert')).toHaveText('Title must not be blank.');
  await expect(blankRenameInput).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByRole('heading', { level: 2, name: renamedTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${renamedTitle}` }),
  ).toHaveCount(0);
});
