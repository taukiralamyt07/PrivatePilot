import React, { useState, useEffect } from 'react';
import { UserProfile, DEFAULT_USER_PROFILE, CustomProfileField } from '../types/profile';
import { loadProfile, saveProfile, deleteProfile, hasProfileData } from '../services/profileService';

interface MyProfileSettingsProps {
  onShowNotice?: (msg: string) => void;
  onProfileUpdated?: (profile: UserProfile) => void;
}

export const MyProfileSettings: React.FC<MyProfileSettingsProps> = ({
  onShowNotice,
  onProfileUpdated
}) => {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [newCustomLabel, setNewCustomLabel] = useState<string>('');
  const [newCustomValue, setNewCustomValue] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    loadProfile()
      .then((loaded) => {
        if (isMounted) {
          setProfile(loaded);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setErrorMessage('Could not load profile from local storage.');
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleFieldChange = (field: keyof Omit<UserProfile, 'customFields' | 'updatedAt'>, value: string) => {
    setProfile((prev) => {
      const next = { ...prev, [field]: value };

      // Single source of truth synchronization for name fields
      if (field === 'fullName') {
        const parts = value.trim().split(/\s+/);
        if (parts.length === 1 && parts[0]) {
          next.firstName = parts[0];
          next.lastName = '';
        } else if (parts.length > 1) {
          next.firstName = parts[0];
          next.lastName = parts.slice(1).join(' ');
        }
      } else if (field === 'firstName' || field === 'lastName') {
        const fn = field === 'firstName' ? value : prev.firstName || '';
        const ln = field === 'lastName' ? value : prev.lastName || '';
        next.fullName = [fn, ln].filter(Boolean).join(' ').trim();
      }

      return next;
    });
    setSaveSuccess(false);
  };

  const handleCustomFieldChange = (id: string, value: string) => {
    setProfile((prev) => ({
      ...prev,
      customFields: prev.customFields.map((cf) =>
        cf.id === id ? { ...cf, value } : cf
      )
    }));
    setSaveSuccess(false);
  };

  const handleRemoveCustomField = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      customFields: prev.customFields.filter((cf) => cf.id !== id)
    }));
    setSaveSuccess(false);
  };

  const handleAddCustomField = () => {
    if (!newCustomLabel.trim()) {
      return;
    }
    const newField: CustomProfileField = {
      id: `custom-${Date.now()}`,
      label: newCustomLabel.trim(),
      value: newCustomValue.trim()
    };
    setProfile((prev) => ({
      ...prev,
      customFields: [...prev.customFields, newField]
    }));
    setNewCustomLabel('');
    setNewCustomValue('');
    setSaveSuccess(false);
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);

    const res = await saveProfile(profile);
    setIsSaving(false);

    if (res.success) {
      setSaveSuccess(true);
      onProfileUpdated?.(profile);
      onShowNotice?.('Profile saved securely in local Chrome storage.');
      setTimeout(() => setSaveSuccess(false), 3000);
    } else {
      setErrorMessage(res.error || 'Failed to save profile locally.');
    }
  };

  const handleDelete = async () => {
    const res = await deleteProfile();
    if (res.success) {
      setProfile({ ...DEFAULT_USER_PROFILE });
      setShowDeleteConfirm(false);
      onProfileUpdated?.({ ...DEFAULT_USER_PROFILE });
      onShowNotice?.('Profile deleted from local storage.');
    } else {
      setErrorMessage(res.error || 'Failed to delete profile.');
    }
  };

  const hasData = hasProfileData(profile);

  if (isLoading) {
    return (
      <div className="profile-loading-state" style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-subtle)' }}>
        <span>Loading local profile…</span>
      </div>
    );
  }

  return (
    <div className="my-profile-container" role="region" aria-label="My Local Profile">
      {/* Privacy Notice Box */}
      <div className="profile-privacy-box">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: 'var(--color-accent-primary)', flexShrink: 0, marginTop: '2px' }}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <div style={{ fontSize: '12px', lineHeight: '1.45', color: 'var(--color-text-muted)' }}>
            <strong style={{ color: 'var(--color-text-main)' }}>Local &amp; Private:</strong> Saved once on this device in Chrome local storage. Never transmitted to external AI APIs or cloud servers.
          </div>
        </div>
      </div>

      {saveSuccess && (
        <div className="profile-alert profile-alert-success" role="status">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Profile saved successfully!</span>
        </div>
      )}

      {errorMessage && (
        <div className="profile-alert profile-alert-error" role="alert">
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="profile-form">
        {/* Full Name */}
        <div className="profile-field-group">
          <label htmlFor="profile-fullName" className="profile-label">
            Full Name
          </label>
          <input
            id="profile-fullName"
            type="text"
            className="profile-input"
            placeholder="e.g. Jane Doe"
            value={profile.fullName}
            onChange={(e) => handleFieldChange('fullName', e.target.value)}
          />
        </div>

        {/* First & Last Name Split Row */}
        <div className="profile-row-grid">
          <div className="profile-field-group">
            <label htmlFor="profile-firstName" className="profile-label">
              First Name
            </label>
            <input
              id="profile-firstName"
              type="text"
              className="profile-input"
              placeholder="e.g. Jane"
              value={profile.firstName || ''}
              onChange={(e) => handleFieldChange('firstName', e.target.value)}
            />
          </div>

          <div className="profile-field-group">
            <label htmlFor="profile-lastName" className="profile-label">
              Last Name
            </label>
            <input
              id="profile-lastName"
              type="text"
              className="profile-input"
              placeholder="e.g. Doe"
              value={profile.lastName || ''}
              onChange={(e) => handleFieldChange('lastName', e.target.value)}
            />
          </div>
        </div>

        {/* Email & Phone Row */}
        <div className="profile-row-grid">
          <div className="profile-field-group">
            <label htmlFor="profile-email" className="profile-label">
              Email Address
            </label>
            <input
              id="profile-email"
              type="email"
              className="profile-input"
              placeholder="e.g. jane@example.com"
              value={profile.email}
              onChange={(e) => handleFieldChange('email', e.target.value)}
            />
          </div>

          <div className="profile-field-group">
            <label htmlFor="profile-phone" className="profile-label">
              Phone Number
            </label>
            <input
              id="profile-phone"
              type="tel"
              className="profile-input"
              placeholder="e.g. +1 555-0199"
              value={profile.phone}
              onChange={(e) => handleFieldChange('phone', e.target.value)}
            />
          </div>
        </div>

        {/* College / Organization */}
        <div className="profile-field-group">
          <label htmlFor="profile-organization" className="profile-label">
            College or Organization
          </label>
          <input
            id="profile-organization"
            type="text"
            className="profile-input"
            placeholder="e.g. Stanford University or Acme Corp"
            value={profile.organization}
            onChange={(e) => handleFieldChange('organization', e.target.value)}
          />
        </div>

        {/* Course or Job Title */}
        <div className="profile-field-group">
          <label htmlFor="profile-jobTitle" className="profile-label">
            Course or Job Title
          </label>
          <input
            id="profile-jobTitle"
            type="text"
            className="profile-input"
            placeholder="e.g. Computer Science or Software Engineer"
            value={profile.jobTitle}
            onChange={(e) => handleFieldChange('jobTitle', e.target.value)}
          />
        </div>

        {/* Street Address */}
        <div className="profile-field-group">
          <label htmlFor="profile-address" className="profile-label">
            Street Address
          </label>
          <input
            id="profile-address"
            type="text"
            className="profile-input"
            placeholder="e.g. 123 Main Street, Apt 4B"
            value={profile.address}
            onChange={(e) => handleFieldChange('address', e.target.value)}
          />
        </div>

        {/* City, State, Postal Code, Country Grid */}
        <div className="profile-row-grid">
          <div className="profile-field-group">
            <label htmlFor="profile-city" className="profile-label">
              City
            </label>
            <input
              id="profile-city"
              type="text"
              className="profile-input"
              placeholder="e.g. Palo Alto"
              value={profile.city}
              onChange={(e) => handleFieldChange('city', e.target.value)}
            />
          </div>

          <div className="profile-field-group">
            <label htmlFor="profile-state" className="profile-label">
              State / Province
            </label>
            <input
              id="profile-state"
              type="text"
              className="profile-input"
              placeholder="e.g. CA"
              value={profile.state}
              onChange={(e) => handleFieldChange('state', e.target.value)}
            />
          </div>
        </div>

        <div className="profile-row-grid">
          <div className="profile-field-group">
            <label htmlFor="profile-postalCode" className="profile-label">
              Postal Code / PIN
            </label>
            <input
              id="profile-postalCode"
              type="text"
              className="profile-input"
              placeholder="e.g. 94301"
              value={profile.postalCode}
              onChange={(e) => handleFieldChange('postalCode', e.target.value)}
            />
          </div>

          <div className="profile-field-group">
            <label htmlFor="profile-country" className="profile-label">
              Country
            </label>
            <input
              id="profile-country"
              type="text"
              className="profile-input"
              placeholder="e.g. United States"
              value={profile.country || ''}
              onChange={(e) => handleFieldChange('country', e.target.value)}
            />
          </div>
        </div>

        {/* Message / Notes */}
        <div className="profile-field-group">
          <label htmlFor="profile-notes" className="profile-label">
            Message / Notes <span className="profile-optional-tag">(Optional)</span>:
          </label>
          <textarea
            id="profile-notes"
            rows={2}
            className="profile-input"
            placeholder="e.g. Interested in learning more about this program..."
            value={profile.notes || ''}
            onChange={(e) => handleFieldChange('notes', e.target.value)}
          />
        </div>

        {/* Custom Fields Section */}
        <div className="profile-custom-section">
          <div className="profile-custom-header">
            <span className="profile-section-title">Custom Fields</span>
            <span className="profile-optional-tag">Extra fields you choose to save</span>
          </div>

          {profile.customFields && profile.customFields.length > 0 && (
            <div className="profile-custom-list">
              {profile.customFields.map((cf) => (
                <div key={cf.id} className="profile-custom-item">
                  <div className="profile-custom-label-badge">{cf.label}</div>
                  <input
                    type="text"
                    className="profile-input profile-custom-input"
                    value={cf.value}
                    onChange={(e) => handleCustomFieldChange(cf.id, e.target.value)}
                    placeholder={`Value for ${cf.label}`}
                  />
                  <button
                    type="button"
                    className="profile-btn-remove"
                    onClick={() => handleRemoveCustomField(cf.id)}
                    title={`Remove ${cf.label}`}
                    aria-label={`Remove ${cf.label}`}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Custom Field Row */}
          <div className="profile-add-custom-box">
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="profile-input"
                style={{ flex: '1 1 120px' }}
                placeholder="Field label (e.g. LinkedIn, Portfolio)"
                value={newCustomLabel}
                onChange={(e) => setNewCustomLabel(e.target.value)}
              />
              <input
                type="text"
                className="profile-input"
                style={{ flex: '1 1 140px' }}
                placeholder="Value"
                value={newCustomValue}
                onChange={(e) => setNewCustomValue(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-secondary-settings profile-btn-add"
              onClick={handleAddCustomField}
              disabled={!newCustomLabel.trim()}
              style={{ alignSelf: 'flex-start', marginTop: '6px' }}
            >
              + Add Custom Field
            </button>
          </div>
        </div>

        {/* Action Controls: Save & Delete */}
        <div className="profile-actions-bar">
          <button
            type="submit"
            className="btn-primary-settings"
            disabled={isSaving}
            style={{ flex: '1' }}
          >
            {isSaving ? 'Saving…' : 'Save Profile'}
          </button>

          {hasData && (
            <button
              type="button"
              className="btn-danger-settings"
              onClick={() => setShowDeleteConfirm(true)}
              style={{ flex: '0 0 auto' }}
            >
              Delete Profile
            </button>
          )}
        </div>
      </form>

      {/* Delete Confirmation Modal / Dialog */}
      {showDeleteConfirm && (
        <div className="profile-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-profile-modal-title">
          <div className="profile-modal-content">
            <h4 id="delete-profile-modal-title" style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#b91c1c' }}>
              Delete Saved Profile?
            </h4>
            <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
              This will permanently remove your stored personal profile from Chrome local storage. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary-settings"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-settings"
                onClick={handleDelete}
              >
                Yes, Delete Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
