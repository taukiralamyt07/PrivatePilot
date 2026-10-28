export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  statusNote?: string;
  isStreaming?: boolean;
  pageContextTitle?: string;
}
