import React, { useState } from 'react';
import { ExtractedPageContent, PageReaderStatus } from '../types/pageReader';
import { GemmaModelStatus } from '../types/gemma';

interface PageReaderCardProps {
  pageContent: ExtractedPageContent | null;
  readerStatus: PageReaderStatus;
  readerError: string | null;
  modelStatus: GemmaModelStatus;
  onReadPage: () => void;
  onClearPage: () => void;
  onAskPageQuestion: (question: string) => void;
  onExplainSimply: () => void;
  onAssistWithForm: () => void;
  onShowNotice: (message: string) => void;
  onOpenSettings?: () => void;
  isGenerating?: boolean;
  isScanningForm?: boolean;
}

export const PageReaderCard: React.FC<PageReaderCardProps> = ({
  pageContent,
  readerStatus,
  readerError,
  modelStatus,
  onReadPage,
  onClearPage,
  onAskPageQuestion,
  onExplainSimply,
  onAssistWithForm,
  onShowNotice,
  onOpenSettings,
  isGenerating = false,
  isScanningForm = false
}) => {
  const [isPreviewExpanded, setIsPreviewExpanded] = useState<boolean>(false);
  const isReading = readerStatus === 'reading';
  const isModelReady = modelStatus === 'ready';

  const handleExplainSimplyClick = () => {
    if (!pageContent) {
      onShowNotice('Please click "Read this page" first so Private Pilot can read the content.');
      return;
    }
    if (!isModelReady) {
      onShowNotice('Gemma 4 is not loaded. Please load Gemma 4 first in Settings to explain this page.');
      onOpenSettings?.();
      return;
    }
    if (isGenerating) {
      onShowNotice('Gemma 4 is currently generating a response. Please wait.');
      return;
    }
    onExplainSimply();
  };

  const handleQuickAction = (questionText: string) => {
    if (!pageContent) {
      onShowNotice('Please click "Read this page" first so Private Pilot can read the content.');
      return;
    }
    if (!isModelReady) {
      onShowNotice('Gemma 4 is not loaded. Open Settings to load the local AI model.');
      onOpenSettings?.();
      return;
    }
    if (isGenerating) {
      onShowNotice('Gemma 4 is currently generating a response. Please wait.');
      return;
    }
    onAskPageQuestion(questionText);
  };

  return (
    <section className="webpage-section" aria-label="Current Webpage Assistant">
      <div className="webpage-card">
        {/* Card Header & Read Trigger */}
        <div className="webpage-card-header">
          <div className="webpage-label-group">
            <svg
              className="webpage-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span className="webpage-label">Current Webpage</span>
          </div>

          <div className="webpage-header-actions">
            <button
              type="button"
              className="btn-assist-form-header"
              onClick={onAssistWithForm}
              disabled={isScanningForm || isReading}
              title="Detect and assist with form fields on this webpage"
              aria-busy={isScanningForm}
            >
              {isScanningForm ? (
                <>
                  <span className="reading-spinner" style={{ borderColor: 'rgba(37,99,235,0.3)', borderTopColor: '#2563eb' }} aria-hidden="true" />
                  <span>Scanning forms…</span>
                </>
              ) : (
                <>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  <span>Assist with Form</span>
                </>
              )}
            </button>

            <button
              type="button"
              className={`btn-read-page ${pageContent ? 'secondary' : ''}`}
              onClick={onReadPage}
              disabled={isReading}
              title={pageContent ? 'Re-read the active webpage' : 'Read visible content from the active tab'}
              aria-busy={isReading}
            >
              {isReading ? (
                <>
                  <span className="reading-spinner" aria-hidden="true" />
                  <span>Reading page…</span>
                </>
              ) : pageContent ? (
                <>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span>Re-read page</span>
                </>
              ) : (
                <>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <span>Read this page</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* State 1: Not Read Yet */}
        {!pageContent && !isReading && !readerError && (
          <p className="webpage-hint-text">
            Not read yet. Click <strong>Read this page</strong> to analyze the active tab with local AI.
          </p>
        )}

        {/* State 2: Reading in Progress */}
        {isReading && (
          <div className="webpage-reading-state" role="status">
            <span className="reading-spinner" style={{ borderColor: 'rgba(37,99,235,0.3)', borderTopColor: '#2563eb' }} />
            <span>Scanning active tab DOM for visible text…</span>
          </div>
        )}

        {/* State 3: Error / Restricted page */}
        {readerError && !isReading && (
          <div className="webpage-error-alert" role="alert">
            <svg
              className="webpage-error-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{readerError}</span>
          </div>
        )}

        {/* State 4: Page Ready */}
        {pageContent && !isReading && (
          <div className="page-ready-meta">
            <div className="page-title-row">
              <span className="page-title-text" title={pageContent.title}>
                {pageContent.title}
              </span>
              <button
                type="button"
                className="page-btn-clear"
                onClick={onClearPage}
                title="Clear page context"
                aria-label="Clear page context"
              >
                &times;
              </button>
            </div>

            <div className="page-stats-line">
              <span className="page-domain-badge">{pageContent.hostname || 'Webpage'}</span>
              <span>{pageContent.wordCount.toLocaleString()} words</span>
              {pageContent.chunks && pageContent.chunks.length > 1 && (
                <>
                  <span>&bull;</span>
                  <span title={`${pageContent.chunks.length} sections indexed for fast AI retrieval`}>
                    {pageContent.chunks.length} sections
                  </span>
                </>
              )}
              {pageContent.truncated && (
                <span
                  className="page-badge-truncated"
                  title="Content was truncated at safe capacity limit"
                >
                  Long page (truncated)
                </span>
              )}
              <span>&bull;</span>
              <span>Page ready</span>
            </div>

            {/* Compact preview */}
            <div className="page-preview-box">
              <div className="page-preview-header">
                <span>Text preview</span>
                <button
                  type="button"
                  className="page-preview-toggle"
                  onClick={() => setIsPreviewExpanded((prev) => !prev)}
                >
                  {isPreviewExpanded ? 'Hide preview' : 'Show preview'}
                </button>
              </div>

              {isPreviewExpanded ? (
                <div className="page-preview-expanded" tabIndex={0}>
                  {pageContent.text}
                </div>
              ) : (
                <p className="page-preview-snippet">
                  {pageContent.text.substring(0, 120)}
                  {pageContent.text.length > 120 ? '…' : ''}
                </p>
              )}
            </div>

            {/* Phase 5: Action Row when Page Content is Available */}
            <div className="page-actions-section">
              <div className="page-actions-row">
                <button
                  type="button"
                  className="btn-explain-simply"
                  onClick={handleExplainSimplyClick}
                  disabled={isGenerating || isReading}
                  title="Explain the current webpage in simple, beginner-friendly language"
                  aria-busy={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <span className="reading-spinner" aria-hidden="true" />
                      <span>Explaining page…</span>
                    </>
                  ) : (
                    <>
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                      <span>Explain Simply</span>
                    </>
                  )}
                </button>

                <div className="quick-actions-bar" aria-label="Additional quick webpage actions">
                  <button
                    type="button"
                    className="quick-action-btn"
                    onClick={() => handleQuickAction('Summarize this page in 3 concise bullet points.')}
                    disabled={isGenerating}
                    title="Summarize in 3 bullet points"
                  >
                    <span>Summarize page</span>
                  </button>
                  <button
                    type="button"
                    className="quick-action-btn"
                    onClick={() => handleQuickAction('What are the main key points on this page?')}
                    disabled={isGenerating}
                    title="Ask about key points"
                  >
                    <span>Ask about page</span>
                  </button>
                  <button
                    type="button"
                    className="quick-action-btn"
                    onClick={onAssistWithForm}
                    disabled={isGenerating || isScanningForm}
                    title="Scan and assist with form fields on this page"
                  >
                    <span>Assist with Form</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
