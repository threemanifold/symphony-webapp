import { expect, test } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type StoredMessage = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
};

const STREAMING_REPLY =
  'Streaming is a technique where the server sends data incrementally, token by token, so the user sees text appear in real time rather than waiting for the full response.';

const NOW = '2026-05-14T12:00:00.000Z';
const AFTER = '2026-05-14T13:00:00.000Z';

test('walkthrough: streaming tokens appear incrementally and sidebar reorders after stream', async ({
  page,
}) => {
  // ── Shared state (Node.js side) ─────────────────────────────────
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, StoredMessage[]>();
  let nextConversation = 1;
  let nextMessage = 1;

  // ── Expose function: browser calls this when /chat is POSTed ───
  // Returns the reply so the browser can stream it incrementally.
  await page.exposeFunction(
    '__handleChat',
    (conversationId: string, userMessage: string): string => {
      const conversation = conversations.get(conversationId);
      if (!conversation) return '[ERROR] conversation not found';

      const userMsgId = `msg-${nextMessage++}`;
      const assistantMsgId = `msg-${nextMessage++}`;
      const existing = messages.get(conversationId) ?? [];
      messages.set(conversationId, [
        ...existing,
        { id: userMsgId, conversation_id: conversationId, role: 'user', content: userMessage, created_at: NOW },
        { id: assistantMsgId, conversation_id: conversationId, role: 'assistant', content: STREAMING_REPLY, created_at: AFTER },
      ]);
      // Bump updated_at so sidebar reorders
      conversations.set(conversationId, { ...conversation, updated_at: AFTER });

      return STREAMING_REPLY;
    },
  );

  // ── Patch fetch in the browser for /chat ────────────────────────
  // Returns a genuine ReadableStream that emits tokens with 60 ms gaps,
  // making the streaming visible in the recording.
  await page.addInitScript(() => {
    const DELAY_MS = 60;
    const _originalFetch = window.fetch.bind(window);

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

        // Call back to Node.js to persist state and get the reply text
        const reply: string = await (window as unknown as Record<string, (...a: unknown[]) => Promise<string>>).__handleChat(
          body.conversation_id,
          body.message,
        );

        // Split into word-level tokens to simulate a real stream
        const tokens = reply.split(' ').map((w) => w + ' ');
        const encoder = new TextEncoder();
        let idx = 0;

        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            await new Promise<void>((r) => setTimeout(r, DELAY_MS));
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

      return _originalFetch(input, init);
    };
  });

  // ── Route: GET/DELETE single conversation ────────────────────────
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

  // ── Route: GET list + POST create conversation ───────────────────
  await page.route('**/conversations', async (route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      const sorted = Array.from(conversations.values()).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
      await route.fulfill({
        contentType: 'application/json',
        json: { conversations: sorted },
      });
      return;
    }

    if (request.method() === 'POST') {
      const id = `conv-${nextConversation}`;
      const isFirst = nextConversation === 1;
      const title = isFirst ? 'Older Chat' : 'Streaming Demo Chat';
      const conversation: Conversation = {
        id,
        title,
        created_at: NOW,
        updated_at: NOW,
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

  // ── Navigate to app ──────────────────────────────────────────────
  await page.goto('/');
  await page.waitForTimeout(500);

  // ── Create "Older Chat" so it will be below after the stream ────
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(600);

  // ── Create "Streaming Demo Chat" which will receive the message ─
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(600);

  // ── Type and send a message ──────────────────────────────────────
  await page.getByLabel('Message').fill('Explain streaming to me.');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Send' }).click();

  // ── Watch tokens arrive incrementally ───────────────────────────
  await expect(page.getByText('Streaming is a technique')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000); // let several more tokens land

  // ── Wait for stream to complete ──────────────────────────────────
  await expect(
    page.getByText('rather than waiting for the full response'),
  ).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);

  // ── Verify sidebar reorders: Streaming Demo Chat now at top ──────
  const sidebarItems = page.getByRole('button', { name: /Open / });
  await expect(sidebarItems.first()).toContainText('Streaming Demo Chat');
  await page.waitForTimeout(500);

  // ── Full reply is rendered ────────────────────────────────────────
  await expect(page.getByText(STREAMING_REPLY.slice(0, 60))).toBeVisible();

  await page.waitForTimeout(1500);
});
