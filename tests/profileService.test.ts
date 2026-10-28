import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProfile,
  saveProfile,
  deleteProfile,
  hasProfileData,
  normalizeProfile,
  getNonEmptyProfileFieldCount,
  _resetInMemoryProfile
} from '../src/services/profileService.ts';
import { UserProfile, DEFAULT_USER_PROFILE } from '../src/types/profile.ts';

describe('Profile Service - Local Persistence & Privacy (Section 1 & 2)', () => {
  beforeEach(() => {
    _resetInMemoryProfile();
  });

  it('loads default empty profile when no profile has been saved', async () => {
    const profile = await loadProfile();
    assert.deepEqual(profile.fullName, '');
    assert.deepEqual(profile.email, '');
    assert.deepEqual(profile.phone, '');
    assert.deepEqual(profile.organization, '');
    assert.deepEqual(profile.jobTitle, '');
    assert.deepEqual(profile.address, '');
    assert.deepEqual(profile.city, '');
    assert.deepEqual(profile.state, '');
    assert.deepEqual(profile.postalCode, '');
    assert.deepEqual(profile.customFields, []);
    assert.equal(hasProfileData(profile), false);
  });

  it('saves and reloads a profile with partial information', async () => {
    const partial: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      fullName: 'Alex Rivera',
      email: 'alex.rivera@example.com',
      organization: 'MIT'
    };

    const saveRes = await saveProfile(partial);
    assert.equal(saveRes.success, true);

    const loaded = await loadProfile();
    assert.equal(loaded.fullName, 'Alex Rivera');
    assert.equal(loaded.email, 'alex.rivera@example.com');
    assert.equal(loaded.organization, 'MIT');
    assert.equal(loaded.phone, '');
    assert.equal(loaded.jobTitle, '');
    assert.equal(hasProfileData(loaded), true);
  });

  it('saves and reloads custom fields with unique IDs', async () => {
    const withCustom: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      fullName: 'Jordan Lee',
      email: 'jordan@example.com',
      customFields: [
        { id: 'c1', label: 'GitHub', value: 'https://github.com/jordan' },
        { id: 'c2', label: 'Portfolio', value: 'https://jordan.dev' }
      ]
    };

    const saveRes = await saveProfile(withCustom);
    assert.equal(saveRes.success, true);

    const loaded = await loadProfile();
    assert.equal(loaded.customFields.length, 2);
    assert.equal(loaded.customFields[0].label, 'GitHub');
    assert.equal(loaded.customFields[0].value, 'https://github.com/jordan');
    assert.equal(loaded.customFields[1].label, 'Portfolio');
  });

  it('allows saving even when all fields are empty without guessing personal data', async () => {
    const emptyProfile: UserProfile = { ...DEFAULT_USER_PROFILE };
    const saveRes = await saveProfile(emptyProfile);
    assert.equal(saveRes.success, true);

    const loaded = await loadProfile();
    assert.equal(loaded.fullName, '');
    assert.equal(loaded.email, '');
    assert.equal(hasProfileData(loaded), false);
  });

  it('deletes the profile and clears stored values', async () => {
    const profile: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      fullName: 'Sam Taylor',
      email: 'sam@example.com'
    };

    await saveProfile(profile);
    assert.equal(hasProfileData(await loadProfile()), true);

    const delRes = await deleteProfile();
    assert.equal(delRes.success, true);

    const reloaded = await loadProfile();
    assert.equal(reloaded.fullName, '');
    assert.equal(hasProfileData(reloaded), false);
  });

  it('normalizes alternative canonical keys (full_name, college, course, message, etc.)', () => {
    const rawData = {
      full_name: 'Taylor Swift',
      contact_email: 'taylor@example.com',
      mobile_number: '+1 555-4321',
      college: 'NYU',
      course: 'Music Technology',
      message: 'Excited to register for the upcoming semester!',
      street_address: '500 Broadway',
      town: 'New York',
      region: 'NY',
      zip_code: '10012'
    };

    const normalized = normalizeProfile(rawData);
    assert.equal(normalized.fullName, 'Taylor Swift');
    assert.equal(normalized.email, 'taylor@example.com');
    assert.equal(normalized.phone, '+1 555-4321');
    assert.equal(normalized.organization, 'NYU');
    assert.equal(normalized.jobTitle, 'Music Technology');
    assert.equal(normalized.notes, 'Excited to register for the upcoming semester!');
    assert.equal(normalized.address, '500 Broadway');
    assert.equal(normalized.city, 'New York');
    assert.equal(normalized.state, 'NY');
    assert.equal(normalized.postalCode, '10012');
  });

  it('counts non-empty profile fields accurately without exposing values', () => {
    const emptyCount = getNonEmptyProfileFieldCount(DEFAULT_USER_PROFILE);
    assert.equal(emptyCount, 0);

    const populated: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      organization: 'Caltech',
      notes: 'Notes here',
      customFields: [{ id: 'cf-1', label: 'Portfolio', value: 'https://example.com' }]
    };

    const filledCount = getNonEmptyProfileFieldCount(populated);
    assert.equal(filledCount, 5); // fullName, email, organization, notes, customField
  });

  it('normalizes and persists firstName, lastName, and country seamlessly', async () => {
    const rawData = {
      first_name: 'Elena',
      last_name: 'Rostova',
      email_id: 'elena@example.com',
      nation: 'Canada'
    };

    const normalized = normalizeProfile(rawData);
    assert.equal(normalized.firstName, 'Elena');
    assert.equal(normalized.lastName, 'Rostova');
    assert.equal(normalized.fullName, 'Elena Rostova', 'FullName should be derived from first and last name');
    assert.equal(normalized.email, 'elena@example.com');
    assert.equal(normalized.country, 'Canada');

    const saveRes = await saveProfile(normalized);
    assert.equal(saveRes.success, true);

    const reloaded = await loadProfile();
    assert.equal(reloaded.firstName, 'Elena');
    assert.equal(reloaded.lastName, 'Rostova');
    assert.equal(reloaded.fullName, 'Elena Rostova');
    assert.equal(reloaded.country, 'Canada');
  });

  it('derives firstName and lastName when user only inputs fullName once', () => {
    const raw = {
      fullName: 'Marcus Aurelius Antoninus'
    };
    const norm = normalizeProfile(raw);
    assert.equal(norm.firstName, 'Marcus');
    assert.equal(norm.lastName, 'Aurelius Antoninus');
  });

  it('normalizes diverse naming conventions (givenName, familyName, surname, locality, region, pincode, degree)', () => {
    const raw = {
      givenName: 'Ada',
      surname: 'Lovelace',
      emailAddress: 'ada@computing.org',
      phoneNumber: '+44 20 7946 0991',
      streetAddress: '12 St James Square',
      locality: 'London',
      region: 'Greater London',
      pincode: 'SW1Y 4LE',
      university: 'University of London',
      degree: 'Mathematics & Computing'
    };

    const norm = normalizeProfile(raw);
    assert.equal(norm.firstName, 'Ada');
    assert.equal(norm.lastName, 'Lovelace');
    assert.equal(norm.fullName, 'Ada Lovelace');
    assert.equal(norm.email, 'ada@computing.org');
    assert.equal(norm.phone, '+44 20 7946 0991');
    assert.equal(norm.address, '12 St James Square');
    assert.equal(norm.city, 'London');
    assert.equal(norm.state, 'Greater London');
    assert.equal(norm.postalCode, 'SW1Y 4LE');
    assert.equal(norm.organization, 'University of London');
    assert.equal(norm.jobTitle, 'Mathematics & Computing');
  });
});
