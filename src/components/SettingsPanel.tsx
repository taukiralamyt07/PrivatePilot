import React, { useState } from 'react';
import {
  GemmaConfig,
  GemmaModelStatus,
  HardwareCompatibilityReport,
  LoadingProgress,
  GEMMA_4_E2B_Q4F16,
  GEMMA_4_E2B_Q4F32
} from '../types/gemma';
import { MyProfileSettings } from './MyProfileSettings';
import { UserProfile } from '../types/profile';

interface SettingsPanelProps {
  onClose: () => void;
  messageCount: number;
  onClearConversation: () => void;
  onLoadSample: () => void;
  status: GemmaModelStatus;
  config: GemmaConfig;
  onUpdateConfig: (newConfig: Partial<GemmaConfig>) => void;
  compatReport: HardwareCompatibilityReport | null;
  onCheckCompatibility: () => void;
  onLoadModel: () => void;
  onUnloadModel: () => void;
  onClearKVCache?: () => void;
  errorMessage?: string | null;
  progress?: LoadingProgress;
  onShowNotice?: (msg: string) => void;
  onProfileUpdated?: (profile: UserProfile) => void;
  initialTab?: 'profile' | 'model';
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  onClose,
  messageCount,
  onClearConversation,
  status,
  config,
  onUpdateConfig,
  compatReport,
  onCheckCompatibility,
  onLoadModel,
  onUnloadModel,
  onClearKVCache,
  errorMessage,
  progress,
  onShowNotice,
  onProfileUpdated,
  initialTab = 'profile'
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'model'>(initialTab);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const isReady = status === 'ready';
  const isLoading = status === 'loading';
  const isBusy = isLoading || status === 'generating' || status === 'unloading';

  const getStatusBadge = () => {
    switch (status) {
      case 'ready':
      case 'generating':
        return <span className="status-pill status-pill-ready">Ready</span>;
      case 'loading':
        return <span className="status-pill status-pill-loading">Loading ({progress?.progress || 0}%)</span>;
      case 'unloading':
        return <span className="status-pill status-pill-loading">Unloading…</span>;
      case 'error':
        return <span className="status-pill status-pill-error">Error</span>;
      default:
        return <span className="status-pill status-pill-offline">Not Loaded</span>;
    }
  };

  return (
    <div className="settings-panel-container" role="region" aria-label="Extension Settings">
      {/* Header */}
      <div className="settings-header">
        <div className="settings-title">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Settings</span>
        </div>
        <button
          type="button"
          className="header-btn"
          onClick={onClose}
          aria-label="Close settings"
        >
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Settings Navigation Tabs */}
      <div className="settings-tabs-bar" role="tablist" aria-label="Settings categories">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          className={`settings-tab-btn ${activeTab === 'profile' ? 'settings-tab-btn-active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>My Profile</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'model'}
          className={`settings-tab-btn ${activeTab === 'model' ? 'settings-tab-btn-active' : ''}`}
          onClick={() => setActiveTab('model')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span>AI Engine &amp; Hardware</span>
        </button>
      </div>

      <div className="settings-scroll-body">
        {activeTab === 'profile' ? (
          <MyProfileSettings
            onShowNotice={onShowNotice}
            onProfileUpdated={onProfileUpdated}
          />
        ) : (
          <>
            {/* Section 1: Local Model Management */}
            <div className="settings-card">
          <div className="settings-card-header">
            <span className="settings-card-title">Local AI Engine</span>
            {getStatusBadge()}
          </div>

          <p className="settings-card-desc">
            Private Pilot runs Google Gemma 4 locally inside your browser via WebGPU. No cloud AI or telemetry is used.
          </p>

          {/* Model Load / Unload Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {!isReady ? (
              <button
                type="button"
                className="btn-primary-settings"
                onClick={onLoadModel}
                disabled={isBusy}
              >
                {isLoading ? (
                  <>
                    <span className="reading-spinner" style={{ borderColor: 'rgba(255,255,255,0.4)', borderTopColor: '#fff' }} />
                    <span>Loading Gemma 4 ({progress?.progress || 0}%)…</span>
                  </>
                ) : (
                  <span>Load Gemma 4 E2B IT</span>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary-settings"
                onClick={onUnloadModel}
                disabled={isBusy}
              >
                <span>Unload Gemma 4 (Free GPU Memory)</span>
              </button>
            )}

            {errorMessage && (
              <div className="webpage-error-alert" role="alert">
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          {/* Model selection dropdown */}
          <div className="settings-form-row">
            <label htmlFor="settings-model-variant" className="settings-form-label">
              Model Variant:
            </label>
            <span className="settings-form-help">
              4-bit quantized model for on-device inference.
            </span>
            <select
              id="settings-model-variant"
              className="settings-select"
              value={config.modelId}
              disabled={isReady || isBusy}
              onChange={(e) => onUpdateConfig({ modelId: e.target.value })}
            >
              <option value={GEMMA_4_E2B_Q4F16}>
                gemma-4-E2B-it-q4f16_1-MLC (Recommended, ~3.4 GB)
              </option>
              <option value={GEMMA_4_E2B_Q4F32}>
                gemma-4-E2B-it-q4f32_1-MLC (Fallback without shader-f16)
              </option>
            </select>
          </div>
        </div>

        {/* Section 2: Generation Settings */}
        <div className="settings-card">
          <div className="settings-card-header">
            <span className="settings-card-title">Generation Settings</span>
          </div>

          {/* Context window */}
          <div className="settings-form-row">
            <label htmlFor="settings-context-window" className="settings-form-label">
              Context Window: {config.contextWindowSize} tokens
            </label>
            <span className="settings-form-help">
              Controls memory allocated for webpage content and history.
            </span>
            <select
              id="settings-context-window"
              className="settings-select"
              value={config.contextWindowSize}
              disabled={isReady || isBusy}
              onChange={(e) => onUpdateConfig({ contextWindowSize: Number(e.target.value) })}
            >
              <option value={512}>512 tokens (Compact memory footprint)</option>
              <option value={1024}>1024 tokens (Recommended safe limit)</option>
            </select>
          </div>

          {/* Maximum response tokens */}
          <div className="settings-form-row">
            <label htmlFor="settings-max-tokens" className="settings-form-label">
              Maximum Answer Length: {config.maxGenTokens} tokens
            </label>
            <span className="settings-form-help">
              Shorter responses generate faster and use less memory.
            </span>
            <select
              id="settings-max-tokens"
              className="settings-select"
              value={config.maxGenTokens}
              onChange={(e) => onUpdateConfig({ maxGenTokens: Number(e.target.value) })}
            >
              <option value={128}>128 tokens (Concise answers)</option>
              <option value={256}>256 tokens (Standard answers)</option>
            </select>
          </div>

          {/* Temperature */}
          <div className="settings-form-row">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label htmlFor="settings-temperature" className="settings-form-label">
                Temperature:
              </label>
              <span style={{ fontSize: '11px', fontWeight: 600 }}>{config.temperature}</span>
            </div>
            <span className="settings-form-help">
              Lower is more factual and concise; higher is more creative.
            </span>
            <input
              id="settings-temperature"
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              className="settings-range-slider"
              value={config.temperature}
              onChange={(e) => onUpdateConfig({ temperature: Number(e.target.value) })}
            />
          </div>

          {/* Clear KV Cache */}
          {onClearKVCache && isReady && (
            <div style={{ paddingTop: '6px', borderTop: '1px solid var(--color-border-subtle)' }}>
              <button
                type="button"
                className="btn-secondary-settings"
                style={{ width: '100%' }}
                onClick={onClearKVCache}
              >
                Clear GPU Memory Cache
              </button>
              <span className="settings-form-help" style={{ display: 'block', marginTop: '3px', textAlign: 'center' }}>
                Frees activation cache without unloading model weights.
              </span>
            </div>
          )}
        </div>

        {/* Section 3: Collapsible Hardware Diagnostics */}
        <div className="settings-accordion">
          <button
            type="button"
            className="accordion-trigger"
            onClick={() => setIsDiagnosticsOpen((prev) => !prev)}
            aria-expanded={isDiagnosticsOpen}
          >
            <span>Advanced Diagnostics &amp; Hardware</span>
            <span style={{ fontSize: '11px', color: 'var(--color-text-subtle)' }}>
              {isDiagnosticsOpen ? '▲ Hide' : '▼ Details'}
            </span>
          </button>

          {isDiagnosticsOpen && (
            <div className="accordion-content">
              <button
                type="button"
                className="btn-secondary-settings"
                onClick={onCheckCompatibility}
                disabled={isBusy}
              >
                Run Hardware Compatibility Check
              </button>

              {compatReport ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                  <div className="diag-item">
                    <span className="diag-label">WebGPU:</span>
                    <span className="diag-value">{compatReport.hasWebGPU ? 'Available' : 'Unavailable'}</span>
                  </div>
                  <div className="diag-item">
                    <span className="diag-label">GPU Adapter:</span>
                    <span className="diag-value" title={compatReport.adapterName}>
                      {compatReport.adapterName.length > 25
                        ? compatReport.adapterName.substring(0, 25) + '…'
                        : compatReport.adapterName}
                    </span>
                  </div>
                  <div className="diag-item">
                    <span className="diag-label">Shader F16:</span>
                    <span className="diag-value">{compatReport.hasShaderF16 ? 'Supported' : 'Not supported'}</span>
                  </div>
                  <div className="diag-item">
                    <span className="diag-label">Max Buffer:</span>
                    <span className="diag-value">{compatReport.maxBufferSizeMB} MB</span>
                  </div>
                  <div className="diag-item">
                    <span className="diag-label">Overall:</span>
                    <span className="diag-value" style={{ textTransform: 'capitalize' }}>
                      {compatReport.overallStatus}
                    </span>
                  </div>
                </div>
              ) : (
                <span className="settings-form-help">
                  Click above to inspect your GPU adapter capabilities for WebGPU inference.
                </span>
              )}
            </div>
          )}
        </div>

        {/* Section 4: Data Management & Privacy */}
        <div className="settings-card">
          <div className="settings-card-header">
            <span className="settings-card-title">Data &amp; Privacy</span>
          </div>

          <p className="settings-card-desc">
            All prompts and webpage texts remain strictly on your local computer. No browsing data or chat history is transmitted to any cloud servers.
          </p>

          <button
            type="button"
            className="btn-danger-settings"
            onClick={onClearConversation}
            disabled={messageCount === 0}
          >
            Clear Conversation History
          </button>
        </div>
        </>
      )}
      </div>
    </div>
  );
};
