import {
  UserProfile,
  DEFAULT_USER_PROFILE,
  STORAGE_KEY_USER_PROFILE
} from '../types/profile';

// In-memory fallback for environments where chrome.storage is not available (e.g., unit tests)
let inMemoryProfile: UserProfile | null = null;

/**
 * Checks whether the Chrome extension storage API is available.
 */
function isChromeStorageAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.storage) &&
    Boolean(chrome.storage.local) &&
    typeof chrome.storage.local.get === 'function' &&
    typeof chrome.storage.local.set === 'function'
  );
}

/**
 * Normalizes raw profile data from storage, handling canonical key aliases so schemas
 * using full_name, college, course, etc. match standard UserProfile keys seamlessly.
 */
export function normalizeProfile(rawInput: unknown): UserProfile {
  if (!rawInput || typeof rawInput !== 'object') {
    return { ...DEFAULT_USER_PROFILE };
  }

  const raw = rawInput as Record<string, unknown>;

  // Flexible key getter supporting exact keys, camelCase, snake_case, and kebab-case
  const getStr = (...keys: string[]): string => {
    for (const k of keys) {
      if (typeof raw[k] === 'string' && (raw[k] as string).trim()) {
        return (raw[k] as string).trim();
      }
      // Also check lowercased / hyphen-free version of keys in raw
      const normalizedK = k.toLowerCase().replace(/[-_]/g, '');
      for (const rawKey of Object.keys(raw)) {
        if (rawKey.toLowerCase().replace(/[-_]/g, '') === normalizedK) {
          const val = raw[rawKey];
          if (typeof val === 'string' && val.trim()) {
            return val.trim();
          }
        }
      }
    }
    return '';
  };

  let fullName = getStr('fullName', 'full_name', 'name', 'applicantName', 'applicant_name', 'studentName', 'completeName');
  let firstName = getStr('firstName', 'first_name', 'givenName', 'given_name', 'fname');
  let lastName = getStr('lastName', 'last_name', 'familyName', 'family_name', 'surname', 'surnames', 'lname');

  // Single source of truth derivation: users enter name details once
  if (fullName && !firstName && !lastName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) {
      firstName = parts[0];
    } else if (parts.length > 1) {
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    }
  } else if (!fullName && (firstName || lastName)) {
    fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  }

  return {
    fullName,
    firstName,
    lastName,
    email: getStr('email', 'emailAddress', 'email_address', 'contactEmail', 'contact_email', 'emailId', 'email_id', 'mailId'),
    phone: getStr('phone', 'phoneNumber', 'phone_number', 'mobile', 'mobileNumber', 'mobile_number', 'tel', 'mobileNo', 'phoneNo', 'contactNo'),
    organization: getStr('organization', 'college', 'institution', 'university', 'school', 'company', 'employer'),
    jobTitle: getStr('jobTitle', 'degree', 'qualification', 'course', 'program', 'job_title', 'role', 'position', 'occupation'),
    address: getStr('address', 'streetAddress', 'street_address', 'addressLine1', 'address_line_1', 'address1'),
    city: getStr('city', 'locality', 'town'),
    state: getStr('state', 'region', 'province'),
    postalCode: getStr('postalCode', 'zipCode', 'zip_code', 'zip', 'postal_code', 'pincode', 'pin_code', 'pin'),
    country: getStr('country', 'countryName', 'country_name', 'nation'),
    notes: getStr('notes', 'message', 'additionalNotes', 'additional_notes', 'userNotes'),
    customFields: Array.isArray(raw.customFields)
      ? raw.customFields
          .filter(
            (f: unknown) =>
              Boolean(f) &&
              typeof f === 'object' &&
              typeof (f as Record<string, unknown>).label === 'string' &&
              typeof (f as Record<string, unknown>).value === 'string'
          )
          .map((f: { id?: string; label: string; value: string }, idx: number) => ({
            id: f.id || `custom-${idx}-${Date.now()}`,
            label: f.label.trim(),
            value: f.value.trim()
          }))
      : [],
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined
  };
}

/**
 * Loads the user profile from local storage.
 * Strictly local: no network requests or external services are contacted.
 */
export async function loadProfile(): Promise<UserProfile> {
  if (!isChromeStorageAvailable()) {
    return inMemoryProfile ? { ...inMemoryProfile } : { ...DEFAULT_USER_PROFILE };
  }

  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([STORAGE_KEY_USER_PROFILE], (result) => {
        if (chrome.runtime?.lastError) {
          // Never log profile details or errors with personal content
          console.error('[Private Pilot Profile] Storage retrieval failed.');
          resolve({ ...DEFAULT_USER_PROFILE });
          return;
        }

        const raw = result?.[STORAGE_KEY_USER_PROFILE];
        const profile = normalizeProfile(raw);
        resolve(profile);
      });
    } catch {
      console.error('[Private Pilot Profile] Exception during storage retrieval.');
      resolve({ ...DEFAULT_USER_PROFILE });
    }
  });
}

/**
 * Saves the user profile into chrome.storage.local.
 * Personal data is kept strictly inside the user's local browser profile.
 */
export async function saveProfile(
  profile: UserProfile
): Promise<{ success: boolean; error?: string }> {
  // Normalize and sync name fields without assuming values
  let fullName = (profile.fullName || '').trim();
  let firstName = (profile.firstName || '').trim();
  let lastName = (profile.lastName || '').trim();

  if (fullName && !firstName && !lastName) {
    const parts = fullName.split(/\s+/);
    if (parts.length === 1) {
      firstName = parts[0];
    } else if (parts.length > 1) {
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    }
  } else if (!fullName && (firstName || lastName)) {
    fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  }

  const sanitized: UserProfile = {
    fullName,
    firstName,
    lastName,
    email: (profile.email || '').trim(),
    phone: (profile.phone || '').trim(),
    organization: (profile.organization || '').trim(),
    jobTitle: (profile.jobTitle || '').trim(),
    address: (profile.address || '').trim(),
    city: (profile.city || '').trim(),
    state: (profile.state || '').trim(),
    postalCode: (profile.postalCode || '').trim(),
    country: (profile.country || '').trim(),
    notes: (profile.notes || '').trim(),
    customFields: (profile.customFields || []).map((f, idx) => ({
      id: f.id || `custom-${idx}-${Date.now()}`,
      label: (f.label || '').trim(),
      value: (f.value || '').trim()
    })),
    updatedAt: Date.now()
  };

  if (!isChromeStorageAvailable()) {
    inMemoryProfile = { ...sanitized };
    return { success: true };
  }

  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY_USER_PROFILE]: sanitized }, () => {
        if (chrome.runtime?.lastError) {
          console.error('[Private Pilot Profile] Chrome storage save failed.');
          resolve({
            success: false,
            error: 'Failed to save profile into Chrome local storage.'
          });
          return;
        }

        resolve({ success: true });
      });
    } catch {
      console.error('[Private Pilot Profile] Exception during storage save.');
      resolve({
        success: false,
        error: 'An unexpected error occurred while saving profile locally.'
      });
    }
  });
}

/**
 * Deletes the saved user profile from local storage.
 */
export async function deleteProfile(): Promise<{ success: boolean; error?: string }> {
  inMemoryProfile = null;

  if (!isChromeStorageAvailable()) {
    return { success: true };
  }

  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove([STORAGE_KEY_USER_PROFILE], () => {
        if (chrome.runtime?.lastError) {
          console.error('[Private Pilot Profile] Chrome storage removal failed.');
          resolve({
            success: false,
            error: 'Failed to delete profile from Chrome local storage.'
          });
          return;
        }

        resolve({ success: true });
      });
    } catch {
      console.error('[Private Pilot Profile] Exception during profile deletion.');
      resolve({
        success: false,
        error: 'An unexpected error occurred while deleting profile.'
      });
    }
  });
}

/**
 * Checks if a profile has at least one populated field value.
 */
export function hasProfileData(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(
    profile.fullName?.trim() ||
      profile.firstName?.trim() ||
      profile.lastName?.trim() ||
      profile.email?.trim() ||
      profile.phone?.trim() ||
      profile.organization?.trim() ||
      profile.jobTitle?.trim() ||
      profile.address?.trim() ||
      profile.city?.trim() ||
      profile.state?.trim() ||
      profile.postalCode?.trim() ||
      profile.country?.trim() ||
      profile.notes?.trim() ||
      (profile.customFields &&
        profile.customFields.some((f) => f.value && f.value.trim()))
  );
}

/**
 * Counts the number of populated, non-empty fields in a profile for privacy-safe diagnostics.
 * Never exposes or returns the actual personal values.
 */
export function getNonEmptyProfileFieldCount(profile: UserProfile | null | undefined): number {
  if (!profile) return 0;
  let count = 0;
  if (profile.fullName?.trim()) count++;
  if (profile.email?.trim()) count++;
  if (profile.phone?.trim()) count++;
  if (profile.organization?.trim()) count++;
  if (profile.jobTitle?.trim()) count++;
  if (profile.address?.trim()) count++;
  if (profile.city?.trim()) count++;
  if (profile.state?.trim()) count++;
  if (profile.postalCode?.trim()) count++;
  if (profile.country?.trim()) count++;
  if (profile.notes?.trim()) count++;
  if (Array.isArray(profile.customFields)) {
    profile.customFields.forEach((cf) => {
      if (cf?.value?.trim()) count++;
    });
  }
  return count;
}

/**
 * Diagnostic reset helper for testing.
 */
export function _resetInMemoryProfile(): void {
  inMemoryProfile = null;
}
