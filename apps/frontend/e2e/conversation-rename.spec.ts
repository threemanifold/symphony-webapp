import { expect, test, type Page } from '@playwright/test';

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

async function setupConversationApi(page: Page) {
  const createdAt = '2026-08-03T07:00:00.000Z';
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, ChatMessage[]>();
  let nextMessageId = 1;

  await page.route('**/conversations/**', async (route) => {
    const request = route.request();
    const conversationId = new URL(request.url()).pathname.split('/').at(-1) ?? '';
    const conversation = conversations.get(conversationId);

    if (!conversation) {
      await route.fulfill({ status: 404 });
      return;
    }

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { title?: string };
      const title = body.title?.trim();

      if (!title) {
        await route.fulfill({ status: 422 });
        return;
      }

      conversation.title = title;
      conversation.updated_at = '2026-08-03T07:05:00.000Z';
      await route.fulfill({ contentType: 'application/json', json: conversation });
      return;
    }

    await route.fulfill({
      contentType: 'application/json',
      json: {
        conversation,
        messages: messages.get(conversationId) ?? [],
      },
    });
  });

  await page.route('**/conversations', async (route) => {
    if (route.request().method() === 'POST') {
      const conversation: Conversation = {
        id: 'conversation-rename',
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

    await route.fulfill({
      contentType: 'application/json',
      json: { conversations: Array.from(conversations.values()) },
    });
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

    const sentAt = '2026-08-03T07:01:00.000Z';
    const threadMessages: ChatMessage[] = [
      {
        id: `message-${nextMessageId++}`,
        conversation_id: conversation.id,
        role: 'user',
        content: body.message,
        created_at: sentAt,
      },
      {
        id: `message-${nextMessageId++}`,
        conversation_id: conversation.id,
        role: 'assistant',
        content: 'I can help with that plan.',
        created_at: sentAt,
      },
    ];
    messages.set(conversation.id, threadMessages);
    conversation.title = body.message;
    conversation.updated_at = sentAt;

    await route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: "I can help with that plan."\n\ndata: [DONE]\n\n',
    });
  });

  await page.goto('/');
}

async function createAutoTitledConversation(page: Page) {
  const autoTitle = 'Plan a mountain weekend';

  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(500);
  await page.getByLabel('Message').fill(autoTitle);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: `Open ${autoTitle}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: autoTitle })).toBeVisible();

  return autoTitle;
}

test('renames an auto-titled conversation and persists it after reload', async ({
  page,
}) => {
  await setupConversationApi(page);
  await page.waitForTimeout(500);
  const autoTitle = await createAutoTitledConversation(page);
  await page.waitForTimeout(500);
  const renamedTitle = 'Mountain weekend itinerary';

  await page.getByRole('button', { name: `Rename ${autoTitle}`, exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('textbox', { name: `Rename ${autoTitle}` }).fill(renamedTitle);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);

  await expect(page.getByRole('button', { name: `Open ${renamedTitle}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: renamedTitle })).toBeVisible();

  await page.reload();

  await expect(page.getByRole('button', { name: `Open ${renamedTitle}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: renamedTitle })).toBeVisible();
  await page.waitForTimeout(1500);
});

test('rejects a whitespace-only conversation title', async ({ page }) => {
  await setupConversationApi(page);
  const autoTitle = await createAutoTitledConversation(page);

  await page.getByRole('button', { name: `Rename ${autoTitle}`, exact: true }).click();
  await page.getByRole('textbox', { name: `Rename ${autoTitle}` }).fill('   ');

  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  const renameInput = page.getByRole('textbox', { name: `Rename ${autoTitle}` });
  await expect(renameInput).toBeVisible();
  await renameInput.press('Escape');
  await expect(page.getByRole('button', { name: `Open ${autoTitle}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: autoTitle })).toBeVisible();
});
