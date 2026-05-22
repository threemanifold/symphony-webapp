import type { Page, Route } from '@playwright/test';

export type ChatMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ChatReplyFactory = (context: {
  conversation: Conversation;
  message: string;
  turn: number;
}) => string;

type ChatApiMockOptions = {
  now?: string;
  conversations?: Conversation[];
  messages?: Record<string, ChatMessage[]>;
  conversationTitles?: string[];
  defaultNewTitle?: string;
  replyFactory?: ChatReplyFactory;
  sortConversations?: boolean;
};

export type ChatApiMock = {
  conversations: Map<string, Conversation>;
  messages: Map<string, ChatMessage[]>;
  patchCalls: Array<{ id: string; title: string }>;
};

const DEFAULT_NOW = '2026-05-14T12:00:00.000Z';

export async function mockChatApi(
  page: Page,
  options: ChatApiMockOptions = {},
): Promise<ChatApiMock> {
  const now = options.now ?? DEFAULT_NOW;
  const conversations = new Map<string, Conversation>(
    (options.conversations ?? []).map((conversation) => [
      conversation.id,
      { ...conversation },
    ]),
  );
  const messages = new Map<string, ChatMessage[]>(
    Object.entries(options.messages ?? {}).map(([id, thread]) => [
      id,
      thread.map((message) => ({ ...message })),
    ]),
  );
  const patchCalls: Array<{ id: string; title: string }> = [];
  let nextConversation = conversations.size + 1;
  let nextMessage = 1;
  let replyTurn = 1;

  await page.route('**/conversations/**', async (route: Route) => {
    const request = route.request();
    const conversationId = new URL(request.url()).pathname.split('/').at(-1) ?? '';

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

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { title: string };
      const conversation = conversations.get(conversationId);
      if (!conversation) {
        await route.fulfill({ status: 404 });
        return;
      }

      patchCalls.push({ id: conversationId, title: body.title });
      const updated = {
        ...conversation,
        title: body.title.trim(),
        updated_at: now,
      };
      conversations.set(conversationId, updated);
      await route.fulfill({
        contentType: 'application/json',
        json: { conversation: updated, messages: messages.get(conversationId) ?? [] },
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

  await page.route('**/conversations', async (route: Route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      const list = Array.from(conversations.values());
      await route.fulfill({
        contentType: 'application/json',
        json: {
          conversations: options.sortConversations
            ? list.sort(
                (a, b) =>
                  new Date(b.updated_at).getTime() -
                  new Date(a.updated_at).getTime(),
              )
            : list,
        },
      });
      return;
    }

    if (request.method() === 'POST') {
      const id = `conv-${nextConversation}`;
      const conversation: Conversation = {
        id,
        title:
          options.conversationTitles?.[nextConversation - 1] ??
          options.defaultNewTitle ??
          'New chat',
        created_at: now,
        updated_at: now,
      };
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

  await page.route('**/chat', async (route: Route) => {
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
      id: `message-${nextMessage++}`,
      conversation_id: conversation.id,
      role: 'user',
      content: body.message,
      created_at: now,
    };
    const assistantMessage: ChatMessage = {
      id: `message-${nextMessage++}`,
      conversation_id: conversation.id,
      role: 'assistant',
      content:
        options.replyFactory?.({
          conversation,
          message: body.message,
          turn: replyTurn++,
        }) ?? `Reply to: ${body.message}`,
      created_at: now,
    };
    const threadMessages = [
      ...(messages.get(conversation.id) ?? []),
      userMessage,
      assistantMessage,
    ];
    const updatedConversation = { ...conversation, updated_at: now };
    conversations.set(conversation.id, updatedConversation);
    messages.set(conversation.id, threadMessages);

    await route.fulfill({
      contentType: 'application/json',
      json: {
        conversation: updatedConversation,
        messages: threadMessages,
        reply: assistantMessage,
      },
    });
  });

  return { conversations, messages, patchCalls };
}

export async function openApp(page: Page, options: { clearStorage?: boolean } = {}) {
  await page.goto('/');
  if (options.clearStorage) {
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
  }
}

export async function createConversation(page: Page) {
  await page.getByRole('button', { name: 'New chat' }).click();
}

export async function sendChatMessage(page: Page, message: string) {
  await page.getByLabel('Message').fill(message);
  await page.getByRole('button', { name: 'Send' }).click();
}

export async function openConversation(page: Page, title: string) {
  await page.getByRole('button', { name: `Open ${title}` }).click();
}

export async function deleteConversation(page: Page, title: string) {
  const deleteButton = page.getByRole('button', { name: `Delete ${title}` });
  await deleteButton.scrollIntoViewIfNeeded();
  await deleteButton.click();
}

export async function searchConversations(page: Page, query: string) {
  await page.getByLabel('Search conversations').fill(query);
}

export async function renameCurrentConversation(page: Page, title: string) {
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Conversation title').fill(title);
  await page.getByRole('button', { name: 'Save' }).click();
}

export async function mockStreamingChat(
  page: Page,
  options: {
    conversations: Map<string, Conversation>;
    messages: Map<string, ChatMessage[]>;
    reply: string;
    now: string;
    after: string;
    delayMs?: number;
  },
) {
  let nextMessage = 1;

  await page.exposeFunction(
    '__handleChat',
    (conversationId: string, userMessage: string): string => {
      const conversation = options.conversations.get(conversationId);
      if (!conversation) return '[ERROR] conversation not found';

      const existing = options.messages.get(conversationId) ?? [];
      options.messages.set(conversationId, [
        ...existing,
        {
          id: `msg-${nextMessage++}`,
          conversation_id: conversationId,
          role: 'user',
          content: userMessage,
          created_at: options.now,
        },
        {
          id: `msg-${nextMessage++}`,
          conversation_id: conversationId,
          role: 'assistant',
          content: options.reply,
          created_at: options.after,
        },
      ]);
      options.conversations.set(conversationId, {
        ...conversation,
        updated_at: options.after,
      });

      return options.reply;
    },
  );

  await page.addInitScript((delayMs) => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;

      if ((url.endsWith('/chat') || url.includes('/chat?')) && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as {
          conversation_id: string;
          message: string;
        };
        const reply: string = await (
          window as unknown as Record<
            string,
            (...args: unknown[]) => Promise<string>
          >
        ).__handleChat(body.conversation_id, body.message);
        const tokens = reply.split(' ').map((word) => `${word} `);
        const encoder = new TextEncoder();
        let idx = 0;

        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            if (idx < tokens.length) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(tokens[idx++])}\n\n`),
              );
            } else {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        });
      }

      return originalFetch(input, init);
    };
  }, options.delayMs ?? 60);
}

export async function paced<T>(
  action: () => Promise<T>,
  page: Page,
  delay = 500,
): Promise<T> {
  const result = await action();
  await page.waitForTimeout(delay);
  return result;
}
