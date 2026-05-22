import type { FormEvent, KeyboardEvent } from 'react';
import type { ConversationSummary } from '../chatTypes';

type ThreadHeaderProps = {
  selectedConversation: ConversationSummary | null;
  renamingConversationId: string | null;
  renameTitle: string;
  renameError: string;
  isRenamingConversation: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRenameTitleChange: (title: string) => void;
  onRenameErrorChange: (message: string) => void;
  onRenameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSaveConversationTitle: (event: FormEvent<HTMLFormElement>) => void;
};

export function ThreadHeader({
  selectedConversation,
  renamingConversationId,
  renameTitle,
  renameError,
  isRenamingConversation,
  onStartRename,
  onCancelRename,
  onRenameTitleChange,
  onRenameErrorChange,
  onRenameKeyDown,
  onSaveConversationTitle,
}: ThreadHeaderProps) {
  const isRenaming =
    selectedConversation && renamingConversationId === selectedConversation.id;

  return (
    <header className="thread-header">
      <div className="thread-title">
        <p className="thread-label">Conversation</p>
        {isRenaming ? (
          <form className="rename-form" onSubmit={onSaveConversationTitle}>
            <label htmlFor="conversation-title">Conversation title</label>
            <input
              id="conversation-title"
              name="conversation-title"
              type="text"
              autoComplete="off"
              value={renameTitle}
              onChange={(event) => {
                onRenameTitleChange(event.target.value);
                if (renameError) {
                  onRenameErrorChange('');
                }
              }}
              onKeyDown={onRenameKeyDown}
              aria-invalid={renameError ? 'true' : undefined}
              aria-describedby={renameError ? 'conversation-title-error' : undefined}
              autoFocus
            />
            <div className="rename-actions">
              <button type="submit" disabled={isRenamingConversation}>
                Save
              </button>
              <button
                type="button"
                onClick={onCancelRename}
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
      {selectedConversation && !isRenaming && (
        <button className="rename-button" type="button" onClick={onStartRename}>
          Rename
        </button>
      )}
    </header>
  );
}
