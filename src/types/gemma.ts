export type GemmaModelStatus =
  | 'unloaded'
  | 'uninitialized'
  | 'checking_compatibility'
  | 'compatibility_checked'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'unloading'
  | 'error';

export interface HardwareCompatibilityReport {
  hasWebGPU: boolean;
  adapterAvailable: boolean;
  adapterName: string;
  vendor: string;
  architecture: string;
  hasShaderF16: boolean;
  maxBufferSizeMB: number;
  maxStorageBufferBindingSizeMB: number;
  deviceMemoryGB?: number;
  canRunQ4F16: boolean;
  canRunQ4F32: boolean;
  overallStatus: 'supported' | 'warning' | 'unsupported';
  summary: string;
  blockers: string[];
  warnings: string[];
  recommendations: string[];
}

export interface LoadingProgress {
  progress: number; // 0 - 100
  text: string;
  timeElapsed?: number;
}

export interface GemmaConfig {
  modelId: string;
  contextWindowSize: number; // Maximum 1024 tokens for low-memory environments
  maxGenTokens: number;      // Bounded output length (default 256)
  temperature: number;
  systemPrompt: string;
}

export const GEMMA_4_E2B_Q4F16 = 'gemma-4-E2B-it-q4f16_1-MLC';
export const GEMMA_4_E2B_Q4F32 = 'gemma-4-E2B-it-q4f32_1-MLC';

// Strict low-memory hardware caps for 16 GB shared iGPU
export const MAX_SAFE_CONTEXT_WINDOW = 1024;
export const MIN_SAFE_CONTEXT_WINDOW = 512;
export const MAX_SAFE_GEN_TOKENS = 256;

export const DEFAULT_GEMMA_CONFIG: GemmaConfig = {
  modelId: GEMMA_4_E2B_Q4F16,
  contextWindowSize: 1024,
  maxGenTokens: 256,
  temperature: 0.7,
  systemPrompt:
    'You are Private Pilot, a fast, concise, on-device AI assistant running locally inside Google Chrome with zero cloud telemetry. Respond clearly and concisely.'
};
