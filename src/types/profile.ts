/**
 * Types for Phase 7: Local Personal Profile and Smart Autofill.
 */

export interface CustomProfileField {
  id: string;
  label: string;
  value: string;
}

export interface UserProfile {
  // Standard required fields (can be saved empty if user prefers)
  fullName: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone: string;
  organization: string; // College or organization
  jobTitle: string;     // Course or job title

  // Location fields
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;

  // Optional message / notes
  notes?: string;

  // Additional custom fields explicitly added by user
  customFields: CustomProfileField[];

  // Metadata
  updatedAt?: number;
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  fullName: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  organization: '',
  jobTitle: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  notes: '',
  customFields: []
};

export const STORAGE_KEY_USER_PROFILE = 'private_pilot_user_profile';
