import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id?: string;
  conversation_id?: string;
  role: ChatRole;
  content: string;
  created_at?: string;
  isError?: boolean;
};

type ConversationSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ConversationDetail = {
  conversation: ConversationSummary;
  messages: ChatMessage[];
};

const selectedConversationStorageKey = 'symphony.selectedConversationId';

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function formatConversationTime(value: string) {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState('Loading conversations...');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [conversationLoadError, setConversationLoadError] = useState(false);

  const selectedConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === selectedConversationId,
      ) ?? null,
    [conversations, selectedConversationId],
  );
  const trimmedConversationSearch = conversationSearch.trim().toLocaleLowerCase();
  const filteredConversations = useMemo(() => {
    if (!trimmedConversationSearch) {
      return conversations;
    }

    return conversations.filter((conversation) =>
      conversation.title.toLocaleLowerCase().includes(trimmedConversationSearch),
    );
  }, [conversations, trimmedConversationSearch]);

  useEffect(() => {
    let ignore = false;

    async function loadConversations() {
      setIsLoadingConversations(true);
      setConversationLoadError(false);

      try {
        const payload = await parseJson<{
          conversations: ConversationSummary[];
        }>(await fetch('/conversations'));
        const savedConversationId = window.localStorage.getItem(
          selectedConversationStorageKey,
        );
        const restoredConversation =
          payload.conversations.find(
            (conversation) => conversation.id === savedConversationId,
          ) ?? payload.conversations[0];

        if (ignore) {
          return;
        }

        setConversations(payload.conversations);
        setSelectedConversationId(restoredConversation?.id ?? null);
        setStatus(
          restoredConversation
            ? ''
            : 'Start a new chat or select a conversation.',
        );
      } catch {
        if (!ignore) {
          setConversationLoadError(true);
          setStatus('Unable to load conversations. Try again.');
        }
      } finally {
        if (!ignore) {
          setIsLoadingConversations(false);
        }
      }
    }

    void loadConversations();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      window.localStorage.removeItem(selectedConversationStorageKey);
      return;
    }

    const conversationId = selectedConversationId;
    let ignore = false;

    async function loadConversation() {
      setIsLoadingThread(true);
      setStatus('Loading conversation...');
      window.localStorage.setItem(
        selectedConversationStorageKey,
        conversationId,
      );

      try {
        const payload = await parseJson<ConversationDetail>(
          await fetch(`/conversations/${conversationId}`),
        );

        if (ignore) {
          return;
        }

        setMessages(payload.messages);
        setConversations((currentConversations) =>
          currentConversations.map((conversation) =>
            conversation.id === payload.conversation.id
              ? payload.conversation
              : conversation,
          ),
        );
        setStatus(payload.messages.length > 0 ? '' : 'No messages yet.');
      } catch {
        if (!ignore) {
          setStatus('Unable to load this conversation. Try again.');
        }
      } finally {
        if (!ignore) {
          setIsLoadingThread(false);
        }
      }
    }

    void loadConversation();

    return () => {
      ignore = true;
    };
  }, [selectedConversationId]);

  async function createConversation() {
    setIsCreatingConversation(true);
    setStatus('Creating conversation...');

    try {
      const payload = await parseJson<ConversationDetail>(
        await fetch('/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }),
      );

      setConversations((currentConversations) => [
        payload.conversation,
        ...currentConversations.filter(
          (conversation) => conversation.id !== payload.conversation.id,
        ),
      ]);
      setSelectedConversationId(payload.conversation.id);
      setMessages(payload.messages);
      setMessage('');
      setStatus('No messages yet.');
    } catch {
      setStatus('Unable to create a new chat. Try again.');
    } finally {
      setIsCreatingConversation(false);
    }
  }

  async function deleteConversation(conversationId: string) {
    try {
      const deleteResponse = await fetch(`/conversations/${conversationId}`, {
        method: 'DELETE',
      });

      if (!deleteResponse.ok) {
        throw new Error(`Delete failed with ${deleteResponse.status}`);
      }

      setConversations((currentConversations) => {
        const nextConversations = currentConversations.filter(
          (conversation) => conversation.id !== conversationId,
        );

        if (selectedConversationId === conversationId) {
          setSelectedConversationId(nextConversations[0]?.id ?? null);
          setMessages([]);
        }

        return nextConversations;
      });
      setStatus('Conversation deleted.');
    } catch {
      setStatus('Unable to delete this conversation. Try again.');
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setStatus('Enter a message to send.');
      return;
    }

    if (!selectedConversationId) {
      setStatus('Create or select a conversation first.');
      return;
    }

    const conversationId = selectedConversationId;
    const streamingId = `streaming-${Date.now()}`;

    setMessages((currentMessages) => [
      ...currentMessages,
      { role: 'user', content: trimmedMessage },
      { id: streamingId, role: 'assistant', content: '' },
    ]);
    setMessage('');
    setIsSending(true);
    setStatus('');

    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: trimmedMessage,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed with ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);

          if (data === '[DONE]') {
            const payload = await parseJson<{
              conversations: ConversationSummary[];
            }>(await fetch('/conversations'));
            setConversations(payload.conversations);
          } else if (data.startsWith('[ERROR]')) {
            const errorText = data.slice(7).trim() || 'An error occurred.';
            setMessages((currentMessages) =>
              currentMessages.map((msg) =>
                msg.id === streamingId
                  ? { ...msg, content: errorText, isError: true }
                  : msg,
              ),
            );
          } else {
            const token = JSON.parse(data) as string;
            setMessages((currentMessages) =>
              currentMessages.map((msg) =>
                msg.id === streamingId
                  ? { ...msg, content: msg.content + token }
                  : msg,
              ),
            );
          }
        }
      }
    } catch {
      setMessages((currentMessages) =>
        currentMessages.map((msg) =>
          msg.id === streamingId
            ? { ...msg, content: 'Unable to send message. Try again.', isError: true }
            : msg,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="chat-shell">
      <aside className="chat-sidebar" aria-label="Conversations">
        <div className="sidebar-header">
          <h1>Symphony Chat</h1>
          <button
            className="new-chat-button"
            type="button"
            onClick={createConversation}
            disabled={isCreatingConversation}
          >
            New chat
          </button>
        </div>
        <div className="conversation-search">
          <label htmlFor="conversation-search">Search conversations</label>
          <input
            id="conversation-search"
            name="conversation-search"
            type="search"
            autoComplete="off"
            placeholder="Search conversations"
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
          />
        </div>
        {isLoadingConversations ? (
          <p className="sidebar-status">Loading...</p>
        ) : conversationLoadError ? (
          <p className="sidebar-status">Unable to load conversations. Try again.</p>
        ) : filteredConversations.length > 0 ? (
          <ol className="conversation-list">
            {filteredConversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  className="conversation-button"
                  type="button"
                  aria-label={`Open ${conversation.title}`}
                  aria-current={
                    selectedConversationId === conversation.id
                      ? 'page'
                      : undefined
                  }
                  onClick={() => setSelectedConversationId(conversation.id)}
                >
                  <span>{conversation.title}</span>
                  <time dateTime={conversation.updated_at}>
                    {formatConversationTime(conversation.updated_at)}
                  </time>
                </button>
                <button
                  className="delete-button"
                  type="button"
                  aria-label={`Delete ${conversation.title}`}
                  onClick={() => void deleteConversation(conversation.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ol>
        ) : conversations.length > 0 ? (
          <p className="sidebar-status">No conversations match this search.</p>
        ) : (
          <p className="sidebar-status">No conversations yet.</p>
        )}
      </aside>

      <section className="chat-thread" aria-label="Selected conversation">
        <header className="thread-header">
          <div>
            <p className="thread-label">Conversation</p>
            <h2>{selectedConversation?.title ?? 'No conversation selected'}</h2>
          </div>
        </header>

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
                  <strong>
                    {chatMessage.role === 'user' ? 'You' : 'Symphony'}:
                  </strong>{' '}
                  {chatMessage.content}
                </p>
              ))}
            </div>
          ) : (
            status && <p>{status}</p>
          )}
          {messages.length > 0 && status && <p>{status}</p>}
        </output>

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
            disabled={!selectedConversationId}
          />
          <button type="submit" disabled={isSending || !selectedConversationId}>
            Send
          </button>
        </form>
      </section>
    </main>
  );
}

export default App;
