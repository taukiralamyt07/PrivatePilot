import React, { useState, useEffect, useMemo } from 'react';
import {
  DetectedFormField,
  FieldSuggestion,
  FormFillResult,
  ApprovedFormFieldToFill
} from '../types/form';
import { GemmaModelStatus } from '../types/gemma';
import { logFormDiagnostic } from '../services/formService';
import { loadProfile, hasProfileData } from '../services/profileService';
import { matchProfileToFormFields, AutofillMatchSummary } from '../services/autofillMatcher';
import { UserProfile } from '../types/profile';

interface FormAssistantPanelProps {
  pageUrl: string;
  pageTitle: string;
  fields: DetectedFormField[];
  excludedCount: number;
  modelStatus: GemmaModelStatus;
  isGenerating: boolean;
  onClose: () => void;
  onSuggestWithAI: (description: string) => Promise<Record<string, string>>;
  onApproveAndFill: (approvedFields: ApprovedFormFieldToFill[]) => Promise<FormFillResult>;
  onOpenSettings?: () => void;
  onOpenProfileSettings?: () => void;
  onShowNotice: (msg: string) => void;
}

export const FormAssistantPanel: React.FC<FormAssistantPanelProps> = ({
  pageTitle,
  fields,
  excludedCount,
  onClose,
  onApproveAndFill,
  onOpenProfileSettings,
  onShowNotice
}) => {
  const [savedProfile, setSavedProfile] = useState<UserProfile | null>(null);
  const [profileMatchSummary, setProfileMatchSummary] = useState<AutofillMatchSummary | null>(null);
  const [isFilling, setIsFilling] = useState<boolean>(false);
  const [fillResult, setFillResult] = useState<FormFillResult | null>(null);

  const [suggestions, setSuggestions] = useState<Record<string, FieldSuggestion>>(() => {
    const initial: Record<string, FieldSuggestion> = {};
    fields.forEach((f) => {
      initial[f.id] = {
        fieldId: f.id,
        label: f.label,
        type: f.type,
        value: '',
        approved: false
      };
    });
    return initial;
  });

  // Automatically load local profile and match fields deterministically
  useEffect(() => {
    let isMounted = true;

    loadProfile().then((loadedProfile) => {
      if (!isMounted) return;
      setSavedProfile(loadedProfile);

      if (hasProfileData(loadedProfile)) {
        const summary = matchProfileToFormFields(fields, loadedProfile);
        setProfileMatchSummary(summary);

        setSuggestions(() => {
          const next: Record<string, FieldSuggestion> = {};
          fields.forEach((f) => {
            const outcome = summary.matches.find((m) => m.fieldId === f.id);
            const hasExistingOnPage = Boolean(f.currentValue && f.currentValue.trim());
            const hasConfidentValue = Boolean(outcome && outcome.proposedValue && outcome.proposedValue.trim());

            // Never silently overwrite user-entered values on page without approval
            const shouldApprove = hasConfidentValue && !hasExistingOnPage;

            next[f.id] = {
              fieldId: f.id,
              label: f.label,
              type: f.type,
              value: hasConfidentValue ? outcome!.proposedValue : (hasExistingOnPage ? f.currentValue! : ''),
              approved: shouldApprove
            };
          });
          return next;
        });

        logFormDiagnostic('Autofill', 'Deterministic profile matching completed', {
          matchedCount: summary.matchedCount,
          ambiguousCount: summary.ambiguousCount,
          skippedCount: summary.skippedCount,
          totalFields: fields.length
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, [fields]);

  const handleValueChange = (fieldId: string, val: string) => {
    setSuggestions((prev) => ({
      ...prev,
      [fieldId]: {
        ...prev[fieldId],
        value: val,
        approved: Boolean(val.trim())
      }
    }));
  };

  const handleToggleApproved = (fieldId: string) => {
    setSuggestions((prev) => ({
      ...prev,
      [fieldId]: {
        ...prev[fieldId],
        approved: !prev[fieldId].approved
      }
    }));
  };

  const approvedCount = Object.values(suggestions).filter(
    (s) => s.approved && s.value.trim()
  ).length;

  // Separate fields into Ready vs Needs Review
  const { readyFields, uncertainFields } = useMemo(() => {
    const ready: DetectedFormField[] = [];
    const uncertain: DetectedFormField[] = [];

    fields.forEach((f) => {
      const outcome = profileMatchSummary?.matches.find((m) => m.fieldId === f.id);
      const isAmbiguous = outcome?.confidence === 'ambiguous' || outcome?.matchStatus === 'ambiguous';
      const hasValue = Boolean(suggestions[f.id]?.value && suggestions[f.id].value.trim());

      if (isAmbiguous || !hasValue) {
        uncertain.push(f);
      } else {
        ready.push(f);
      }
    });

    return { readyFields: ready, uncertainFields: uncertain };
  }, [fields, profileMatchSummary, suggestions]);

  const handleFillClick = async () => {
    if (isFilling) return;

    if (approvedCount === 0) {
      onShowNotice('No approved fields to fill. Please review and approve at least one field.');
      return;
    }

    setIsFilling(true);
    setFillResult(null);

    const toFill: ApprovedFormFieldToFill[] = fields
      .filter((f) => suggestions[f.id]?.approved && suggestions[f.id]?.value.trim())
      .map((f) => ({
        fieldId: f.id,
        selector: f.selector,
        label: f.label,
        value: suggestions[f.id].value.trim(),
        name: f.name,
        elementId: f.elementId,
        index: f.index
      }));

    try {
      const res = await onApproveAndFill(toFill);
      setFillResult(res);

      if (res.success) {
        onShowNotice(`Successfully filled and verified ${res.filledFields.length} field(s). Review webpage and submit manually.`);
      } else if (res.filledFields.length > 0) {
        onShowNotice(`Filled ${res.filledFields.length} field(s), but ${res.failedFields.length} field(s) could not be verified.`);
      } else {
        onShowNotice(res.error || 'Form filling failed. Please inspect the webpage.');
      }
    } catch {
      onShowNotice('An unexpected error occurred during form filling.');
    } finally {
      setIsFilling(false);
    }
  };

  return (
    <div className="form-assistant-panel" role="region" aria-label="Form Assistant">
      {/* Header Bar */}
      <div className="form-assistant-header">
        <div className="form-assistant-header-titles">
          <div className="form-assistant-title-row">
            <h2 className="form-assistant-title">Form Assistant</h2>
            <span className="form-badge-private">On-Device</span>
          </div>
          <span className="form-assistant-page-title" title={pageTitle}>
            {pageTitle || 'Active Webpage'}
          </span>
        </div>
        <button
          type="button"
          className="panel-close-btn"
          onClick={onClose}
          aria-label="Close Form Assistant"
          title="Close Form Assistant"
        >
          &times;
        </button>
      </div>

      {/* Compact Matching Summary */}
      <div className="form-matching-summary-banner">
        <div className="summary-banner-stats">
          <span className="summary-stat-total">{fields.length} fields detected</span>
          <span className="summary-dot">·</span>
          <span className="summary-stat-ready">{readyFields.length} ready</span>
          <span className="summary-dot">·</span>
          <span className="summary-stat-review">{uncertainFields.length} need review</span>
        </div>
        {excludedCount > 0 && (
          <span className="summary-stat-excluded">
            ({excludedCount} sensitive excluded)
          </span>
        )}
      </div>

      {/* Primary Action Button Bar */}
      <div className="form-action-bar">
        <button
          type="button"
          className="btn-fill-form-primary"
          onClick={handleFillClick}
          disabled={isFilling || approvedCount === 0}
        >
          {isFilling ? (
            <>
              <span className="btn-spinner" />
              <span>Filling Form…</span>
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Fill Form ({approvedCount} approved)</span>
            </>
          )}
        </button>

        {onOpenProfileSettings && (
          <button
            type="button"
            className="btn-secondary-profile"
            onClick={onOpenProfileSettings}
            title="Edit My Profile"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>My Profile</span>
          </button>
        )}
      </div>

      {/* Fill Result Alert */}
      {fillResult && (
        <div
          className={`form-fill-result-alert ${
            fillResult.success
              ? 'alert-success'
              : fillResult.filledFields.length > 0
              ? 'alert-warning'
              : 'alert-error'
          }`}
          role="status"
        >
          {fillResult.success ? (
            <div>
              <strong>Verified & filled {fillResult.filledFields.length} field(s) successfully!</strong>
              <div style={{ fontSize: '11px', marginTop: '2px', opacity: 0.9 }}>
                The webpage was not submitted automatically. Review and submit when ready.
              </div>
            </div>
          ) : fillResult.filledFields.length > 0 ? (
            <div>
              <strong>
                Filled {fillResult.filledFields.length} field(s), but {fillResult.failedFields.length} field(s) could not be verified:
              </strong>
              {fillResult.failedDetails && fillResult.failedDetails.length > 0 && (
                <ul style={{ fontSize: '11px', marginTop: '4px', paddingLeft: '16px', margin: '4px 0 0 0' }}>
                  {fillResult.failedDetails.map((d, i) => (
                    <li key={i}>
                      {d.label}: {d.reason}
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.9 }}>
                The webpage was not submitted automatically. Please review and complete remaining fields manually.
              </div>
            </div>
          ) : (
            <div>
              <strong>Could not fill fields:</strong> {fillResult.error || 'DOM elements were not found.'}
              {fillResult.failedDetails && fillResult.failedDetails.length > 0 && (
                <ul style={{ fontSize: '11px', marginTop: '4px', paddingLeft: '16px', margin: '4px 0 0 0' }}>
                  {fillResult.failedDetails.map((d, i) => (
                    <li key={i}>
                      {d.label}: {d.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Field List Scroll Area */}
      <div className="form-fields-scroll-list">
        {/* Section 1: Uncertain Matches that Need Review */}
        {uncertainFields.length > 0 && (
          <div className="field-group-container group-uncertain">
            <div className="field-group-header">
              <span className="badge-needs-review">Needs Review ({uncertainFields.length})</span>
              <span className="group-hint">Uncertain matches left blank for safety</span>
            </div>

            <div className="field-cards-list">
              {uncertainFields.map((field) => {
                const suggestion = suggestions[field.id];
                const outcome = profileMatchSummary?.matches.find((m) => m.fieldId === field.id);
                const reason = outcome?.reason || 'No certain match found in profile';

                return (
                  <div key={field.id} className="field-review-card card-uncertain">
                    <div className="field-card-top">
                      <label className="field-checkbox-label">
                        <input
                          type="checkbox"
                          className="field-checkbox"
                          checked={suggestion?.approved || false}
                          onChange={() => handleToggleApproved(field.id)}
                        />
                        <span className="field-name-text">{field.label}</span>
                      </label>
                      <span className="field-type-tag">{field.type}</span>
                    </div>

                    <div className="field-reason-text" title={reason}>
                      {reason}
                    </div>

                    {field.currentValue && field.currentValue.trim() && (
                      <div style={{ fontSize: '11px', color: 'var(--color-warning-text)', padding: '2px 0' }}>
                        Current on page: "{field.currentValue}" (Check box to approve overwrite)
                      </div>
                    )}

                    {savedProfile && (
                      <div style={{ marginTop: '2px', marginBottom: '4px' }}>
                        <select
                          className="field-map-select"
                          value=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) {
                              handleValueChange(field.id, val);
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            fontSize: '11px',
                            backgroundColor: '#171717',
                            color: 'var(--color-text-muted)',
                            border: '1px solid var(--color-border-subtle)',
                            borderRadius: 'var(--border-radius-xs)',
                            outline: 'none'
                          }}
                        >
                          <option value="">Map to a profile field…</option>
                          {savedProfile.fullName && <option value={savedProfile.fullName}>Full Name: {savedProfile.fullName}</option>}
                          {savedProfile.firstName && <option value={savedProfile.firstName}>First Name: {savedProfile.firstName}</option>}
                          {savedProfile.lastName && <option value={savedProfile.lastName}>Last Name: {savedProfile.lastName}</option>}
                          {savedProfile.email && <option value={savedProfile.email}>Email: {savedProfile.email}</option>}
                          {savedProfile.phone && <option value={savedProfile.phone}>Phone: {savedProfile.phone}</option>}
                          {savedProfile.address && <option value={savedProfile.address}>Address: {savedProfile.address}</option>}
                          {savedProfile.city && <option value={savedProfile.city}>City: {savedProfile.city}</option>}
                          {savedProfile.state && <option value={savedProfile.state}>State: {savedProfile.state}</option>}
                          {savedProfile.postalCode && <option value={savedProfile.postalCode}>Postal Code: {savedProfile.postalCode}</option>}
                          {savedProfile.country && <option value={savedProfile.country}>Country: {savedProfile.country}</option>}
                          {savedProfile.organization && <option value={savedProfile.organization}>College/Org: {savedProfile.organization}</option>}
                          {savedProfile.jobTitle && <option value={savedProfile.jobTitle}>Degree/Job: {savedProfile.jobTitle}</option>}
                          {savedProfile.notes && <option value={savedProfile.notes}>Notes: {savedProfile.notes}</option>}
                          {savedProfile.customFields?.map((cf) => (
                            <option key={cf.id} value={cf.value}>{cf.label}: {cf.value}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="field-input-row">
                      <input
                        type="text"
                        className="field-value-input"
                        placeholder="Enter value or leave empty…"
                        value={suggestion?.value || ''}
                        onChange={(e) => handleValueChange(field.id, e.target.value)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 2: Ready to Fill Matches */}
        {readyFields.length > 0 && (
          <div className="field-group-container group-ready">
            <div className="field-group-header">
              <span className="badge-ready">Ready to Fill ({readyFields.length})</span>
              <span className="group-hint">Matched from My Profile</span>
            </div>

            <div className="field-cards-list">
              {readyFields.map((field) => {
                const suggestion = suggestions[field.id];
                const outcome = profileMatchSummary?.matches.find((m) => m.fieldId === field.id);

                return (
                  <div key={field.id} className="field-review-card card-ready">
                    <div className="field-card-top">
                      <label className="field-checkbox-label">
                        <input
                          type="checkbox"
                          className="field-checkbox"
                          checked={suggestion?.approved || false}
                          onChange={() => handleToggleApproved(field.id)}
                        />
                        <span className="field-name-text">{field.label}</span>
                      </label>
                      <span className="field-source-tag">
                        {outcome?.matchedProfileKey || 'Matched'}
                      </span>
                    </div>

                    <div className="field-input-row">
                      <input
                        type="text"
                        className="field-value-input"
                        value={suggestion?.value || ''}
                        onChange={(e) => handleValueChange(field.id, e.target.value)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Safety Footer */}
      <div className="form-assistant-footer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>Never auto-submits. Personal data stays 100% on your device.</span>
      </div>
    </div>
  );
};
