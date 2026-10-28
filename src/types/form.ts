export type SupportedFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'textarea'
  | 'url'
  | 'search'
  | 'select'
  | 'checkbox'
  | 'radio';

export type FieldLabelSource =
  | 'explicit'
  | 'enclosing'
  | 'aria-labelledby'
  | 'aria-label'
  | 'nearby'
  | 'placeholder'
  | 'autocomplete'
  | 'name'
  | 'fallback';

export interface DetectedFormField {
  id: string;
  label: string;
  type: SupportedFieldType;
  placeholder?: string;
  name?: string;
  selector: string;
  isRequired?: boolean;
  elementId?: string;
  index?: number;
  explicitLabel?: string;
  ariaLabel?: string;
  autocomplete?: string;
  labelSource?: FieldLabelSource;
  nearbyText?: string;
  options?: Array<{ value: string; text: string }>;
  currentValue?: string;
  checked?: boolean;
}

export interface FormScanResult {
  success: boolean;
  pageUrl: string;
  pageTitle: string;
  fields: DetectedFormField[];
  excludedCount: number;
  tabId?: number;
  error?: string;
}

export interface FieldSuggestion {
  fieldId: string;
  label: string;
  type: SupportedFieldType;
  value: string;
  approved: boolean;
}

export interface FormFillFailureDetail {
  fieldId?: string;
  label: string;
  reason: string;
}

export interface FormFillResult {
  success: boolean;
  filledFields: string[];
  failedFields: string[];
  failedDetails?: FormFillFailureDetail[];
  error?: string;
}

export interface ApprovedFormFieldToFill {
  fieldId: string;
  selector: string;
  label: string;
  value: string;
  name?: string;
  elementId?: string;
  index?: number;
}
