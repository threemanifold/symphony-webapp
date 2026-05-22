import type { ConversationSummary } from '../chatTypes';

type ConversationSidebarProps = {
  conversations: ConversationSummary[];
  filteredConversations: ConversationSummary[];
  selectedConversationId: string | null;
  conversationSearch: string;
  conversationLoadError: boolean;
  isLoadingConversations: boolean;
  isCreatingConversation: boolean;
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onSearchChange: (value: string) => void;
};

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

export function ConversationSidebar({
  conversations,
  filteredConversations,
  selectedConversationId,
  conversationSearch,
  conversationLoadError,
  isLoadingConversations,
  isCreatingConversation,
  onCreateConversation,
  onDeleteConversation,
  onSelectConversation,
  onSearchChange,
}: ConversationSidebarProps) {
  return (
    <aside className="chat-sidebar" aria-label="Conversations">
      <div className="sidebar-header">
        <h1>Symphony Chat</h1>
        <button
          className="new-chat-button"
          type="button"
          onClick={onCreateConversation}
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
          onChange={(event) => onSearchChange(event.target.value)}
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
                  selectedConversationId === conversation.id ? 'page' : undefined
                }
                onClick={() => onSelectConversation(conversation.id)}
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
                onClick={() => onDeleteConversation(conversation.id)}
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
  );
}
