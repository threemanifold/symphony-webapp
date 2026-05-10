import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the chat UI', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Symphony Chat' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByText('Response will appear here.')).toBeInTheDocument();
  });

  it('sends the full message history and keeps prior turns visible', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { role: 'assistant', content: 'hello, this is symphony' },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { role: 'assistant', content: 'second response' },
        }),
      } as Response);
    render(<App />);

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('hello, this is symphony');

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'second message' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('second response');

    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('hello, this is symphony')).toBeInTheDocument();
    expect(screen.getByText('second message')).toBeInTheDocument();
    expect(screen.getByText('second response')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hello, this is symphony' },
          { role: 'user', content: 'second message' },
        ],
      }),
    });
  });

  it('keeps the visible conversation during an error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { role: 'assistant', content: 'first response' },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
      } as Response);
    render(<App />);

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'first message' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
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
