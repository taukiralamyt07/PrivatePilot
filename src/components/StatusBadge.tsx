import React from 'react';
import { GemmaModelStatus } from '../types/gemma';

interface StatusBadgeProps {
  status: GemmaModelStatus;
  progressPct?: number;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, progressPct = 0 }) => {
  const getStatusText = () => {
    switch (status) {
      case 'loading':
        return `Loading (${progressPct}%)`;
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
      case 'unloaded':
      case 'uninitialized':
      default:
        return 'Not Loaded';
    }
  };

  const getDotClass = () => {
    switch (status) {
      case 'ready':
        return 'dot-ready';
      case 'generating':
      case 'loading':
      case 'unloading':
      case 'checking_compatibility':
        return 'dot-pulsing';
      case 'error':
        return 'dot-error';
      default:
        return 'dot-offline';
    }
  };

  return (
    <div className="status-bar" role="status" aria-live="polite">
      <div className="status-badge">
        <span className={`status-dot ${getDotClass()}`} aria-hidden="true" />
        <span className="status-text">{getStatusText()}</span>
      </div>
      <span className="phase-indicator">Phase 3 &bull; Gemma 4 Local</span>
    </div>
  );
};
