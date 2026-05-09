import { fireEvent, render, screen } from '@testing-library/react';
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

  it('sends a message and displays the backend response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'hello, this is symphony' }),
    } as Response);
    render(<App />);

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(fetchMock).toHaveBeenCalledWith('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(
      await screen.findByText('hello, this is symphony'),
    ).toBeInTheDocument();
  });
});
