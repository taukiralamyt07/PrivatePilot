import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { ConversationArea } from './components/ConversationArea';
import { PromptInput } from './components/PromptInput';
import { SettingsPanel } from './components/SettingsPanel';
import { PageReaderCard } from './components/PageReaderCard';
import { ChatMessage } from './types/chat';
import {
  GemmaConfig,
  GemmaModelStatus,
  HardwareCompatibilityReport,
  LoadingProgress
} from './types/gemma';
import { ExtractedPageContent, PageReaderStatus } from './types/pageReader';
import { FormScanResult, ApprovedFormFieldToFill } from './types/form';
import {
  gemmaService,
  checkHardwareCompatibility,
  GenerationMetrics
} from './services/gemmaService';
import { readActiveWebpage, clearPageCache } from './services/pageReaderService';
import {
  retrieveRelevantContext,
  isDetailedExplanationRequest
} from './services/pageRetrievalService';
import {
  scanActiveTabForms,
  fillApprovedFormFields,
  buildFormSuggestionPrompt,
  parseFormSuggestions
} from './services/formService';
import { FormAssistantPanel } from './components/FormAssistantPanel';

export const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [instruction, setInstruction] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'model'>('profile');
  const [notification, setNotification] = useState<string | null>(null);

  // Gemma 4 local inference state: starts in 'unloaded' state without downloading or allocating
  const [modelStatus, setModelStatus] = useState<GemmaModelStatus>(gemmaService.getStatus());
  const [progress, setProgress] = useState<LoadingProgress>(gemmaService.getProgress());
  const [compatReport, setCompatReport] = useState<HardwareCompatibilityReport | null>(null);
  const [config, setConfig] = useState<GemmaConfig>(gemmaService.getConfig());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Phase 4: Active Webpage Reader State
  const [pageContent, setPageContent] = useState<ExtractedPageContent | null>(null);
  const [readerStatus, setReaderStatus] = useState<PageReaderStatus>('idle');
  const [readerError, setReaderError] = useState<string | null>(null);

  // Phase 6: Safe Form Assistant State
  const [isFormAssistantOpen, setIsFormAssistantOpen] = useState<boolean>(false);
  const [isScanningForm, setIsScanningForm] = useState<boolean>(false);
  const [scannedForm, setScannedForm] = useState<FormScanResult | null>(null);

  // Subscribe to service state changes
  useEffect(() => {
    const unsubStatus = gemmaService.onStatusChange((newStatus) => {
      setModelStatus(newStatus);
      if (newStatus === 'ready') {
        setErrorMessage(null);
        showNotification('Gemma 4 is ready for private local queries.');
      } else if (newStatus === 'error') {
        const err = gemmaService.getLastError();
        setErrorMessage(err);
      }
    });

    const unsubProgress = gemmaService.onProgressChange((p) => {
      setProgress(p);
    });

    return () => {
      unsubStatus();
      unsubProgress();
    };
  }, []);

  const showNotification = (text: string) => {
    setNotification(text);
  };

  const handleClearConversation = async () => {
    setMessages([]);
    try {
      await gemmaService.clearKVCache();
      showNotification('Conversation history and cache cleared.');
    } catch {
      showNotification('Conversation history cleared.');
    }
  };

  const handleClearKVCache = useCallback(async () => {
    try {
      await gemmaService.clearKVCache();
      showNotification('GPU memory cache cleared.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`Clear cache error: ${msg}`);
    }
  }, []);

  const handleSelectPrompt = (prompt: string) => {
    setInstruction(prompt);
  };

  const handleCheckCompatibility = useCallback(async () => {
    setModelStatus('checking_compatibility');
    try {
      const report = await checkHardwareCompatibility();
      setCompatReport(report);
      setModelStatus('compatibility_checked');
      if (report.overallStatus === 'supported' || report.overallStatus === 'warning') {
        showNotification(`Hardware check: ${report.summary}`);
      } else {
        showNotification(`Hardware check warning: ${report.summary}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Compatibility check failed: ${msg}`);
      setModelStatus('unloaded');
    }
  }, []);

  const handleLoadModel = useCallback(async () => {
    setErrorMessage(null);
    try {
      await gemmaService.loadModel(config);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      showNotification(`Model load failed: ${msg}`);
    }
  }, [config]);

  const handleUnloadModel = useCallback(async () => {
    try {
      await gemmaService.unloadModel();
      showNotification('Gemma 4 model unloaded.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`Unload error: ${msg}`);
    }
  }, []);

  const handleUpdateConfig = useCallback((newConfig: Partial<GemmaConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...newConfig };
      gemmaService.setConfig(updated);
      return updated;
    });
  }, []);

  const handleReadPage = useCallback(async () => {
    setReaderError(null);
    setReaderStatus('reading');
    try {
      const isReread = Boolean(pageContent);
      const res = await readActiveWebpage({ forceRefresh: isReread });
      if (res.success && res.data) {
        setPageContent(res.data);
        setReaderStatus('success');
        const chunkCount = res.data.chunks?.length || 0;
        const chunkInfo = chunkCount > 0 ? ` across ${chunkCount} sections` : '';
        const timeInfo = res.data.extractionTimeMs !== undefined ? ` in ${res.data.extractionTimeMs.toFixed(0)}ms` : '';
        showNotification(
          `Read "${res.data.title}" (${res.data.wordCount.toLocaleString()} words${chunkInfo}${timeInfo}).`
        );
      } else {
        setReaderStatus('error');
        const err = res.unsupportedReason || res.error || 'Failed to read active tab.';
        setReaderError(err);
        showNotification(err);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setReaderStatus('error');
      setReaderError(msg);
      showNotification(`Page read error: ${msg}`);
    }
  }, [pageContent]);

  const handleClearPage = useCallback(() => {
    clearPageCache();
    setPageContent(null);
    setReaderStatus('idle');
    setReaderError(null);
    showNotification('Page context cleared.');
  }, []);

  const handleSubmitInstruction = useCallback(
    async (promptOverride?: string) => {
      const queryText = (typeof promptOverride === 'string' ? promptOverride : instruction).trim();
      if (!queryText) return;
      if (modelStatus !== 'ready') {
        showNotification('Gemma 4 is not loaded. Open Settings to load local AI.');
        setIsSettingsOpen(true);
        return;
      }

      const queryStartTime = performance.now();
      const now = Date.now();
      const userMsgId = `user-${now}`;
      const assistantMsgId = `assistant-${now}`;

      const userMessage: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: queryText,
        pageContextTitle: pageContent ? pageContent.title : undefined,
        timestamp: now
      };

      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: now,
        isStreaming: true,
        statusNote: pageContent
          ? `Gemma 4 • Page: ${pageContent.hostname}`
          : 'Gemma 4'
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      if (!promptOverride) {
        setInstruction('');
      }

      // Fast local retrieval and dynamic context preparation
      let promptToSend = queryText;
      let targetMaxTokens = 120;
      let retrievalTimeMs = 0;
      let matchedSection = '';

      if (pageContent) {
        const retrieval = retrieveRelevantContext(pageContent, queryText);
        retrievalTimeMs = retrieval.retrievalTimeMs;
        matchedSection = retrieval.primarySection;
        const isDetailed = isDetailedExplanationRequest(queryText);
        // Default to concise output tokens (120 tokens ~ 2-3 sentences) to achieve 4-8s response times,
        // while honoring user requests for comprehensive explanations (up to 256 tokens)
        targetMaxTokens = isDetailed ? 256 : 120;

        if (retrieval.hasConfidentMatch) {
          const concisenessInstruction = isDetailed
            ? 'Provide a clear, detailed, and structured explanation based strictly on the context.'
            : 'Provide a direct, concise answer in 2 to 3 sentences based strictly on the context.';

          promptToSend = `You are Private Pilot, a fast on-device browser assistant. Answer the user's question using ONLY the provided webpage context from "${pageContent.title}".

Webpage Context [Section: ${retrieval.primarySection}]:
"""
${retrieval.contextText}
"""

Question: ${queryText}

Instructions:
- ${concisenessInstruction}
- Rely strictly on the webpage context provided above.
- If the context does not contain enough information to answer, state: "The extracted page context does not contain information to answer this question."`;
        } else {
          // Unrelated question or topic absent from webpage
          const topTopics =
            pageContent.chunks && pageContent.chunks.length > 0
              ? pageContent.chunks.slice(0, 5).map((c) => c.heading).filter(Boolean).join(', ')
              : pageContent.title;

          promptToSend = `You are Private Pilot, an on-device browser assistant.
The user is viewing the webpage "${pageContent.title}" (${pageContent.hostname}).
This webpage covers: ${topTopics}.

Question: ${queryText}

Instructions:
The requested topic "${queryText}" was not found in the extracted content of "${pageContent.title}".
Acknowledge this limitation directly and state clearly that this information is not present on the current webpage. Do not invent facts or guess.`;
        }
      }

      const metricsRef: { current: GenerationMetrics | null } = { current: null };

      try {
        await gemmaService.generateStreaming(
          promptToSend,
          messages,
          (_token: string, accumulated: string) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? { ...msg, content: accumulated, isStreaming: true }
                  : msg
              )
            );
          },
          {
            maxTokens: targetMaxTokens,
            onMetrics: (m) => {
              metricsRef.current = m;
            }
          }
        );

        const totalQueryTimeMs = performance.now() - queryStartTime;

        // Build clean development diagnostics status note (no sensitive page content exposed)
        let timingBadge = '';
        const recordedMetrics = metricsRef.current;
        if (recordedMetrics) {
          const retPart = retrievalTimeMs > 0 ? `Retrieval: ${retrievalTimeMs < 1 ? '<1' : retrievalTimeMs.toFixed(0)}ms • ` : '';
          timingBadge = `${(totalQueryTimeMs / 1000).toFixed(1)}s (${retPart}Gen: ${(recordedMetrics.generationTimeMs / 1000).toFixed(1)}s)`;
        } else {
          timingBadge = `${(totalQueryTimeMs / 1000).toFixed(1)}s`;
        }

        const sectionPart = matchedSection ? ` • ${matchedSection}` : '';
        const finalStatusNote = pageContent
          ? `Gemma 4 • ${timingBadge}${sectionPart} • ${pageContent.hostname}`
          : `Gemma 4 • ${timingBadge}`;

        // Finalize streaming
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, isStreaming: false, statusNote: finalStatusNote }
              : msg
          )
        );
      } catch (err: unknown) {
        const errorText = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content:
                    msg.content ||
                    'Generation failed. The model encountered an error during inference.',
                  statusNote: `Error: ${errorText.substring(0, 80)}`,
                  isStreaming: false
                }
              : msg
          )
        );
        showNotification(`Inference error: ${errorText}`);
      }
    },
    [instruction, modelStatus, config, messages, pageContent]
  );

  const handleAskPageQuestion = useCallback(
    (question: string) => {
      if (modelStatus !== 'ready') {
        showNotification('Gemma 4 is not loaded. Open Settings to load local AI.');
        setIsSettingsOpen(true);
        return;
      }
      handleSubmitInstruction(question);
    },
    [modelStatus, handleSubmitInstruction]
  );

  const handleExplainSimply = useCallback(async () => {
    if (!pageContent) {
      showNotification('Please click "Read this page" first so Private Pilot can read the content.');
      return;
    }
    if (modelStatus === 'generating') {
      showNotification('Gemma 4 is currently generating a response. Please wait.');
      return;
    }
    if (modelStatus !== 'ready') {
      showNotification('Gemma 4 is not loaded. Please load Gemma 4 first in Settings to explain this page.');
      setIsSettingsOpen(true);
      return;
    }

    const now = Date.now();
    const userMsgId = `user-${now}`;
    const assistantMsgId = `assistant-${now}`;

    const userMessage: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: `Explain "${pageContent.title}" simply`,
      pageContextTitle: pageContent.title,
      timestamp: now
    };

    const assistantMessage: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: now,
      isStreaming: true,
      statusNote: `Gemma 4 • Explain Simply • ${pageContent.hostname}`
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    // Bounded context window for memory safety and graceful long webpage handling:
    // Gemma 4 E2B IT operates within a safe 1024-token budget. Bounding text to 1800 chars
    // leaves ample budget for instructions and the max 256 generated tokens.
    const safePageText =
      pageContent.text.length > 1800
        ? pageContent.text.substring(0, 1800) + '...'
        : pageContent.text;

    const longPageNotice =
      pageContent.truncated || pageContent.text.length > 1800
        ? `\n[Note: This is a long webpage. The provided context includes the first ${pageContent.wordCount.toLocaleString()} words.]`
        : '';

    const promptToSend = `You are a helpful reading assistant explaining a webpage in simple terms for a beginner.

Webpage Title: "${pageContent.title}"
Domain: "${pageContent.hostname}"${longPageNotice}
Webpage Content:
"""
${safePageText}
"""

Please explain this webpage simply according to these strict rules:
1. Grounding: Answer ONLY based on the webpage text provided above. If the text does not contain enough information, clearly state "The page does not provide enough information on this" instead of inventing facts.
2. Short Summary: Write a 1-2 sentence overview of what this page is about in plain, simple everyday language.
3. Key Points: Provide 3 to 4 bullet points highlighting the main ideas or takeaways simply.
4. Difficult Terms Explained: Identify 1 to 3 technical, complex, or unfamiliar terms from the text and explain what they mean in plain language. If there are no difficult terms, write "None".

Format your response using these exact section headers:
**Summary**
[1-2 plain sentences]

**Key Points**
• [Point 1]
• [Point 2]
• [Point 3]

**Difficult Terms Explained**
• [Term]: [Simple definition]`;

    const explainStartTime = performance.now();
    const explainMetricsRef: { current: GenerationMetrics | null } = { current: null };

    try {
      await gemmaService.generateStreaming(
        promptToSend,
        messages,
        (_token: string, accumulated: string) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: accumulated, isStreaming: true }
                : msg
            )
          );
        },
        {
          maxTokens: 256,
          onMetrics: (m) => {
            explainMetricsRef.current = m;
          }
        }
      );

      const totalExplainTimeMs = performance.now() - explainStartTime;
      const recordedExplain = explainMetricsRef.current;
      const timingNote = recordedExplain
        ? `${(totalExplainTimeMs / 1000).toFixed(1)}s (Gen: ${(recordedExplain.generationTimeMs / 1000).toFixed(1)}s)`
        : `${(totalExplainTimeMs / 1000).toFixed(1)}s`;

      // Finalize streaming
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                isStreaming: false,
                statusNote: `Gemma 4 • Explain Simply • ${timingNote} • ${pageContent.hostname}`
              }
            : msg
        )
      );
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content:
                  msg.content ||
                  'Explanation failed. The local model encountered an error during inference.',
                statusNote: `Error: ${errorText.substring(0, 80)}`,
                isStreaming: false
              }
            : msg
        )
      );
      showNotification(`Inference error: ${errorText}`);
    }
  }, [pageContent, modelStatus, messages]);

  const handleTriggerAssistWithForm = useCallback(async () => {
    setIsScanningForm(true);
    try {
      const scan = await scanActiveTabForms();
      if (!scan.success) {
        showNotification(scan.error || 'Failed to inspect form fields on the active tab.');
        return;
      }

      if (scan.fields.length === 0) {
        if (scan.excludedCount > 0) {
          showNotification(
            `No ordinary text fields found on this page (${scan.excludedCount} sensitive or unsupported fields were safely protected).`
          );
        } else {
          showNotification('No ordinary form fields found on the active webpage.');
        }
        return;
      }

      setScannedForm(scan);
      setIsFormAssistantOpen(true);
      showNotification(
        `Detected ${scan.fields.length} ordinary field(s). Review and edit values before filling.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`Form scan error: ${msg}`);
    } finally {
      setIsScanningForm(false);
    }
  }, []);

  const handleSuggestWithAI = useCallback(
    async (description: string): Promise<Record<string, string>> => {
      if (!scannedForm) return {};
      if (modelStatus !== 'ready') {
        showNotification('Gemma 4 is not loaded. Open Settings to load local AI.');
        setIsSettingsOpen(true);
        throw new Error('Local Gemma 4 model is not loaded. Please load it first in Settings.');
      }

      const promptToSend = buildFormSuggestionPrompt(scannedForm.fields, description);
      let responseText = '';

      await gemmaService.generateStreaming(
        promptToSend,
        [],
        (_token: string, fullText: string) => {
          responseText = fullText;
        }
      );

      return parseFormSuggestions(responseText, scannedForm.fields);
    },
    [scannedForm, modelStatus]
  );

  const handleApproveAndFill = useCallback(
    async (approvedFields: ApprovedFormFieldToFill[]) => {
      if (!scannedForm) {
        return {
          success: false,
          filledFields: [],
          failedFields: [],
          error: 'No active form session. Please click "Assist with Form" to inspect form fields first.'
        };
      }

      const result = await fillApprovedFormFields(
        scannedForm.pageUrl,
        approvedFields,
        scannedForm.tabId
      );

      if (result.success && result.filledFields.length > 0) {
        const now = Date.now();
        const fillMessage: ChatMessage = {
          id: `fill-${now}`,
          role: 'assistant',
          content: `Safely filled ${result.filledFields.length} field(s) on "${scannedForm.pageTitle}":\n${result.filledFields.map((f) => `• ${f}`).join('\n')}${
            result.failedFields && result.failedFields.length > 0
              ? `\n\nNote: ${result.failedFields.length} field(s) could not be filled (${result.failedFields.join(', ')}).`
              : ''
          }\n\nNote: The form was NOT submitted automatically. Please review the webpage and submit manually when ready.`,
          timestamp: now,
          statusNote: `Form Assistant • ${scannedForm.fields.length} fields detected`
        };
        setMessages((prev) => [...prev, fillMessage]);
      }

      return result;
    },
    [scannedForm]
  );

  const handleLoadSample = () => {
    const now = Date.now();
    const sampleMessages: ChatMessage[] = [
      {
        id: `sample-user-${now}`,
        role: 'user',
        content: 'Summarize the privacy architecture of Private Pilot',
        timestamp: now - 30000
      },
      {
        id: `sample-assistant-${now}`,
        role: 'assistant',
        content:
          'Private Pilot Architecture Summary:\n\n• 100% On-Device Inference: Powered locally by Google Gemma 4 E2B IT using WebGPU.\n• Zero Cloud Endpoints: Prompts and context never leave your browser sandbox.\n• Bounded Resource Management: Context length strictly bounded to ≤1024 tokens to safely operate within shared RAM.\n• Complete User Control: Explicit model loading, KV cache disposal, and full unload controls.',
        timestamp: now,
        statusNote: 'Gemma 4 E2B IT (local)'
      }
    ];

    setMessages(sampleMessages);
    showNotification('Sample conversation loaded.');
  };

  return (
    <div className="sidepanel-container">
      <Header
        onToggleSettings={() => setIsSettingsOpen((prev) => !prev)}
        isSettingsOpen={isSettingsOpen}
        onClearConversation={handleClearConversation}
        hasMessages={messages.length > 0}
      />

      {/* 3 Clear Primary Actions: My Profile, Assist with Form, Fill Form */}
      <nav className="primary-actions-nav" aria-label="Main Actions">
        <button
          type="button"
          className={`primary-action-btn ${isSettingsOpen && settingsTab === 'profile' ? 'active' : ''}`}
          onClick={() => {
            if (isSettingsOpen && settingsTab === 'profile') {
              setIsSettingsOpen(false);
            } else {
              setIsFormAssistantOpen(false);
              setSettingsTab('profile');
              setIsSettingsOpen(true);
            }
          }}
          title="View, edit, and save personal details"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>My Profile</span>
        </button>

        <button
          type="button"
          className={`primary-action-btn ${isScanningForm ? 'loading' : ''} ${isFormAssistantOpen ? 'active' : ''}`}
          onClick={() => {
            setIsSettingsOpen(false);
            handleTriggerAssistWithForm();
          }}
          disabled={isScanningForm}
          title="Detect fields and prepare suggested matches"
        >
          {isScanningForm ? (
            <span className="btn-spinner" aria-hidden="true" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          )}
          <span>Assist with Form</span>
        </button>

        <button
          type="button"
          className="primary-action-btn primary-action-btn-accent"
          onClick={() => {
            if (isFormAssistantOpen && scannedForm) {
              const fillBtn = document.querySelector('.btn-fill-form-primary') as HTMLButtonElement | null;
              if (fillBtn) {
                fillBtn.click();
              } else {
                showNotification('Review matches below and click Fill Form.');
              }
            } else {
              setIsSettingsOpen(false);
              handleTriggerAssistWithForm();
              showNotification('Detecting form fields to prepare matches for review...');
            }
          }}
          title="Fill approved values into the current webpage"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Fill Form</span>
        </button>
      </nav>

      {notification && (
        <div className="notification-banner" role="alert" aria-live="polite">
          <div className="notification-content">
            <svg
              className="notification-icon"
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
            <span>{notification}</span>
          </div>
          <button
            type="button"
            className="notification-close-btn"
            onClick={() => setNotification(null)}
            aria-label="Dismiss message"
          >
            &times;
          </button>
        </div>
      )}

      {isSettingsOpen ? (
        <SettingsPanel
          onClose={() => setIsSettingsOpen(false)}
          messageCount={messages.length}
          onClearConversation={handleClearConversation}
          onLoadSample={handleLoadSample}
          status={modelStatus}
          config={config}
          onUpdateConfig={handleUpdateConfig}
          compatReport={compatReport}
          onCheckCompatibility={handleCheckCompatibility}
          onLoadModel={handleLoadModel}
          onUnloadModel={handleUnloadModel}
          onClearKVCache={handleClearKVCache}
          errorMessage={errorMessage}
          progress={progress}
          onShowNotice={showNotification}
          initialTab={settingsTab}
        />
      ) : isFormAssistantOpen && scannedForm ? (
        <FormAssistantPanel
          pageUrl={scannedForm.pageUrl}
          pageTitle={scannedForm.pageTitle}
          fields={scannedForm.fields}
          excludedCount={scannedForm.excludedCount}
          modelStatus={modelStatus}
          isGenerating={modelStatus === 'generating'}
          onClose={() => setIsFormAssistantOpen(false)}
          onSuggestWithAI={handleSuggestWithAI}
          onApproveAndFill={handleApproveAndFill}
          onOpenSettings={() => {
            setIsFormAssistantOpen(false);
            setSettingsTab('model');
            setIsSettingsOpen(true);
          }}
          onOpenProfileSettings={() => {
            setIsFormAssistantOpen(false);
            setSettingsTab('profile');
            setIsSettingsOpen(true);
          }}
          onShowNotice={showNotification}
        />
      ) : (
        <>
          {/* Current Webpage Section & Quick Actions */}
          <PageReaderCard
            pageContent={pageContent}
            readerStatus={readerStatus}
            readerError={readerError}
            modelStatus={modelStatus}
            onReadPage={handleReadPage}
            onClearPage={handleClearPage}
            onAskPageQuestion={handleAskPageQuestion}
            onExplainSimply={handleExplainSimply}
            onAssistWithForm={handleTriggerAssistWithForm}
            onShowNotice={showNotification}
            onOpenSettings={() => setIsSettingsOpen(true)}
            isGenerating={modelStatus === 'generating'}
            isScanningForm={isScanningForm}
          />

          {/* Chat & Welcome Area */}
          <main className="conversation-scroll-wrapper">
            <ConversationArea
              messages={messages}
              onSelectPrompt={handleSelectPrompt}
              onLoadSample={handleLoadSample}
            />
          </main>

          {/* Bottom Input Dock with Privacy Indicator */}
          <footer className="sidepanel-bottom-dock">
            <PromptInput
              instruction={instruction}
              onChange={setInstruction}
              onSubmit={handleSubmitInstruction}
              status={modelStatus}
              onShowNotice={showNotification}
              onOpenSettings={() => setIsSettingsOpen(true)}
              activePageTitle={pageContent ? pageContent.title : undefined}
            />
          </footer>
        </>
      )}
    </div>
  );
};
