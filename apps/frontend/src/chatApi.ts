import type { ConversationDetail, ConversationSummary } from './chatTypes';

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

async function parseErrorMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { detail?: unknown };

    if (typeof payload.detail === 'string' && payload.detail.trim()) {
      return payload.detail;
    }
  } catch {
    // Use the UI fallback when a server error is not JSON.
  }

  return fallback;
}

export async function listConversations() {
  return parseJson<{ conversations: ConversationSummary[] }>(
    await fetch('/conversations'),
  );
}

export async function loadConversation(conversationId: string) {
  return parseJson<ConversationDetail>(
    await fetch(`/conversations/${conversationId}`),
  );
}

export async function createConversation() {
  return parseJson<ConversationDetail>(
    await fetch('/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
  );
}

export async function deleteConversation(conversationId: string) {
  const response = await fetch(`/conversations/${conversationId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Delete failed with ${response.status}`);
  }
}

export async function renameConversation(
  conversationId: string,
  title: string,
) {
  const response = await fetch(`/conversations/${conversationId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'Unable to rename this conversation. Try again.',
      ),
    );
  }

  return (await response.json()) as ConversationDetail;
}
