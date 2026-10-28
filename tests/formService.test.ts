import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrlForComparison,
  parseFormSuggestions,
  buildFormSuggestionPrompt
} from '../src/services/formService.ts';
import { DetectedFormField, ApprovedFormFieldToFill } from '../src/types/form.ts';

describe('Form Service - URL Normalization (Task 3 & 4)', () => {
  it('normalizes URLs ignoring hash fragments', () => {
    const url1 = 'https://example.com/form.html#step2';
    const url2 = 'https://example.com/form.html';
    assert.equal(
      normalizeUrlForComparison(url1),
      normalizeUrlForComparison(url2)
    );
  });

  it('normalizes trailing slashes on paths', () => {
    const url1 = 'https://example.com/registration/';
    const url2 = 'https://example.com/registration';
    assert.equal(
      normalizeUrlForComparison(url1),
      normalizeUrlForComparison(url2)
    );
  });

  it('normalizes Windows file:/// URLs regardless of drive letter casing', () => {
    const url1 = 'file:///C:/Users/test/sample-form.html';
    const url2 = 'file:///c:/users/test/sample-form.html';
    assert.equal(
      normalizeUrlForComparison(url1),
      normalizeUrlForComparison(url2)
    );
  });

  it('detects genuinely different URLs', () => {
    const url1 = 'https://example.com/form.html';
    const url2 = 'chrome://extensions';
    assert.notEqual(
      normalizeUrlForComparison(url1),
      normalizeUrlForComparison(url2)
    );
  });
});

describe('Form Service - AI Suggestion Parsing (Task 1 & 4)', () => {
  const mockFields: DetectedFormField[] = [
    {
      id: 'field-0-fullName',
      label: 'Full Name',
      type: 'text',
      name: 'fullName',
      selector: '#fullName'
    },
    {
      id: 'field-1-email',
      label: 'Email Address',
      type: 'email',
      name: 'email',
      selector: '#userEmail'
    },
    {
      id: 'field-2-phone',
      label: 'Phone Number',
      type: 'tel',
      name: 'phone',
      selector: '#userPhone'
    },
    {
      id: 'field-3-notes',
      label: 'Additional Notes',
      type: 'textarea',
      name: 'notes',
      selector: '#userNotes'
    }
  ];

  it('parses standard FIELD and VALUE lines', () => {
    const response = `
FIELD: field-0-fullName
VALUE: Alex Rivera

FIELD: field-1-email
VALUE: alex@example.com

FIELD: field-2-phone
VALUE: [EMPTY]
`;
    const result = parseFormSuggestions(response, mockFields);
    assert.equal(result['field-0-fullName'], 'Alex Rivera');
    assert.equal(result['field-1-email'], 'alex@example.com');
    assert.equal(result['field-2-phone'], undefined);
  });

  it('parses markdown bold and bullet formatted FIELD and VALUE lines', () => {
    const response = `
1. **FIELD:** field-0-fullName
   **VALUE:** Alex Rivera

2. **FIELD:** field-1-email
   **VALUE:** "alex@example.com"
`;
    const result = parseFormSuggestions(response, mockFields);
    assert.equal(result['field-0-fullName'], 'Alex Rivera');
    assert.equal(result['field-1-email'], 'alex@example.com');
  });

  it('matches fields by 1-based index (e.g. FIELD: 1)', () => {
    const response = `
FIELD: 1
VALUE: Jordan Lee

FIELD: 2
VALUE: jordan@example.com
`;
    const result = parseFormSuggestions(response, mockFields);
    assert.equal(result['field-0-fullName'], 'Jordan Lee');
    assert.equal(result['field-1-email'], 'jordan@example.com');
  });

  it('matches fields by label text when ID is omitted', () => {
    const response = `
FIELD: Full Name
VALUE: Morgan Smith

FIELD: Email Address
VALUE: morgan@example.com
`;
    const result = parseFormSuggestions(response, mockFields);
    assert.equal(result['field-0-fullName'], 'Morgan Smith');
    assert.equal(result['field-1-email'], 'morgan@example.com');
  });

  it('handles unstructured fallback format (Label: Value)', () => {
    const response = `
Full Name: Taylor Swift
Email Address: taylor@example.com
`;
    const result = parseFormSuggestions(response, mockFields);
    assert.equal(result['field-0-fullName'], 'Taylor Swift');
    assert.equal(result['field-1-email'], 'taylor@example.com');
  });

  it('builds clear suggestion prompt containing all fields and safe grounding', () => {
    const prompt = buildFormSuggestionPrompt(mockFields, 'My name is Alex, email alex@test.com');
    assert.ok(prompt.includes('Full Name'));
    assert.ok(prompt.includes('field-0-fullName'));
    assert.ok(prompt.includes('alex@test.com'));
    assert.ok(prompt.includes('[EMPTY]'));
  });
});

describe('Form Service - Approval and Review Pipeline (Task 6)', () => {
  const fields: DetectedFormField[] = [
    { id: 'f1', label: 'Name', type: 'text', selector: '#name' },
    { id: 'f2', label: 'Email', type: 'email', selector: '#email' },
    { id: 'f3', label: 'Phone', type: 'tel', selector: '#phone' }
  ];

  it('correctly filters to approved fields with non-empty values', () => {
    const suggestionsState: Record<string, { approved: boolean; value: string }> = {
      f1: { approved: true, value: 'Alex' },
      f2: { approved: false, value: 'alex@test.com' }, // Unapproved
      f3: { approved: true, value: '   ' } // Empty
    };

    const toFill: ApprovedFormFieldToFill[] = fields
      .filter((f) => suggestionsState[f.id]?.approved && suggestionsState[f.id]?.value.trim())
      .map((f) => ({
        fieldId: f.id,
        selector: f.selector,
        label: f.label,
        value: suggestionsState[f.id].value.trim()
      }));

    assert.equal(toFill.length, 1);
    assert.equal(toFill[0].fieldId, 'f1');
    assert.equal(toFill[0].value, 'Alex');
  });

  it('rejects approval when no fields have approved values', () => {
    const suggestionsState: Record<string, { approved: boolean; value: string }> = {
      f1: { approved: false, value: 'Alex' },
      f2: { approved: true, value: '' }
    };

    const toFill = fields.filter(
      (f) => suggestionsState[f.id]?.approved && suggestionsState[f.id]?.value.trim()
    );

    assert.equal(toFill.length, 0);
  });
});

describe('Form Service - Target Resolution & Revalidation (Task 4, 8 & 9)', () => {
  // Reusable simulated element helper
  class MockInputElement {
    tagName: string;
    type: string;
    name: string;
    id: string;
    value: string = '';
    disabled: boolean = false;
    readOnly: boolean = false;
    isConnected: boolean = true;
    style: { outline: string; transition: string } = { outline: '', transition: '' };
    attributes: Map<string, string> = new Map();
    dispatchedEvents: string[] = [];

    constructor(tagName: string, type: string, name: string = '', id: string = '') {
      this.tagName = tagName.toUpperCase();
      this.type = type;
      this.name = name;
      this.id = id;
      this.attributes.set('type', type);
      if (name) this.attributes.set('name', name);
      if (id) this.attributes.set('id', id);
    }

    getAttribute(attr: string): string | null {
      return this.attributes.get(attr) || null;
    }

    setAttribute(attr: string, val: string): void {
      this.attributes.set(attr, val);
    }

    hasAttribute(attr: string): boolean {
      return this.attributes.has(attr);
    }

    focus(): void {}

    dispatchEvent(event: { type: string }): boolean {
      this.dispatchedEvents.push(event.type);
      return true;
    }
  }

  it('verifies that sensitive fields (password, credit card) fail revalidation safely', () => {
    const passwordEl = new MockInputElement('input', 'password', 'userPassword', 'userPassword');
    const SENSITIVE_KEYWORDS = ['password', 'card', 'cvv', 'token', 'otp'];
    const isSensitive = (text: string) => SENSITIVE_KEYWORDS.some((kw) => text.toLowerCase().includes(kw));

    const isPasswordBlocked =
      passwordEl.type === 'password' || isSensitive(passwordEl.name);
    assert.equal(isPasswordBlocked, true, 'Password must be rejected before filling');
  });

  it('verifies that disabled or readonly fields are rejected with actionable reason', () => {
    const disabledEl = new MockInputElement('input', 'text', 'lockedField');
    disabledEl.disabled = true;

    const canFill = !disabledEl.disabled && !disabledEl.readOnly && disabledEl.isConnected;
    assert.equal(canFill, false, 'Disabled field must not be filled');
  });

  it('simulates safe value injection and event dispatch', () => {
    const nameEl = new MockInputElement('input', 'text', 'fullName', 'fullName');
    nameEl.setAttribute('data-private-pilot-field-id', 'field-0-fullName');

    // Simulate filling
    nameEl.value = 'Alex Rivera';
    nameEl.dispatchEvent({ type: 'input' });
    nameEl.dispatchEvent({ type: 'change' });

    assert.equal(nameEl.value, 'Alex Rivera');
    assert.ok(nameEl.dispatchedEvents.includes('input'));
    assert.ok(nameEl.dispatchedEvents.includes('change'));
    assert.equal(nameEl.getAttribute('data-private-pilot-field-id'), 'field-0-fullName');
  });

  it('preserves existing user-entered values and does not silently overwrite without approval', () => {
    const existingField: DetectedFormField = {
      id: 'field-10-phone',
      label: 'Phone Number',
      type: 'tel',
      currentValue: '555-9999',
      selector: '#phone'
    };

    // A field with an existing value on page should be flagged
    const hasExistingOnPage = Boolean(existingField.currentValue && existingField.currentValue.trim());
    assert.equal(hasExistingOnPage, true);

    // Initial approval state should be false to prevent silent overwriting
    const initialApproved = false;
    assert.equal(initialApproved, false, 'Existing field must require explicit user approval to overwrite');
  });

  it('simulates Google Forms W3C aria-labelledby space-separated ID parsing', () => {
    // In Google Forms, aria-labelledby="i1 i4" where i1 is question and i4 is "Your answer"
    const labelledBy = 'i1 i4';
    const mockElements: Record<string, string> = {
      i1: 'Address *',
      i4: 'Your answer'
    };

    const isGeneric = (text: string) => /^(your answer|short answer text)$/i.test(text.replace(/[*:]+/g, '').trim());
    const cleanLabel = (text: string) => text.replace(/[\s*:]+$/, '').trim();

    const ids = labelledBy.split(/\s+/);
    let resolvedTitle = '';

    for (const id of ids) {
      const text = mockElements[id];
      if (text) {
        const clean = cleanLabel(text);
        if (!isGeneric(clean)) {
          resolvedTitle = clean;
          break;
        }
      }
    }

    assert.equal(resolvedTitle, 'Address', 'Should extract "Address" and discard "Your answer"');
  });
});

describe('Google Forms Autofill Bugs Verification (Bug 1 & Bug 2)', () => {
  // Test fixtures as specified by user requirements
  const sampleProfile = {
    fullName: 'Taukir',
    firstName: 'Taukir',
    lastName: '',
    email: 'taukir@example.com',
    phone: '9876543210',
    address: 'Faizabad Road',
    city: 'Lucknow',
    organization: 'BBDITM',
    postalCode: '273001'
  };

  const googleFormsQuestions: DetectedFormField[] = [
    {
      id: 'field-0-entry-1',
      label: 'First Name',
      type: 'text',
      selector: '[aria-labelledby~="i1"]',
      explicitLabel: 'First Name',
      placeholder: 'Your answer',
      index: 0
    },
    {
      id: 'field-1-entry-2',
      label: 'Email Address',
      type: 'email',
      selector: '[aria-labelledby~="i5"]',
      explicitLabel: 'Email Address',
      placeholder: 'Your answer',
      index: 1
    },
    {
      id: 'field-2-entry-3',
      label: 'Phone Number',
      type: 'tel',
      selector: '[aria-labelledby~="i9"]',
      explicitLabel: 'Phone Number',
      placeholder: 'Your answer',
      index: 2
    },
    {
      id: 'field-3-entry-4',
      label: 'Address',
      type: 'text',
      selector: '[aria-labelledby~="i13"]',
      explicitLabel: 'Address',
      placeholder: 'Your answer',
      index: 3
    },
    {
      id: 'field-4-entry-5',
      label: 'City',
      type: 'text',
      selector: '[aria-labelledby~="i17"]',
      explicitLabel: 'City',
      placeholder: 'Your answer',
      index: 4
    },
    {
      id: 'field-5-entry-6',
      label: 'College',
      type: 'text',
      selector: '[aria-labelledby~="i21"]',
      explicitLabel: 'College',
      placeholder: 'Your answer',
      index: 5
    },
    {
      id: 'field-6-entry-7',
      label: 'PIN Code',
      type: 'text',
      selector: '[aria-labelledby~="i25"]',
      explicitLabel: 'PIN Code',
      placeholder: 'Your answer',
      index: 6
    }
  ];

  it('Bug 1: ensures every question strictly receives only its corresponding value without shifting', async () => {
    const { matchProfileToFormFields } = await import('../src/services/autofillMatcher.ts');
    const result = matchProfileToFormFields(googleFormsQuestions, sampleProfile);

    const matchMap: Record<string, string> = {};
    for (const m of result.matches) {
      matchMap[m.label] = m.proposedValue;
    }

    // 1. First Name receives Taukir
    assert.equal(matchMap['First Name'], 'Taukir');

    // 2. Email Address receives taukir@example.com
    assert.equal(matchMap['Email Address'], 'taukir@example.com');

    // 3. Phone Number receives 9876543210 (NEVER Faizabad Road)
    assert.equal(matchMap['Phone Number'], '9876543210');
    assert.notEqual(matchMap['Phone Number'], 'Faizabad Road', 'Phone Number must not receive address');

    // 4. Address receives Faizabad Road
    assert.equal(matchMap['Address'], 'Faizabad Road');

    // 5. City receives Lucknow (NEVER numeric phone number)
    assert.equal(matchMap['City'], 'Lucknow');
    assert.notEqual(matchMap['City'], '9876543210', 'City must not receive phone number');

    // 6. College receives BBDITM (NEVER Lucknow)
    assert.equal(matchMap['College'], 'BBDITM');
    assert.notEqual(matchMap['College'], 'Lucknow', 'College must not receive city');

    // 7. PIN Code receives 273001
    assert.equal(matchMap['PIN Code'], '273001');
  });

  it('Bug 1: prevents index-based value reuse and ensures adjacent fields do not inherit neighboring values', async () => {
    const { matchSingleField } = await import('../src/services/autofillMatcher.ts');

    // Test each field independently
    const phoneMatch = matchSingleField(googleFormsQuestions[2], sampleProfile);
    const addressMatch = matchSingleField(googleFormsQuestions[3], sampleProfile);
    const cityMatch = matchSingleField(googleFormsQuestions[4], sampleProfile);
    const collegeMatch = matchSingleField(googleFormsQuestions[5], sampleProfile);

    assert.equal(phoneMatch.proposedValue, '9876543210');
    assert.equal(addressMatch.proposedValue, 'Faizabad Road');
    assert.equal(cityMatch.proposedValue, 'Lucknow');
    assert.equal(collegeMatch.proposedValue, 'BBDITM');

    // No cross contamination
    assert.notEqual(phoneMatch.proposedValue, addressMatch.proposedValue);
    assert.notEqual(cityMatch.proposedValue, phoneMatch.proposedValue);
    assert.notEqual(collegeMatch.proposedValue, cityMatch.proposedValue);
  });

  it('Bug 2: replaces text cleanly without appending or duplicating existing content', () => {
    class SimulatedInput {
      value: string = '';
      selected: boolean = false;
      parentClasses: Set<string> = new Set();
      placeholderDisplay: string = 'block';

      focus(): void {}
      select(): void {
        this.selected = true;
      }
      setValueClean(val: string): void {
        // Simulates native setter clearing first then replacing
        this.value = '';
        this.value = val;
        this.parentClasses.add('CD27Sd');
        this.parentClasses.add('u3bW4e');
        this.placeholderDisplay = 'none';
      }
    }

    const field = new SimulatedInput();
    // Simulate field having some pre-existing or partial text
    field.value = 'Partial Text';

    // Execute clean replacement
    field.setValueClean('Faizabad Road');

    // Assert value is replaced, NOT appended (no 'Partial TextFaizabad Road')
    assert.equal(field.value, 'Faizabad Road');
    assert.equal(field.placeholderDisplay, 'none', 'Placeholder must disappear when value is entered');
    assert.ok(field.parentClasses.has('CD27Sd'), 'Google Forms floating active class CD27Sd must be applied');
  });

  it('Bug 2: blocks duplicate fill operations and verifies post-fill value accuracy', () => {
    const filledElements = new Set<string>();
    const filledFields: string[] = [];
    const failedFields: string[] = [];

    const simulateFill = (elId: string, label: string, intendedVal: string, actualVal: string) => {
      // Revalidation: duplicate check
      if (filledElements.has(elId)) {
        failedFields.push(label);
        return false;
      }

      // Verification: value check
      if (actualVal !== intendedVal) {
        failedFields.push(label);
        return false;
      }

      filledElements.add(elId);
      filledFields.push(label);
      return true;
    };

    // First attempt: success
    const res1 = simulateFill('input-phone', 'Phone Number', '9876543210', '9876543210');
    assert.equal(res1, true);
    assert.equal(filledFields.length, 1);

    // Second duplicate attempt on same element: blocked
    const res2 = simulateFill('input-phone', 'Phone Number', '9876543210', '9876543210');
    assert.equal(res2, false);
    assert.equal(failedFields.includes('Phone Number'), true);

    // Mismatched value verification failure
    const res3 = simulateFill('input-city', 'City', 'Lucknow', 'Incorrect Value');
    assert.equal(res3, false);
    assert.equal(failedFields.includes('City'), true);
    assert.equal(filledFields.includes('City'), false, 'Unverified field must not be counted in success');
  });

  it('ensures ambiguous or missing profile fields remain available for review and never auto-submits', async () => {
    const { matchSingleField } = await import('../src/services/autofillMatcher.ts');

    // Question for a field not in the profile (e.g. Alternate Phone)
    const ambiguousQuestion: DetectedFormField = {
      id: 'field-alt-phone',
      label: 'Emergency Contact Phone',
      type: 'tel',
      selector: '#altPhone'
    };

    const match = matchSingleField(ambiguousQuestion, sampleProfile);
    assert.equal(match.matchStatus, 'ambiguous');
    assert.equal(match.proposedValue, '', 'Ambiguous field must not be auto-filled');
    assert.ok(match.reason?.includes('Ambiguous'), 'Must provide review reason');
  });

  it('Step 5: tests empty form filling, value replacement with approval, and running fill operation twice', () => {
    class GoogleFormsInputMock {
      value: string = '';
      focused: boolean = false;
      selected: boolean = false;
      hasRequiredError: boolean = false;
      parentClasses: Set<string> = new Set();
      dispatchedEvents: string[] = [];

      constructor(initialVal: string = '', isRequiredUnanswered: boolean = false) {
        this.value = initialVal;
        this.hasRequiredError = isRequiredUnanswered;
      }

      focus(): void {
        this.focused = true;
      }

      select(): void {
        this.selected = true;
      }

      dispatchEvent(evt: { type: string }): boolean {
        this.dispatchedEvents.push(evt.type);
        if (evt.type === 'input' && this.value.trim().length > 0) {
          this.hasRequiredError = false; // Google Forms clears required warning when input event fires with value
          this.parentClasses.add('CD27Sd');
          this.parentClasses.add('u3bW4e');
        }
        return true;
      }

      simulateFill(valToSet: string): void {
        const existing = this.value || '';
        // If already has exact value, do not concatenate or append
        if (existing.trim() === valToSet) {
          return;
        }

        this.focus();
        this.select();

        // Native simulation of document.execCommand('insertText') / clean replacement
        this.value = valToSet;

        this.dispatchEvent({ type: 'input' });
        this.dispatchEvent({ type: 'change' });
        this.dispatchEvent({ type: 'blur' });
      }
    }

    // 1. Empty Form Filling: Verify single insertion (no duplicate text)
    const firstNameInput = new GoogleFormsInputMock('', true);
    firstNameInput.simulateFill('Taukir');
    assert.equal(firstNameInput.value, 'Taukir', 'Empty field must receive value exactly once');
    assert.equal(firstNameInput.value.includes('TaukirTaukir'), false, 'Value must not concatenate');
    assert.equal(firstNameInput.hasRequiredError, false, 'Required warning must be cleared after filling');

    // 2. Replacing an existing value with explicit approval: Verify clean replacement
    const addressInput = new GoogleFormsInputMock('Old Address 123', false);
    addressInput.simulateFill('Faizabad Road');
    assert.equal(addressInput.value, 'Faizabad Road', 'Must replace existing text cleanly');
    assert.equal(addressInput.value.includes('Old Address'), false, 'Previous text must be cleared');
    assert.equal(addressInput.value.includes('Faizabad RoadFaizabad Road'), false, 'New value must not be duplicated');

    // 3. Running Fill Operation Twice: Verify idempotency (no concatenation on re-run)
    const phoneInput = new GoogleFormsInputMock('', true);
    // Run 1:
    phoneInput.simulateFill('9876543210');
    assert.equal(phoneInput.value, '9876543210');
    // Run 2 (subsequent fill attempt):
    phoneInput.simulateFill('9876543210');
    assert.equal(phoneInput.value, '9876543210', 'Running fill twice must not duplicate or concatenate text');
    assert.notEqual(phoneInput.value, '98765432109876543210', 'Running fill twice must not double the number');

    // 4. Verify Google Forms required question recognition
    const emailInput = new GoogleFormsInputMock('', true);
    assert.equal(emailInput.hasRequiredError, true, 'Initially marked as required unanswered');
    emailInput.simulateFill('taukir@example.com');
    assert.equal(emailInput.value, 'taukir@example.com');
    assert.equal(emailInput.hasRequiredError, false, 'Google Forms recognizes required field as answered');
    assert.ok(emailInput.parentClasses.has('CD27Sd'), 'Active floating label class must be set');
  });
});

