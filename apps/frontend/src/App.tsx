import type { FormEvent, KeyboardEvent } from 'react';
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

type RenameLocation = 'sidebar' | 'header';

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
  const [renamingConversationId, setRenamingConversationId] = useState<
    string | null
  >(null);
  const [renameLocation, setRenameLocation] = useState<RenameLocation | null>(
    null,
  );
  const [renameTitle, setRenameTitle] = useState('');
  const [renameError, setRenameError] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

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

  function beginRename(
    conversation: ConversationSummary,
    location: RenameLocation,
  ) {
    setRenamingConversationId(conversation.id);
    setRenameLocation(location);
    setRenameTitle(conversation.title);
    setRenameError('');
    setStatus('');
  }

  function cancelRename() {
    setRenamingConversationId(null);
    setRenameLocation(null);
    setRenameTitle('');
    setRenameError('');
  }

  async function renameConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = renameTitle.trim();
    if (!trimmedTitle) {
      setRenameError('Enter a conversation title.');
      return;
    }

    if (!renamingConversationId) {
      return;
    }

    setIsRenaming(true);
    setRenameError('');

    try {
      const updatedConversation = await parseJson<ConversationSummary>(
        await fetch(`/conversations/${renamingConversationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: trimmedTitle }),
        }),
      );

      setConversations((currentConversations) =>
        currentConversations.map((conversation) =>
          conversation.id === updatedConversation.id
            ? updatedConversation
            : conversation,
        ),
      );
      cancelRename();
      setStatus('Conversation renamed.');
    } catch {
      setRenameError('Unable to rename this conversation. Try again.');
    } finally {
      setIsRenaming(false);
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  }

  function renameEditor(conversation: ConversationSummary) {
    const inputId = `rename-${renameLocation}-${conversation.id}`;

    return (
      <form className="rename-form" onSubmit={renameConversation}>
        <label htmlFor={inputId}>Rename {conversation.title}</label>
        <input
          id={inputId}
          type="text"
          autoFocus
          value={renameTitle}
          onChange={(event) => {
            setRenameTitle(event.target.value);
            setRenameError('');
          }}
          onKeyDown={handleRenameKeyDown}
          aria-invalid={Boolean(renameError)}
          aria-describedby={renameError ? `${inputId}-error` : undefined}
        />
        <div className="rename-actions">
          <button type="submit" disabled={isRenaming || !renameTitle.trim()}>
            Save
          </button>
          <button type="button" onClick={cancelRename} disabled={isRenaming}>
            Cancel
          </button>
        </div>
        {renameError && (
          <p className="rename-error" id={`${inputId}-error`} role="alert">
            {renameError}
          </p>
        )}
      </form>
    );
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
                {renamingConversationId === conversation.id &&
                renameLocation === 'sidebar' ? (
                  renameEditor(conversation)
                ) : (
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
                )}
                <button
                  className="rename-button"
                  type="button"
                  aria-label={`Rename ${conversation.title}`}
                  onClick={() => beginRename(conversation, 'sidebar')}
                  disabled={isRenaming}
                >
                  Rename
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
            {selectedConversation &&
            renamingConversationId === selectedConversation.id &&
            renameLocation === 'header' ? (
              renameEditor(selectedConversation)
            ) : (
              <h2 aria-label={selectedConversation?.title}>
                {selectedConversation ? (
                  <button
                    className="thread-title-button"
                    type="button"
                    aria-label={`Rename ${selectedConversation.title} from thread header`}
                    onClick={() => beginRename(selectedConversation, 'header')}
                  >
                    {selectedConversation.title}
                  </button>
                ) : (
                  'No conversation selected'
                )}
              </h2>
            )}
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
