import {
  DetectedFormField,
  FormScanResult,
  FormFillResult,
  SupportedFieldType,
  ApprovedFormFieldToFill
} from '../types/form';
import {
  checkUrlSupport,
  getActiveTabInCurrentWindow,
  FILE_ACCESS_BLOCKED_MESSAGE,
  isFileSchemeAccessAllowed
} from './pageReaderService';

/**
 * Safe development diagnostics helper for form operations.
 * CRITICAL: Never logs field values, user descriptions, or sensitive webpage content.
 */
export function logFormDiagnostic(
  stage: string,
  event: string,
  data?: Record<string, unknown>
): void {
  try {
    console.debug(`[Private Pilot Form Diagnostics] [${stage}] ${event}`, data ? JSON.stringify(data) : '');
  } catch {
    // ignore
  }
}

/**
 * Normalizes a URL for comparison between scan time and fill time.
 * Handles trailing slashes, hash anchors, and Windows file:/// drive letter casing.
 */
export function normalizeUrlForComparison(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    let p = u.pathname;
    if (u.protocol === 'file:') {
      p = p.toLowerCase();
    }
    if (p.length > 1 && p.endsWith('/')) {
      p = p.slice(0, -1);
    }
    u.pathname = p;
    return u.href.toLowerCase();
  } catch {
    return rawUrl.split('#')[0].trim().toLowerCase();
  }
}

/**
 * Self-contained detection function executed inside the active tab context.
 * In Chrome MV3, this function must not reference variables outside its own scope.
 */
function detectFormsInTab(): {
  pageUrl: string;
  pageTitle: string;
  fields: DetectedFormField[];
  excludedCount: number;
} {
  const pageUrl = window.location.href || '';
  const pageTitle = (document.title || '').trim() || 'Untitled Page';

  const SENSITIVE_REGEXES = [
    /\b(password|passcode|passwd|secret|pwd)\b/i,
    /\b(otp|2fa|mfa|token|authcode|security[-_ ]?code|verification[-_ ]?code|recovery[-_ ]?code)\b/i,
    /\b(atm[-_ ]?pin|mpin|security[-_ ]?pin|secret[-_ ]?pin|card[-_ ]?pin)\b/i,
    /\b(credit[-_ ]?card|debit[-_ ]?card|card[-_ ]?number|cardnumber|cvv|cvc|cc[-_ ]?num|payment[-_ ]?card|pan)\b/i,
    /\b(ssn|social[-_ ]?security|tax[-_ ]?id|ein|national[-_ ]?id|passport|aadhar|gov[-_ ]?id)\b/i,
    /\b(captcha|recaptcha|hcaptcha|turnstile)\b/i,
    /\b(bank[-_ ]?account|routing[-_ ]?number|iban|swift[-_ ]?code)\b/i
  ];

  function isSensitive(text: string): boolean {
    if (!text) return false;
    const normalized = text.replace(/[_-]+/g, ' ');
    if (
      /\b(postal|zip|zipcode|postcode|address|location|area|pin\s*code|pincode)\b/i.test(normalized) &&
      !/\b(atm|security|secret|auth|card|mpin|bank|login|password)\b/i.test(normalized)
    ) {
      return false;
    }
    if (/\b(pin|pin[-_ ]?code)\b/i.test(normalized) && !/\b(postal|zip|postcode|pin\s*code|pincode)\b/i.test(normalized)) {
      return true;
    }
    return SENSITIVE_REGEXES.some((rx) => rx.test(normalized));
  }

  function isElementVisible(el: HTMLElement): boolean {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    try {
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parseFloat(style.opacity || '1') === 0
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return false;
      }
    } catch {
      // fallback
    }
    return true;
  }

  function cleanLabelText(raw: string): string {
    if (!raw) return '';
    return raw
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[\s*:]+$/, '')
      .replace(/\s*\((required|optional)\)\s*$/i, '')
      .replace(/^\s*(?:q(?:uestion)?\s*\d+[:.-]?|\d+[:.)-])\s*/i, '')
      .trim();
  }

  function isGenericFieldLabel(text: string): boolean {
    if (!text) return true;
    const clean = text
      .toLowerCase()
      .trim()
      .replace(/[*:]+/g, '')
      .trim();
    return (
      clean === '' ||
      /^(your\s*answer|short\s*answer(\s*text)?|long\s*answer(\s*text)?|option\s*\d+|choose|select(\s*an\s*option)?|select\s*\.\.\.|type\s*your\s*answer(\s*here)?|enter\s*(your\s*)?answer|answer|entry\.\d+|text\s*field\s*#?\d*|input\s*field\s*#?\d*|textarea\s*field\s*#?\d*|select\s*field\s*#?\d*)$/i.test(
        clean
      )
    );
  }

  function extractAriaLabelledBy(el: HTMLElement): { label: string; headingId: string } | null {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (!labelledBy) return null;
    const ids = labelledBy.trim().split(/\s+/);
    for (const id of ids) {
      if (!id) continue;
      const targetEl = document.getElementById(id);
      if (targetEl && targetEl.textContent) {
        const clean = cleanLabelText(targetEl.textContent);
        if (clean && clean.length > 0 && clean.length <= 100 && !isGenericFieldLabel(clean)) {
          return { label: clean, headingId: id };
        }
      }
    }
    return null;
  }

  function extractQuestionContainerTitle(
    el: HTMLElement
  ): { label: string; headingId?: string; containerItemId?: string } | null {
    // Priority 1: Google Forms individual question item (.Qr7Oae, .geS5n, [data-item-id], [jsmodel="CP1oW"])
    // Never select multi-question wrappers like [role="list"] or multi-question [role="group"]
    const gFormItem = el.closest<HTMLElement>(
      '.Qr7Oae, .geS5n, [data-item-id], [jsmodel="CP1oW"], [role="listitem"]:not([role="list"])'
    );
    if (gFormItem) {
      const heading = gFormItem.querySelector<HTMLElement>(
        '.M7eMe, [role="heading"], .HoXoMd .M7eMe, .c2ku11, .freebirdFormviewerComponentsQuestionBaseTitle'
      );
      if (heading && heading !== el && !heading.contains(el)) {
        const clean = cleanLabelText(heading.textContent || '');
        if (clean && clean.length > 0 && clean.length <= 100 && !isGenericFieldLabel(clean)) {
          return {
            label: clean,
            headingId: heading.id || undefined,
            containerItemId: gFormItem.getAttribute('data-item-id') || undefined
          };
        }
      }
    }

    // Priority 2: Generic single-field wrapper (.form-group, .form-row, fieldset, etc.)
    // Ensure the container wraps ONLY this field to prevent inheriting adjacent questions' titles
    const singleContainer = el.closest<HTMLElement>(
      '.form-group, .form-row, .form-field, .form-item, .field-wrapper, fieldset'
    );
    if (singleContainer) {
      const inputsInside = singleContainer.querySelectorAll(
        'input:not([type="hidden"]), textarea, select'
      );
      if (inputsInside.length === 1) {
        const heading = singleContainer.querySelector<HTMLElement>(
          'legend, label, .form-label, [role="heading"], .question-title'
        );
        if (heading && heading !== el && !heading.contains(el)) {
          const clean = cleanLabelText(heading.textContent || '');
          if (clean && clean.length > 0 && clean.length <= 100 && !isGenericFieldLabel(clean)) {
            return {
              label: clean,
              headingId: heading.id || undefined
            };
          }
        }
      }
    }

    return null;
  }

  function findNearbyText(el: HTMLElement): string | undefined {
    // Preceding immediate element sibling only (never walk up to parent's siblings across question boundaries)
    let prev = el.previousElementSibling;
    while (prev) {
      const text = cleanLabelText(prev.textContent || '');
      if (text && text.length > 0 && text.length < 80 && !isGenericFieldLabel(text)) {
        return text;
      }
      prev = prev.previousElementSibling;
    }

    // Parent container: only inspect direct text labels inside the immediate parent wrapper
    const parent = el.parentElement;
    if (parent && parent.tagName !== 'BODY' && parent.tagName !== 'FORM') {
      const textNodes = Array.from(
        parent.querySelectorAll('label, span, p, div, strong, b, h4, h5, h6')
      );
      for (const node of textNodes) {
        if (node !== el && !node.contains(el)) {
          const text = cleanLabelText(node.textContent || '');
          if (text && text.length > 0 && text.length < 80 && !isGenericFieldLabel(text)) {
            return text;
          }
        }
      }
    }

    // Table row: preceding cell within the same table row
    const td = el.closest('td');
    if (td) {
      const tr = td.closest('tr');
      if (tr) {
        const cells = Array.from(tr.querySelectorAll('th, td'));
        const idx = cells.indexOf(td);
        if (idx > 0) {
          const text = cleanLabelText(cells[idx - 1].textContent || '');
          if (text && text.length > 0 && text.length < 80 && !isGenericFieldLabel(text)) {
            return text;
          }
        }
      }
    }
    return undefined;
  }

  function resolveFieldLabel(
    el: HTMLElement,
    index: number
  ): {
    label: string;
    source: 'explicit' | 'enclosing' | 'aria-labelledby' | 'aria-label' | 'nearby' | 'placeholder' | 'name' | 'fallback';
    headingId?: string;
    containerItemId?: string;
  } {
    // 1. aria-labelledby (W3C standard: space-separated list of IDs - Google Forms primary title)
    const ariaLabelledBy = extractAriaLabelledBy(el);
    if (ariaLabelledBy) {
      return {
        label: ariaLabelledBy.label,
        source: 'aria-labelledby',
        headingId: ariaLabelledBy.headingId
      };
    }

    // 2. Question container title (Google Forms item container or isolated field wrapper)
    const containerTitle = extractQuestionContainerTitle(el);
    if (containerTitle) {
      return {
        label: containerTitle.label,
        source: 'nearby',
        headingId: containerTitle.headingId,
        containerItemId: containerTitle.containerItemId
      };
    }

    // 3. Explicit <label for="id"> if not generic
    if (el.id) {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicitLabel && explicitLabel.textContent) {
        const clean = cleanLabelText(explicitLabel.textContent);
        if (clean && clean.length <= 80 && !isGenericFieldLabel(clean)) {
          return { label: clean, source: 'explicit' };
        }
      }
    }

    // 4. Enclosing <label> if not generic
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.textContent) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      const inputs = clone.querySelectorAll('input, textarea, select');
      inputs.forEach((i) => i.remove());
      const clean = cleanLabelText(clone.textContent || '');
      if (clean && clean.length <= 80 && !isGenericFieldLabel(clean)) {
        return { label: clean, source: 'enclosing' };
      }
    }

    // 5. aria-label if not generic
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      const clean = cleanLabelText(ariaLabel);
      if (clean && clean.length <= 80 && !isGenericFieldLabel(clean)) {
        return { label: clean, source: 'aria-label' };
      }
    }

    // 6. Nearby accessible text if not generic
    const nearby = findNearbyText(el);
    if (nearby && nearby.length <= 80 && !isGenericFieldLabel(nearby)) {
      return { label: nearby, source: 'nearby' };
    }

    // 7. placeholder if not generic
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) {
      const clean = cleanLabelText(placeholder);
      if (clean && clean.length <= 80 && !isGenericFieldLabel(clean)) {
        return { label: clean, source: 'placeholder' };
      }
    }

    // 8. name attribute formatted if not generic (ignore Google Forms entry.xxxx)
    const nameAttr = (el as HTMLInputElement).name || el.getAttribute('name');
    if (nameAttr && nameAttr.trim() && !/^entry\.\d+$/i.test(nameAttr.trim())) {
      const cleanName = cleanLabelText(
        nameAttr
          .replace(/[_-]+/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .trim()
      );
      if (cleanName.length <= 50 && !isGenericFieldLabel(cleanName)) {
        return {
          label: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
          source: 'name'
        };
      }
    }

    // Fallback: If nothing specific found
    const type =
      el.tagName.toLowerCase() === 'textarea'
        ? 'Textarea'
        : el.tagName.toLowerCase() === 'select'
        ? 'Select'
        : (el as HTMLInputElement).type || 'Text';
    return {
      label: `${type.charAt(0).toUpperCase() + type.slice(1)} Field #${index + 1}`,
      source: 'fallback'
    };
  }

  function getUniqueSelector(
    el: HTMLElement,
    fieldId: string,
    headingId?: string,
    containerItemId?: string
  ): string {
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }
    // High-precision Google Forms selector via aria-labelledby heading ID
    if (headingId) {
      return `[aria-labelledby~="${CSS.escape(headingId)}"]`;
    }
    // High-precision Google Forms selector via container data-item-id
    if (containerItemId) {
      const tag = el.tagName.toLowerCase();
      return `[data-item-id="${CSS.escape(containerItemId)}"] ${tag}`;
    }
    const nameAttr = el.getAttribute('name');
    if (nameAttr && !/^entry\.\d+$/i.test(nameAttr)) {
      const matches = document.querySelectorAll(`[name="${CSS.escape(nameAttr)}"]`);
      if (matches.length === 1) {
        return `${el.tagName.toLowerCase()}[name="${CSS.escape(nameAttr)}"]`;
      }
    }
    // High-precision selector using safe DOM data attribute
    return `[data-private-pilot-field-id="${CSS.escape(fieldId)}"]`;
  }

  const detected: DetectedFormField[] = [];
  let excludedCount = 0;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('input, textarea, select')
  );

  candidates.forEach((el, index) => {
    const tagName = el.tagName.toUpperCase();
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();

    // 1. Check supported types
    let supportedType: SupportedFieldType | null = null;
    let selectOptions: Array<{ value: string; text: string }> | undefined = undefined;

    if (tagName === 'TEXTAREA') {
      supportedType = 'textarea';
    } else if (tagName === 'SELECT') {
      supportedType = 'select';
      const sEl = el as HTMLSelectElement;
      selectOptions = Array.from(sEl.options).map((opt) => ({
        value: opt.value,
        text: (opt.text || opt.label || '').trim()
      }));
    } else if (tagName === 'INPUT') {
      if (['text', 'email', 'tel', 'url', 'search'].includes(inputType)) {
        supportedType = inputType as SupportedFieldType;
      } else if (inputType === 'checkbox') {
        supportedType = 'checkbox';
      } else if (inputType === 'radio') {
        supportedType = 'radio';
      } else if (!el.hasAttribute('type')) {
        supportedType = 'text';
      }
    }

    if (!supportedType) {
      excludedCount++;
      return;
    }

    // 2. Check disabled or read-only
    const inputEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (inputEl.disabled || (inputEl as HTMLInputElement).readOnly) {
      excludedCount++;
      return;
    }

    // 3. Check visibility
    if (!isElementVisible(el)) {
      excludedCount++;
      return;
    }

    // 4. Exclude sensitive attributes (DO NOT read their values!)
    const nameAttr = (el as HTMLInputElement).name || el.getAttribute('name') || '';
    const idAttr = el.id || '';
    const placeholderAttr = el.getAttribute('placeholder') || '';
    const ariaLabelAttr = el.getAttribute('aria-label') || '';
    const autocompleteAttr = (el.getAttribute('autocomplete') || '').toLowerCase();

    let labelHint = '';
    const parentLabel = el.closest('label');
    if (parentLabel) labelHint += parentLabel.textContent || '';
    if (idAttr) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(idAttr)}"]`);
      if (forLabel) labelHint += ' ' + (forLabel.textContent || '');
    }

    const combinedInspectString = `${nameAttr} ${idAttr} ${placeholderAttr} ${ariaLabelAttr} ${autocompleteAttr} ${labelHint}`;

    if (
      inputType === 'password' ||
      inputType === 'hidden' ||
      autocompleteAttr.includes('password') ||
      autocompleteAttr.includes('cc-') ||
      autocompleteAttr.includes('one-time-code') ||
      isSensitive(combinedInspectString)
    ) {
      excludedCount++;
      return;
    }

    // 5. Build clean, stable field metadata
    const resolved = resolveFieldLabel(el, index);
    const label = resolved.label;
    const labelSource = resolved.source;
    const explicitLabel = resolved.source !== 'fallback' ? resolved.label : undefined;
    const nearbyText = findNearbyText(el);
    const fieldId = `field-${index}-${idAttr || (nameAttr && !/^entry\.\d+$/i.test(nameAttr) ? nameAttr : '') || supportedType}`;
    const selector = getUniqueSelector(el, fieldId, resolved.headingId, resolved.containerItemId);

    // Stamp a stable, safe DOM attribute so filling can target this exact element reliably
    try {
      el.setAttribute('data-private-pilot-field-id', fieldId);
    } catch {
      // ignore
    }

    detected.push({
      id: fieldId,
      label,
      type: supportedType,
      placeholder: placeholderAttr.trim() || undefined,
      name: nameAttr.trim() || undefined,
      selector,
      isRequired: (inputEl as HTMLInputElement).required || false,
      elementId: idAttr || undefined,
      index,
      explicitLabel,
      ariaLabel: ariaLabelAttr.trim() || undefined,
      autocomplete: autocompleteAttr.trim() || undefined,
      labelSource,
      nearbyText,
      options: selectOptions,
      currentValue: (inputEl as HTMLInputElement).value || undefined,
      checked: (inputEl as HTMLInputElement).checked
    });
  });

  return {
    pageUrl,
    pageTitle,
    fields: detected,
    excludedCount
  };
}

/**
 * Self-contained filling function executed inside the target tab context.
 * In Chrome MV3, this function must not reference variables outside its own scope.
 */
function fillFormFieldsInTab(
  expectedUrl: string,
  approvedFields: ApprovedFormFieldToFill[]
): {
  success: boolean;
  filledFields: string[];
  failedFields: string[];
  failedDetails: Array<{ fieldId?: string; label: string; reason: string }>;
  error?: string;
} {
  function normalizeUrl(rawUrl: string): string {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      u.hash = '';
      let p = u.pathname;
      if (u.protocol === 'file:') {
        p = p.toLowerCase();
      }
      if (p.length > 1 && p.endsWith('/')) {
        p = p.slice(0, -1);
      }
      u.pathname = p;
      return u.href.toLowerCase();
    } catch {
      return rawUrl.split('#')[0].trim().toLowerCase();
    }
  }

  const currentUrl = window.location.href || '';
  if (normalizeUrl(currentUrl) !== normalizeUrl(expectedUrl)) {
    return {
      success: false,
      filledFields: [],
      failedFields: approvedFields.map((f) => f.label),
      failedDetails: approvedFields.map((f) => ({
        fieldId: f.fieldId,
        label: f.label,
        reason: `Webpage URL changed from ${expectedUrl.substring(0, 35)}... to ${currentUrl.substring(0, 35)}...`
      })),
      error: `The active webpage URL (${currentUrl.substring(0, 40)}...) does not match the page where fields were reviewed (${expectedUrl.substring(0, 40)}...). Form filling aborted for safety.`
    };
  }

  const SENSITIVE_REGEXES = [
    /\b(password|passcode|passwd|secret|pwd)\b/i,
    /\b(otp|2fa|mfa|token|authcode|security[-_ ]?code|verification[-_ ]?code|recovery[-_ ]?code)\b/i,
    /\b(atm[-_ ]?pin|mpin|security[-_ ]?pin|secret[-_ ]?pin|card[-_ ]?pin)\b/i,
    /\b(credit[-_ ]?card|debit[-_ ]?card|card[-_ ]?number|cardnumber|cvv|cvc|cc[-_ ]?num|payment[-_ ]?card|pan)\b/i,
    /\b(ssn|social[-_ ]?security|tax[-_ ]?id|ein|national[-_ ]?id|passport|aadhar|gov[-_ ]?id)\b/i,
    /\b(captcha|recaptcha|hcaptcha|turnstile)\b/i,
    /\b(bank[-_ ]?account|routing[-_ ]?number|iban|swift[-_ ]?code)\b/i
  ];

  function isSensitive(text: string): boolean {
    if (!text) return false;
    const normalized = text.replace(/[_-]+/g, ' ');
    if (
      /\b(postal|zip|zipcode|postcode|address|location|area|pin\s*code|pincode)\b/i.test(normalized) &&
      !/\b(atm|security|secret|auth|card|mpin|bank|login|password)\b/i.test(normalized)
    ) {
      return false;
    }
    if (/\b(pin|pin[-_ ]?code)\b/i.test(normalized) && !/\b(postal|zip|postcode|pin\s*code|pincode)\b/i.test(normalized)) {
      return true;
    }
    return SENSITIVE_REGEXES.some((rx) => rx.test(normalized));
  }

  function isElementVisible(el: HTMLElement): boolean {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    try {
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parseFloat(style.opacity || '1') === 0
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return false;
      }
    } catch {
      // fallback
    }
    return true;
  }

  // Tab-level concurrency guard
  if ((window as any).__privatePilotFillInProgress) {
    return {
      success: false,
      filledFields: [],
      failedFields: approvedFields.map((f) => f.label),
      failedDetails: approvedFields.map((f) => ({
        fieldId: f.fieldId,
        label: f.label,
        reason: 'Another fill operation was actively running in this tab'
      })),
      error: 'A fill operation is already actively executing in this tab. Please wait for it to complete.'
    };
  }
  (window as any).__privatePilotFillInProgress = true;

  try {
    const filledFields: string[] = [];
    const failedFields: string[] = [];
    const failedDetails: Array<{ fieldId?: string; label: string; reason: string }> = [];
    const filledElements = new Set<HTMLElement>();
    const processedFieldIds = new Set<string>();

    for (const item of approvedFields) {
      if (!item.value || !item.value.trim()) {
        continue;
      }

      // Prevent duplicate processing of the same field ID within a single fill pass
      if (item.fieldId) {
        if (processedFieldIds.has(item.fieldId)) {
          continue;
        }
        processedFieldIds.add(item.fieldId);
      }

      let el: HTMLElement | null = null;

      // Strategy 1: Match by stable data attribute set during detection
      if (item.fieldId) {
        try {
          el = document.querySelector<HTMLElement>(
            `[data-private-pilot-field-id="${CSS.escape(item.fieldId)}"]`
          );
        } catch {
          // ignore
        }
      }

      // Strategy 2: Match by unique selector (e.g. [aria-labelledby~="i1"], [data-item-id="..."], #id)
      if (!el && item.selector) {
        try {
          el = document.querySelector<HTMLElement>(item.selector);
        } catch {
          // ignore
        }
      }

      // Strategy 3: Semantic Question Title matching in Google Forms and standard web forms
      // Strictly matches the specific question container or aria-labelledby relationship, never guesses by array index
      if (!el && item.label) {
        try {
          const cleanTarget = item.label
            .toLowerCase()
            .trim()
            .replace(/[*:]+/g, '')
            .trim();

          const headings = Array.from(
            document.querySelectorAll<HTMLElement>(
              '.M7eMe, [role="heading"], legend, label, .question-title, .form-label'
            )
          );

          for (const h of headings) {
            const hText = (h.textContent || '')
              .toLowerCase()
              .trim()
              .replace(/[*:]+/g, '')
              .replace(/\s*\((required|optional)\)\s*$/i, '')
              .replace(/^\s*(?:q(?:uestion)?\s*\d+[:.-]?|\d+[:.)-])\s*/i, '')
              .replace(/\s+/g, ' ')
              .trim();

            if (hText === cleanTarget) {
              // Priority A: Heading ID referenced by an input's aria-labelledby
              if (h.id) {
                const byAria = document.querySelector<HTMLElement>(
                  `[aria-labelledby~="${CSS.escape(h.id)}"]`
                );
                if (byAria) {
                  el = byAria;
                  break;
                }
              }

              // Priority B: Input inside the same individual question container
              const container = h.closest<HTMLElement>(
                '.Qr7Oae, .geS5n, [data-item-id], [jsmodel="CP1oW"], [role="listitem"]:not([role="list"]), .form-group, .form-row, .form-field'
              );
              if (container) {
                const candidateInput = container.querySelector<HTMLElement>(
                  'input:not([type="hidden"]), textarea, select'
                );
                if (candidateInput) {
                  el = candidateInput;
                  break;
                }
              }
            }
          }
        } catch {
          // ignore
        }
      }

      // Strategy 4: Match by HTML element ID
      if (!el && item.elementId) {
        try {
          const byId = document.getElementById(item.elementId);
          if (byId && (byId.tagName === 'INPUT' || byId.tagName === 'TEXTAREA' || byId.tagName === 'SELECT')) {
            el = byId;
          }
        } catch {
          // ignore
        }
      }

      // Strategy 5: Match by unique name attribute (excluding Google Forms entry.xxxx)
      if (!el && item.name && !/^entry\.\d+$/i.test(item.name)) {
        try {
          const matches = document.querySelectorAll<HTMLElement>(
            `input[name="${CSS.escape(item.name)}"], textarea[name="${CSS.escape(item.name)}"], select[name="${CSS.escape(item.name)}"]`
          );
          if (matches.length === 1) {
            el = matches[0];
          }
        } catch {
          // ignore
        }
      }

      // Ensure the selector resolved directly to an input/textarea/select, not a placeholder or wrapper
      if (el && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName.toUpperCase())) {
        const actualInput = el.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select');
        if (actualInput) {
          el = actualInput;
        } else {
          el = null;
        }
      }

      // Revalidation 1: Does element exist in the DOM?
      // NOTE: Positional index fallback (candidates[item.index]) is strictly forbidden to prevent value shifting
      if (!el) {
        failedFields.push(item.label);
        failedDetails.push({
          fieldId: item.fieldId,
          label: item.label,
          reason: 'Target input element could not be reliably located in the webpage DOM'
        });
        continue;
      }

      // Revalidation 2: Prevent duplicate fill operations from running on the same field
      if (filledElements.has(el)) {
        failedFields.push(item.label);
        failedDetails.push({
          fieldId: item.fieldId,
          label: item.label,
          reason: 'Duplicate fill operation prevented: field was already filled'
        });
        continue;
      }

      // Revalidation 3: Is element still connected to the active document?
      if (!el.isConnected) {
        failedFields.push(item.label);
        failedDetails.push({
          fieldId: item.fieldId,
          label: item.label,
          reason: 'Target element was disconnected from the webpage DOM'
        });
        continue;
      }

      // Revalidation 4: Is element visible?
      if (!isElementVisible(el)) {
        failedFields.push(item.label);
        failedDetails.push({
          fieldId: item.fieldId,
          label: item.label,
          reason: 'Target element is hidden or invisible on the webpage'
        });
        continue;
      }

      // Revalidation 5: Is element disabled or read-only?
      const inputLike = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (inputLike.disabled || (inputLike as HTMLInputElement).readOnly) {
        failedFields.push(item.label);
        failedDetails.push({
          fieldId: item.fieldId,
          label: item.label,
          reason: 'Target element is disabled or read-only'
        });
        continue;
      }

      // Revalidation 6: Never fill password or sensitive fields even if mistakenly targeted
      const inputType = (el.getAttribute('type') || '').toLowerCase();
      const nameAttr = (el as HTMLInputElement).name || el.getAttribute('name') || '';
      const idAttr = el.id || '';
      const placeholderAttr = el.getAttribute('placeholder') || '';
      const ariaLabelAttr = el.getAttribute('aria-label') || '';
      const autocompleteAttr = (el.getAttribute('autocomplete') || '').toLowerCase();

      let labelHint = '';
      const parentLabel = el.closest('label');
      if (parentLabel) labelHint += parentLabel.textContent || '';
      if (idAttr) {
        const forLabel = document.querySelector(`label[for="${CSS.escape(idAttr)}"]`);
        if (forLabel) labelHint += ' ' + (forLabel.textContent || '');
      }
      const combinedInspectString = `${nameAttr} ${idAttr} ${placeholderAttr} ${ariaLabelAttr} ${autocompleteAttr} ${labelHint}`;

      if (
        inputType === 'password' ||
        inputType === 'hidden' ||
        autocompleteAttr.includes('password') ||
        autocompleteAttr.includes('cc-') ||
        autocompleteAttr.includes('one-time-code') ||
        isSensitive(combinedInspectString)
      ) {
        failedFields.push(item.label);
        failedDetails.push({
          fieldId: item.fieldId,
          label: item.label,
          reason: 'Field was flagged as sensitive and safely excluded from automated filling'
        });
        continue;
      }

      // Safe, framework-compatible DOM value injection
      try {
        const valToSet = item.value.trim();
        const tagName = el.tagName.toUpperCase();

        if (tagName === 'SELECT') {
          const selectEl = el as HTMLSelectElement;
          const normTarget = valToSet.toLowerCase();
          let selected = false;

          for (let i = 0; i < selectEl.options.length; i++) {
            const opt = selectEl.options[i];
            const optVal = opt.value.trim().toLowerCase();
            const optText = (opt.text || opt.label || '').trim().toLowerCase();

            if (
              optVal === normTarget ||
              optText === normTarget ||
              (normTarget.length >= 3 && optText.includes(normTarget)) ||
              (optText.length >= 3 && normTarget.includes(optText))
            ) {
              selectEl.selectedIndex = i;
              selectEl.value = opt.value;
              selected = true;
              break;
            }
          }

          if (!selected) {
            selectEl.value = valToSet;
          }

          try {
            const tracker = (selectEl as any)._valueTracker;
            if (tracker && typeof tracker.setValue === 'function') {
              tracker.setValue('');
            }
          } catch {
            // ignore
          }

          selectEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          selectEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          selectEl.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

          // Verification for select element
          if (selectEl.value && selectEl.value.trim().length > 0) {
            filledElements.add(el);
            filledFields.push(item.label);
          } else {
            failedFields.push(item.label);
            failedDetails.push({
              fieldId: item.fieldId,
              label: item.label,
              reason: `Could not match "${valToSet}" to any available dropdown option`
            });
          }
        } else if (tagName === 'INPUT' && inputType === 'checkbox') {
          const chk = el as HTMLInputElement;
          const shouldCheck = /^(true|yes|1|on|checked)$/i.test(valToSet) || valToSet.length > 0;
          chk.checked = shouldCheck;

          try {
            const tracker = (chk as any)._valueTracker;
            if (tracker && typeof tracker.setValue === 'function') {
              tracker.setValue(!shouldCheck);
            }
          } catch {
            // ignore
          }

          chk.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          chk.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          chk.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

          filledElements.add(el);
          filledFields.push(item.label);
        } else if (tagName === 'INPUT' && inputType === 'radio') {
          const radio = el as HTMLInputElement;
          radio.checked = true;

          try {
            const tracker = (radio as any)._valueTracker;
            if (tracker && typeof tracker.setValue === 'function') {
              tracker.setValue(false);
            }
          } catch {
            // ignore
          }

          radio.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          radio.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          radio.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

          filledElements.add(el);
          filledFields.push(item.label);
        } else {
          // Standard text inputs and textareas
          const isTextarea = tagName === 'TEXTAREA';
          const targetInput = el as HTMLInputElement | HTMLTextAreaElement;
          const nativeSetter = Object.getOwnPropertyDescriptor(
            isTextarea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
            'value'
          )?.set;

          const existingValue = targetInput.value || '';

          // If the field already contains the exact intended value (e.g. fill run a second time),
          // do NOT re-insert or concatenate text. Simply update framework state and verify.
          if (existingValue.trim() !== valToSet) {
            // Focus the element first (required for user-like text insertion and execCommand)
            targetInput.focus();

            // Select all existing text so the insertion replaces rather than appends
            try {
              targetInput.select();
            } catch {
              // ignore
            }

            let insertedNatively = false;

            // In Chrome, document.execCommand('insertText') atomically replaces selected text
            // and triggers Google Forms' Closure/YPqndb internal state listeners directly
            try {
              insertedNatively = document.execCommand('insertText', false, valToSet);
            } catch {
              insertedNatively = false;
            }

            // Fallback: If execCommand was not supported or did not set the complete intended value,
            // clear and set cleanly via the native prototype descriptor
            if (!insertedNatively || targetInput.value !== valToSet) {
              if (nativeSetter) {
                nativeSetter.call(targetInput, '');
                nativeSetter.call(targetInput, valToSet);
              } else {
                targetInput.value = '';
                targetInput.value = valToSet;
              }
            }

            // Reset React _valueTracker so React controlled components register the change
            try {
              const tracker = (targetInput as any)._valueTracker;
              if (tracker && typeof tracker.setValue === 'function') {
                tracker.setValue('__initial__');
              }
            } catch {
              // ignore
            }

            // Update framework & Google Forms data attributes
            try {
              targetInput.setAttribute('data-initial-value', valToSet);
              targetInput.setAttribute('badinput', 'false');
            } catch {
              // ignore
            }

            // Dispatch input and change events so framework listeners update their state
            // NOTE: Never dispatch duplicate synthetic InputEvent('insertText') here, as that
            // causes double-insertion and text concatenation in Chrome!
            targetInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            targetInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            targetInput.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
          }

          // Handle Google Forms floating placeholder ("Your answer"):
          // Add active/floating classes to parent containers and hide placeholder element
          try {
            const parent = targetInput.parentElement;
            if (parent) {
              parent.classList.add('CD27Sd');
              const grandParent = parent.parentElement;
              if (grandParent) {
                grandParent.classList.add('CD27Sd', 'u3bW4e');
                grandParent.classList.remove('k3Du5');
              }
              const placeholders = parent.querySelectorAll<HTMLElement>(
                '.ndAZY, [jsname="L9xktb"]'
              );
              placeholders.forEach((p) => {
                p.style.display = 'none';
              });
            }
          } catch {
            // ignore
          }

          // Clear any Google Forms required warning indicator if present
          const qContainer = targetInput.closest<HTMLElement>('.Qr7Oae, .geS5n, [role="listitem"]');
          if (qContainer) {
            qContainer.classList.remove('k3Du5');
            const alertEl = qContainer.querySelector<HTMLElement>(
              '.RHiDh, [jsname="B34EJ"], [role="alert"]'
            );
            if (alertEl && targetInput.value === valToSet) {
              alertEl.style.display = 'none';
            }
          }

          // Step 4 Verification: Verify actual field value in the DOM matches intended profile value
          const actualVal = targetInput.value;
          if (actualVal !== valToSet) {
            failedFields.push(item.label);
            failedDetails.push({
              fieldId: item.fieldId,
              label: item.label,
              reason: `Value verification failed: Field value was "${actualVal}" instead of expected "${valToSet}"`
            });
            continue;
          }

          // Step 4 Verification: Ensure Google Forms does not still display an active required error
          if (qContainer) {
            const activeAlert = qContainer.querySelector<HTMLElement>(
              '.RHiDh, [jsname="B34EJ"], [role="alert"]'
            );
            if (
              activeAlert &&
              activeAlert.style.display !== 'none' &&
              /this is a required question|required/i.test(activeAlert.textContent || '') &&
              actualVal.trim() === ''
            ) {
              failedFields.push(item.label);
              failedDetails.push({
                fieldId: item.fieldId,
                label: item.label,
                reason: 'Google Forms internal state did not register field as answered (required validation still active)'
              });
              continue;
            }
          }

          filledElements.add(el);
          filledFields.push(item.label);
        }

        // Temporary visual confirmation outline
        const prevOutline = el.style.outline;
        const prevTransition = el.style.transition;
        el.style.transition = 'outline 0.3s ease';
        el.style.outline = '2px solid #10a37f';
        setTimeout(() => {
          try {
            el!.style.outline = prevOutline;
            el!.style.transition = prevTransition;
          } catch {
            // ignore
          }
        }, 1500);
      } catch (fillErr: unknown) {
        const errText = fillErr instanceof Error ? fillErr.message : String(fillErr);
        failedFields.push(item.label);
        failedDetails.push({
          fieldId: item.fieldId,
          label: item.label,
          reason: `DOM error setting value: ${errText}`
        });
      }
    }

    // Success requires at least one verified field AND zero failed/unverified fields
    const success = filledFields.length > 0 && failedFields.length === 0;
    let errorMsg: string | undefined = undefined;

    if (!success) {
      if (failedDetails.length > 0 && filledFields.length === 0) {
        errorMsg = `Could not fill ${failedDetails.length} field(s): ${failedDetails
          .map((d) => `"${d.label}" (${d.reason})`)
          .join('; ')}.`;
      } else if (failedDetails.length > 0 && filledFields.length > 0) {
        errorMsg = `Filled ${filledFields.length} field(s), but ${failedFields.length} field(s) could not be verified: ${failedDetails
          .map((d) => `"${d.label}" (${d.reason})`)
          .join('; ')}.`;
      } else {
        errorMsg = 'No fields were filled because none of the approved fields contained values.';
      }
    }

    return {
      success,
      filledFields,
      failedFields,
      failedDetails,
      error: errorMsg
    };
  } finally {
    (window as any).__privatePilotFillInProgress = false;
  }
}

/**
 * Scans the active browser tab for supported, visible, ordinary form fields.
 */
export async function scanActiveTabForms(): Promise<FormScanResult> {
  // Step 1: Verify Chrome MV3 Extension APIs
  if (
    typeof chrome === 'undefined' ||
    !chrome.tabs ||
    typeof chrome.tabs.query !== 'function' ||
    !chrome.scripting ||
    typeof chrome.scripting.executeScript !== 'function'
  ) {
    return {
      success: false,
      pageUrl: '',
      pageTitle: '',
      fields: [],
      excludedCount: 0,
      error: 'Missing required Chrome Extension APIs (chrome.tabs or chrome.scripting).'
    };
  }

  const tab = await getActiveTabInCurrentWindow();
  if (!tab || tab.id === undefined) {
    return {
      success: false,
      pageUrl: '',
      pageTitle: '',
      fields: [],
      excludedCount: 0,
      error: 'No active tab found in the current window. Please click on a webpage and try again.'
    };
  }

  const tabUrl = (tab.url || tab.pendingUrl || '').trim();
  logFormDiagnostic('Detection', 'Query active tab', { tabId: tab.id, tabUrl });

  if (!tabUrl) {
    return {
      success: false,
      pageUrl: '',
      pageTitle: '',
      fields: [],
      excludedCount: 0,
      error: 'The active tab has no accessible URL. Please wait for the page to finish loading.'
    };
  }

  const urlCheck = await checkUrlSupport(tabUrl);
  if (!urlCheck.supported) {
    logFormDiagnostic('Detection', 'Restricted page detected', { tabUrl, reason: urlCheck.reason });
    return {
      success: false,
      pageUrl: tabUrl,
      pageTitle: tab.title || '',
      fields: [],
      excludedCount: 0,
      error: urlCheck.reason || 'Forms on this browser page cannot be inspected or filled.'
    };
  }

  // Step 2: Verify origin permission if needed
  let originPattern: string | null = null;
  try {
    const parsed = new URL(tabUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      originPattern = `${parsed.origin}/*`;
    }
  } catch {
    // ignore
  }

  if (
    originPattern &&
    chrome.permissions &&
    typeof chrome.permissions.contains === 'function' &&
    typeof chrome.permissions.request === 'function'
  ) {
    let hasOrigin = false;
    try {
      hasOrigin = await chrome.permissions.contains({ origins: [originPattern] });
    } catch {
      // ignore
    }

    if (!hasOrigin) {
      try {
        const granted = await chrome.permissions.request({ origins: [originPattern] });
        if (!granted) {
          return {
            success: false,
            pageUrl: tabUrl,
            pageTitle: tab.title || '',
            fields: [],
            excludedCount: 0,
            error: 'Permission to inspect forms on this webpage was not granted.'
          };
        }
      } catch (reqErr) {
        const msg = reqErr instanceof Error ? reqErr.message : String(reqErr);
        return {
          success: false,
          pageUrl: tabUrl,
          pageTitle: tab.title || '',
          fields: [],
          excludedCount: 0,
          error: `Permission error: ${msg}`
        };
      }
    }
  }

  // Step 3: Execute in-tab detection
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectFormsInTab
    });

    if (!results || results.length === 0 || !results[0].result) {
      return {
        success: false,
        pageUrl: tabUrl,
        pageTitle: tab.title || '',
        fields: [],
        excludedCount: 0,
        error: 'No form field data was returned from the active tab. The webpage may still be loading.'
      };
    }

    const data = results[0].result;
    logFormDiagnostic('Detection', 'Scan completed', {
      eligibleCount: data.fields.length,
      excludedCount: data.excludedCount,
      tabId: tab.id
    });

    return {
      success: true,
      pageUrl: data.pageUrl || tabUrl,
      pageTitle: data.pageTitle || tab.title || 'Current Webpage',
      fields: data.fields,
      excludedCount: data.excludedCount,
      tabId: tab.id
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logFormDiagnostic('Detection', 'Script execution error', { error: msg });

    if (tabUrl.toLowerCase().startsWith('file://')) {
      const allowed = await isFileSchemeAccessAllowed();
      if (!allowed || msg.includes('Cannot access') || msg.includes('permission')) {
        return {
          success: false,
          pageUrl: tabUrl,
          pageTitle: tab.title || '',
          fields: [],
          excludedCount: 0,
          error: FILE_ACCESS_BLOCKED_MESSAGE
        };
      }
    }
    return {
      success: false,
      pageUrl: tabUrl,
      pageTitle: tab.title || '',
      fields: [],
      excludedCount: 0,
      error: `Failed to inspect form fields: ${msg}`
    };
  }
}

let isFillExecutionActive = false;

/**
 * Applies reviewed and approved values to the target webpage fields.
 * Never submits forms automatically.
 */
export async function fillApprovedFormFields(
  expectedUrl: string,
  approvedFields: ApprovedFormFieldToFill[],
  targetTabId?: number
): Promise<FormFillResult> {
  if (isFillExecutionActive) {
    return {
      success: false,
      filledFields: [],
      failedFields: approvedFields.map((f) => f.label),
      failedDetails: approvedFields.map((f) => ({
        fieldId: f.fieldId,
        label: f.label,
        reason: 'A form fill operation is already actively executing'
      })),
      error: 'A form fill operation is already running. Please wait for it to complete.'
    };
  }
  isFillExecutionActive = true;

  try {
    return await executeFillApprovedFormFieldsInternal(expectedUrl, approvedFields, targetTabId);
  } finally {
    isFillExecutionActive = false;
  }
}

async function executeFillApprovedFormFieldsInternal(
  expectedUrl: string,
  approvedFields: ApprovedFormFieldToFill[],
  targetTabId?: number
): Promise<FormFillResult> {
  logFormDiagnostic('DOM Filling', 'Starting fill process', {
    targetTabId,
    expectedUrl,
    approvedCount: approvedFields.length
  });

  if (approvedFields.length === 0) {
    return {
      success: false,
      filledFields: [],
      failedFields: [],
      error: 'No approved fields to fill. Please check at least one field with a value.'
    };
  }

  // Step 1: Identify target Chrome tab
  let tab: chrome.tabs.Tab | null = null;

  if (typeof targetTabId === 'number' && typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.get === 'function') {
    try {
      const retrieved = await chrome.tabs.get(targetTabId);
      if (retrieved && retrieved.id !== undefined) {
        tab = retrieved;
      }
    } catch {
      // Fallback to active tab in current window if specific tab retrieval failed
    }
  }

  // If specific tab was not retrieved or is no longer active in the window, resolve active tab
  if (!tab || tab.active === false) {
    const activeTab = await getActiveTabInCurrentWindow();
    if (activeTab && activeTab.id !== undefined) {
      tab = activeTab;
    }
  }

  if (!tab || tab.id === undefined) {
    logFormDiagnostic('DOM Filling', 'Active tab lost');
    return {
      success: false,
      filledFields: [],
      failedFields: approvedFields.map((f) => f.label),
      failedDetails: approvedFields.map((f) => ({
        label: f.label,
        reason: 'Target browser tab not found or closed'
      })),
      error: 'Active tab lost. Please ensure the target page tab is open and active.'
    };
  }

  const currentTabUrl = (tab.url || tab.pendingUrl || '').trim();
  logFormDiagnostic('DOM Filling', 'Tab resolved for filling', { tabId: tab.id, currentTabUrl });

  // Step 2: Verify Chrome internal restricted page (Task 3)
  const urlCheck = await checkUrlSupport(currentTabUrl);
  if (!urlCheck.supported) {
    const errorMsg = urlCheck.reason || `Active tab is on a restricted browser page (${currentTabUrl.split(':')[0]}://). Please switch to the tab containing your form.`;
    logFormDiagnostic('DOM Filling', 'Restricted tab rejected', { currentTabUrl, reason: errorMsg });
    return {
      success: false,
      filledFields: [],
      failedFields: approvedFields.map((f) => f.label),
      failedDetails: approvedFields.map((f) => ({
        label: f.label,
        reason: 'Active tab is a restricted browser page'
      })),
      error: errorMsg
    };
  }

  // Step 3: Verify target page URL matches scanned form URL (Task 3 & 4)
  if (normalizeUrlForComparison(currentTabUrl) !== normalizeUrlForComparison(expectedUrl)) {
    const errorMsg = `Active tab URL does not match the page where fields were reviewed. Expected "${expectedUrl.substring(0, 45)}...", but active tab is "${currentTabUrl.substring(0, 45)}...". Please switch back to your form tab before filling.`;
    logFormDiagnostic('DOM Filling', 'URL mismatch', { expectedUrl, currentTabUrl });
    return {
      success: false,
      filledFields: [],
      failedFields: approvedFields.map((f) => f.label),
      failedDetails: approvedFields.map((f) => ({
        label: f.label,
        reason: 'Active tab does not match scanned form page'
      })),
      error: errorMsg
    };
  }

  // Step 4: Verify local file access permission if file:// URL
  if (currentTabUrl.toLowerCase().startsWith('file://')) {
    const allowed = await isFileSchemeAccessAllowed();
    if (!allowed) {
      logFormDiagnostic('DOM Filling', 'file:// access not allowed');
      return {
        success: false,
        filledFields: [],
        failedFields: approvedFields.map((f) => f.label),
        failedDetails: approvedFields.map((f) => ({
          label: f.label,
          reason: 'File URL access not allowed by Chrome'
        })),
        error: FILE_ACCESS_BLOCKED_MESSAGE
      };
    }
  }

  // Step 4b: Verify origin permissions for HTTP/HTTPS targets
  let originPattern: string | null = null;
  try {
    const parsed = new URL(currentTabUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      originPattern = `${parsed.origin}/*`;
    }
  } catch {
    // ignore
  }

  if (
    originPattern &&
    chrome.permissions &&
    typeof chrome.permissions.contains === 'function' &&
    typeof chrome.permissions.request === 'function'
  ) {
    let hasOrigin = false;
    try {
      hasOrigin = await chrome.permissions.contains({ origins: [originPattern] });
    } catch {
      // ignore
    }

    if (!hasOrigin) {
      try {
        const granted = await chrome.permissions.request({ origins: [originPattern] });
        if (!granted) {
          return {
            success: false,
            filledFields: [],
            failedFields: approvedFields.map((f) => f.label),
            failedDetails: approvedFields.map((f) => ({
              label: f.label,
              reason: 'Origin permission denied'
            })),
            error: `Permission to fill form fields on "${currentTabUrl}" was not granted.`
          };
        }
      } catch (permErr) {
        const pMsg = permErr instanceof Error ? permErr.message : String(permErr);
        return {
          success: false,
          filledFields: [],
          failedFields: approvedFields.map((f) => f.label),
          failedDetails: approvedFields.map((f) => ({
            label: f.label,
            reason: pMsg
          })),
          error: `Permission error before filling: ${pMsg}`
        };
      }
    }
  }

  // Step 5: Execute script inside tab context
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillFormFieldsInTab,
      args: [expectedUrl, approvedFields]
    });

    if (!results || results.length === 0 || !results[0].result) {
      logFormDiagnostic('DOM Filling', 'No script result returned');
      return {
        success: false,
        filledFields: [],
        failedFields: approvedFields.map((f) => f.label),
        failedDetails: approvedFields.map((f) => ({
          label: f.label,
          reason: 'No execution result returned from webpage'
        })),
        error: 'No result returned from form filling execution. The page may have reloaded or uncommitted.'
      };
    }

    const fillResult = results[0].result;
    logFormDiagnostic('DOM Filling', 'Filling execution complete', {
      success: fillResult.success,
      filledCount: fillResult.filledFields.length,
      failedCount: fillResult.failedFields.length,
      errorMessage: fillResult.error || 'None'
    });

    return fillResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logFormDiagnostic('DOM Filling', 'executeScript exception caught', { error: msg });

    let specificError = `Failed to fill form fields: ${msg}`;
    if (expectedUrl.toLowerCase().startsWith('file://')) {
      const allowed = await isFileSchemeAccessAllowed();
      if (!allowed || msg.includes('Cannot access') || msg.includes('permission')) {
        specificError = FILE_ACCESS_BLOCKED_MESSAGE;
      }
    } else if (msg.includes('Cannot access a chrome://') || msg.includes('cannot be scripted')) {
      specificError = 'Chrome security strictly prohibits scripting on internal browser pages or protected web stores.';
    } else if (
      msg.includes('Extension manifest must request permission') ||
      msg.includes('Cannot access contents of url') ||
      msg.includes('permission')
    ) {
      specificError = `Permission error on tab (ID: ${tab.id}): Chrome blocked script injection. Please ensure the target page is active and host access is granted.`;
    } else if (
      msg.includes('Frame with ID 0 was removed') ||
      msg.includes('tab was closed') ||
      msg.includes('No tab with id')
    ) {
      specificError = 'The target browser tab was closed or refreshed while filling.';
    }

    return {
      success: false,
      filledFields: [],
      failedFields: approvedFields.map((f) => f.label),
      failedDetails: approvedFields.map((f) => ({
        label: f.label,
        reason: msg
      })),
      error: specificError
    };
  }
}

/**
 * Builds the prompt for local Gemma 4 to extract field values from the user's description.
 */
export function buildFormSuggestionPrompt(
  fields: DetectedFormField[],
  userDescription: string
): string {
  const fieldList = fields
    .map(
      (f, idx) =>
        `${idx + 1}. ID: ${f.id} | Label: "${f.label}" | Type: ${f.type}${
          f.placeholder ? ` | Placeholder: "${f.placeholder}"` : ''
        }`
    )
    .join('\n');

  return `You are a precise form assistant helping a user fill ordinary fields on a webpage.
The user provided the following information description:
"""
${userDescription}
"""

Target Form Fields:
${fieldList}

Instructions:
1. Grounding: Rely strictly on the information provided in the user's description.
2. For each field, determine if the user provided relevant data (such as their name, email, phone number, message, or notes).
3. If provided, extract or formulate the exact value for that field.
4. If not provided or uncertain, write "[EMPTY]" for that field. Do NOT invent or hallucinate data.
5. Format your output strictly line by line:
FIELD: <ID>
VALUE: <Extracted value or [EMPTY]>`;
}

/**
 * Parses Gemma 4's response into a map of fieldId -> suggestedValue.
 * Supports bullet prefixes, markdown bold tags, numbered IDs, and field label matching.
 */
export function parseFormSuggestions(
  responseText: string,
  fields: DetectedFormField[]
): Record<string, string> {
  const results: Record<string, string> = {};
  if (!responseText || !fields || fields.length === 0) return results;

  const lines = responseText.split('\n');
  let currentFieldId: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Check FIELD line: handle bullets (- , * , 1. ), markdown bold (**FIELD:**), etc.
    const fieldMatch = line.match(/^(?:[-*•]|\d+\.)?\s*(?:\*\*)?FIELD(?:\*\*)?:\s*(.+)$/i);
    if (fieldMatch) {
      let fieldIdentifier = fieldMatch[1].replace(/^\*\*|\*\*$/g, '').trim();
      fieldIdentifier = fieldIdentifier.replace(/^["'`]|["'`]$/g, '').trim();

      // 1. Direct ID match
      let matched = fields.find((f) => f.id === fieldIdentifier);

      // 2. Match by 1-based index (e.g. "1", "2") if identifier is numeric
      if (!matched) {
        const numIdx = parseInt(fieldIdentifier, 10);
        if (!isNaN(numIdx) && String(numIdx) === fieldIdentifier && numIdx >= 1 && numIdx <= fields.length) {
          matched = fields[numIdx - 1];
        }
      }

      // 3. ID substring match (only for meaningful identifiers longer than 3 chars)
      if (!matched && fieldIdentifier.length > 3) {
        matched = fields.find((f) => fieldIdentifier.includes(f.id) || f.id.includes(fieldIdentifier));
      }

      // 4. Match by label (case-insensitive)
      if (!matched) {
        const lowerIdent = fieldIdentifier.toLowerCase();
        matched = fields.find(
          (f) =>
            f.label.toLowerCase() === lowerIdent ||
            lowerIdent.includes(f.label.toLowerCase()) ||
            f.label.toLowerCase().includes(lowerIdent)
        );
      }

      // 5. Match by name attribute
      if (!matched) {
        matched = fields.find(
          (f) => f.name && f.name.toLowerCase() === fieldIdentifier.toLowerCase()
        );
      }

      currentFieldId = matched ? matched.id : null;
      continue;
    }

    // Check VALUE line
    const valueMatch = line.match(/^(?:[-*•]|\d+\.)?\s*(?:\*\*)?VALUE(?:\*\*)?:\s*(.+)$/i);
    if (valueMatch && currentFieldId) {
      let valPart = valueMatch[1].replace(/^\*\*|\*\*$/g, '').trim();
      if (
        (valPart.startsWith('"') && valPart.endsWith('"')) ||
        (valPart.startsWith("'") && valPart.endsWith("'"))
      ) {
        valPart = valPart.slice(1, -1).trim();
      }

      if (valPart && valPart !== '[EMPTY]' && !valPart.includes('[EMPTY]')) {
        results[currentFieldId] = valPart;
      }
      currentFieldId = null;
    }
  }

  // Fallback: If structured format wasn't strictly followed, check for "Label: Value"
  if (Object.keys(results).length === 0) {
    for (const field of fields) {
      const escapedLabel = field.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:${escapedLabel}|${field.id})[:\\s-]+([^\\n]+)`, 'i');
      const match = responseText.match(regex);
      if (match && match[1]) {
        let val = match[1].trim();
        val = val.replace(/^["'`]|["'`]$/g, '').trim();
        if (val && !val.toLowerCase().includes('empty') && !val.toLowerCase().includes('none')) {
          results[field.id] = val;
        }
      }
    }
  }

  return results;
}
