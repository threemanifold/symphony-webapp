export type ChatStreamHandlers = {
  onToken: (token: string) => void;
  onError: (message: string) => void;
  onDone: () => Promise<void> | void;
};

export async function handleChatStreamLine(
  line: string,
  handlers: ChatStreamHandlers,
) {
  if (!line.startsWith('data: ')) {
    return;
  }

  const data = line.slice(6);
  if (data === '[DONE]') {
    await handlers.onDone();
  } else if (data.startsWith('[ERROR]')) {
    handlers.onError(data.slice(7).trim() || 'An error occurred.');
  } else {
    handlers.onToken(JSON.parse(data) as string);
  }
}

export async function readChatStream(
  stream: ReadableStream<Uint8Array>,
  handlers: ChatStreamHandlers,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      await handleChatStreamLine(line, handlers);
    }
  }
}

export async function streamChatResponse(
  conversationId: string,
  message: string,
  handlers: ChatStreamHandlers,
) {
  const response = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      message,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed with ${response.status}`);
  }

  await readChatStream(response.body, handlers);
}
