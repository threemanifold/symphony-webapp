import { describe, expect, it, vi } from 'vitest';
import { readChatStream, streamChatResponse } from './chatStream';

function streamFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('chatStream', () => {
  it('parses token, done, and error SSE events across chunks', async () => {
    const onToken = vi.fn();
    const onError = vi.fn();
    const onDone = vi.fn();

    await readChatStream(
      streamFromChunks([
        `data: ${JSON.stringify('hel')}\n`,
        `data: ${JSON.stringify('lo')}\n\ndata: [DONE]\n`,
        'data: [ERROR] Rate limit exceeded\n\n',
      ]),
      { onToken, onError, onDone },
    );

    expect(onToken).toHaveBeenNthCalledWith(1, 'hel');
    expect(onToken).toHaveBeenNthCalledWith(2, 'lo');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('Rate limit exceeded');
  });

  it('posts chat requests with the selected conversation id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: streamFromChunks(['data: [DONE]\n\n']),
    } as Response);

    await streamChatResponse('conversation-1', 'hello', {
      onToken: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    });

    expect(fetchMock).toHaveBeenCalledWith('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conversation-1',
        message: 'hello',
      }),
    });

    fetchMock.mockRestore();
  });
});
