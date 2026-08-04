import { expect, test } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

/**
 * End-to-end regression for the conversation rename feature.
 *
 * Rename an existing conversation via the shipped rename affordance, assert
 * the new title on both the sidebar row and the thread header, reload the
 * page, and confirm the new title still shows on both surfaces. This is the
 * canonical proof that the client↔server rename contract survives a hard
 * refresh.
 */
test('rename persists across reload on sidebar row and thread header', async ({
  page,
}) => {
  const now = '2026-05-11T12:00:00.000Z';
  const originalTitle = 'Untitled draft';
  const renamedTitle = 'Renamed via e2e';

  const conversations = new Map<string, Conversation>();
  conversations.set('conv-rename-e2e', {
    id: 'conv-rename-e2e',
    title: originalTitle,
    created_at: now,
    updated_at: now,
  });

  // Route: single conversation (GET / PATCH / DELETE)
  await page.route('**/conversations/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const conversationId = url.pathname.split('/').at(-1) ?? '';

    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          conversation: conversations.get(conversationId),
          messages: [],
        },
      });
      return;
    }

    if (request.method() === 'PATCH') {
      const conversation = conversations.get(conversationId);
      if (!conversation) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          json: { detail: 'Conversation not found.' },
        });
        return;
      }
      const body = (await request.postDataJSON()) as { title: string };
      const updated: Conversation = {
        ...conversation,
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

    if (request.method() === 'DELETE') {
      conversations.delete(conversationId);
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fallback();
  });

  // Route: conversation list (GET)
  await page.route('**/conversations', async (route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { conversations: Array.from(conversations.values()) },
      });
      return;
    }

    await route.fallback();
  });

  // Load the app with a clean localStorage so the seeded conversation is
  // fetched fresh from the mocked backend.
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);

  // Pre-rename baseline: original title on both surfaces.
  await expect(
    page.getByRole('button', { name: `Open ${originalTitle}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: originalTitle }),
  ).toBeVisible();
  await page.waitForTimeout(300);

  // Drive rename via the shipped affordance (SYM-238):
  //   - `Rename <title>` button opens the inline editor.
  //   - `New title for <title>` labelled input receives the new title.
  //   - `Save` button submits the PATCH.
  await page
    .getByRole('button', { name: `Rename ${originalTitle}` })
    .click();
  await page.waitForTimeout(300);

  const renameInput = page.getByLabel(`New title for ${originalTitle}`);
  await renameInput.fill(renamedTitle);
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(700);

  // Post-rename, pre-reload: new title on both surfaces.
  await expect(
    page.getByRole('button', { name: `Open ${renamedTitle}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: renamedTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${originalTitle}` }),
  ).toHaveCount(0);
  await page.waitForTimeout(300);

  // Reload and confirm the rename persisted through a full refresh.
  await page.reload();
  await page.waitForTimeout(700);

  await expect(
    page.getByRole('button', { name: `Open ${renamedTitle}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: renamedTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${originalTitle}` }),
  ).toHaveCount(0);

  await page.waitForTimeout(500);
});
