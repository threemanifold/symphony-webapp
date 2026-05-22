import { expect, test, type Page } from '@playwright/test';

import {
  mockChatApi,
  openApp,
  paced,
  renameCurrentConversation,
  type ChatApiMock,
} from './chat-helpers';

const SEEDED_TITLE = 'Project kickoff';
const RENAMED_TITLE = 'Research synthesis';
const CREATED_AT = '2026-05-22T08:00:00.000Z';
const UPDATED_AT = '2026-05-22T08:05:00.000Z';

async function setupRenameFixture(page: Page): Promise<ChatApiMock> {
  const fixture = await mockChatApi(page, {
    now: UPDATED_AT,
    conversations: [
      {
        id: 'chat-rename',
        title: SEEDED_TITLE,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      },
    ],
  });
  await openApp(page, { clearStorage: true });
  return fixture;
}

test('rename: updates sidebar + thread header after save and persists across reload', async ({
  page,
}) => {
  const fixture = await setupRenameFixture(page);

  await expect(
    page.getByRole('heading', { name: SEEDED_TITLE }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${SEEDED_TITLE}` }),
  ).toBeVisible();

  await renameCurrentConversation(page, RENAMED_TITLE);

  await expect(
    page.getByRole('heading', { name: RENAMED_TITLE }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${RENAMED_TITLE}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${SEEDED_TITLE}` }),
  ).toHaveCount(0);

  expect(fixture.patchCalls).toHaveLength(1);
  expect(fixture.patchCalls[0].title).toBe(RENAMED_TITLE);

  await page.reload();

  await expect(
    page.getByRole('heading', { name: RENAMED_TITLE }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${RENAMED_TITLE}` }),
  ).toBeVisible();
});

test('rename: rejects whitespace-only input without issuing a PATCH', async ({
  page,
}) => {
  const fixture = await setupRenameFixture(page);

  await page.getByRole('button', { name: 'Rename' }).click();

  const titleInput = page.getByLabel('Conversation title');
  await expect(titleInput).toBeVisible();

  await titleInput.fill('   ');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Enter a conversation title.')).toBeVisible();
  expect(fixture.patchCalls).toHaveLength(0);

  await expect(
    page.getByRole('button', { name: `Open ${SEEDED_TITLE}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: SEEDED_TITLE }),
  ).toHaveCount(0);
});

test('walkthrough: rename conversation', async ({ page }) => {
  await setupRenameFixture(page);
  await page.waitForTimeout(500);

  await paced(
    async () => page.getByRole('button', { name: 'Rename' }).click(),
    page,
  );
  await paced(
    async () => page.getByLabel('Conversation title').fill(RENAMED_TITLE),
    page,
  );
  await paced(
    async () => page.getByRole('button', { name: 'Save' }).click(),
    page,
  );

  await page.reload();
  await page.waitForTimeout(1500);

  await expect(
    page.getByRole('heading', { name: RENAMED_TITLE }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${RENAMED_TITLE}` }),
  ).toBeVisible();
});
