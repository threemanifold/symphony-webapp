import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const firstConversation = {
  id: 'conversation-1',
  title: 'First chat',
  created_at: '2026-05-09T14:00:00.000Z',
  updated_at: '2026-05-09T14:05:00.000Z',
};

const secondConversation = {
  id: 'conversation-2',
  title: 'Second chat',
  created_at: '2026-05-10T14:00:00.000Z',
  updated_at: '2026-05-10T14:05:00.000Z',
};

function okJson(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function sseErrorResponse(errorMessage: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: [ERROR] ${errorMessage}\n\n`),
      );
      controller.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

function sseResponse(tokens: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const token of tokens) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(token)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

type StoredMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

type StoredConversation = typeof firstConversation;

function createPersistentChatApi() {
  let nextConversation = 1;
  let nextMessage = 1;
  let nextTimestamp = Date.parse('2026-05-10T18:00:00.000Z');
  const conversations: StoredConversation[] = [];
  const messages = new Map<string, StoredMessage[]>();

  function now() {
    const value = new Date(nextTimestamp).toISOString();
    nextTimestamp += 1000;
    return value;
  }

  function moveConversationToTop(conversation: StoredConversation) {
    conversations.splice(
      0,
      conversations.length,
      conversation,
      ...conversations.filter((item) => item.id !== conversation.id),
    );
  }

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    const method = init?.method ?? 'GET';

    if (path === '/conversations' && method === 'GET') {
      return okJson({ conversations });
    }

    if (path === '/conversations' && method === 'POST') {
      const createdAt = now();
      const conversation = {
        id: `conversation-${nextConversation++}`,
        title: 'New chat',
        created_at: createdAt,
        updated_at: createdAt,
      };
      conversations.unshift(conversation);
      messages.set(conversation.id, []);
      return okJson({ conversation, messages: [] });
    }

    const conversationMatch = path.match(/^\/conversations\/(.+)$/);
    if (conversationMatch && method === 'GET') {
      const conversation = conversations.find(
        (item) => item.id === conversationMatch[1],
      );
      if (!conversation) {
        return { ok: false } as Response;
      }

      return okJson({
        conversation,
        messages: messages.get(conversation.id) ?? [],
      });
    }

    if (conversationMatch && method === 'DELETE') {
      const conversationId = conversationMatch[1];
      const index = conversations.findIndex((item) => item.id === conversationId);
      if (index === -1) {
        return { ok: false } as Response;
      }

      conversations.splice(index, 1);
      messages.delete(conversationId);
      return { ok: true } as Response;
    }

    if (conversationMatch && method === 'PATCH') {
      const conversation = conversations.find(
        (item) => item.id === conversationMatch[1],
      );
      if (!conversation) {
        return { ok: false } as Response;
      }

      const body = JSON.parse(init?.body?.toString() ?? '{}') as {
        title?: string;
      };
      const title = body.title?.trim() ?? '';
      if (!title) {
        return {
          ok: false,
          json: async () => ({
            detail: 'Conversation title must not be blank.',
          }),
        } as Response;
      }

      conversation.title = title;
      conversation.updated_at = now();
      return okJson({
        conversation,
        messages: messages.get(conversation.id) ?? [],
      });
    }

    if (path === '/chat' && method === 'POST') {
      const body = JSON.parse(init?.body?.toString() ?? '{}') as {
        conversation_id: string;
        message: string;
      };
      const conversation = conversations.find(
        (item) => item.id === body.conversation_id,
      );
      if (!conversation) {
        return { ok: false } as Response;
      }

      const timestamp = now();
      const userMessage = {
        id: `message-${nextMessage++}`,
        conversation_id: conversation.id,
        role: 'user' as const,
        content: body.message,
        created_at: timestamp,
      };
      const replyContent = `${body.message}, this is symphony`;
      const reply = {
        id: `message-${nextMessage++}`,
        conversation_id: conversation.id,
        role: 'assistant' as const,
        content: replyContent,
        created_at: now(),
      };
      const conversationMessages = messages.get(conversation.id) ?? [];
      conversationMessages.push(userMessage, reply);
      messages.set(conversation.id, conversationMessages);
      conversation.title =
        conversation.title === 'New chat' ? body.message : conversation.title;
      conversation.updated_at = reply.created_at;
      moveConversationToTop(conversation);

      return sseResponse([replyContent]);
    }

    return { ok: false } as Response;
  });
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('loads conversations on startup and renders the initial persisted conversation', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        okJson({ conversations: [firstConversation, secondConversation] }),
      )
      .mockResolvedValueOnce(
        okJson({
          conversation: firstConversation,
          messages: [
            {
              id: 'message-1',
              conversation_id: firstConversation.id,
              role: 'user',
              content: 'persisted question',
              created_at: '2026-05-10T14:01:00.000Z',
            },
            {
              id: 'message-2',
              conversation_id: firstConversation.id,
              role: 'assistant',
              content: 'persisted question, this is symphony',
              created_at: '2026-05-10T14:02:00.000Z',
            },
          ],
        }),
      );

    render(<App />);

    expect(
      await screen.findByRole('button', { name: 'Open First chat' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Second chat')).toBeInTheDocument();
    expect(await screen.findByText('persisted question')).toBeInTheDocument();
    expect(
      screen.getByText('persisted question, this is symphony'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/conversations');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/conversations/${firstConversation.id}`,
    );
  });

  it('loads a selected conversation from the sidebar', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        okJson({ conversations: [firstConversation, secondConversation] }),
      )
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      )
      .mockResolvedValueOnce(
        okJson({
          conversation: secondConversation,
          messages: [
            {
              id: 'message-3',
              conversation_id: secondConversation.id,
              role: 'user',
              content: 'open second',
              created_at: '2026-05-10T14:01:00.000Z',
            },
          ],
        }),
      );

    render(<App />);

    await screen.findByRole('button', { name: 'Open First chat' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Second chat' }));

    expect(await screen.findByText('open second')).toBeInTheDocument();
    expect(window.localStorage.getItem('symphony.selectedConversationId')).toBe(
      secondConversation.id,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/conversations/${secondConversation.id}`,
    );
  });

  it('filters conversations as the user types and restores them when cleared', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        okJson({ conversations: [firstConversation, secondConversation] }),
      )
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      );

    render(<App />);

    await screen.findByRole('button', { name: 'Open First chat' });

    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'second' },
    });

    expect(
      screen.queryByRole('button', { name: 'Open First chat' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open Second chat' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: '' },
    });

    expect(
      screen.getByRole('button', { name: 'Open First chat' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open Second chat' }),
    ).toBeInTheDocument();
  });

  it('shows a distinct empty state when no conversations match the search', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ conversations: [firstConversation] }))
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      );

    render(<App />);

    await screen.findByRole('button', { name: 'Open First chat' });
    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'missing' },
    });

    expect(
      screen.getByText('No conversations match this search.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
  });

  it('keeps the selected conversation open when filtering hides it', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        okJson({ conversations: [firstConversation, secondConversation] }),
      )
      .mockResolvedValueOnce(
        okJson({
          conversation: firstConversation,
          messages: [
            {
              id: 'message-8',
              conversation_id: firstConversation.id,
              role: 'user',
              content: 'first thread message',
              created_at: '2026-05-10T14:01:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        okJson({
          conversation: secondConversation,
          messages: [
            {
              id: 'message-9',
              conversation_id: secondConversation.id,
              role: 'user',
              content: 'second thread message',
              created_at: '2026-05-10T14:02:00.000Z',
            },
          ],
        }),
      );

    render(<App />);

    expect(await screen.findByText('first thread message')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'second' },
    });

    expect(
      screen.queryByRole('button', { name: 'Open First chat' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('first thread message')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Second chat' }));

    expect(await screen.findByText('second thread message')).toBeInTheDocument();
    expect(screen.queryByText('first thread message')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/conversations/${secondConversation.id}`,
    );
  });

  it('creates and selects a new empty conversation', async () => {
    const createdConversation = {
      id: 'conversation-3',
      title: 'New chat',
      created_at: '2026-05-10T15:00:00.000Z',
      updated_at: '2026-05-10T15:00:00.000Z',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ conversations: [] }))
      .mockResolvedValueOnce(
        okJson({ conversation: createdConversation, messages: [] }),
      )
      .mockResolvedValueOnce(
        okJson({ conversation: createdConversation, messages: [] }),
      );

    render(<App />);

    await screen.findByText('No conversations yet.');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));

    expect(await screen.findByText('New chat')).toBeInTheDocument();
    expect(screen.getByText('No messages yet.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  });

  it('renames the selected conversation and updates the sidebar and header', async () => {
    const renamedConversation = {
      ...firstConversation,
      title: 'Renamed planning chat',
      updated_at: '2026-05-10T15:00:00.000Z',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        okJson({ conversations: [firstConversation, secondConversation] }),
      )
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      )
      .mockResolvedValueOnce(
        okJson({ conversation: renamedConversation, messages: [] }),
      );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'First chat' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Conversation title'), {
      target: { value: ' Renamed planning chat ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByRole('heading', { name: 'Renamed planning chat' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open Renamed planning chat' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/conversations/${firstConversation.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed planning chat' }),
      },
    );
  });

  it('keeps the existing conversation title when rename is canceled', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ conversations: [firstConversation] }))
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'First chat' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Conversation title'), {
      target: { value: 'Draft title' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { name: 'First chat' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Draft title')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blocks empty conversation titles before calling the rename API', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ conversations: [firstConversation] }))
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'First chat' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Conversation title'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Enter a conversation title.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('displays backend rename validation errors without changing the title', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ conversations: [firstConversation] }))
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      )
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Conversation title is already taken.' }),
      } as Response);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'First chat' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Conversation title'), {
      target: { value: 'Duplicate title' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Conversation title is already taken.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open First chat' }))
      .toBeInTheDocument();
  });

  it('sends a message with conversation_id and renders the persisted echo response', async () => {
    const updatedConversation = {
      ...firstConversation,
      title: 'hello',
      updated_at: '2026-05-10T16:00:00.000Z',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ conversations: [firstConversation] }))
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      )
      .mockResolvedValueOnce(sseResponse(['hello, this is symphony']))
      .mockResolvedValueOnce(
        okJson({ conversations: [updatedConversation] }),
      );

    render(<App />);

    await screen.findByText('No messages yet.');
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('hello, this is symphony')).toBeInTheDocument();
    expect(screen.getAllByText('hello').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: firstConversation.id,
        message: 'hello',
      }),
    });
  });

  it('keeps the visible conversation during a send error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ conversations: [firstConversation] }))
      .mockResolvedValueOnce(
        okJson({
          conversation: firstConversation,
          messages: [
            {
              id: 'message-6',
              conversation_id: firstConversation.id,
              role: 'user',
              content: 'first message',
              created_at: '2026-05-10T16:00:00.000Z',
            },
            {
              id: 'message-7',
              conversation_id: firstConversation.id,
              role: 'assistant',
              content: 'first response',
              created_at: '2026-05-10T16:00:01.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce({
        ok: false,
      } as Response);

    render(<App />);

    await screen.findByText('first response');
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'failing message' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(
        screen.getByText('Unable to send message. Try again.'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('first message')).toBeInTheDocument();
    expect(screen.getByText('first response')).toBeInTheDocument();
    expect(screen.getByText('failing message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();
  });

  it('shows inline error bubble when SSE stream emits an [ERROR] event', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ conversations: [firstConversation] }))
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      )
      .mockResolvedValueOnce(sseErrorResponse('Rate limit exceeded — please retry shortly'));

    render(<App />);

    await screen.findByText('No messages yet.');
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(
        screen.getByText('Rate limit exceeded — please retry shortly'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();
  });

  it('shows inline error when non-2xx response is received before streaming', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ conversations: [firstConversation] }))
      .mockResolvedValueOnce(
        okJson({ conversation: firstConversation, messages: [] }),
      )
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    render(<App />);

    await screen.findByText('No messages yet.');
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'trigger error' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(
        screen.getByText('Unable to send message. Try again.'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('trigger error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();
  });

  it('shows the conversation history error when the initial request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
    } as Response);

    render(<App />);

    expect(
      await screen.findAllByText('Unable to load conversations. Try again.'),
    ).toHaveLength(2);
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
  });

  it('validates the persistent conversation user flow end to end', async () => {
    const fetchMock = createPersistentChatApi();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const firstRender = render(<App />);

    await screen.findByText('No conversations yet.');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await screen.findByText('No messages yet.');

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'first durable turn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('first durable turn, this is symphony'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'second durable turn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('second durable turn, this is symphony'),
    ).toBeInTheDocument();

    firstRender.unmount();
    render(<App />);

    expect(
      await screen.findByText('first durable turn, this is symphony'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('second durable turn, this is symphony'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await screen.findByText('No messages yet.');
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'second chat turn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('second chat turn, this is symphony'),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Open first durable turn' }),
    );
    expect(
      await screen.findByText('second durable turn, this is symphony'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('second chat turn, this is symphony'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open second chat turn' }));
    expect(
      await screen.findByText('second chat turn, this is symphony'),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete second chat turn' }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Open second chat turn' }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: 'Open first durable turn' }),
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith('/conversations');
    expect(fetchMock).toHaveBeenCalledWith('/chat', expect.any(Object));
  });
});
