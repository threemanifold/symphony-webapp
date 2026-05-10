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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
      .mockResolvedValueOnce(
        okJson({
          conversation: updatedConversation,
          messages: [
            {
              id: 'message-4',
              conversation_id: firstConversation.id,
              role: 'user',
              content: 'hello',
              created_at: '2026-05-10T16:00:00.000Z',
            },
            {
              id: 'message-5',
              conversation_id: firstConversation.id,
              role: 'assistant',
              content: 'hello, this is symphony',
              created_at: '2026-05-10T16:00:01.000Z',
            },
          ],
          reply: {
            id: 'message-5',
            conversation_id: firstConversation.id,
            role: 'assistant',
            content: 'hello, this is symphony',
            created_at: '2026-05-10T16:00:01.000Z',
          },
        }),
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
  });
});
