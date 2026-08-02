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
 * Shared mock setup: seeds two conversations so we can exercise the
 * "select then rename" flow, wires GET/PATCH routes consistent with
 * existing walkthrough specs, and tracks PATCH invocations so tests can
 * assert on the negative (whitespace-only) case.
 */
async function setupRenameFixture(page: import('@playwright/test').Page) {
  const now = '2026-05-14T10:00:00.000Z';

  const conversations = new Map<string, Conversation>([
    [
      'conv-primary',
      {
        id: 'conv-primary',
        title: 'Original title',
        created_at: now,
        updated_at: now,
      },
    ],
    [
      'conv-secondary',
      {
        id: 'conv-secondary',
        title: 'Secondary chat',
        created_at: now,
        updated_at: now,
      },
    ],
  ]);
  const messages = new Map<string, ChatMessage[]>([
    ['conv-primary', []],
    ['conv-secondary', []],
  ]);
  const patchCalls: Array<{ id: string; title: string }> = [];

  // Route: single conversation (GET / PATCH)
  await page.route('**/conversations/*', async (route) => {
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
      const body = request.postDataJSON() as { title: string };
      patchCalls.push({ id: conversationId, title: body.title });

      const existing = conversations.get(conversationId);
      if (!existing) {
        await route.fulfill({ status: 404 });
        return;
      }

      const updated: Conversation = {
        ...existing,
        title: body.title,
        updated_at: new Date().toISOString(),
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

  // Route: conversation list
  await page.route('**/conversations', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { conversations: Array.from(conversations.values()) },
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/');
  await page.waitForTimeout(500);

  return { patchCalls, conversations };
}

test('rename: sidebar + thread header update and survive a full reload', async ({
  page,
}) => {
  const { patchCalls } = await setupRenameFixture(page);

  // Both seeded conversations show up in the sidebar.
  await expect(
    page.getByRole('button', { name: 'Open Original title' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Secondary chat' }),
  ).toBeVisible();

  // Explicitly select the primary conversation.
  await page.getByRole('button', { name: 'Open Original title' }).click();
  await page.waitForTimeout(300);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Original title' }),
  ).toBeVisible();

  // Invoke the rename affordance for that conversation.
  await page.getByRole('button', { name: 'Rename Original title' }).click();
  await page.waitForTimeout(300);

  const renameInput = page.getByLabel('New title');
  await expect(renameInput).toBeVisible();

  // Enter the new title and submit via the Save button inside the rename form.
  await renameInput.press('ControlOrMeta+A');
  await renameInput.fill('Renamed via e2e');
  await page
    .getByRole('form', { name: 'Rename Original title' })
    .getByRole('button', { name: 'Save' })
    .click();
  await page.waitForTimeout(500);

  // Sidebar list reflects the new title (old label is gone).
  await expect(
    page.getByRole('button', { name: 'Open Renamed via e2e' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Original title' }),
  ).toHaveCount(0);

  // Thread header reflects the new title.
  await expect(
    page.getByRole('heading', { level: 2, name: 'Renamed via e2e' }),
  ).toBeVisible();

  // Backend saw exactly one PATCH with the new title.
  expect(patchCalls).toEqual([{ id: 'conv-primary', title: 'Renamed via e2e' }]);

  // Full page reload — mock still returns the updated title from /conversations
  // and /conversations/:id because the shared map was mutated on PATCH.
  await page.reload();
  await page.waitForTimeout(800);

  // Re-select the primary conversation to open the thread post-reload.
  await page.getByRole('button', { name: 'Open Renamed via e2e' }).click();
  await page.waitForTimeout(300);

  // Both surfaces still show the renamed title after a fresh page load.
  await expect(
    page.getByRole('button', { name: 'Open Renamed via e2e' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Renamed via e2e' }),
  ).toBeVisible();

  // No additional PATCH fired during the reload path.
  expect(patchCalls).toHaveLength(1);
});

test('rename: whitespace-only title does not call PATCH or change the visible title', async ({
  page,
}) => {
  const { patchCalls } = await setupRenameFixture(page);

  // Select the primary conversation.
  await page.getByRole('button', { name: 'Open Original title' }).click();
  await page.waitForTimeout(300);

  // Open the rename affordance.
  await page.getByRole('button', { name: 'Rename Original title' }).click();
  await page.waitForTimeout(300);

  const renameInput = page.getByLabel('New title');
  await renameInput.press('ControlOrMeta+A');
  await renameInput.fill('   ');

  await page
    .getByRole('form', { name: 'Rename Original title' })
    .getByRole('button', { name: 'Save' })
    .click();
  await page.waitForTimeout(500);

  // Inline validation surfaces; PATCH is NOT called.
  await expect(page.getByRole('alert')).toHaveText('Title must not be blank.');
  expect(patchCalls).toHaveLength(0);

  // Cancel back to the neutral state so the sidebar row (not the form) is visible.
  await page
    .getByRole('form', { name: 'Rename Original title' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await page.waitForTimeout(300);

  // Sidebar list still shows the original title.
  await expect(
    page.getByRole('button', { name: 'Open Original title' }),
  ).toBeVisible();
  // Thread header still shows the original title.
  await expect(
    page.getByRole('heading', { level: 2, name: 'Original title' }),
  ).toBeVisible();
});
