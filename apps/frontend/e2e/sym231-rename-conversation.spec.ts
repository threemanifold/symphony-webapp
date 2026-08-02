import { expect, test } from '@playwright/test';

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

test('walkthrough: rename existing conversation', async ({ page }) => {
  const createdAt = '2026-05-11T12:00:00.000Z';
  const conversation: Conversation = {
    id: 'conversation-1',
    title: 'Original title',
    created_at: createdAt,
    updated_at: createdAt,
  };

  await page.route('**/conversations', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { conversations: [conversation] },
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/conversations/*', async (route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        json: { conversation, messages: [] },
      });
      return;
    }

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { title: string };
      conversation.title = body.title;
      conversation.updated_at = new Date().toISOString();
      await route.fulfill({
        contentType: 'application/json',
        json: conversation,
      });
      return;
    }

    await route.fallback();
  });

  // Scene (a): open the app and reveal the rename affordance.
  await page.goto('/');
  await page.waitForTimeout(800);

  await page
    .getByRole('button', { name: 'Rename Original title' })
    .click();
  await page.waitForTimeout(800);

  // Scene (b): edit the title and submit — sidebar + header both update.
  const renameInput = page.getByLabel('New title');
  await renameInput.press('ControlOrMeta+A');
  await page.waitForTimeout(300);
  await renameInput.fill('Renamed via walkthrough');
  await page.waitForTimeout(500);
  await page
    .getByRole('form', { name: 'Rename Original title' })
    .getByRole('button', { name: 'Save' })
    .click();
  await page.waitForTimeout(1000);

  // Scene (c): reload the whole page.
  await page.reload();
  await page.waitForTimeout(1000);

  // Scene (d): the renamed title survives the reload.
  await page.waitForTimeout(1500);

  await expect(
    page.getByRole('button', { name: 'Open Renamed via walkthrough' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Renamed via walkthrough' }),
  ).toBeVisible();
});
