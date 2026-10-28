import React from 'react';
import {
  GemmaModelStatus,
  HardwareCompatibilityReport,
  LoadingProgress,
  GEMMA_4_E2B_Q4F16,
  GEMMA_4_E2B_Q4F32
} from '../types/gemma';

interface ModelControlCardProps {
  status: GemmaModelStatus;
  progress: LoadingProgress;
  compatReport: HardwareCompatibilityReport | null;
  selectedModelId: string;
  onSelectModelId: (modelId: string) => void;
  onCheckCompatibility: () => void;
  onLoadModel: () => void;
  onUnloadModel: () => void;
  onClearKVCache?: () => void;
  errorMessage: string | null;
}

export const ModelControlCard: React.FC<ModelControlCardProps> = ({
  status,
  progress,
  compatReport,
  selectedModelId,
  onSelectModelId,
  onCheckCompatibility,
  onLoadModel,
  onUnloadModel,
  onClearKVCache,
  errorMessage
}) => {
  const isBusy = status === 'loading' || status === 'generating' || status === 'unloading';
  const isReady = status === 'ready';

  // Real lifecycle status labels strictly matching requirement:
  // Not Loaded, Loading, Ready, Unloading, Error
  const getLifecycleStatusLabel = () => {
    switch (status) {
      case 'loading':
        return `Loading (${progress.progress}%)`;
      case 'ready':
        return 'Ready';
      case 'generating':
        return 'Ready (Generating)';
      case 'unloading':
        return 'Unloading';
      case 'error':
        return 'Error';
      case 'checking_compatibility':
        return 'Checking...';
      case 'compatibility_checked':
        return 'Not Loaded (Verified)';
      case 'unloaded':
      case 'uninitialized':
      default:
        return 'Not Loaded';
    }
  };

  const getPillClass = () => {
    switch (status) {
      case 'ready':
      case 'generating':
        return 'pill-ready';
      case 'loading':
        return 'pill-loading';
      case 'unloading':
        return 'pill-unloading';
      case 'error':
        return 'pill-error';
      case 'checking_compatibility':
      case 'compatibility_checked':
        return 'pill-checking_compatibility';
      default:
        return 'pill-unloaded';
    }
  };

  return (
    <div className="model-control-card" role="region" aria-label="Gemma 4 Model Controls">
      {/* Header bar */}
      <div className="model-card-header">
        <div className="model-identity">
          <div className="model-badge-icon" aria-hidden="true">
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
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
          </div>
          <div>
            <div className="model-name-row">
              <span className="model-title">Google Gemma 4 E2B IT</span>
              <span className="model-type-tag">Edge 2B</span>
            </div>
            <span className="model-subinfo">Official WebLLM Local WebGPU Engine</span>
          </div>
        </div>

        {/* Real Model Lifecycle Status Indicator */}
        <div className={`model-status-pill ${getPillClass()}`}>
          <span className="status-indicator-dot" />
          <span className="lifecycle-status-text">{getLifecycleStatusLabel()}</span>
        </div>
      </div>

      {/* Model variant selector */}
      <div className="model-variant-row">
        <label htmlFor="model-variant-select" className="variant-label">
          Model Variant:
        </label>
        <select
          id="model-variant-select"
          className="variant-select"
          value={selectedModelId}
          disabled={isBusy || isReady}
          onChange={(e) => onSelectModelId(e.target.value)}
        >
          <option value={GEMMA_4_E2B_Q4F16}>
            q4f16_1 (Recommended &bull; ~2.64 GB download &bull; ~3.39 GB VRAM)
          </option>
          <option value={GEMMA_4_E2B_Q4F32}>
            q4f32_1 (Fallback &bull; No shader-f16 required &bull; ~3.86 GB VRAM)
          </option>
        </select>
      </div>

      {/* Hardware Warning banner (integrated GPU memory notice) */}
      <div className="integrated-gpu-warning" role="note">
        <div className="warning-icon-wrapper">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="warning-text">
          <strong>Low-Memory Architecture Notice:</strong> Integrated graphics dynamically
          share host RAM (16 GB total, 50–70% currently idle). Loading Gemma 4 allocates ~3.39 GB.
          Neither Chrome nor WebGPU enforces a hard OS-level RAM limit; memory safety is maintained
          by restricting context to ≤1024 tokens and output to ≤256 tokens.
        </div>
      </div>

      {/* Compatibility report details if checked */}
      {compatReport && (
        <div className="compatibility-summary-box">
          <div className="compat-header">
            <span className="compat-title">Diagnostic Results</span>
            <span className={`compat-badge compat-${compatReport.overallStatus}`}>
              {compatReport.overallStatus.toUpperCase()}
            </span>
          </div>

          <div className="compat-grid">
            <div className="compat-item">
              <span className="compat-label">WebGPU:</span>
              <span className="compat-value">
                {compatReport.hasWebGPU ? 'Available (navigator.gpu)' : 'Not Supported'}
              </span>
            </div>
            <div className="compat-item">
              <span className="compat-label">Adapter:</span>
              <span className="compat-value" title={compatReport.adapterName}>
                {compatReport.adapterName}
              </span>
            </div>
            <div className="compat-item">
              <span className="compat-label">shader-f16:</span>
              <span className="compat-value">
                {compatReport.hasShaderF16 ? 'Supported (q4f16 ready)' : 'Missing (Use q4f32 fallback)'}
              </span>
            </div>
            <div className="compat-item">
              <span className="compat-label">Max Buffer:</span>
              <span className="compat-value">
                {compatReport.maxBufferSizeMB} MB (Req: 192 MB)
              </span>
            </div>
          </div>

          {compatReport.blockers.length > 0 && (
            <div className="compat-blockers">
              {compatReport.blockers.map((b, i) => (
                <div key={i} className="blocker-item">
                  &bull; {b}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress display during download / initialization */}
      {status === 'loading' && (
        <div className="loading-progress-container" role="status" aria-live="polite">
          <div className="progress-info-row">
            <span className="progress-label">Downloading &amp; Initializing Gemma 4:</span>
            <span className="progress-pct">{progress.progress}%</span>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
          <p className="progress-detail-text">
            {progress.text || 'Connecting to Hugging Face & compiling WebGPU shaders...'}
          </p>
        </div>
      )}

      {/* Error state alert */}
      {status === 'error' && errorMessage && (
        <div className="model-error-banner" role="alert">
          <strong>Initialization Error:</strong> {errorMessage}
        </div>
      )}

      {/* Model Controls: Check Compatibility, Load Gemma 4, and Unload Model */}
      <div className="model-actions-container">
        <button
          type="button"
          className="model-action-btn secondary-action-btn"
          onClick={onCheckCompatibility}
          disabled={isBusy}
          title="Detect WebGPU support, shader-f16 feature, and buffer limits"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Check Compatibility
        </button>

        <div className="model-actions-row">
          {/* Load Gemma 4: enabled when Not Loaded, disabled while loading or when Ready */}
          <button
            type="button"
            className="model-action-btn primary-action-btn"
            onClick={onLoadModel}
            disabled={
              isReady ||
              isBusy ||
              (compatReport !== null &&
                selectedModelId === GEMMA_4_E2B_Q4F16 &&
                !compatReport.canRunQ4F16)
            }
            title={
              isReady
                ? 'Model is already loaded and ready'
                : isBusy
                ? 'Model is loading...'
                : 'Explicitly start downloading and loading Gemma 4 E2B IT'
            }
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {status === 'loading'
              ? `Loading (${progress.progress}%)`
              : isReady
              ? 'Gemma 4 Loaded'
              : 'Load Gemma 4'}
          </button>

          {/* Unload Model: always visible, disabled until model is loaded */}
          <button
            type="button"
            className="model-action-btn unload-action-btn"
            onClick={onUnloadModel}
            disabled={!isReady || isBusy}
            title={
              !isReady
                ? 'Unload Model is disabled because the model is not loaded'
                : 'Release WebGPU buffers, KV cache, and model engine'
            }
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="9" x2="15" y2="15" />
              <line x1="15" y1="9" x2="9" y2="15" />
            </svg>
            Unload Model
          </button>
        </div>

        {/* Optional KV Cache Flush when Ready */}
        {isReady && onClearKVCache && (
          <button
            type="button"
            className="model-action-btn cache-action-btn"
            onClick={onClearKVCache}
            disabled={isBusy}
            title="Dispose attention KV cache tensors without unloading weights"
          >
            Clear KV Cache (Free Context Memory)
          </button>
        )}
      </div>
    </div>
  );
};
