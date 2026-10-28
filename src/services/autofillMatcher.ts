import { DetectedFormField } from '../types/form';
import { UserProfile } from '../types/profile';

export type MatchConfidence = 'high' | 'medium' | 'ambiguous' | 'none';

export type MatchStatus = 'exact' | 'inferred' | 'ambiguous' | 'unmatched';

export type PriorityLevel = 1 | 2 | 3 | 4 | 5;

export interface FieldMatchOutcome {
  fieldId: string;
  label: string;
  proposedValue: string;
  matchedProfileKey?: string;
  confidence: MatchConfidence;
  matchStatus: MatchStatus;
  isSensitive: boolean;
  reason?: string;
  priorityLevel?: PriorityLevel;
}

export interface AutofillMatchSummary {
  matches: FieldMatchOutcome[];
  matchedCount: number;
  skippedCount: number;
  sensitiveCount: number;
  ambiguousCount: number;
}

/**
 * Strict regexes with word boundaries for sensitive fields.
 * Excludes passwords, credit cards, CVVs, OTPs, security PINs, SSNs, captchas.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(password|passcode|passwd|secret|pwd)\b/i,
  /\b(otp|2fa|mfa|token|authcode|security[-_ ]?code|verification[-_ ]?code|recovery[-_ ]?code)\b/i,
  /\b(atm[-_ ]?pin|mpin|security[-_ ]?pin|secret[-_ ]?pin|card[-_ ]?pin)\b/i,
  /\b(credit[-_ ]?card|debit[-_ ]?card|card[-_ ]?number|cardnumber|cvv|cvc|cc[-_ ]?num|payment[-_ ]?card|pan)\b/i,
  /\b(ssn|social[-_ ]?security|tax[-_ ]?id|ein|national[-_ ]?id|passport|aadhar|gov[-_ ]?id)\b/i,
  /\b(captcha|recaptcha|hcaptcha|turnstile)\b/i,
  /\b(bank[-_ ]?account|routing[-_ ]?number|iban|swift[-_ ]?code)\b/i
];

const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'cc-name',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-type',
  'transaction-amount',
  'one-time-code'
]);

/**
 * Checks if a field is sensitive and must never be read, saved, or filled.
 * Accurately allows postal PIN codes (e.g., India Postal Index Number) while strictly
 * rejecting security/ATM/banking PINs.
 */
export function isFieldSensitive(field: {
  type?: string;
  name?: string;
  elementId?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  autocomplete?: string;
  ariaLabel?: string;
  explicitLabel?: string;
}): boolean {
  const type = (field.type || '').toLowerCase();
  if (type === 'password' || type === 'hidden') {
    return true;
  }

  const autocomplete = (field.autocomplete || '').toLowerCase().trim();
  if (autocomplete && SENSITIVE_AUTOCOMPLETE.has(autocomplete)) {
    return true;
  }

  // Inspect label, name, id, and placeholder using word boundaries
  const targetStrings = [
    field.explicitLabel || '',
    field.label || '',
    field.ariaLabel || '',
    field.name || '',
    field.elementId || '',
    field.id || '',
    field.placeholder || ''
  ];

  for (const str of targetStrings) {
    if (!str) continue;
    const normalized = str.replace(/[_-]+/g, ' ');

    // Special guard: If PIN is in postal, zip, or address context without banking/security terms,
    // it is a postal code, not a sensitive authentication PIN.
    const isPostalContext =
      /\b(postal|zip|zipcode|postcode|address|location|area|pin\s*code|pincode)\b/i.test(normalized) &&
      !/\b(atm|security|secret|auth|card|mpin|bank|login|password)\b/i.test(normalized);

    if (isPostalContext) {
      continue;
    }

    // Explicit security PIN check
    if (
      /\b(pin|pin[-_ ]?code)\b/i.test(normalized) &&
      !/\b(postal|zip|postcode|pin\s*code|pincode)\b/i.test(normalized)
    ) {
      return true;
    }

    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(normalized)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if a candidate label string is a generic placeholder or prompt
 * (e.g., "Your answer", "Short answer text", "Option 1") rather than a real question title.
 */
export function isGenericFieldLabel(text: string): boolean {
  if (!text) return true;
  const clean = text
    .toLowerCase()
    .trim()
    .replace(/[*:]+/g, '')
    .trim();
  return (
    clean === '' ||
    /^(your\s*answer|short\s*answer(\s*text)?|long\s*answer(\s*text)?|option\s*\d+|choose|select(\s*an\s*option)?|select\s*\.\.\.|type\s*your\s*answer(\s*here)?|enter\s*(your\s*)?answer|answer|text\s*field\s*#?\d*|input\s*field\s*#?\d*|textarea\s*field\s*#?\d*|select\s*field\s*#?\d*)$/i.test(
      clean
    )
  );
}

/**
 * Normalizes strings for matching by stripping punctuation, symbols, and extraneous whitespace.
 * Handles apostrophes (e.g. "student's name" -> "students name") and common abbreviations.
 */
export function normalizeForMatching(text: string): string {
  if (!text) return '';
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // split camelCase e.g. userEmail -> user Email
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/['’]/g, '') // strip apostrophes
    .replace(/[-_]+/g, ' ') // convert dashes and underscores to spaces
    .replace(/[^\w\s]+/g, ' ') // replace punctuation & symbols with spaces
    .replace(/\b(required|optional)\b/gi, ' ') // strip (required), (optional) tags
    .replace(/^\s*(?:q(?:uestion)?\s*\d+[:.-]?|\d+[:.)-])\s*/i, '') // strip leading question numbers like "1. ", "Q1: "
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Modifiers that indicate a field is for a secondary contact, alternative entity,
 * or third party (e.g. "Emergency Contact Email", "Parent Phone", "Alternate Email").
 */
const AMBIGUOUS_MODIFIERS =
  /\b(emergency|parent|parents|guardian|guardians|mother|mothers|father|fathers|spouse|spouses|relative|next\s*of\s*kin|alternate|alternative|secondary|backup|other|second|work|office|company|business|employer|supervisor|manager|reference|referrer|referee|sponsor|friend|doctor|physician)\b/i;

/**
 * Helper to escape regex special characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type StandardProfileKey =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'organization'
  | 'jobTitle'
  | 'address'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'country'
  | 'notes';

interface MatchedCandidate {
  key: StandardProfileKey | string;
  value: string;
  priorityLevel: PriorityLevel;
  confidence: MatchConfidence;
  reason: string;
  sourceText: string;
}

/**
 * Checks if candidate text indicates an ambiguous field for personal contact details.
 */
function checkAmbiguity(normalizedText: string, category: StandardProfileKey): boolean {
  if (
    category === 'email' ||
    category === 'phone' ||
    category === 'fullName' ||
    category === 'firstName' ||
    category === 'lastName'
  ) {
    return AMBIGUOUS_MODIFIERS.test(normalizedText);
  }
  return false;
}

/**
 * Deterministically tests normalized text against standard profile field categories.
 */
function matchTextToProfileCategory(
  normalizedText: string,
  fieldType: string,
  priorityLevel: PriorityLevel,
  profile: UserProfile
): { match?: MatchedCandidate; isAmbiguous?: boolean; ambiguousReason?: string } {
  if (!normalizedText) {
    return {};
  }

  // Early ambiguity guard for any third-party or alternative contact/name fields
  // Exclude organization and course concepts (e.g., "Company Name", "Course Name") so they match their respective categories
  const isOrgOrCourse = /\b(college|university|institution|organization|organisation|school|campus|institute|company|employer|workplace|course|degree|program|major)\b/i.test(
    normalizedText
  );

  if (!isOrgOrCourse) {
    const hasAmbiguousModifier = AMBIGUOUS_MODIFIERS.test(normalizedText);
    const hasContactOrIdentityTerm = /\b(name|email|mail|phone|mobile|tel|number|contact)\b/i.test(
      normalizedText
    );
    if (hasAmbiguousModifier && hasContactOrIdentityTerm) {
      return {
        isAmbiguous: true,
        ambiguousReason: `Ambiguous field (contains modifier indicating non-primary contact: "${normalizedText}")`
      };
    }
  }

  // Helper to construct candidate
  const candidate = (
    key: StandardProfileKey,
    val: string,
    confidence: MatchConfidence,
    reason: string
  ): MatchedCandidate => ({
    key,
    value: (val || '').trim(),
    priorityLevel,
    confidence,
    reason,
    sourceText: normalizedText
  });

  // 1. Email Address
  // Matches: Email, E-mail Address, Contact Email, Email Address, etc.
  const isEmail =
    fieldType === 'email' ||
    /\b(email|email\s*address|e\s*mail|e\s*mail\s*address|contact\s*email|applicant\s*email|student\s*email|your\s*email|personal\s*email|primary\s*email|email\s*id)\b/i.test(
      normalizedText
    );

  if (isEmail) {
    if (checkAmbiguity(normalizedText, 'email')) {
      return {
        isAmbiguous: true,
        ambiguousReason: `Ambiguous email field (contains modifier: "${normalizedText}")`
      };
    }
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'email',
        profile.email,
        profile.email ? conf : 'none',
        `Matched email field from priority level ${priorityLevel}`
      )
    };
  }

  // 2. Phone Number
  // Matches: Phone, Mobile Number, Contact Number, Telephone, etc.
  const isPhone =
    fieldType === 'tel' ||
    /\b(phone|phone\s*number|telephone|telephone\s*number|mobile|mobile\s*number|cell|cell\s*phone|contact\s*number|mobile\s*no|phone\s*no|contact\s*no|tel|primary\s*phone|primary\s*mobile|personal\s*phone|personal\s*mobile|whatsapp)\b/i.test(
      normalizedText
    );

  if (isPhone) {
    if (checkAmbiguity(normalizedText, 'phone')) {
      return {
        isAmbiguous: true,
        ambiguousReason: `Ambiguous phone field (contains modifier: "${normalizedText}")`
      };
    }
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'phone',
        profile.phone,
        profile.phone ? conf : 'none',
        `Matched phone field from priority level ${priorityLevel}`
      )
    };
  }

  // 3. College or Organization
  // Matches: College Name, University, Institution, Organization, School, etc.
  // Evaluate before Full Name so "College Name" or "University Name" does not match Full Name
  const isCollegeOrOrg =
    /\b(college|college\s*name|university|university\s*name|institution|institution\s*name|organization|organisation|organization\s*name|organisation\s*name|school|school\s*name|campus|campus\s*name|institute|institute\s*name|company|company\s*name|employer|employer\s*name|workplace|affiliated\s*college|name\s*of\s*college|name\s*of\s*university|name\s*of\s*institution)\b/i.test(
      normalizedText
    );

  if (isCollegeOrOrg) {
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'organization',
        profile.organization,
        profile.organization ? conf : 'none',
        `Matched college or organization field from priority level ${priorityLevel}`
      )
    };
  }

  // 4. Course or Job Title
  // Matches: Degree, Qualification, Course Name, Program, Job Title, etc.
  // Evaluate before Full Name so "Course Name" or "Program Name" does not match Full Name
  const isCourseOrJob =
    /\b(degree|degree\s*name|qualification|qualifications|highest\s*qualification|course|course\s*name|program|program\s*name|course\s*interested\s*in|interested\s*course|program\s*interested\s*in|major|field\s*of\s*study|specialization|branch|discipline|curriculum|job\s*title|position|role|designation|occupation|profession)\b/i.test(
      normalizedText
    ) ||
    normalizedText === 'degree' ||
    normalizedText === 'qualification';

  if (isCourseOrJob) {
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'jobTitle',
        profile.jobTitle,
        profile.jobTitle ? conf : 'none',
        `Matched course or job title field from priority level ${priorityLevel}`
      )
    };
  }

  // 5a. First Name (tested before Full Name)
  const isFirstName =
    /\b(first\s*name|given\s*name|forename|firstname|fname|first\s*names?)\b/i.test(normalizedText) ||
    normalizedText === 'first';

  if (isFirstName) {
    if (checkAmbiguity(normalizedText, 'firstName')) {
      return {
        isAmbiguous: true,
        ambiguousReason: `Ambiguous first name field (contains modifier: "${normalizedText}")`
      };
    }
    const val =
      profile.firstName ||
      (profile.fullName ? profile.fullName.trim().split(/\s+/)[0] : '');
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'firstName',
        val,
        val ? conf : 'none',
        `Matched first name field from priority level ${priorityLevel}`
      )
    };
  }

  // 5b. Last Name (tested before Full Name)
  const isLastName =
    /\b(last\s*name|family\s*name|surname|lastname|lname|last\s*names?)\b/i.test(normalizedText) ||
    normalizedText === 'last';

  if (isLastName) {
    if (checkAmbiguity(normalizedText, 'lastName')) {
      return {
        isAmbiguous: true,
        ambiguousReason: `Ambiguous last name field (contains modifier: "${normalizedText}")`
      };
    }
    const nameParts = profile.fullName ? profile.fullName.trim().split(/\s+/) : [];
    const val =
      profile.lastName ||
      (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '');
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'lastName',
        val,
        val ? conf : 'none',
        `Matched last name field from priority level ${priorityLevel}`
      )
    };
  }

  // 5c. Full Name
  // Matches: Your Full Name, Applicant Name, Student Name, Name, Complete Name, etc.
  const isFullNameExplicit =
    /\b(full\s*name|fullname|complete\s*name|completename|your\s*full\s*name|applicant\s*name|student\s*name|candidate\s*name|contact\s*name|legal\s*name|your\s*name|first\s*and\s*last\s*name|name\s*of\s*applicant|name\s*of\s*student|full\s*name\s*of\s*applicant|applicants\s*name|students\s*name)\b/i.test(
      normalizedText
    );

  const isNameStandalone =
    normalizedText === 'name' ||
    normalizedText === 'full name' ||
    normalizedText === 'your name' ||
    normalizedText === 'complete name';

  if (isFullNameExplicit || isNameStandalone) {
    if (checkAmbiguity(normalizedText, 'fullName')) {
      return {
        isAmbiguous: true,
        ambiguousReason: `Ambiguous name field (contains modifier: "${normalizedText}")`
      };
    }
    const val =
      profile.fullName ||
      [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'fullName',
        val,
        val ? conf : 'none',
        `Matched full name field from priority level ${priorityLevel}`
      )
    };
  }

  // 6. Country
  const isCountry =
    /\b(country|country\s*region|country\s*territory|nation|country\s*of\s*residence|nationality|country\s*name)\b/i.test(
      normalizedText
    ) || normalizedText === 'country';

  if (isCountry) {
    const val = profile.country || '';
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'country',
        val,
        val ? conf : 'none',
        `Matched country field from priority level ${priorityLevel}`
      )
    };
  }

  // 7. Postal Code / ZIP / PIN Code
  // Matches: ZIP Code, PIN Code, Postcode, Postal Code, Area PIN Code, etc.
  const isPostalCode =
    /\b(postal\s*code|zip\s*code|zip|pin\s*code|pincode|postcode|post\s*code|area\s*pin\s*code|postal\s*pin|zip\s*pincode)\b/i.test(
      normalizedText
    ) ||
    normalizedText === 'pin' ||
    normalizedText === 'zip' ||
    normalizedText === 'pincode';

  if (isPostalCode) {
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'postalCode',
        profile.postalCode,
        profile.postalCode ? conf : 'none',
        `Matched postal code field from priority level ${priorityLevel}`
      )
    };
  }

  // 8. City
  // Matches: City, Locality, Town, Current City, etc.
  const isCity =
    /\b(city|locality|town|current\s*city|city\s*town|city\s*name|municipality|suburb)\b/i.test(
      normalizedText
    ) ||
    normalizedText === 'city' ||
    normalizedText === 'locality';

  if (isCity) {
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'city',
        profile.city,
        profile.city ? conf : 'none',
        `Matched city field from priority level ${priorityLevel}`
      )
    };
  }

  // 9. State / Province
  // Matches: State, Province, Region, State / Province, etc.
  const isState =
    /\b(state|province|region|state\s*province|state\s*region)\b/i.test(
      normalizedText
    ) || normalizedText === 'state';

  if (isState) {
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'state',
        profile.state,
        profile.state ? conf : 'none',
        `Matched state field from priority level ${priorityLevel}`
      )
    };
  }

  // 10. Street Address
  // Matches: Street Address, Address, Residential Address, Mailing Address, etc.
  // Guard against email addresses or web addresses, and address line 2 / apt
  const isAddressLine2 = /\b(address\s*(line\s*)?2|apt|suite|unit|building|floor)\b/i.test(
    normalizedText
  );
  const isAddress =
    !isAddressLine2 &&
    !/\b(email|e\s*mail|ip|mac|web|url)\b/i.test(normalizedText) &&
    (/\b(street\s*address|residential\s*address|home\s*address|address\s*line\s*1|address\s*1|mailing\s*address|current\s*address|permanent\s*address)\b/i.test(
      normalizedText
    ) ||
      normalizedText === 'address');

  if (isAddress) {
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'address',
        profile.address,
        profile.address ? conf : 'none',
        `Matched street address field from priority level ${priorityLevel}`
      )
    };
  }

  // 10. Message / Notes
  // Matches: Message, Additional Notes / Message, Notes, Comments, Inquiries, Bio, etc.
  const isMessageOrNotes =
    /\b(message|notes|additional\s*notes|additional\s*message|comments|inquiry|cover\s*letter|about|bio)\b/i.test(
      normalizedText
    ) ||
    normalizedText === 'message' ||
    normalizedText === 'notes';

  if (isMessageOrNotes) {
    const conf: MatchConfidence = priorityLevel <= 2 ? 'high' : 'medium';
    return {
      match: candidate(
        'notes',
        profile.notes || '',
        profile.notes ? conf : 'none',
        `Matched message or notes field from priority level ${priorityLevel}`
      )
    };
  }

  // 11. Custom Profile Fields
  if (profile.customFields && profile.customFields.length > 0) {
    for (const cf of profile.customFields) {
      if (!cf.label || !cf.value) continue;
      if (SENSITIVE_PATTERNS.some((p) => p.test(cf.label))) {
        continue;
      }

      const cfNorm = normalizeForMatching(cf.label);
      if (!cfNorm) continue;

      const isExactMatch = cfNorm === normalizedText;
      const isWordMatch =
        cfNorm.length >= 3 &&
        new RegExp(`\\b${escapeRegex(cfNorm)}\\b`, 'i').test(normalizedText);

      if (isExactMatch || isWordMatch) {
        const conf: MatchConfidence = isExactMatch && priorityLevel <= 2 ? 'high' : 'medium';
        return {
          match: {
            key: `custom-${cf.id}`,
            value: cf.value.trim(),
            priorityLevel,
            confidence: cf.value ? conf : 'none',
            reason: `Matched custom profile field "${cf.label}" from priority level ${priorityLevel}`,
            sourceText: normalizedText
          }
        };
      }
    }
  }

  return {};
}

function resolveSelectOptionValue(
  proposedValue: string,
  options?: Array<{ value: string; text: string }>
): string {
  if (!proposedValue || !options || options.length === 0) return proposedValue;
  const target = proposedValue.trim().toLowerCase();
  // 1. Exact value match
  const byVal = options.find((o) => o.value.trim().toLowerCase() === target);
  if (byVal) return byVal.value;
  // 2. Exact text match
  const byText = options.find((o) => o.text.trim().toLowerCase() === target);
  if (byText) return byText.value;
  // 3. Substring match
  const bySub = options.find(
    (o) =>
      (o.text.length >= 3 && target.includes(o.text.trim().toLowerCase())) ||
      (target.length >= 3 && o.text.trim().toLowerCase().includes(target))
  );
  if (bySub) return bySub.value;
  return proposedValue;
}

/**
 * Tests HTML standard autocomplete attribute tokens against profile fields.
 * Priority Level 4.
 */
function matchAutocompleteToProfile(
  autocomplete: string,
  profile: UserProfile
): MatchedCandidate | null {
  const norm = (autocomplete || '').toLowerCase().trim();
  if (!norm) return null;

  const candidate = (
    key: StandardProfileKey,
    val: string,
    reason: string
  ): MatchedCandidate => ({
    key,
    value: (val || '').trim(),
    priorityLevel: 4,
    confidence: val ? 'high' : 'none',
    reason,
    sourceText: norm
  });

  if (norm === 'name') {
    const val = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
    return candidate('fullName', val, 'Matched from autocomplete="name"');
  }
  if (['given-name', 'fname'].includes(norm)) {
    const val = profile.firstName || (profile.fullName ? profile.fullName.trim().split(/\s+/)[0] : '');
    return candidate('firstName', val, `Matched from autocomplete="${norm}"`);
  }
  if (['family-name', 'surname', 'lname'].includes(norm)) {
    const nameParts = profile.fullName ? profile.fullName.trim().split(/\s+/) : [];
    const val = profile.lastName || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '');
    return candidate('lastName', val, `Matched from autocomplete="${norm}"`);
  }
  if (norm === 'email') {
    return candidate('email', profile.email, 'Matched from autocomplete="email"');
  }
  if (['tel', 'tel-national', 'tel-local', 'mobile'].includes(norm)) {
    return candidate('phone', profile.phone, `Matched from autocomplete="${norm}"`);
  }
  if (norm === 'organization') {
    return candidate('organization', profile.organization, 'Matched from autocomplete="organization"');
  }
  if (norm === 'organization-title') {
    return candidate('jobTitle', profile.jobTitle, 'Matched from autocomplete="organization-title"');
  }
  if (['street-address', 'address-line1'].includes(norm)) {
    return candidate('address', profile.address, `Matched from autocomplete="${norm}"`);
  }
  if (norm === 'address-level2') {
    return candidate('city', profile.city, 'Matched from autocomplete="address-level2" (city)');
  }
  if (norm === 'address-level1') {
    return candidate('state', profile.state, 'Matched from autocomplete="address-level1" (state)');
  }
  if (norm === 'postal-code') {
    return candidate('postalCode', profile.postalCode, 'Matched from autocomplete="postal-code"');
  }
  if (['country', 'country-name'].includes(norm)) {
    return candidate('country', profile.country || '', `Matched from autocomplete="${norm}"`);
  }

  return null;
}

/**
 * Matches a detected form field against a user profile using deterministic rules.
 * Strictly adheres to the priority levels:
 * 1. Explicitly associated visible label
 * 2. Accessible name or aria-label
 * 3. Placeholder
 * 4. Appropriate autocomplete attribute
 * 5. Input name or ID as a lower-confidence fallback
 * 6. Nearby accessible text
 */
export function matchSingleField(
  field: DetectedFormField,
  profile: UserProfile
): FieldMatchOutcome {
  // 1. Sensitive field guard: Never fill sensitive fields under any circumstances
  if (isFieldSensitive(field)) {
    return {
      fieldId: field.id,
      label: field.label,
      proposedValue: '',
      confidence: 'none',
      matchStatus: 'unmatched',
      isSensitive: true,
      reason: 'Field flagged as sensitive and safely excluded'
    };
  }

  const fieldType = (field.type || '').toLowerCase();

  const wrapOutcome = (outcome: FieldMatchOutcome): FieldMatchOutcome => {
    if (field.type === 'select' && outcome.proposedValue && field.options) {
      outcome.proposedValue = resolveSelectOptionValue(outcome.proposedValue, field.options);
    }
    return outcome;
  };

  // Priority 1: Explicitly associated visible label
  // Uses field.explicitLabel if available, or field.label if not generic or synthetic
  const isGeneric = isGenericFieldLabel(field.label || '');
  const explicitText = field.explicitLabel || (!isGeneric ? field.label : '');
  const explicitNorm = normalizeForMatching(explicitText);

  if (explicitNorm && !isGenericFieldLabel(explicitNorm)) {
    const res = matchTextToProfileCategory(explicitNorm, fieldType, 1, profile);
    if (res.isAmbiguous) {
      return {
        fieldId: field.id,
        label: field.label,
        proposedValue: '',
        confidence: 'ambiguous',
        matchStatus: 'ambiguous',
        isSensitive: false,
        reason: res.ambiguousReason || 'Ambiguous label detected'
      };
    }
    if (res.match) {
      return wrapOutcome({
        fieldId: field.id,
        label: field.label,
        proposedValue: res.match.value,
        matchedProfileKey: res.match.key,
        confidence: res.match.confidence,
        matchStatus: res.match.confidence === 'high' ? 'exact' : res.match.confidence === 'none' ? 'unmatched' : 'inferred',
        isSensitive: false,
        reason: res.match.reason,
        priorityLevel: 1
      });
    }
  }

  // Priority 2: Accessible name or aria-label
  const ariaNorm = normalizeForMatching(field.ariaLabel || '');
  if (ariaNorm) {
    const res = matchTextToProfileCategory(ariaNorm, fieldType, 2, profile);
    if (res.isAmbiguous) {
      return {
        fieldId: field.id,
        label: field.label,
        proposedValue: '',
        confidence: 'ambiguous',
        matchStatus: 'ambiguous',
        isSensitive: false,
        reason: res.ambiguousReason || 'Ambiguous aria-label detected'
      };
    }
    if (res.match) {
      return wrapOutcome({
        fieldId: field.id,
        label: field.label,
        proposedValue: res.match.value,
        matchedProfileKey: res.match.key,
        confidence: res.match.confidence,
        matchStatus: res.match.confidence === 'high' ? 'exact' : res.match.confidence === 'none' ? 'unmatched' : 'inferred',
        isSensitive: false,
        reason: res.match.reason,
        priorityLevel: 2
      });
    }
  }

  // Priority 3: Placeholder
  const placeholderNorm = normalizeForMatching(field.placeholder || '');
  if (placeholderNorm) {
    const res = matchTextToProfileCategory(placeholderNorm, fieldType, 3, profile);
    if (res.isAmbiguous) {
      return {
        fieldId: field.id,
        label: field.label,
        proposedValue: '',
        confidence: 'ambiguous',
        matchStatus: 'ambiguous',
        isSensitive: false,
        reason: res.ambiguousReason || 'Ambiguous placeholder detected'
      };
    }
    if (res.match) {
      return wrapOutcome({
        fieldId: field.id,
        label: field.label,
        proposedValue: res.match.value,
        matchedProfileKey: res.match.key,
        confidence: res.match.confidence,
        matchStatus: res.match.confidence === 'none' ? 'unmatched' : 'inferred',
        isSensitive: false,
        reason: res.match.reason,
        priorityLevel: 3
      });
    }
  }

  // Priority 4: Appropriate autocomplete attribute
  if (field.autocomplete) {
    const autoMatch = matchAutocompleteToProfile(field.autocomplete, profile);
    if (autoMatch) {
      return wrapOutcome({
        fieldId: field.id,
        label: field.label,
        proposedValue: autoMatch.value,
        matchedProfileKey: autoMatch.key,
        confidence: autoMatch.confidence,
        matchStatus: autoMatch.confidence === 'none' ? 'unmatched' : 'inferred',
        isSensitive: false,
        reason: autoMatch.reason,
        priorityLevel: 4
      });
    }
  }

  // Priority 5: Input name or ID as lower-confidence fallback
  const nameNorm = normalizeForMatching(field.name || '');
  const idNorm = normalizeForMatching(field.elementId || '');
  const fallbackText = `${nameNorm} ${idNorm}`.trim();

  if (fallbackText) {
    const res = matchTextToProfileCategory(fallbackText, fieldType, 5, profile);
    if (res.isAmbiguous) {
      return {
        fieldId: field.id,
        label: field.label,
        proposedValue: '',
        confidence: 'ambiguous',
        matchStatus: 'ambiguous',
        isSensitive: false,
        reason: res.ambiguousReason || 'Ambiguous input name/ID detected'
      };
    }
    if (res.match) {
      return wrapOutcome({
        fieldId: field.id,
        label: field.label,
        proposedValue: res.match.value,
        matchedProfileKey: res.match.key,
        confidence: res.match.confidence === 'none' ? 'none' : 'medium',
        matchStatus: res.match.confidence === 'none' ? 'unmatched' : 'inferred',
        isSensitive: false,
        reason: `${res.match.reason} (fallback name/id match)`,
        priorityLevel: 5
      });
    }
  }

  // Priority 6: Nearby accessible text fallback
  const nearbyNorm = normalizeForMatching(field.nearbyText || '');
  if (nearbyNorm) {
    const res = matchTextToProfileCategory(nearbyNorm, fieldType, 5, profile);
    if (res.isAmbiguous) {
      return {
        fieldId: field.id,
        label: field.label,
        proposedValue: '',
        confidence: 'ambiguous',
        matchStatus: 'ambiguous',
        isSensitive: false,
        reason: res.ambiguousReason || 'Ambiguous nearby text detected'
      };
    }
    if (res.match) {
      return wrapOutcome({
        fieldId: field.id,
        label: field.label,
        proposedValue: res.match.value,
        matchedProfileKey: res.match.key,
        confidence: res.match.confidence === 'none' ? 'none' : 'medium',
        matchStatus: res.match.confidence === 'none' ? 'unmatched' : 'inferred',
        isSensitive: false,
        reason: `${res.match.reason} (nearby accessible text)`,
        priorityLevel: 5
      });
    }
  }

  // No reliable match found: leave blank, do not invent values
  return {
    fieldId: field.id,
    label: field.label,
    proposedValue: '',
    confidence: 'none',
    matchStatus: 'unmatched',
    isSensitive: false,
    reason: 'No matching profile field found'
  };
}

/**
 * Matches an entire set of detected webpage form fields against the saved user profile.
 * Applies multi-field conflict resolution so two unrelated form fields never receive
 * the same profile value by accidental matching.
 */
export function matchProfileToFormFields(
  fields: DetectedFormField[],
  profile: UserProfile
): AutofillMatchSummary {
  // Pass 1: Run prioritized matching on each field
  const initialMatches: FieldMatchOutcome[] = fields.map((f) => matchSingleField(f, profile));

  // Pass 2: Deduplication and conflict resolution across fields
  // Group fields proposing the same non-empty profile key
  const keyToOutcomes: Record<string, number[]> = {};

  initialMatches.forEach((outcome, idx) => {
    if (outcome.matchedProfileKey && outcome.proposedValue && outcome.proposedValue.trim()) {
      const key = outcome.matchedProfileKey;
      if (!keyToOutcomes[key]) {
        keyToOutcomes[key] = [];
      }
      keyToOutcomes[key].push(idx);
    }
  });

  // Resolve conflicts: if multiple fields matched the same profile key
  for (const [key, indices] of Object.entries(keyToOutcomes)) {
    if (indices.length <= 1) continue;

    // Find the minimum priorityLevel (1 is highest priority, 5 is lowest)
    let bestLevel = 999;
    indices.forEach((idx) => {
      const level = initialMatches[idx].priorityLevel || 5;
      if (level < bestLevel) {
        bestLevel = level;
      }
    });

    const bestIndices = indices.filter(
      (idx) => (initialMatches[idx].priorityLevel || 5) === bestLevel
    );

    if (bestIndices.length === 1) {
      // Exactly one field had the highest priority; it wins the match.
      const winnerIdx = bestIndices[0];
      indices.forEach((idx) => {
        if (idx !== winnerIdx) {
          initialMatches[idx] = {
            ...initialMatches[idx],
            proposedValue: '',
            confidence: 'none',
            matchStatus: 'unmatched',
            reason: `Profile field "${key}" already matched to higher-priority field "${initialMatches[winnerIdx].label}"`
          };
        }
      });
    } else {
      // Multiple fields share the same priority for the same key.
      // To strictly avoid accidental duplicate filling into unrelated form fields,
      // mark them as ambiguous and leave them blank for manual user selection.
      indices.forEach((idx) => {
        initialMatches[idx] = {
          ...initialMatches[idx],
          proposedValue: '',
          confidence: 'ambiguous',
          matchStatus: 'ambiguous',
          reason: `Multiple fields matched the same profile key ("${key}"); left blank to prevent accidental duplicate filling`
        };
      });
    }
  }

  // Pass 3: Tally counts
  let matchedCount = 0;
  let skippedCount = 0;
  let sensitiveCount = 0;
  let ambiguousCount = 0;

  for (const outcome of initialMatches) {
    if (outcome.isSensitive) {
      sensitiveCount++;
      skippedCount++;
    } else if (outcome.proposedValue && outcome.proposedValue.trim()) {
      matchedCount++;
    } else if (outcome.confidence === 'ambiguous') {
      ambiguousCount++;
      skippedCount++;
    } else {
      skippedCount++;
    }
  }

  return {
    matches: initialMatches,
    matchedCount,
    skippedCount,
    sensitiveCount,
    ambiguousCount
  };
}

/**
 * Builds a prompt for local Gemma 4 to resolve ambiguous field meanings without
 * sending any personal data. Only field labels and generic category names are included.
 */
export function buildAmbiguousResolverPrompt(
  ambiguousFields: DetectedFormField[],
  availableCategories: string[]
): string {
  const fieldList = ambiguousFields
    .map(
      (f, i) =>
        `${i + 1}. ID: ${f.id} | Label: "${f.label}" | Placeholder: "${f.placeholder || ''}"`
    )
    .join('\n');

  const categories = availableCategories.join(', ');

  return `You are a precise form field classifier. Classify each ambiguous form field into one of the following available categories:
[${categories}, None]

Form Fields to classify:
${fieldList}

Instructions:
1. Select the single best category for each field from the available list.
2. If none clearly match or you are uncertain, choose "None".
3. Do not invent categories or personal data.
4. Output format:
FIELD: <ID>
CATEGORY: <Category or None>`;
}
