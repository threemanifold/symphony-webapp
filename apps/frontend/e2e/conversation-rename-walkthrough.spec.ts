import { expect, test } from '@playwright/test';

test('rename persists in the sidebar and thread header after reload', async ({
  page,
}) => {
  const timestamp = '2026-08-03T07:00:00.000Z';
  const conversations = [
    {
      id: 'conversation-planning',
      title: 'Weekend planning',
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: 'conversation-books',
      title: 'Books to read',
      created_at: timestamp,
      updated_at: timestamp,
    },
  ];

  await page.route('**/conversations', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { conversations },
    });
  });

  await page.route('**/conversations/**', async (route) => {
    const request = route.request();
    const conversationId = new URL(request.url()).pathname.split('/').at(-1);
    const conversation = conversations.find((item) => item.id === conversationId);

    if (!conversation) {
      await route.fulfill({ status: 404 });
      return;
    }

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { title: string };
      conversation.title = body.title;
      conversation.updated_at = '2026-08-03T07:05:00.000Z';
      conversations.splice(
        0,
        conversations.length,
        conversation,
        ...conversations.filter((item) => item.id !== conversation.id),
      );
      await route.fulfill({ contentType: 'application/json', json: conversation });
      return;
    }

    await route.fulfill({
      contentType: 'application/json',
      json: { conversation, messages: [] },
    });
  });

  await page.goto('/');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Open Books to read' }).click();
  await page.waitForTimeout(500);

  await page
    .getByRole('button', { name: 'Rename Books to read', exact: true })
    .click();
  await page.waitForTimeout(500);

  await page.getByRole('textbox', { name: 'Rename Books to read' }).fill(
    'Summer reading list',
  );
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);

  await page.reload();
  await page.waitForTimeout(1500);

  await expect(
    page.getByRole('button', { name: 'Open Summer reading list' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Summer reading list' }),
  ).toBeVisible();
});
