import { expect, test } from '@playwright/test';

/**
 * SYM-227 — E2E coverage for the conversation rename flow.
 *
 * Walks the full path a user takes end-to-end:
 *   1. Create a new conversation.
 *   2. Send a message so the backend hands back an auto-generated title.
 *   3. Rename the conversation via the sidebar affordance.
 *   4. Assert both the sidebar entry and the thread `<h2>` header reflect
 *      the new title.
 *   5. `page.reload()` and re-assert persistence across a full reload.
 *   6. Attempt to submit an empty/whitespace title and confirm the previous
 *      title stays in place (rejection path).
 *
 * The frontend contract is mocked end-to-end so this spec runs deterministically
 * and produces a clean video/trace artifact regardless of backend availability.
 */

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type StoredMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

const CREATED_AT = '2026-05-14T12:00:00.000Z';
const AFTER_SEND = '2026-05-14T12:05:00.000Z';
const AFTER_RENAME = '2026-05-14T12:10:00.000Z';

const CONVERSATION_ID = 'sym227-conversation';
const AUTO_TITLE = 'Auto-generated summary';
const RENAMED_TITLE = 'Weekly planning notes';
const ASSISTANT_REPLY =
  'Sure — here is a quick overview of what streaming does under the hood.';

test('walkthrough: rename persists across sidebar, header, and reload', async ({
  page,
}) => {
  // ── Shared mock state (per-test) ────────────────────────────────
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, StoredMessage[]>();
  let nextMessageId = 1;

  // ── Browser-side helper: called from patched fetch for `/chat` ──
  await page.exposeFunction(
    '__symphonyHandleChat',
    (conversationId: string, userMessage: string): string => {
      const conversation = conversations.get(conversationId);
      if (!conversation) return '[ERROR] conversation not found';

      const userMsgId = `msg-${nextMessageId++}`;
      const assistantMsgId = `msg-${nextMessageId++}`;
      const existing = messages.get(conversationId) ?? [];
      messages.set(conversationId, [
        ...existing,
        {
          id: userMsgId,
          conversation_id: conversationId,
          role: 'user',
          content: userMessage,
          created_at: AFTER_SEND,
        },
        {
          id: assistantMsgId,
          conversation_id: conversationId,
          role: 'assistant',
          content: ASSISTANT_REPLY,
          created_at: AFTER_SEND,
        },
      ]);

      // Simulate the backend's auto-title behaviour: once the first
      // exchange is captured, the conversation gains a real title.
      conversations.set(conversationId, {
        ...conversation,
        title: AUTO_TITLE,
        updated_at: AFTER_SEND,
      });

      return ASSISTANT_REPLY;
    },
  );

  // ── Patch fetch inside the browser for the streamed `/chat` call ─
  await page.addInitScript(() => {
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

      if (
        (url.endsWith('/chat') || url.includes('/chat?')) &&
        init?.method === 'POST'
      ) {
        const body = JSON.parse(init.body as string) as {
          conversation_id: string;
          message: string;
        };

        const reply: string = await (
          window as unknown as Record<
            string,
            (...args: unknown[]) => Promise<string>
          >
        ).__symphonyHandleChat(body.conversation_id, body.message);

        const tokens = reply.split(' ').map((word) => `${word} `);
        const encoder = new TextEncoder();
        let idx = 0;

        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            await new Promise<void>((resolve) => setTimeout(resolve, 30));
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
  });

  // ── Route: GET/PATCH single conversation ────────────────────────
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

    if (request.method() === 'PATCH') {
      const conversation = conversations.get(conversationId);
      if (!conversation) {
        await route.fulfill({ status: 404 });
        return;
      }

      const requestBody = JSON.parse(request.postData() ?? '{}') as {
        title?: string;
      };
      const nextTitle = (requestBody.title ?? '').trim();
      if (!nextTitle) {
        // Server-side would 422; frontend already blocks blank submits, but
        // covering it here keeps the mock honest.
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          json: { detail: 'Title must not be blank.' },
        });
        return;
      }

      const updated: Conversation = {
        ...conversation,
        title: nextTitle,
        updated_at: AFTER_RENAME,
      };
      conversations.set(conversationId, updated);

      await route.fulfill({
        contentType: 'application/json',
        json: updated,
      });
      return;
    }

    await route.fallback();
  });

  // ── Route: GET list + POST create ────────────────────────────────
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
        id: CONVERSATION_ID,
        title: 'New chat',
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
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

  // ── Boot the app with a clean localStorage ──────────────────────
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForTimeout(600);

  // ── 1. Create a fresh conversation ──────────────────────────────
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.waitForTimeout(500);

  await expect(
    page.getByRole('button', { name: 'Open New chat' }),
  ).toBeVisible();

  // ── 2. Send a message so the backend can assign an auto-title ──
  await page.getByLabel('Message').fill('Explain how streaming works.');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Send' }).click();

  // Wait for the streamed reply to finish and the sidebar to refresh
  // with the auto-generated title.
  await expect(
    page.getByRole('button', { name: `Open ${AUTO_TITLE}` }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole('heading', { level: 2, name: AUTO_TITLE }),
  ).toBeVisible();
  await page.waitForTimeout(500);

  // ── 3. Invoke rename affordance and reject an empty submission ──
  await page
    .getByRole('button', { name: `Rename ${AUTO_TITLE}` })
    .click();
  await page.waitForTimeout(400);

  const renameInput = page.getByRole('textbox', {
    name: `Rename ${AUTO_TITLE}`,
  });
  await expect(renameInput).toBeVisible();

  // Whitespace-only entry should be rejected: inline error appears and the
  // sidebar/header keep the previous title.
  await renameInput.fill('   ');
  await page.waitForTimeout(300);
  await renameInput.press('Enter');
  await page.waitForTimeout(400);

  await expect(page.getByRole('alert')).toHaveText('Title must not be blank.');
  await expect(
    page.getByRole('button', { name: `Open ${AUTO_TITLE}` }),
  ).toHaveCount(0); // still in rename mode, so the open-button hides
  await expect(
    page.getByRole('heading', { level: 2, name: AUTO_TITLE }),
  ).toBeVisible();

  // ── 4. Submit a valid new title ─────────────────────────────────
  await renameInput.fill(RENAMED_TITLE);
  await page.waitForTimeout(300);
  await renameInput.press('Enter');
  await page.waitForTimeout(600);

  // Both sidebar entry and the thread header pick up the new title.
  await expect(
    page.getByRole('button', { name: `Open ${RENAMED_TITLE}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: RENAMED_TITLE }),
  ).toBeVisible();

  // Sanity: previous title is no longer on the page anywhere.
  await expect(
    page.getByRole('button', { name: `Open ${AUTO_TITLE}` }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { level: 2, name: AUTO_TITLE }),
  ).toHaveCount(0);

  // ── 5. Full page reload — new title still shows in both surfaces ─
  await page.reload();
  await page.waitForTimeout(800);

  await expect(
    page.getByRole('button', { name: `Open ${RENAMED_TITLE}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: RENAMED_TITLE }),
  ).toBeVisible();

  // Give the video a beat before it ends.
  await page.waitForTimeout(1500);
});
