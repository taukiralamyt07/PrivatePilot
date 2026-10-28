export interface PageSectionChunk {
  id: string;
  heading: string;
  level: number;
  text: string;
  characterCount: number;
  wordCount: number;
}

export interface ExtractedPageContent {
  title: string;
  url: string;
  hostname: string;
  text: string;
  characterCount: number;
  wordCount: number;
  extractedAt: number;
  truncated: boolean;
  chunks?: PageSectionChunk[];
  extractionTimeMs?: number;
}

export interface PageRetrievalResult {
  hasConfidentMatch: boolean;
  primarySection: string;
  matchedSections: string[];
  contextText: string;
  matchedChunks: PageSectionChunk[];
  retrievalScore: number;
  retrievalTimeMs: number;
}

export type PageReaderStatus = 'idle' | 'reading' | 'success' | 'error';

export type PageReaderErrorCategory =
  | 'MISSING_PERMISSION'
  | 'ABSENT_TAB'
  | 'ABSENT_URL'
  | 'RESTRICTED_URL'
  | 'EXECUTION_FAILED'
  | 'EMPTY_CONTENT'
  | 'UNKNOWN';

export interface PageReaderResult {
  success: boolean;
  data?: ExtractedPageContent;
  error?: string;
  isUnsupportedPage?: boolean;
  unsupportedReason?: string;
  errorCategory?: PageReaderErrorCategory;
  diagnosticStep?: string;
}
