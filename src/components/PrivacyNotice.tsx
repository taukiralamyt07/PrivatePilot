import React, { useState } from 'react';

export const PrivacyNotice: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside className="privacy-banner" aria-label="Privacy Guarantee">
      <div className="privacy-header-row" onClick={() => setIsExpanded((prev) => !prev)}>
        <div className="privacy-title-group">
          <svg
            className="privacy-icon"
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
          <span className="privacy-title">Local Privacy Guarantee</span>
        </div>
        <button
          type="button"
          className="privacy-toggle-btn"
          aria-expanded={isExpanded}
          title={isExpanded ? 'Hide details' : 'Show details'}
        >
          {isExpanded ? 'Hide' : 'Details'}
        </button>
      </div>

      {isExpanded && (
        <div className="privacy-body">
          <p>
            Private Pilot operates 100% on-device inside Chrome. Webpage reading is strictly triggered by your manual clicks, scoped to the active tab, and executed entirely on your local machine.
          </p>
          <ul className="privacy-list">
            <li>Zero Cloud Telemetry: Extracted page text and instructions never leave your browser sandbox.</li>
            <li>No Sensitive Inputs: Form elements, passwords, textareas, and cookies are strictly excluded.</li>
            <li>ActiveTab Permissions Only: No broad access to browsing history or unauthorized background pages.</li>
          </ul>
        </div>
      )}
    </aside>
  );
};
