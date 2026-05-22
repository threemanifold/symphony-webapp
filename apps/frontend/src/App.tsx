import { useChatState } from './useChatState';

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
  const {
    conversations,
    filteredConversations,
    selectedConversation,
    selectedConversationId,
    setSelectedConversationId,
    message,
    setMessage,
    messages,
    status,
    isSending,
    isLoadingConversations,
    isLoadingThread,
    isCreatingConversation,
    conversationSearch,
    setConversationSearch,
    conversationLoadError,
    renamingConversationId,
    renameTitle,
    setRenameTitle,
    renameError,
    setRenameError,
    isRenamingConversation,
    createConversation,
    deleteConversation,
    startRenameConversation,
    cancelRenameConversation,
    handleRenameKeyDown,
    saveConversationTitle,
    sendMessage,
  } = useChatState();

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
          <div className="thread-title">
            <p className="thread-label">Conversation</p>
            {selectedConversation &&
            renamingConversationId === selectedConversation.id ? (
              <form className="rename-form" onSubmit={saveConversationTitle}>
                <label htmlFor="conversation-title">Conversation title</label>
                <input
                  id="conversation-title"
                  name="conversation-title"
                  type="text"
                  autoComplete="off"
                  value={renameTitle}
                  onChange={(event) => {
                    setRenameTitle(event.target.value);
                    if (renameError) {
                      setRenameError('');
                    }
                  }}
                  onKeyDown={handleRenameKeyDown}
                  aria-invalid={renameError ? 'true' : undefined}
                  aria-describedby={
                    renameError ? 'conversation-title-error' : undefined
                  }
                  autoFocus
                />
                <div className="rename-actions">
                  <button type="submit" disabled={isRenamingConversation}>
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={cancelRenameConversation}
                    disabled={isRenamingConversation}
                  >
                    Cancel
                  </button>
                </div>
                {renameError && (
                  <p className="rename-error" id="conversation-title-error">
                    {renameError}
                  </p>
                )}
              </form>
            ) : (
              <h2>{selectedConversation?.title ?? 'No conversation selected'}</h2>
            )}
          </div>
          {selectedConversation &&
            renamingConversationId !== selectedConversation.id && (
              <button
                className="rename-button"
                type="button"
                onClick={startRenameConversation}
              >
                Rename
              </button>
            )}
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
