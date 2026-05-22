import type { FormEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createConversation as createConversationRequest,
  deleteConversation as deleteConversationRequest,
  listConversations,
  loadConversation,
  renameConversation,
  streamChatResponse,
} from './chatApi';
import type { ChatMessage, ConversationSummary } from './chatTypes';

const selectedConversationStorageKey = 'symphony.selectedConversationId';

function replaceConversation(
  conversations: ConversationSummary[],
  replacement: ConversationSummary,
) {
  return conversations.map((conversation) =>
    conversation.id === replacement.id ? replacement : conversation,
  );
}

function replaceStreamingMessage(
  messages: ChatMessage[],
  streamingId: string,
  update: (message: ChatMessage) => ChatMessage,
) {
  return messages.map((message) =>
    message.id === streamingId ? update(message) : message,
  );
}

export function useChatState() {
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
  const [renameTitle, setRenameTitle] = useState('');
  const [renameError, setRenameError] = useState('');
  const [isRenamingConversation, setIsRenamingConversation] = useState(false);

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

    async function restoreConversations() {
      setIsLoadingConversations(true);
      setConversationLoadError(false);

      try {
        const payload = await listConversations();
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

    void restoreConversations();

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

    async function loadSelectedConversation() {
      setIsLoadingThread(true);
      setStatus('Loading conversation...');
      window.localStorage.setItem(
        selectedConversationStorageKey,
        conversationId,
      );

      try {
        const payload = await loadConversation(conversationId);

        if (ignore) {
          return;
        }

        setMessages(payload.messages);
        setConversations((currentConversations) =>
          replaceConversation(currentConversations, payload.conversation),
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

    void loadSelectedConversation();

    return () => {
      ignore = true;
    };
  }, [selectedConversationId]);

  const createConversation = useCallback(async () => {
    setIsCreatingConversation(true);
    setStatus('Creating conversation...');

    try {
      const payload = await createConversationRequest();

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
  }, []);

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      try {
        await deleteConversationRequest(conversationId);

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
    },
    [selectedConversationId],
  );

  const startRenameConversation = useCallback(() => {
    if (!selectedConversation) {
      return;
    }

    setRenamingConversationId(selectedConversation.id);
    setRenameTitle(selectedConversation.title);
    setRenameError('');
  }, [selectedConversation]);

  const cancelRenameConversation = useCallback(() => {
    setRenamingConversationId(null);
    setRenameTitle('');
    setRenameError('');
    setIsRenamingConversation(false);
  }, []);

  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        cancelRenameConversation();
      }
    },
    [cancelRenameConversation],
  );

  const saveConversationTitle = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const conversationId = renamingConversationId;
      const trimmedTitle = renameTitle.trim();

      if (!conversationId) {
        return;
      }

      if (!trimmedTitle) {
        setRenameError('Enter a conversation title.');
        return;
      }

      setIsRenamingConversation(true);
      setRenameError('');

      try {
        const payload = await renameConversation(conversationId, trimmedTitle);
        setConversations((currentConversations) =>
          replaceConversation(currentConversations, payload.conversation),
        );
        setMessages(payload.messages);
        setRenamingConversationId(null);
        setRenameTitle('');
        setStatus('');
      } catch (error) {
        setRenameError(
          error instanceof Error
            ? error.message
            : 'Unable to rename this conversation. Try again.',
        );
      } finally {
        setIsRenamingConversation(false);
      }
    },
    [renameTitle, renamingConversationId],
  );

  const sendMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
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
        await streamChatResponse(conversationId, trimmedMessage, {
          onToken(token) {
            setMessages((currentMessages) =>
              replaceStreamingMessage(currentMessages, streamingId, (msg) => ({
                ...msg,
                content: msg.content + token,
              })),
            );
          },
          onError(errorText) {
            setMessages((currentMessages) =>
              replaceStreamingMessage(currentMessages, streamingId, (msg) => ({
                ...msg,
                content: errorText,
                isError: true,
              })),
            );
          },
          async onDone() {
            const payload = await listConversations();
            setConversations(payload.conversations);
          },
        });
      } catch {
        setMessages((currentMessages) =>
          replaceStreamingMessage(currentMessages, streamingId, (msg) => ({
            ...msg,
            content: 'Unable to send message. Try again.',
            isError: true,
          })),
        );
      } finally {
        setIsSending(false);
      }
    },
    [message, selectedConversationId],
  );

  return {
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
  };
}
