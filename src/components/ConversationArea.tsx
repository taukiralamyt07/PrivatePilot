import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../types/chat';
import { ChatMessageBubble } from './ChatMessageBubble';

interface ConversationAreaProps {
  messages: ChatMessage[];
  onSelectPrompt: (prompt: string) => void;
  onLoadSample: () => void;
}

export const ConversationArea: React.FC<ConversationAreaProps> = ({
  messages,
  onSelectPrompt: _onSelectPrompt,
  onLoadSample
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="empty-welcome-area" role="region" aria-label="Welcome area">
        <div className="welcome-icon-box" aria-hidden="true">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="12 2 19 21 12 17 5 21 12 2" fill="currentColor" fillOpacity="0.15" />
          </svg>
        </div>

        <h2 className="welcome-heading">What can I help you with?</h2>
        <p className="welcome-description">
          Ask questions about the current page, request a concise summary, or chat with on-device AI.
        </p>

        <button
          type="button"
          className="quick-action-btn"
          style={{ marginTop: '8px' }}
          onClick={onLoadSample}
          title="Preview sample conversation"
        >
          <span>Preview sample conversation</span>
        </button>
      </div>
    );
  }

  return (
    <div className="conversation-message-list" role="log" aria-label="Conversation history">
      {messages.map((msg) => (
        <ChatMessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} className="scroll-anchor" />
    </div>
  );
};
