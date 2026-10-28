import React from 'react';
import { ChatMessage } from '../types/chat';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

const renderFormattedText = (text: string): React.ReactNode => {
  if (!text) return text;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={index} className="bubble-strong">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
};

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const timeFormatted = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className={`chat-bubble-row ${isUser ? 'user-row' : 'assistant-row'}`}>
      {!isUser && (
        <div className="assistant-avatar" aria-hidden="true">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="12 2 19 21 12 17 5 21 12 2" fill="currentColor" fillOpacity="0.25" />
          </svg>
        </div>
      )}

      <div className={`chat-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'}`}>
        <div className="bubble-header">
          <span className="bubble-author">{isUser ? 'You' : 'Gemma 4 IT'}</span>
          <span className="bubble-time">{timeFormatted}</span>
        </div>

        {message.pageContextTitle && (
          <div
            className="bubble-page-context-tag"
            title={`Referenced webpage: ${message.pageContextTitle}`}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>Page: {message.pageContextTitle}</span>
          </div>
        )}

        <div className="bubble-content">
          {!message.content && message.isStreaming && (
            <div className="streaming-indicator" aria-live="polite">
              <span className="streaming-dot" />
              <span className="streaming-dot" />
              <span className="streaming-dot" />
              <span className="streaming-text">Gemma 4 is thinking...</span>
            </div>
          )}

          {message.content.split('\n').map((line, idx) => {
            if (!line.trim()) {
              return <div key={idx} className="bubble-spacer" />;
            }
            if (line.startsWith('• ') || line.startsWith('- ')) {
              const cleanLine = line.replace(/^[•-]\s*/, '');
              return (
                <div key={idx} className="bubble-bullet-item">
                  <span className="bullet-dot">&bull;</span>
                  <span>{renderFormattedText(cleanLine)}</span>
                </div>
              );
            }
            return <p key={idx}>{renderFormattedText(line)}</p>;
          })}

          {message.isStreaming && message.content && (
            <span className="streaming-cursor" aria-hidden="true">▋</span>
          )}
        </div>

        {message.statusNote && (
          <div className="bubble-status-note">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{message.statusNote}</span>
          </div>
        )}
      </div>
    </div>
  );
};
