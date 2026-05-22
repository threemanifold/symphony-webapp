import type { ChatMessage } from '../chatTypes';

type ChatHistoryProps = {
  messages: ChatMessage[];
  status: string;
  isLoadingThread: boolean;
};

export function ChatHistory({
  messages,
  status,
  isLoadingThread,
}: ChatHistoryProps) {
  return (
    <output className="chat-output" aria-live="polite">
      {isLoadingThread ? (
        <p>Loading conversation...</p>
      ) : messages.length > 0 ? (
        <div className="chat-history">
          {messages.map((chatMessage, index) => (
            <p
              className={`message message-${chatMessage.role}${chatMessage.isError ? ' message-error' : ''}`}
              key={chatMessage.id ?? `${chatMessage.role}-${index}`}
            >
              <strong>{chatMessage.role === 'user' ? 'You' : 'Symphony'}:</strong>{' '}
              {chatMessage.content}
            </p>
          ))}
        </div>
      ) : (
        status && <p>{status}</p>
      )}
      {messages.length > 0 && status && <p>{status}</p>}
    </output>
  );
}
