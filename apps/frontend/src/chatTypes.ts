export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id?: string;
  conversation_id?: string;
  role: ChatRole;
  content: string;
  created_at?: string;
  isError?: boolean;
};

export type ConversationSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: ChatMessage[];
};
