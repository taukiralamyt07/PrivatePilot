import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchSingleField,
  matchProfileToFormFields,
  isFieldSensitive,
  normalizeForMatching,
  buildAmbiguousResolverPrompt
} from '../src/services/autofillMatcher.ts';
import { DetectedFormField, ApprovedFormFieldToFill } from '../src/types/form.ts';
import { UserProfile, DEFAULT_USER_PROFILE } from '../src/types/profile.ts';
import { saveProfile, loadProfile } from '../src/services/profileService.ts';

describe('Autofill Matcher - Deterministic Smart Matching (Section 3)', () => {
  const sampleProfile: UserProfile = {
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+1 555-0123',
    organization: 'Stanford University',
    jobTitle: 'Software Engineer',
    address: '100 University Ave',
    city: 'Palo Alto',
    state: 'California',
    postalCode: '94301',
    customFields: [
      { id: 'c1', label: 'GitHub', value: 'https://github.com/janedoe' },
      { id: 'c2', label: 'Portfolio', value: 'https://janedoe.me' }
    ]
  };

  it('matches full name field deterministically', () => {
    const field: DetectedFormField = {
      id: 'f-name',
      label: 'Full Name',
      type: 'text',
      selector: '#fullName'
    };
    const outcome = matchSingleField(field, sampleProfile);
    assert.equal(outcome.proposedValue, 'Jane Doe');
    assert.equal(outcome.matchedProfileKey, 'fullName');
    assert.equal(outcome.confidence, 'high');
  });

  it('matches email field by type and label', () => {
    const field: DetectedFormField = {
      id: 'f-email',
      label: 'Email Address',
      type: 'email',
      selector: '#email'
    };
    const outcome = matchSingleField(field, sampleProfile);
    assert.equal(outcome.proposedValue, 'jane.doe@example.com');
    assert.equal(outcome.matchedProfileKey, 'email');
  });

  it('matches phone number field by type and label', () => {
    const field: DetectedFormField = {
      id: 'f-phone',
      label: 'Telephone Number',
      type: 'tel',
      selector: '#phone'
    };
    const outcome = matchSingleField(field, sampleProfile);
    assert.equal(outcome.proposedValue, '+1 555-0123');
    assert.equal(outcome.matchedProfileKey, 'phone');
  });

  it('matches college or organization field', () => {
    const field: DetectedFormField = {
      id: 'f-org',
      label: 'College / University',
      type: 'text',
      selector: '#college'
    };
    const outcome = matchSingleField(field, sampleProfile);
    assert.equal(outcome.proposedValue, 'Stanford University');
    assert.equal(outcome.matchedProfileKey, 'organization');
  });

  it('matches job title or course field', () => {
    const field: DetectedFormField = {
      id: 'f-job',
      label: 'Job Title / Position',
      type: 'text',
      selector: '#jobTitle'
    };
    const outcome = matchSingleField(field, sampleProfile);
    assert.equal(outcome.proposedValue, 'Software Engineer');
    assert.equal(outcome.matchedProfileKey, 'jobTitle');
  });

  it('matches street address, city, state, and postal code', () => {
    const fields: DetectedFormField[] = [
      { id: 'f-addr', label: 'Street Address', type: 'text', selector: '#addr' },
      { id: 'f-city', label: 'City', type: 'text', selector: '#city' },
      { id: 'f-state', label: 'State / Province', type: 'text', selector: '#state' },
      { id: 'f-zip', label: 'Postal Code / ZIP', type: 'text', selector: '#zip' }
    ];

    const summary = matchProfileToFormFields(fields, sampleProfile);
    assert.equal(summary.matchedCount, 4);
    assert.equal(summary.matches[0].proposedValue, '100 University Ave');
    assert.equal(summary.matches[1].proposedValue, 'Palo Alto');
    assert.equal(summary.matches[2].proposedValue, 'California');
    assert.equal(summary.matches[3].proposedValue, '94301');
  });

  it('matches user-defined custom profile fields', () => {
    const field: DetectedFormField = {
      id: 'f-github',
      label: 'GitHub Profile URL',
      type: 'text',
      selector: '#github'
    };
    const outcome = matchSingleField(field, sampleProfile);
    assert.equal(outcome.proposedValue, 'https://github.com/janedoe');
    assert.equal(outcome.matchedProfileKey, 'custom-c1');
  });

  it('leaves unmatched or empty profile values blank without inventing data', () => {
    const emptyProfile: UserProfile = { ...DEFAULT_USER_PROFILE };
    const field: DetectedFormField = {
      id: 'f-name',
      label: 'Full Name',
      type: 'text',
      selector: '#fullName'
    };
    const outcome = matchSingleField(field, emptyProfile);
    assert.equal(outcome.proposedValue, '');
    assert.equal(outcome.confidence, 'none');
  });
});

describe('Autofill Matcher - Robust Synonyms and Alternate Wording', () => {
  const profile: UserProfile = {
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+1 555-0123',
    organization: 'Massachusetts Institute of Technology',
    jobTitle: 'Computer Science',
    address: '77 Massachusetts Ave',
    city: 'Cambridge',
    state: 'MA',
    postalCode: '02139',
    customFields: []
  };

  it('matches Full Name variations: Your Full Name, Applicant Name, Student Name, Name', () => {
    const variations = [
      'Full Name',
      'Your Full Name',
      'Applicant Name',
      'Student Name',
      'Candidate Name',
      'Legal Name',
      'Your Name',
      'Name'
    ];

    for (const label of variations) {
      const field: DetectedFormField = {
        id: `f-${label}`,
        label,
        type: 'text',
        selector: '#name'
      };
      const outcome = matchSingleField(field, profile);
      assert.equal(outcome.proposedValue, 'Jane Doe', `Failed for label: "${label}"`);
      assert.equal(outcome.matchedProfileKey, 'fullName');
      assert.equal(outcome.confidence, 'high');
    }
  });

  it('matches Email variations: Email, E-mail Address, Contact Email', () => {
    const variations = [
      'Email',
      'E-mail Address',
      'Email Address',
      'Contact Email',
      'Personal Email',
      'Applicant Email'
    ];

    for (const label of variations) {
      const field: DetectedFormField = {
        id: `f-${label}`,
        label,
        type: 'text',
        selector: '#email'
      };
      const outcome = matchSingleField(field, profile);
      assert.equal(outcome.proposedValue, 'jane.doe@example.com', `Failed for label: "${label}"`);
      assert.equal(outcome.matchedProfileKey, 'email');
    }
  });

  it('matches Phone variations: Phone, Mobile Number, Contact Number', () => {
    const variations = [
      'Phone',
      'Phone Number',
      'Mobile Number',
      'Contact Number',
      'Telephone',
      'Cell Phone',
      'Mobile No'
    ];

    for (const label of variations) {
      const field: DetectedFormField = {
        id: `f-${label}`,
        label,
        type: 'text',
        selector: '#phone'
      };
      const outcome = matchSingleField(field, profile);
      assert.equal(outcome.proposedValue, '+1 555-0123', `Failed for label: "${label}"`);
      assert.equal(outcome.matchedProfileKey, 'phone');
    }
  });

  it('matches College / Organization variations: College Name, University, Institution, Organization', () => {
    const variations = [
      'College Name',
      'College',
      'University',
      'University Name',
      'Institution',
      'Organization',
      'Organisation',
      'School Name',
      'Company Name'
    ];

    for (const label of variations) {
      const field: DetectedFormField = {
        id: `f-${label}`,
        label,
        type: 'text',
        selector: '#org'
      };
      const outcome = matchSingleField(field, profile);
      assert.equal(
        outcome.proposedValue,
        'Massachusetts Institute of Technology',
        `Failed for label: "${label}"`
      );
      assert.equal(outcome.matchedProfileKey, 'organization');
    }
  });

  it('matches Course variations: Course Name, Program, Degree, Course Interested In', () => {
    const variations = [
      'Course Name',
      'Program',
      'Degree',
      'Course Interested In',
      'Course',
      'Program Name',
      'Degree Name',
      'Major'
    ];

    for (const label of variations) {
      const field: DetectedFormField = {
        id: `f-${label}`,
        label,
        type: 'text',
        selector: '#course'
      };
      const outcome = matchSingleField(field, profile);
      assert.equal(outcome.proposedValue, 'Computer Science', `Failed for label: "${label}"`);
      assert.equal(outcome.matchedProfileKey, 'jobTitle');
    }
  });

  it('matches City variations: City, Town, Current City', () => {
    const variations = ['City', 'Town', 'Current City', 'City / Town'];

    for (const label of variations) {
      const field: DetectedFormField = {
        id: `f-${label}`,
        label,
        type: 'text',
        selector: '#city'
      };
      const outcome = matchSingleField(field, profile);
      assert.equal(outcome.proposedValue, 'Cambridge', `Failed for label: "${label}"`);
      assert.equal(outcome.matchedProfileKey, 'city');
    }
  });

  it('matches Postal Code variations: ZIP Code, PIN Code, Postcode', () => {
    const variations = [
      'ZIP Code',
      'PIN Code',
      'Postcode',
      'Postal Code',
      'Pincode',
      'ZIP',
      'Postal PIN'
    ];

    for (const label of variations) {
      const field: DetectedFormField = {
        id: `f-${label}`,
        label,
        type: 'text',
        selector: '#postal'
      };
      const outcome = matchSingleField(field, profile);
      assert.equal(outcome.proposedValue, '02139', `Failed for label: "${label}"`);
      assert.equal(outcome.matchedProfileKey, 'postalCode');
    }
  });
});

describe('Autofill Matcher - Punctuation, Symbols, and Capitalization', () => {
  const profile: UserProfile = {
    ...DEFAULT_USER_PROFILE,
    fullName: 'Alex Rivera',
    email: 'alex@example.com',
    jobTitle: 'Data Science',
    postalCode: '10001'
  };

  it('normalizes punctuation and capitalization in field labels', () => {
    assert.equal(normalizeForMatching('Name:'), 'name');
    assert.equal(normalizeForMatching('Full Name *'), 'full name');
    assert.equal(normalizeForMatching('E-mail Address (Required):'), 'e mail address');
    assert.equal(normalizeForMatching('Course Interested In?'), 'course interested in');
    assert.equal(normalizeForMatching('ZIP / PIN Code:'), 'zip pin code');
    assert.equal(normalizeForMatching("Student's Full Name:"), 'students full name');
  });

  it('correctly matches labels containing colons, asterisks, question marks, and parentheses', () => {
    const fieldsWithPunctuation: Array<{ label: string; expectedVal: string; expectedKey: string }> = [
      { label: 'Name:', expectedVal: 'Alex Rivera', expectedKey: 'fullName' },
      { label: 'Full Name *', expectedVal: 'Alex Rivera', expectedKey: 'fullName' },
      { label: 'E-mail Address (Required):', expectedVal: 'alex@example.com', expectedKey: 'email' },
      { label: 'Course Interested In?', expectedVal: 'Data Science', expectedKey: 'jobTitle' },
      { label: 'ZIP / PIN Code:', expectedVal: '10001', expectedKey: 'postalCode' }
    ];

    for (const item of fieldsWithPunctuation) {
      const field: DetectedFormField = {
        id: `f-${item.label}`,
        label: item.label,
        type: 'text',
        selector: '#input'
      };
      const outcome = matchSingleField(field, profile);
      assert.equal(outcome.proposedValue, item.expectedVal, `Failed for "${item.label}"`);
      assert.equal(outcome.matchedProfileKey, item.expectedKey, `Key mismatch for "${item.label}"`);
    }
  });
});

describe('Autofill Matcher - Priority Hierarchy and Fallbacks', () => {
  const profile: UserProfile = {
    ...DEFAULT_USER_PROFILE,
    fullName: 'Morgan Smith',
    email: 'morgan@example.com',
    phone: '555-9876',
    organization: 'Acme Corp'
  };

  it('prioritizes explicit visible label over placeholder and name fallback', () => {
    const field: DetectedFormField = {
      id: 'f-prio1',
      label: 'Your Full Name',
      explicitLabel: 'Your Full Name',
      placeholder: 'Enter contact email',
      name: 'user_phone',
      type: 'text',
      selector: '#test1'
    };

    const outcome = matchSingleField(field, profile);
    assert.equal(outcome.matchedProfileKey, 'fullName');
    assert.equal(outcome.proposedValue, 'Morgan Smith');
    assert.equal(outcome.priorityLevel, 1);
  });

  it('prioritizes aria-label over placeholder when explicit label is absent', () => {
    const field: DetectedFormField = {
      id: 'f-prio2',
      label: 'Text Field #1',
      ariaLabel: 'Email Address',
      placeholder: 'Acme Corp',
      name: 'general_input',
      type: 'text',
      selector: '#test2'
    };

    const outcome = matchSingleField(field, profile);
    assert.equal(outcome.matchedProfileKey, 'email');
    assert.equal(outcome.proposedValue, 'morgan@example.com');
    assert.equal(outcome.priorityLevel, 2);
  });

  it('matches placeholder when visible label and aria-label are absent (placeholder-only field)', () => {
    const field: DetectedFormField = {
      id: 'f-placeholder-only',
      label: 'Text Field #3',
      placeholder: 'Your Full Name',
      name: 'field3',
      type: 'text',
      selector: '#test3'
    };

    const outcome = matchSingleField(field, profile);
    assert.equal(outcome.matchedProfileKey, 'fullName');
    assert.equal(outcome.proposedValue, 'Morgan Smith');
    assert.equal(outcome.confidence, 'medium');
    assert.equal(outcome.priorityLevel, 3);
  });

  it('matches appropriate autocomplete attribute when label and placeholder are generic', () => {
    const field: DetectedFormField = {
      id: 'f-autocomplete',
      label: 'Text Field #4',
      autocomplete: 'organization',
      name: 'input4',
      type: 'text',
      selector: '#test4'
    };

    const outcome = matchSingleField(field, profile);
    assert.equal(outcome.matchedProfileKey, 'organization');
    assert.equal(outcome.proposedValue, 'Acme Corp');
    assert.equal(outcome.priorityLevel, 4);
  });

  it('falls back to input name or ID with lower confidence only when higher priority signals are missing', () => {
    const field: DetectedFormField = {
      id: 'f-fallback',
      label: 'Text Field #5',
      name: 'applicant_phone',
      type: 'text',
      selector: '#test5'
    };

    const outcome = matchSingleField(field, profile);
    assert.equal(outcome.matchedProfileKey, 'phone');
    assert.equal(outcome.proposedValue, '555-9876');
    assert.equal(outcome.priorityLevel, 5);
  });
});

describe('Autofill Matcher - Ambiguity and Safe Exclusion of Substrings', () => {
  const profile: UserProfile = {
    ...DEFAULT_USER_PROFILE,
    fullName: 'Taylor Swift',
    email: 'taylor@example.com',
    phone: '555-1234'
  };

  it('does NOT match Emergency Contact Email to personal email and marks it ambiguous', () => {
    const field: DetectedFormField = {
      id: 'f-emergency-email',
      label: 'Emergency Contact Email',
      type: 'email',
      selector: '#em_email'
    };

    const outcome = matchSingleField(field, profile);
    assert.equal(outcome.confidence, 'ambiguous');
    assert.equal(outcome.proposedValue, '');
  });

  it('does NOT match Emergency Contact Phone to personal phone and marks it ambiguous', () => {
    const field: DetectedFormField = {
      id: 'f-emergency-phone',
      label: 'Emergency Contact Phone Number',
      type: 'tel',
      selector: '#em_phone'
    };

    const outcome = matchSingleField(field, profile);
    assert.equal(outcome.confidence, 'ambiguous');
    assert.equal(outcome.proposedValue, '');
  });

  it('does NOT match Parent or Guardian Name to user full name and marks it ambiguous', () => {
    const variations = [
      "Parent's Full Name",
      'Father Name',
      'Mother Name',
      'Guardian Full Name',
      'Spouse Name'
    ];

    for (const label of variations) {
      const field: DetectedFormField = {
        id: `f-${label}`,
        label,
        type: 'text',
        selector: '#relative'
      };

      const outcome = matchSingleField(field, profile);
      assert.equal(
        outcome.confidence,
        'ambiguous',
        `Expected "${label}" to be flagged as ambiguous`
      );
      assert.equal(outcome.proposedValue, '');
    }
  });

  it('does NOT match Alternate or Secondary Email to user primary email', () => {
    const field: DetectedFormField = {
      id: 'f-alt-email',
      label: 'Alternate Email Address',
      type: 'email',
      selector: '#alt_email'
    };

    const outcome = matchSingleField(field, profile);
    assert.equal(outcome.confidence, 'ambiguous');
    assert.equal(outcome.proposedValue, '');
  });
});

describe('Autofill Matcher - Duplicate Prevention Across Form Fields', () => {
  const profile: UserProfile = {
    ...DEFAULT_USER_PROFILE,
    fullName: 'Jordan Miller',
    email: 'jordan@example.com'
  };

  it('does not allow two unrelated form fields to receive the same profile value by accidental matching', () => {
    const fields: DetectedFormField[] = [
      {
        id: 'f-primary-name',
        label: 'Full Name',
        explicitLabel: 'Full Name',
        type: 'text',
        selector: '#primaryName'
      },
      {
        id: 'f-fallback-name',
        label: 'Reference Person',
        name: 'name',
        type: 'text',
        selector: '#refPerson'
      }
    ];

    const summary = matchProfileToFormFields(fields, profile);

    // Primary name (priority 1) wins the match
    assert.equal(summary.matches[0].proposedValue, 'Jordan Miller');
    assert.equal(summary.matches[0].confidence, 'high');

    // Fallback name is prevented from duplicate assignment and left blank
    assert.equal(summary.matches[1].proposedValue, '');
    assert.notEqual(summary.matches[1].confidence, 'high');
  });

  it('marks conflicting equal-priority duplicate fields as ambiguous and leaves them blank', () => {
    const fields: DetectedFormField[] = [
      {
        id: 'f-name1',
        label: 'Applicant Name',
        explicitLabel: 'Applicant Name',
        type: 'text',
        selector: '#name1'
      },
      {
        id: 'f-name2',
        label: 'Student Name',
        explicitLabel: 'Student Name',
        type: 'text',
        selector: '#name2'
      }
    ];

    const summary = matchProfileToFormFields(fields, profile);

    // Both matched fullName with identical priority (1), so both are kept blank for safety
    assert.equal(summary.matches[0].proposedValue, '');
    assert.equal(summary.matches[0].confidence, 'ambiguous');
    assert.equal(summary.matches[1].proposedValue, '');
    assert.equal(summary.matches[1].confidence, 'ambiguous');
  });
});

describe('Autofill Matcher - Sensitive Information Safeguards (Section 5)', () => {
  it('strictly excludes passwords and hidden fields', () => {
    assert.equal(isFieldSensitive({ type: 'password', label: 'Password' }), true);
    assert.equal(isFieldSensitive({ type: 'hidden', name: 'csrf_token' }), true);
  });

  it('strictly excludes credit card numbers and CVV security codes', () => {
    assert.equal(isFieldSensitive({ type: 'text', label: 'Credit Card Number' }), true);
    assert.equal(isFieldSensitive({ type: 'text', name: 'card_cvv' }), true);
    assert.equal(isFieldSensitive({ type: 'text', placeholder: 'Card CVV / CVC' }), true);
    assert.equal(isFieldSensitive({ type: 'text', autocomplete: 'cc-number' }), true);
  });

  it('strictly excludes OTPs, 2FA codes, security PINs, and SSN', () => {
    assert.equal(isFieldSensitive({ type: 'text', label: 'Enter OTP Code' }), true);
    assert.equal(isFieldSensitive({ type: 'text', name: 'mfa_token' }), true);
    assert.equal(isFieldSensitive({ type: 'text', label: 'Security PIN' }), true);
    assert.equal(isFieldSensitive({ type: 'text', label: 'Social Security Number (SSN)' }), true);
    assert.equal(isFieldSensitive({ type: 'text', label: 'Government ID / National ID' }), true);
  });

  it('does NOT falsely reject "shipping" as a security PIN', () => {
    const field = { type: 'text', label: 'Shipping Address', name: 'shipping_address' };
    assert.equal(isFieldSensitive(field), false);
  });

  it('does NOT reject postal pin code in address forms', () => {
    const field1 = { type: 'text', label: 'Postal PIN Code', name: 'postal_code' };
    assert.equal(isFieldSensitive(field1), false);

    const field2 = { type: 'text', label: 'PIN Code', name: 'pincode' };
    assert.equal(isFieldSensitive(field2), false);

    const field3 = { type: 'text', label: 'Pincode' };
    assert.equal(isFieldSensitive(field3), false);
  });

  it('never autofills sensitive fields even if a custom profile field exists', () => {
    const profileWithSensitiveCustom: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      customFields: [{ id: 's1', label: 'Credit Card', value: '4111222233334444' }]
    };
    const field: DetectedFormField = {
      id: 'f-card',
      label: 'Credit Card Number',
      type: 'text',
      selector: '#cc'
    };
    const outcome = matchSingleField(field, profileWithSensitiveCustom);
    assert.equal(outcome.isSensitive, true);
    assert.equal(outcome.proposedValue, '');
  });
});

describe('Autofill Matcher - Sample Registration Form Simulation', () => {
  const profile: UserProfile = {
    fullName: 'Alex Rivera',
    email: 'alex@example.com',
    phone: '555-0144',
    organization: 'Stanford University',
    jobTitle: 'Computer Science',
    address: '123 Main St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94105',
    notes: 'Interested in AI alignment and safety research.',
    customFields: []
  };

  // Fields corresponding to public/sample-form.html:
  // Full Name, Email Address, Phone Number, College / Organization, Course Interested In, Message
  const sampleFormFields: DetectedFormField[] = [
    {
      id: 'field-0-fullName',
      label: 'Full Name',
      explicitLabel: 'Full Name',
      type: 'text',
      name: 'fullName',
      placeholder: 'e.g. Alex Rivera',
      selector: '#fullName',
      isRequired: true,
      labelSource: 'explicit'
    },
    {
      id: 'field-1-userEmail',
      label: 'Email Address',
      explicitLabel: 'Email Address',
      type: 'email',
      name: 'email',
      placeholder: 'e.g. alex@example.com',
      selector: '#userEmail',
      isRequired: true,
      labelSource: 'explicit'
    },
    {
      id: 'field-2-userPhone',
      label: 'Phone Number',
      explicitLabel: 'Phone Number',
      type: 'tel',
      name: 'phone',
      placeholder: 'e.g. 555-0144',
      selector: '#userPhone',
      labelSource: 'explicit'
    },
    {
      id: 'field-3-userCollege',
      label: 'College / Organization',
      explicitLabel: 'College / Organization',
      type: 'text',
      name: 'organization',
      placeholder: 'e.g. Stanford University',
      selector: '#userCollege',
      labelSource: 'explicit'
    },
    {
      id: 'field-4-userCourse',
      label: 'Course Interested In',
      explicitLabel: 'Course Interested In',
      type: 'text',
      name: 'course',
      placeholder: 'e.g. Computer Science',
      selector: '#userCourse',
      labelSource: 'explicit'
    },
    {
      id: 'field-5-userMessage',
      label: 'Message',
      explicitLabel: 'Message',
      type: 'textarea',
      name: 'message',
      placeholder: 'Tell us about your background or inquiry...',
      selector: '#userMessage',
      labelSource: 'explicit'
    }
  ];

  it('matches all standard eligible fields from the sample registration form', () => {
    const summary = matchProfileToFormFields(sampleFormFields, profile);
    assert.equal(summary.matchedCount, 6); // All 6 fields matched
    assert.equal(summary.ambiguousCount, 0);

    // Full Name
    assert.equal(summary.matches[0].proposedValue, 'Alex Rivera');
    assert.equal(summary.matches[0].matchedProfileKey, 'fullName');
    assert.equal(summary.matches[0].matchStatus, 'exact');

    // Email Address
    assert.equal(summary.matches[1].proposedValue, 'alex@example.com');
    assert.equal(summary.matches[1].matchedProfileKey, 'email');
    assert.equal(summary.matches[1].matchStatus, 'exact');

    // Phone Number
    assert.equal(summary.matches[2].proposedValue, '555-0144');
    assert.equal(summary.matches[2].matchedProfileKey, 'phone');
    assert.equal(summary.matches[2].matchStatus, 'exact');

    // College / Organization
    assert.equal(summary.matches[3].proposedValue, 'Stanford University');
    assert.equal(summary.matches[3].matchedProfileKey, 'organization');
    assert.equal(summary.matches[3].matchStatus, 'exact');

    // Course Interested In
    assert.equal(summary.matches[4].proposedValue, 'Computer Science');
    assert.equal(summary.matches[4].matchedProfileKey, 'jobTitle');
    assert.equal(summary.matches[4].matchStatus, 'exact');

    // Message
    assert.equal(summary.matches[5].proposedValue, 'Interested in AI alignment and safety research.');
    assert.equal(summary.matches[5].matchedProfileKey, 'notes');
    assert.equal(summary.matches[5].matchStatus, 'exact');
  });

  it('ensures correct values are passed to review UI and approved before filling', () => {
    const summary = matchProfileToFormFields(sampleFormFields, profile);

    // Review stage: suggestions mapped from matcher
    const suggestions: Record<string, { value: string; approved: boolean }> = {};
    summary.matches.forEach((outcome) => {
      suggestions[outcome.fieldId] = {
        value: outcome.proposedValue,
        approved: Boolean(outcome.proposedValue)
      };
    });

    assert.equal(Object.keys(suggestions).length, 6);
    assert.equal(Object.values(suggestions).filter((s) => s.approved).length, 6);

    // Approval stage: User approves fields
    const approvedToFill: ApprovedFormFieldToFill[] = sampleFormFields
      .filter((f) => suggestions[f.id]?.approved && suggestions[f.id]?.value.trim())
      .map((f) => ({
        fieldId: f.id,
        selector: f.selector,
        label: f.label,
        value: suggestions[f.id].value.trim()
      }));

    assert.equal(approvedToFill.length, 6);
    assert.equal(approvedToFill[0].label, 'Full Name');
    assert.equal(approvedToFill[0].value, 'Alex Rivera');
    assert.equal(approvedToFill[3].label, 'College / Organization');
    assert.equal(approvedToFill[3].value, 'Stanford University');
    assert.equal(approvedToFill[4].label, 'Course Interested In');
    assert.equal(approvedToFill[4].value, 'Computer Science');
    assert.equal(approvedToFill[5].label, 'Message');
    assert.equal(approvedToFill[5].value, 'Interested in AI alignment and safety research.');
  });
});

describe('Autofill Matcher - Ambiguity Resolution Prompt (Section 3)', () => {
  it('constructs classifier prompt containing only field labels and categories (zero personal data)', () => {
    const fields: DetectedFormField[] = [
      { id: 'f-ambig', label: 'Primary Affiliation', type: 'text', selector: '#affil' }
    ];
    const categories = ['Full Name', 'Email', 'College or Organization', 'Job Title'];
    const prompt = buildAmbiguousResolverPrompt(fields, categories);

    assert.ok(prompt.includes('Primary Affiliation'));
    assert.ok(prompt.includes('College or Organization'));
    assert.ok(!prompt.includes('Jane Doe'));
    assert.ok(!prompt.includes('jane.doe@example.com'));
  });
});

describe('Data Flow Trace - Stages 1 through 8 End-to-End Simulation', () => {
  it('executes stages 1 through 8 seamlessly without missing or mismatched data', async () => {
    // Stage 1: Profile details are saved
    const inputProfile: UserProfile = {
      fullName: 'Alex Rivera',
      email: 'alex@example.com',
      phone: '555-0144',
      organization: 'Stanford University',
      jobTitle: 'Computer Science',
      address: '123 Main St',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94105',
      notes: 'Interested in AI alignment and safety research.',
      customFields: []
    };
    const saveRes = await saveProfile(inputProfile);
    assert.equal(saveRes.success, true, 'Stage 1: Profile must be successfully saved');

    // Stage 2: Saved details are read back from storage
    const loadedProfile = await loadProfile();
    assert.equal(loadedProfile.fullName, 'Alex Rivera', 'Stage 2: fullName matches');
    assert.equal(loadedProfile.organization, 'Stanford University', 'Stage 2: organization matches');
    assert.equal(loadedProfile.jobTitle, 'Computer Science', 'Stage 2: jobTitle matches');
    assert.equal(loadedProfile.notes, 'Interested in AI alignment and safety research.', 'Stage 2: notes matches');

    // Stage 3 & 4: Active webpage form fields detected & labels/metadata extracted
    const sampleFields: DetectedFormField[] = [
      { id: 'f-0', label: 'Full Name', type: 'text', selector: '#fullName', labelSource: 'explicit' },
      { id: 'f-1', label: 'Email Address', type: 'email', selector: '#userEmail', labelSource: 'explicit' },
      { id: 'f-2', label: 'Phone Number', type: 'tel', selector: '#userPhone', labelSource: 'explicit' },
      { id: 'f-3', label: 'College / Organization', type: 'text', selector: '#userCollege', labelSource: 'explicit' },
      { id: 'f-4', label: 'Course Interested In', type: 'text', selector: '#userCourse', labelSource: 'explicit' },
      { id: 'f-5', label: 'Message', type: 'textarea', selector: '#userMessage', labelSource: 'explicit' }
    ];
    assert.equal(sampleFields.length, 6, 'Stage 3 & 4: 6 eligible form fields detected');

    // Stage 5: Profile properties matched to detected fields
    const summary = matchProfileToFormFields(sampleFields, loadedProfile);
    assert.equal(summary.matchedCount, 6, 'Stage 5: All 6 fields must be matched');
    assert.equal(summary.sensitiveCount, 0, 'Stage 5: Sensitive count is 0');
    assert.equal(summary.ambiguousCount, 0, 'Stage 5: Ambiguous count is 0');

    // Stage 6: Proposed mappings passed to review UI
    const reviewSuggestions: Record<string, { value: string; approved: boolean; label: string }> = {};
    summary.matches.forEach((outcome) => {
      reviewSuggestions[outcome.fieldId] = {
        label: outcome.label,
        value: outcome.proposedValue,
        approved: Boolean(outcome.proposedValue)
      };
    });
    assert.equal(Object.keys(reviewSuggestions).length, 6, 'Stage 6: Review suggestions count');
    assert.equal(reviewSuggestions['f-0'].value, 'Alex Rivera', 'Stage 6: Full Name in review');
    assert.equal(reviewSuggestions['f-3'].value, 'Stanford University', 'Stage 6: Organization in review');
    assert.equal(reviewSuggestions['f-4'].value, 'Computer Science', 'Stage 6: Course in review');
    assert.equal(reviewSuggestions['f-5'].value, 'Interested in AI alignment and safety research.', 'Stage 6: Message in review');

    // Stage 7: Approved mappings reach the fill function
    const approvedToFill: ApprovedFormFieldToFill[] = sampleFields
      .filter((f) => reviewSuggestions[f.id]?.approved && reviewSuggestions[f.id]?.value.trim())
      .map((f) => ({
        fieldId: f.id,
        selector: f.selector,
        label: f.label,
        value: reviewSuggestions[f.id].value.trim()
      }));
    assert.equal(approvedToFill.length, 6, 'Stage 7: All 6 fields approved to fill');

    // Stage 8: Correct webpage fields are updated (DOM simulation)
    const domStore: Record<string, string> = {};
    approvedToFill.forEach((field) => {
      domStore[field.selector] = field.value;
    });
    assert.equal(domStore['#fullName'], 'Alex Rivera', 'Stage 8: DOM updated #fullName');
    assert.equal(domStore['#userEmail'], 'alex@example.com', 'Stage 8: DOM updated #userEmail');
    assert.equal(domStore['#userPhone'], '555-0144', 'Stage 8: DOM updated #userPhone');
    assert.equal(domStore['#userCollege'], 'Stanford University', 'Stage 8: DOM updated #userCollege');
    assert.equal(domStore['#userCourse'], 'Computer Science', 'Stage 8: DOM updated #userCourse');
    assert.equal(domStore['#userMessage'], 'Interested in AI alignment and safety research.', 'Stage 8: DOM updated #userMessage');
  });
});

describe('Autofill Matcher - Single Source of Truth & Extended Fields', () => {
  it('matches first name and last name derived from single full name entry', () => {
    const profile: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      fullName: 'Samantha Vance',
      email: 'samantha@example.com'
    };

    const fnameField: DetectedFormField = {
      id: 'f-first',
      label: 'First Name',
      type: 'text',
      selector: '#firstName'
    };
    const lnameField: DetectedFormField = {
      id: 'f-last',
      label: 'Last Name',
      type: 'text',
      selector: '#lastName'
    };

    const resFirst = matchSingleField(fnameField, profile);
    assert.equal(resFirst.proposedValue, 'Samantha');
    assert.equal(resFirst.matchedProfileKey, 'firstName');

    const resLast = matchSingleField(lnameField, profile);
    assert.equal(resLast.proposedValue, 'Vance');
    assert.equal(resLast.matchedProfileKey, 'lastName');
  });

  it('matches all common variations of Email including Email ID and E-mail address', () => {
    const profile: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      email: 'user@domain.com'
    };

    const variations = [
      'Email',
      'E-mail',
      'Email address',
      'E-mail address',
      'Email ID',
      'E-mail ID',
      'Contact Email',
      'EmailId'
    ];

    for (const label of variations) {
      const field: DetectedFormField = {
        id: `f-${label}`,
        label,
        type: 'text',
        selector: '#email'
      };
      const res = matchSingleField(field, profile);
      assert.equal(res.proposedValue, 'user@domain.com', `Failed for email variation: "${label}"`);
      assert.equal(res.matchedProfileKey, 'email');
    }
  });

  it('matches camelCase input name userEmail when visible label is missing', () => {
    const profile: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      email: 'dev@domain.com'
    };

    const field: DetectedFormField = {
      id: 'f-camel',
      label: 'Text Field #1',
      name: 'userEmail',
      type: 'text',
      selector: '#userEmail'
    };

    const res = matchSingleField(field, profile);
    assert.equal(res.proposedValue, 'dev@domain.com');
    assert.equal(res.matchedProfileKey, 'email');
  });

  it('matches Country field and resolves select option value', () => {
    const profile: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      country: 'United States'
    };

    const selectField: DetectedFormField = {
      id: 'f-country',
      label: 'Country / Region',
      type: 'select',
      selector: '#country',
      options: [
        { value: '', text: 'Select a country' },
        { value: 'CA', text: 'Canada' },
        { value: 'US', text: 'United States' },
        { value: 'UK', text: 'United Kingdom' }
      ]
    };

    const res = matchSingleField(selectField, profile);
    assert.equal(res.proposedValue, 'US', 'Select option value US should be resolved for United States');
    assert.equal(res.matchedProfileKey, 'country');
  });

  it('leaves uncertain/ambiguous matches empty and flags for review', () => {
    const profile: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      fullName: 'Alex Rivera',
      email: 'alex@example.com'
    };

    const emergencyEmail: DetectedFormField = {
      id: 'f-emerg',
      label: 'Emergency Contact Email',
      type: 'email',
      selector: '#emergEmail'
    };

    const res = matchSingleField(emergencyEmail, profile);
    assert.equal(res.proposedValue, '', 'Uncertain match proposed value must be empty');
    assert.equal(res.confidence, 'ambiguous', 'Uncertain match must be marked ambiguous');
    assert.equal(res.matchStatus, 'ambiguous', 'Match status must be ambiguous');
  });
});

describe('Google Forms & Generic Placeholder Resilience', () => {
  const fullProfile: UserProfile = {
    ...DEFAULT_USER_PROFILE,
    fullName: 'Jane Doe',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
    phone: '+1 555-0199',
    organization: 'Stanford University',
    jobTitle: 'Computer Science',
    address: '450 Serra Mall',
    city: 'Stanford',
    state: 'California',
    postalCode: '94305',
    country: 'United States'
  };

  it('correctly matches Google Forms fields when input placeholder is "Your answer" and question title is extracted', () => {
    // 7 questions as described in the user problem
    const googleFormsFields: DetectedFormField[] = [
      { id: 'q1', label: 'First Name', placeholder: 'Your answer', type: 'text', selector: 'input.whsOnd[name="entry.101"]' },
      { id: 'q2', label: 'Last Name', placeholder: 'Your answer', type: 'text', selector: 'input.whsOnd[name="entry.102"]' },
      { id: 'q3', label: 'Email Address', placeholder: 'Your answer', type: 'text', selector: 'input.whsOnd[name="entry.103"]' },
      { id: 'q4', label: 'Phone Number', placeholder: 'Your answer', type: 'text', selector: 'input.whsOnd[name="entry.104"]' },
      { id: 'q5', label: 'Address', placeholder: 'Your answer', type: 'text', selector: 'input.whsOnd[name="entry.105"]' },
      { id: 'q6', label: 'College / University', placeholder: 'Your answer', type: 'text', selector: 'input.whsOnd[name="entry.106"]' },
      { id: 'q7', label: 'Degree / Qualification', placeholder: 'Your answer', type: 'text', selector: 'input.whsOnd[name="entry.107"]' }
    ];

    const matchSummary = matchProfileToFormFields(googleFormsFields, fullProfile);

    assert.equal(matchSummary.matchedCount, 7, 'All 7 Google Forms questions should match saved profile');
    assert.equal(matchSummary.ambiguousCount, 0);

    const q1 = matchSummary.matches.find((m) => m.fieldId === 'q1');
    assert.equal(q1?.proposedValue, 'Jane', 'First Name must match Jane');
    assert.equal(q1?.matchedProfileKey, 'firstName');

    const q2 = matchSummary.matches.find((m) => m.fieldId === 'q2');
    assert.equal(q2?.proposedValue, 'Doe', 'Last Name must match Doe');
    assert.equal(q2?.matchedProfileKey, 'lastName');

    const q3 = matchSummary.matches.find((m) => m.fieldId === 'q3');
    assert.equal(q3?.proposedValue, 'jane.doe@example.com', 'Email must match');
    assert.equal(q3?.matchedProfileKey, 'email');

    const q4 = matchSummary.matches.find((m) => m.fieldId === 'q4');
    assert.equal(q4?.proposedValue, '+1 555-0199', 'Phone must match');
    assert.equal(q4?.matchedProfileKey, 'phone');

    const q5 = matchSummary.matches.find((m) => m.fieldId === 'q5');
    assert.equal(q5?.proposedValue, '450 Serra Mall', 'Address must match');
    assert.equal(q5?.matchedProfileKey, 'address');

    const q6 = matchSummary.matches.find((m) => m.fieldId === 'q6');
    assert.equal(q6?.proposedValue, 'Stanford University', 'College must match');
    assert.equal(q6?.matchedProfileKey, 'organization');

    const q7 = matchSummary.matches.find((m) => m.fieldId === 'q7');
    assert.equal(q7?.proposedValue, 'Computer Science', 'Degree must match');
    assert.equal(q7?.matchedProfileKey, 'jobTitle');
  });

  it('does NOT match generic label "Your answer" alone when question title is absent', () => {
    const genericField: DetectedFormField = {
      id: 'generic-1',
      label: 'Your answer',
      placeholder: 'Your answer',
      type: 'text',
      selector: 'input.whsOnd'
    };

    const res = matchSingleField(genericField, fullProfile);
    assert.equal(res.proposedValue, '', 'Generic label "Your answer" must never autofill a field');
    assert.equal(res.matchStatus, 'unmatched');
  });

  it('handles question labels with trailing required asterisks and question numbers', () => {
    const rawQuestions: DetectedFormField[] = [
      { id: 'num-1', label: '1. First Name *', type: 'text', selector: '#q1' },
      { id: 'num-2', label: 'Q2: Address *', type: 'text', selector: '#q2' },
      { id: 'num-3', label: '3) Email Address (required)', type: 'text', selector: '#q3' }
    ];

    const matchSummary = matchProfileToFormFields(rawQuestions, fullProfile);
    assert.equal(matchSummary.matches.find((m) => m.fieldId === 'num-1')?.proposedValue, 'Jane');
    assert.equal(matchSummary.matches.find((m) => m.fieldId === 'num-2')?.proposedValue, '450 Serra Mall');
    assert.equal(matchSummary.matches.find((m) => m.fieldId === 'num-3')?.proposedValue, 'jane.doe@example.com');
  });
});

describe('Reliable Field Normalization & Known Aliases', () => {
  const profile: UserProfile = {
    ...DEFAULT_USER_PROFILE,
    fullName: 'Jane Marie Doe',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '555-1234',
    organization: 'MIT',
    jobTitle: 'Bachelor of Science',
    address: '77 Massachusetts Ave',
    city: 'Cambridge',
    state: 'Massachusetts',
    postalCode: '02139'
  };

  it('supports First Name aliases (givenName, fname, forename) without matching Full Name', () => {
    for (const label of ['First Name', 'Given Name', 'givenName', 'fname', 'Forename']) {
      const res = matchSingleField({ id: `fn-${label}`, label, type: 'text', selector: '#fn' }, profile);
      assert.equal(res.proposedValue, 'Jane', `Failed for ${label}`);
      assert.equal(res.matchedProfileKey, 'firstName');
    }
  });

  it('supports Last Name aliases (familyName, surname, lname) without matching Full Name', () => {
    for (const label of ['Last Name', 'Family Name', 'familyName', 'surname', 'lname']) {
      const res = matchSingleField({ id: `ln-${label}`, label, type: 'text', selector: '#ln' }, profile);
      assert.equal(res.proposedValue, 'Doe', `Failed for ${label}`);
      assert.equal(res.matchedProfileKey, 'lastName');
    }
  });

  it('supports Full Name aliases (fullName, name, completeName) without matching First Name', () => {
    for (const label of ['Full Name', 'fullName', 'Name', 'Your Name', 'Complete Name', 'Applicant Name']) {
      const res = matchSingleField({ id: `fl-${label}`, label, type: 'text', selector: '#fl' }, profile);
      assert.equal(res.proposedValue, 'Jane Marie Doe', `Failed for ${label}`);
      assert.equal(res.matchedProfileKey, 'fullName');
    }
  });

  it('supports Address aliases (streetAddress, addressLine1) without confusing with City', () => {
    for (const label of ['Address', 'Street Address', 'streetAddress', 'Residential Address', 'Address Line 1']) {
      const res = matchSingleField({ id: `addr-${label}`, label, type: 'text', selector: '#addr' }, profile);
      assert.equal(res.proposedValue, '77 Massachusetts Ave', `Failed for ${label}`);
      assert.equal(res.matchedProfileKey, 'address');
    }
  });

  it('supports City aliases (locality, town) without confusing with Address', () => {
    for (const label of ['City', 'Locality', 'locality', 'Town']) {
      const res = matchSingleField({ id: `city-${label}`, label, type: 'text', selector: '#city' }, profile);
      assert.equal(res.proposedValue, 'Cambridge', `Failed for ${label}`);
      assert.equal(res.matchedProfileKey, 'city');
    }
  });

  it('supports State aliases (region, province) and Postal Code aliases (zipCode, pincode)', () => {
    for (const label of ['State', 'Region', 'region', 'Province']) {
      const res = matchSingleField({ id: `st-${label}`, label, type: 'text', selector: '#st' }, profile);
      assert.equal(res.proposedValue, 'Massachusetts', `Failed for ${label}`);
      assert.equal(res.matchedProfileKey, 'state');
    }

    for (const label of ['Postal Code', 'Zip Code', 'zipCode', 'pincode', 'PIN Code', 'Postcode']) {
      const res = matchSingleField({ id: `zip-${label}`, label, type: 'text', selector: '#zip' }, profile);
      assert.equal(res.proposedValue, '02139', `Failed for ${label}`);
      assert.equal(res.matchedProfileKey, 'postalCode');
    }
  });

  it('supports College aliases (institution, university) and Degree aliases (degree, qualification)', () => {
    for (const label of ['College', 'Institution', 'institution', 'University', 'university']) {
      const res = matchSingleField({ id: `col-${label}`, label, type: 'text', selector: '#col' }, profile);
      assert.equal(res.proposedValue, 'MIT', `Failed for ${label}`);
      assert.equal(res.matchedProfileKey, 'organization');
    }

    for (const label of ['Degree', 'degree', 'Qualification', 'qualification', 'Course']) {
      const res = matchSingleField({ id: `deg-${label}`, label, type: 'text', selector: '#deg' }, profile);
      assert.equal(res.proposedValue, 'Bachelor of Science', `Failed for ${label}`);
      assert.equal(res.matchedProfileKey, 'jobTitle');
    }
  });

  it('leaves missing profile fields empty and marks them unmatched for review', () => {
    const sparseProfile: UserProfile = {
      ...DEFAULT_USER_PROFILE,
      fullName: 'Alex Ray',
      email: 'alex@example.com'
      // address, phone, city, etc. are empty
    };

    const addressField: DetectedFormField = {
      id: 'f-empty-addr',
      label: 'Street Address',
      type: 'text',
      selector: '#addr'
    };

    const res = matchSingleField(addressField, sparseProfile);
    assert.equal(res.proposedValue, '', 'Empty profile field must leave proposedValue empty');
    assert.equal(res.matchStatus, 'unmatched');
    assert.equal(res.confidence, 'none');
  });
});



