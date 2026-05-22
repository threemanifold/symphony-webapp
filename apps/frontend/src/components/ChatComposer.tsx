import type { FormEvent } from 'react';

type ChatComposerProps = {
  message: string;
  selectedConversationId: string | null;
  isSending: boolean;
  onMessageChange: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function ChatComposer({
  message,
  selectedConversationId,
  isSending,
  onMessageChange,
  onSubmit,
}: ChatComposerProps) {
  return (
    <form className="chat-form" onSubmit={onSubmit}>
      <label htmlFor="message">Message</label>
      <input
        id="message"
        name="message"
        type="text"
        autoComplete="off"
        placeholder="Type one message"
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        disabled={!selectedConversationId}
      />
      <button type="submit" disabled={isSending || !selectedConversationId}>
        Send
      </button>
    </form>
  );
}
