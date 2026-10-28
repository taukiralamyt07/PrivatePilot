import React, { useRef } from 'react';
import { GemmaModelStatus } from '../types/gemma';

interface PromptInputProps {
  instruction: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  status: GemmaModelStatus;
  onShowNotice: (message: string) => void;
  onOpenSettings?: () => void;
  activePageTitle?: string;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  instruction,
  onChange,
  onSubmit,
  status,
  onShowNotice,
  onOpenSettings,
  activePageTitle
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isReady = status === 'ready';
  const isGenerating = status === 'generating';
  const isBusy = status === 'loading' || status === 'unloading' || isGenerating;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isReady) {
        onShowNotice('Gemma 4 is not loaded. Open Settings to load local AI.');
        return;
      }
      if (isBusy || !instruction.trim()) {
        return;
      }
      onSubmit();
    }
  };

  const handleSendClick = () => {
    if (!isReady) {
      onShowNotice('Gemma 4 is not loaded. Open Settings to load local AI.');
      return;
    }
    if (isBusy || !instruction.trim()) {
      return;
    }
    onSubmit();
  };

  const getPlaceholder = () => {
    if (isGenerating) {
      return 'Gemma 4 is answering…';
    }
    if (activePageTitle) {
      return 'Ask about this page…';
    }
    return 'Ask a question…';
  };

  return (
    <div className="prompt-input-wrapper">
      {/* Friendly helper when model is unloaded */}
      {!isReady && !isBusy && (
        <div className="unloaded-model-hint" role="status">
          <span>Local AI model is not loaded yet.</span>
          {onOpenSettings && (
            <button
              type="button"
              className="btn-open-settings-inline"
              onClick={onOpenSettings}
            >
              Open Settings &rarr;
            </button>
          )}
        </div>
      )}

      {/* Input Box */}
      <div className="input-container" role="form" aria-label="Ask assistant">
        <textarea
          ref={textareaRef}
          className="instruction-textarea"
          placeholder={getPlaceholder()}
          value={instruction}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={isGenerating}
          aria-label="Your message or instruction"
        />

        <div className="input-actions-row">
          <span className="input-hint-badge">
            {activePageTitle ? (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span>Page context active</span>
              </>
            ) : (
              <span>Shift+Enter for newline</span>
            )}
          </span>

          <button
            type="button"
            className="send-btn"
            onClick={handleSendClick}
            disabled={!instruction.trim() || isGenerating}
            title={
              !isReady
                ? 'Gemma 4 is not loaded (Click to open guidance)'
                : isGenerating
                ? 'Generating answer…'
                : 'Send message'
            }
            aria-label="Send message"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {/* Privacy Indicator */}
      <div className="privacy-indicator-bar" aria-label="Privacy guarantee">
        <svg
          className="privacy-indicator-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Designed for local, private AI</span>
      </div>
    </div>
  );
};
