import { ChatComposer } from './components/ChatComposer';
import { ChatHistory } from './components/ChatHistory';
import { ConversationSidebar } from './components/ConversationSidebar';
import { ThreadHeader } from './components/ThreadHeader';
import { useChatState } from './useChatState';

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
      <ConversationSidebar
        conversations={conversations}
        filteredConversations={filteredConversations}
        selectedConversationId={selectedConversationId}
        conversationSearch={conversationSearch}
        conversationLoadError={conversationLoadError}
        isLoadingConversations={isLoadingConversations}
        isCreatingConversation={isCreatingConversation}
        onCreateConversation={createConversation}
        onDeleteConversation={(conversationId) => void deleteConversation(conversationId)}
        onSelectConversation={setSelectedConversationId}
        onSearchChange={setConversationSearch}
      />

      <section className="chat-thread" aria-label="Selected conversation">
        <ThreadHeader
          selectedConversation={selectedConversation}
          renamingConversationId={renamingConversationId}
          renameTitle={renameTitle}
          renameError={renameError}
          isRenamingConversation={isRenamingConversation}
          onStartRename={startRenameConversation}
          onCancelRename={cancelRenameConversation}
          onRenameTitleChange={setRenameTitle}
          onRenameErrorChange={setRenameError}
          onRenameKeyDown={handleRenameKeyDown}
          onSaveConversationTitle={saveConversationTitle}
        />
        <ChatHistory
          messages={messages}
          status={status}
          isLoadingThread={isLoadingThread}
        />
        <ChatComposer
          message={message}
          selectedConversationId={selectedConversationId}
          isSending={isSending}
          onMessageChange={setMessage}
          onSubmit={sendMessage}
        />
      </section>
    </main>
  );
}

export default App;
