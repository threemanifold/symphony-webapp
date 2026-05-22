import { expect, test, type Page, type Route } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

/**
 * End-to-end coverage for the conversation rename feature (SYM-199).
 *
 * Each test seeds its own in-memory conversation via mocked routes so the
 * suite does not depend on pre-existing data and can run deterministically
 * in any environment.
 */

const SEEDED_TITLE = 'Project kickoff';
const RENAMED_TITLE = 'Research synthesis';
const CREATED_AT = '2026-05-22T08:00:00.000Z';
const UPDATED_AT = '2026-05-22T08:05:00.000Z';

type RenameFixture = {
  conversation: Conversation;
  patchCalls: Array<{ title: string }>;
};

async function setupRenameFixture(page: Page): Promise<RenameFixture> {
  const fixture: RenameFixture = {
    conversation: {
      id: 'chat-rename',
      title: SEEDED_TITLE,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    },
    patchCalls: [],
  };

  // Conversation list (GET only) — sidebar load + post-stream refresh path.
  await page.route('**/conversations', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { conversations: [fixture.conversation] },
      });
      return;
    }
    await route.fallback();
  });

  // Single conversation (GET / PATCH).
  await page.route('**/conversations/**', async (route: Route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { conversation: fixture.conversation, messages: [] },
      });
      return;
    }

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { title: string };
      fixture.patchCalls.push({ title: body.title });
      fixture.conversation = {
        ...fixture.conversation,
        title: body.title.trim(),
        updated_at: UPDATED_AT,
      };
      await route.fulfill({
        contentType: 'application/json',
        json: { conversation: fixture.conversation, messages: [] },
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/');
  // Clear any previously persisted selection from earlier runs so we always
  // land on the seeded conversation deterministically.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  return fixture;
}

test('rename: updates sidebar + thread header after save and persists across reload', async ({
  page,
}) => {
  const fixture = await setupRenameFixture(page);

  // Pre-rename: seeded title is visible in both surfaces.
  await expect(
    page.getByRole('heading', { name: SEEDED_TITLE }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${SEEDED_TITLE}` }),
  ).toBeVisible();

  // Open the rename affordance.
  await page.getByRole('button', { name: 'Rename' }).click();

  const titleInput = page.getByLabel('Conversation title');
  await expect(titleInput).toBeVisible();
  await expect(titleInput).toHaveValue(SEEDED_TITLE);

  // Type the new title and save.
  await titleInput.fill(RENAMED_TITLE);
  await page.getByRole('button', { name: 'Save' }).click();

  // After save (before reload): both title surfaces reflect the new value
  // and the old title is gone from the sidebar.
  await expect(
    page.getByRole('heading', { name: RENAMED_TITLE }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${RENAMED_TITLE}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${SEEDED_TITLE}` }),
  ).toHaveCount(0);

  // The PATCH request fired with the trimmed title.
  expect(fixture.patchCalls).toHaveLength(1);
  expect(fixture.patchCalls[0].title).toBe(RENAMED_TITLE);

  // Reload and verify the renamed title persists across a fresh app boot.
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

  // Replace the prefilled title with whitespace only and try to save.
  await titleInput.fill('   ');
  await page.getByRole('button', { name: 'Save' }).click();

  // Inline validation error is shown and PATCH was NOT issued.
  await expect(page.getByText('Enter a conversation title.')).toBeVisible();
  expect(fixture.patchCalls).toHaveLength(0);

  // Original title is still authoritative in the sidebar; the rename form is
  // still open (no heading rendered) which is the expected client-side state.
  await expect(
    page.getByRole('button', { name: `Open ${SEEDED_TITLE}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: SEEDED_TITLE }),
  ).toHaveCount(0);
});

test('walkthrough: rename conversation', async ({ page }) => {
  // Narrative walkthrough kept for video evidence: paced flow with no
  // mid-flow asserts, so the recording is uninterrupted from open → rename →
  // save → reload → persisted title.
  await setupRenameFixture(page);
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Rename' }).click();
  await page.waitForTimeout(500);

  await page.getByLabel('Conversation title').fill(RENAMED_TITLE);
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);

  await page.reload();
  await page.waitForTimeout(1500);

  await expect(
    page.getByRole('heading', { name: RENAMED_TITLE }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${RENAMED_TITLE}` }),
  ).toBeVisible();
});
