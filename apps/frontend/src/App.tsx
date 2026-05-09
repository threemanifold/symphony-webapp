import type { FormEvent } from 'react';
import { useState } from 'react';

function App() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('Response will appear here.');
  const [isSending, setIsSending] = useState(false);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setResponse('Enter a message to send.');
      return;
    }

    setIsSending(true);
    setResponse('Sending...');

    try {
      const chatResponse = await fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: trimmedMessage }),
      });

      if (!chatResponse.ok) {
        throw new Error(`Chat request failed with ${chatResponse.status}`);
      }

      const payload = (await chatResponse.json()) as { response?: string };
      setResponse(payload.response?.trim() || 'No response returned.');
    } catch {
      setResponse('Unable to send message. Try again.');
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
        {response}
      </output>
    </main>
  );
}

export default App;
