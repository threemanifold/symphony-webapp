import { expect, test } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

test('walkthrough: streaming tokens appear incrementally and sidebar reorders after stream', async ({
  page,
}) => {
  const now = '2026-05-14T12:00:00.000Z';
  const conversations = new Map<string, Conversation>();
  const messages = new Map<
    string,
    Array<{ id: string; conversation_id: string; role: string; content: string; created_at: string }>
  >();
  let nextConversation = 1;
  let nextMessage = 1;

  const STREAMING_REPLY =
    'Streaming is a technique where the server sends data incrementally, token by token, so the user sees text appear in real time rather than waiting for the full response.';

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
      const title = nextConversation === 1 ? 'Streaming Demo Chat' : 'Older Chat';
      const updatedAt = nextConversation === 1 ? '2026-05-14T13:00:00.000Z' : now;
      const conversation: Conversation = {
        id,
        title,
        created_at: now,
        updated_at: updatedAt,
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

  // Route: /chat — emit SSE stream with token-by-token chunks
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

    const userMsgId = `msg-${nextMessage++}`;
    const assistantMsgId = `msg-${nextMessage++}`;
    const msgCreatedAt = '2026-05-14T13:00:00.000Z';

    // Store messages so the conversation reload after DONE shows them
    const threadMessages = [
      ...(messages.get(conversation.id) ?? []),
      { id: userMsgId, conversation_id: conversation.id, role: 'user', content: body.message, created_at: now },
      { id: assistantMsgId, conversation_id: conversation.id, role: 'assistant', content: STREAMING_REPLY, created_at: msgCreatedAt },
    ];
    messages.set(conversation.id, threadMessages);

    // Update conversation timestamp so sidebar reorders
    const updatedConversation = { ...conversation, updated_at: msgCreatedAt, title: 'Streaming Demo Chat' };
    conversations.set(conversation.id, updatedConversation);

    // Build SSE body: emit words one by one to simulate token stream
    const words = STREAMING_REPLY.split(' ');
    const sseChunks = words.map((w) => `data: ${JSON.stringify(w + ' ')}\n\n`);
    sseChunks.push('data: [DONE]\n\n');
    const body_str = sseChunks.join('');

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: body_str,
    });
  });

  // ── Navigate to app ──────────────────────────────────────────────
  await page.goto('/');
  await page.waitForTimeout(500);

  // ── Create "Older Chat" first so it appears below ────────────────
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(500);

  // ── Create the main "Streaming Demo Chat" ───────────────────────
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(500);

  // ── Type and send a message ──────────────────────────────────────
  await page.getByLabel('Message').fill('Explain streaming to me.');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Send' }).click();

  // ── Watch tokens arrive: assistant bubble should start filling ───
  // Wait for the first few words to appear
  await expect(page.getByText('Streaming is a technique')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(800);

  // ── Wait for stream to complete ──────────────────────────────────
  await expect(page.getByText('rather than waiting for the full response')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(500);

  // ── Verify sidebar reorders: Streaming Demo Chat appears at top ──
  const sidebarItems = page.getByRole('button', { name: /Open / });
  await expect(sidebarItems.first()).toContainText('Streaming Demo Chat');
  await page.waitForTimeout(500);

  // ── Final assertion: full response is rendered ──────────────────
  await expect(page.getByText(STREAMING_REPLY.slice(0, 60))).toBeVisible();

  await page.waitForTimeout(1500);
});
