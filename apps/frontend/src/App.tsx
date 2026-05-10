import type { FormEvent } from 'react';
import { useState } from 'react';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function App() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState('Response will appear here.');
  const [isSending, setIsSending] = useState(false);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setStatus('Enter a message to send.');
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: trimmedMessage },
    ];

    setMessages(nextMessages);
    setMessage('');
    setIsSending(true);
    setStatus('Sending...');

    try {
      const chatResponse = await fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!chatResponse.ok) {
        throw new Error(`Chat request failed with ${chatResponse.status}`);
      }

      const payload = (await chatResponse.json()) as { message: ChatMessage };
      const assistantMessage = payload.message;
      const assistantContent = assistantMessage.content.trim();

      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: assistantContent || 'No response returned.',
        },
      ]);
      setStatus('');
    } catch {
      setStatus('Unable to send message. Try again.');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="chat-shell">
      <h1>Symphony Chat</h1>
      <form className="chat-form" onSubmit={sendMessage}>
        <label htmlFor="message">Message</label>
        <input
          id="message"
          name="message"
          type="text"
          autoComplete="off"
          placeholder="Type one message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button type="submit" disabled={isSending}>
          Send
        </button>
      </form>
      <output className="chat-output" aria-live="polite">
        {messages.length > 0 && (
          <div className="chat-history">
            {messages.map((chatMessage, index) => (
              <p key={`${chatMessage.role}-${index}`}>
                <strong>{chatMessage.role === 'user' ? 'You' : 'Symphony'}:</strong>{' '}
                {chatMessage.content}
              </p>
            ))}
          </div>
        )}
        {status && <p>{status}</p>}
      </output>
    </main>
  );
}

export default App;
