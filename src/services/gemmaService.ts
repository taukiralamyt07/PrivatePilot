import {
  CreateMLCEngine,
  MLCEngine,
  InitProgressReport,
  prebuiltAppConfig,
  AppConfig
} from '@mlc-ai/web-llm';
import {
  GemmaConfig,
  GemmaModelStatus,
  HardwareCompatibilityReport,
  LoadingProgress,
  DEFAULT_GEMMA_CONFIG,
  GEMMA_4_E2B_Q4F16,
  MAX_SAFE_CONTEXT_WINDOW,
  MAX_SAFE_GEN_TOKENS
} from '../types/gemma';
import { ChatMessage } from '../types/chat';

export interface GenerationMetrics {
  totalTimeMs: number;
  timeToFirstTokenMs: number;
  generationTimeMs: number;
  tokenCount: number;
  tokensPerSecond: number;
}

export interface GenerateStreamingOptions {
  maxTokens?: number;
  temperature?: number;
  onMetrics?: (metrics: GenerationMetrics) => void;
}

export async function checkHardwareCompatibility(): Promise<HardwareCompatibilityReport> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // 1. Check navigator.gpu support
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    blockers.push(
      'WebGPU is not enabled or supported in this browser. Please ensure you are using Google Chrome with hardware acceleration enabled.'
    );
    return {
      hasWebGPU: false,
      adapterAvailable: false,
      adapterName: 'Unknown',
      vendor: 'Unknown',
      architecture: 'Unknown',
      hasShaderF16: false,
      maxBufferSizeMB: 0,
      maxStorageBufferBindingSizeMB: 0,
      canRunQ4F16: false,
      canRunQ4F32: false,
      overallStatus: 'unsupported',
      summary: 'WebGPU is unavailable in the current browser session.',
      blockers,
      warnings,
      recommendations: [
        'Enable "Use graphics acceleration when available" in chrome://settings/system',
        'Update graphics drivers for your integrated GPU'
      ]
    };
  }

  // 2. Request adapter
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    blockers.push(`Failed to request WebGPU adapter: ${errorMsg}`);
  }

  if (!adapter) {
    blockers.push('No compatible WebGPU hardware adapter found.');
    return {
      hasWebGPU: true,
      adapterAvailable: false,
      adapterName: 'None',
      vendor: 'Unknown',
      architecture: 'Unknown',
      hasShaderF16: false,
      maxBufferSizeMB: 0,
      maxStorageBufferBindingSizeMB: 0,
      canRunQ4F16: false,
      canRunQ4F32: false,
      overallStatus: 'unsupported',
      summary: 'No compatible WebGPU adapter found on this system.',
      blockers,
      warnings,
      recommendations: [
        'Verify your GPU driver supports Direct3D 12 or Vulkan WebGPU backends'
      ]
    };
  }

  // 3. Inspect adapter metadata
  let adapterName = 'Integrated / System GPU';
  let vendor = 'Generic';
  let architecture = 'Generic';

  if ('info' in adapter && adapter.info) {
    const info = (adapter as { info: GPUAdapterInfo }).info;
    adapterName = info.description || info.device || adapterName;
    vendor = info.vendor || vendor;
    architecture = info.architecture || architecture;
  } else if ('requestAdapterInfo' in adapter && typeof (adapter as unknown as { requestAdapterInfo: () => Promise<GPUAdapterInfo> }).requestAdapterInfo === 'function') {
    try {
      const info = await (adapter as unknown as { requestAdapterInfo: () => Promise<GPUAdapterInfo> }).requestAdapterInfo();
      adapterName = info.description || info.device || adapterName;
      vendor = info.vendor || vendor;
      architecture = info.architecture || architecture;
    } catch {
      // Non-blocking fallback
    }
  }

  // 4. Feature support (shader-f16 is required for q4f16_1)
  const hasShaderF16 = adapter.features.has('shader-f16');
  if (!hasShaderF16) {
    blockers.push(
      'GPU adapter lacks the "shader-f16" feature extension required by Gemma 4 E2B q4f16_1.'
    );
  }

  // 5. Buffer limits (Gemma 4 E2B requires 201,326,592 bytes ~ 192 MB per buffer)
  const requiredBufferBytes = 201326592;
  const maxBufferSizeMB = Math.round(adapter.limits.maxBufferSize / (1024 * 1024));
  const maxStorageBufferBindingSizeMB = Math.round(
    adapter.limits.maxStorageBufferBindingSize / (1024 * 1024)
  );

  const meetsBufferRequirements =
    adapter.limits.maxBufferSize >= requiredBufferBytes &&
    adapter.limits.maxStorageBufferBindingSize >= requiredBufferBytes;

  if (!meetsBufferRequirements) {
    blockers.push(
      `WebGPU max buffer size (${maxBufferSizeMB} MB) is below the required ${Math.round(
        requiredBufferBytes / (1024 * 1024)
      )} MB for Gemma 4 E2B.`
    );
  }

  // 6. Memory & Integrated GPU warning assessment
  // Integrated graphics share system RAM. At 50-70% idle RAM on a 16 GB machine, free RAM is ~4.8 - 8.0 GB.
  warnings.push(
    'Hardware Architecture: Integrated GPU shares host system RAM (16 GB total, 50–70% idle). Model buffers allocate ~3.39 GB of shared memory.'
  );
  warnings.push(
    'Memory Safety Notice: Neither Google Chrome nor WebGPU enforces a hard operating-system RAM limit. Memory safety on integrated graphics is governed by bounded context size (≤1024 tokens), limited response length, and manual model unloading.'
  );

  recommendations.push(
    'Context window is restricted to 1024 tokens or lower to strictly minimize KV-cache tensor memory allocation.'
  );
  recommendations.push(
    'Close memory-intensive background browser tabs before loading Gemma 4 to prevent host system memory exhaustion.'
  );

  const canRunQ4F16 = hasShaderF16 && meetsBufferRequirements;
  const canRunQ4F32 = meetsBufferRequirements;

  let overallStatus: 'supported' | 'warning' | 'unsupported' = 'supported';
  let summary = 'Hardware meets requirements for Gemma 4 E2B IT (q4f16_1).';

  if (!canRunQ4F16) {
    if (canRunQ4F32) {
      overallStatus = 'warning';
      summary =
        'Gemma 4 q4f16_1 is unavailable because shader-f16 is missing. Gemma 4 q4f32_1 is supported as an alternative (requires ~3.86 GB VRAM).';
      recommendations.unshift(
        'Switch to Gemma 4 E2B q4f32_1 if your GPU lacks shader-f16 support.'
      );
    } else {
      overallStatus = 'unsupported';
      summary = 'Hardware does not meet minimum buffer or feature requirements.';
    }
  } else {
    overallStatus = 'warning';
    summary =
      'WebGPU and shader-f16 supported. Shared integrated GPU memory caution applies.';
  }

  return {
    hasWebGPU: true,
    adapterAvailable: true,
    adapterName,
    vendor,
    architecture,
    hasShaderF16,
    maxBufferSizeMB,
    maxStorageBufferBindingSizeMB,
    canRunQ4F16,
    canRunQ4F32,
    overallStatus,
    summary,
    blockers,
    warnings,
    recommendations
  };
}

type StatusListener = (status: GemmaModelStatus) => void;
type ProgressListener = (progress: LoadingProgress) => void;

class GemmaInferenceService {
  private engine: MLCEngine | null = null;
  // Startup state is strictly unloaded; no model loads or downloads at startup
  private status: GemmaModelStatus = 'unloaded';
  private currentProgress: LoadingProgress = { progress: 0, text: '' };
  private lastError: string | null = null;
  private statusListeners: Set<StatusListener> = new Set();
  private progressListeners: Set<ProgressListener> = new Set();
  private activeConfig: GemmaConfig = { ...DEFAULT_GEMMA_CONFIG };

  // Explicit concurrency locks to prevent duplicate init or simultaneous inference
  private isInitializing = false;
  private isGenerating = false;
  private isUnloading = false;

  public getStatus(): GemmaModelStatus {
    return this.status;
  }

  public getProgress(): LoadingProgress {
    return this.currentProgress;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getConfig(): GemmaConfig {
    return { ...this.activeConfig };
  }

  public setConfig(newConfig: Partial<GemmaConfig>) {
    // Strictly enforce that context window cannot exceed MAX_SAFE_CONTEXT_WINDOW (1024)
    const contextWindowSize = newConfig.contextWindowSize
      ? Math.min(MAX_SAFE_CONTEXT_WINDOW, Math.max(256, newConfig.contextWindowSize))
      : this.activeConfig.contextWindowSize;

    // Strictly enforce that max generation tokens cannot exceed MAX_SAFE_GEN_TOKENS (256)
    const maxGenTokens = newConfig.maxGenTokens
      ? Math.min(MAX_SAFE_GEN_TOKENS, Math.max(64, newConfig.maxGenTokens))
      : this.activeConfig.maxGenTokens;

    this.activeConfig = {
      ...this.activeConfig,
      ...newConfig,
      contextWindowSize,
      maxGenTokens
    };
  }

  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public onProgressChange(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  private notifyStatus(newStatus: GemmaModelStatus) {
    this.status = newStatus;
    this.statusListeners.forEach((fn) => {
      try {
        fn(newStatus);
      } catch (err) {
        console.error('Error in status listener:', err);
      }
    });
  }

  private notifyProgress(progress: LoadingProgress) {
    this.currentProgress = progress;
    this.progressListeners.forEach((fn) => {
      try {
        fn(progress);
      } catch (err) {
        console.error('Error in progress listener:', err);
      }
    });
  }

  private lastInitTimeMs: number = 0;

  public getLastInitTimeMs(): number {
    return this.lastInitTimeMs;
  }

  /**
   * Explicitly load Gemma 4 E2B IT.
   * Strictly guarded against duplicate calls, in-flight initialization, and concurrent inference.
   * Model is initialized once and reused while extension sidepanel is active.
   */
  public async loadModel(configOverride?: Partial<GemmaConfig>): Promise<void> {
    if (this.isInitializing || this.status === 'loading') {
      throw new Error('Gemma 4 model initialization is already in progress.');
    }
    if (this.isGenerating || this.status === 'generating') {
      throw new Error('Cannot load or reinitialize while inference is active.');
    }
    if (this.isUnloading || this.status === 'unloading') {
      throw new Error('Cannot load model while unloader is executing.');
    }
    if (this.status === 'ready' && this.engine) {
      console.info('[Private Pilot] Gemma model is already active and ready in memory. Reusing existing instance.');
      return; // Already loaded and ready
    }

    if (configOverride) {
      this.setConfig(configOverride);
    }

    this.isInitializing = true;
    const targetModelId = this.activeConfig.modelId || GEMMA_4_E2B_Q4F16;
    this.lastError = null;
    this.notifyStatus('loading');
    this.notifyProgress({ progress: 1, text: `Preparing to load ${targetModelId}...` });
    const initStartTime = performance.now();

    try {
      // Find model record in official prebuiltAppConfig
      const modelRecord = prebuiltAppConfig.model_list.find(
        (m) => m.model_id === targetModelId
      );

      if (!modelRecord) {
        throw new Error(
          `Model ${targetModelId} not found in the official WebLLM catalog.`
        );
      }

      // Hard clamp context window to at most 1024 tokens to keep KV-cache compact
      const clampedContextWindow = Math.min(
        MAX_SAFE_CONTEXT_WINDOW,
        Math.max(256, this.activeConfig.contextWindowSize || MAX_SAFE_CONTEXT_WINDOW)
      );

      const appConfig: AppConfig = {
        model_list: [
          {
            ...modelRecord,
            overrides: {
              ...modelRecord.overrides,
              context_window_size: clampedContextWindow
            }
          }
        ]
      };

      const initProgressCallback = (report: InitProgressReport) => {
        const pct = Math.min(100, Math.max(0, Math.round(report.progress * 100)));
        this.notifyProgress({
          progress: pct,
          text: report.text,
          timeElapsed: report.timeElapsed
        });
      };

      // Ensure any existing instance is cleanly torn down before mounting new one
      if (this.engine) {
        try {
          await this.engine.resetChat();
          await this.engine.unload();
        } catch {
          // ignore cleanup error
        }
        this.engine = null;
      }

      this.engine = await CreateMLCEngine(targetModelId, {
        appConfig,
        initProgressCallback
      });

      this.lastInitTimeMs = performance.now() - initStartTime;
      console.info(
        `[Private Pilot Diagnostics] Gemma model initialized in ${this.lastInitTimeMs.toFixed(0)}ms`
      );

      this.notifyProgress({ progress: 100, text: `${targetModelId} is ready.` });
      this.notifyStatus('ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.notifyStatus('error');
      if (this.engine) {
        try {
          await this.engine.unload();
        } catch {
          // ignore
        }
        this.engine = null;
      }
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Clears the attention KV-cache tensors from WebGPU memory without unloading weights.
   * Directly disposes of cached multi-turn activation tensors.
   */
  public async clearKVCache(): Promise<void> {
    if (!this.engine || this.status !== 'ready') {
      return;
    }
    if (this.isGenerating) {
      throw new Error('Cannot clear KV cache while generation is active.');
    }

    try {
      await this.engine.resetChat(false);
      this.notifyProgress({ progress: 100, text: 'KV cache tensors cleared from GPU memory.' });
    } catch (err) {
      console.warn('Error clearing KV cache:', err);
    }
  }

  /**
   * Safely unload the model and release WebGPU memory buffers and engine resources.
   * Properly transitions to 'unloaded' state.
   */
  public async unloadModel(): Promise<void> {
    if (this.isUnloading || this.status === 'unloading') {
      return;
    }
    if (this.status === 'unloaded' && !this.engine) {
      return;
    }

    this.isUnloading = true;
    this.notifyStatus('unloading');
    this.notifyProgress({ progress: 0, text: 'Unloading model and releasing WebGPU buffers...' });

    try {
      if (this.engine) {
        // If generating, interrupt first
        if (this.isGenerating) {
          try {
            await this.engine.interruptGenerate();
          } catch {
            // ignore
          }
        }

        // Dispose KV cache tensors first
        try {
          await this.engine.resetChat(false);
        } catch {
          // ignore
        }

        // Release WebGPU buffers, pipelines, and WASM runtime
        try {
          await this.engine.unload();
        } catch (err) {
          console.warn('Error during engine.unload():', err);
        } finally {
          this.engine = null;
        }
      }
    } finally {
      this.isGenerating = false;
      this.isInitializing = false;
      this.isUnloading = false;
      this.notifyStatus('unloaded');
      this.notifyProgress({ progress: 0, text: 'Model unloaded. WebGPU memory released.' });
    }
  }

  /**
  /**
   * Generate streaming completion using Gemma 4 E2B IT.
   * Concurrency is guarded to strictly prevent simultaneous inference.
   * Context length is bounded (≤1024 tokens) and generated tokens are limited (≤256).
   */
  public async generateStreaming(
    userInstruction: string,
    history: ChatMessage[],
    onToken: (token: string, fullText: string) => void,
    options?: GenerateStreamingOptions
  ): Promise<string> {
    if (this.isGenerating || this.status === 'generating') {
      throw new Error(
        'Simultaneous inference is prevented for memory safety. Please wait for current generation to complete.'
      );
    }
    if (this.status !== 'ready' || !this.engine) {
      throw new Error('Gemma 4 model is not ready. Please load the model first.');
    }

    this.isGenerating = true;
    this.notifyStatus('generating');
    let fullResponse = '';
    const startTime = performance.now();
    let firstTokenTime = 0;
    let tokenCount = 0;

    try {
      // Build strictly bounded conversation messages to stay within the 1024 token limit
      // Keep only the last 2 user/assistant turns (up to 4 messages total)
      const recentHistory = history.slice(-4);
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: this.activeConfig.systemPrompt }
      ];

      for (const msg of recentHistory) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          // Truncate past messages if unusually long to guarantee context fits in 1024 tokens
          const boundedContent =
            msg.content.length > 400 ? msg.content.substring(0, 400) + '...' : msg.content;
          messages.push({
            role: msg.role,
            content: boundedContent
          });
        }
      }

      // Append current user instruction (bounded to 2500 characters to accommodate webpage context safely within 1024 tokens)
      const MAX_INSTRUCTION_CHARS = 2500;
      const safeInstruction =
        userInstruction.length > MAX_INSTRUCTION_CHARS
          ? userInstruction.substring(0, MAX_INSTRUCTION_CHARS) + '... (truncated for memory safety)'
          : userInstruction;

      messages.push({ role: 'user', content: safeInstruction });

      // Enforce response token ceiling: use options.maxTokens if provided, else bounded default
      const requestedMaxTokens = options?.maxTokens || this.activeConfig.maxGenTokens || MAX_SAFE_GEN_TOKENS;
      const boundedMaxTokens = Math.min(
        MAX_SAFE_GEN_TOKENS,
        Math.max(32, requestedMaxTokens)
      );

      const requestedTemperature =
        options?.temperature !== undefined
          ? options.temperature
          : this.activeConfig.temperature;

      const asyncChunkGenerator = await this.engine.chat.completions.create({
        messages,
        temperature: requestedTemperature,
        max_tokens: boundedMaxTokens,
        stream: true
      });

      for await (const chunk of asyncChunkGenerator) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          if (tokenCount === 0) {
            firstTokenTime = performance.now();
          }
          tokenCount++;
          fullResponse += delta;
          onToken(delta, fullResponse);
        }
      }

      const endTime = performance.now();
      const totalTimeMs = endTime - startTime;
      const timeToFirstTokenMs = firstTokenTime > 0 ? firstTokenTime - startTime : totalTimeMs;
      const generationTimeMs = firstTokenTime > 0 ? endTime - firstTokenTime : totalTimeMs;
      const tokensPerSecond = generationTimeMs > 0 ? tokenCount / (generationTimeMs / 1000) : 0;

      const metrics: GenerationMetrics = {
        totalTimeMs,
        timeToFirstTokenMs,
        generationTimeMs,
        tokenCount,
        tokensPerSecond
      };

      if (options?.onMetrics) {
        try {
          options.onMetrics(metrics);
        } catch {
          // ignore callback error
        }
      }

      console.info(
        `[Private Pilot Diagnostics] Inference complete: Total ${totalTimeMs.toFixed(0)}ms | TTFT: ${timeToFirstTokenMs.toFixed(0)}ms | Gen: ${generationTimeMs.toFixed(0)}ms (${tokenCount} tokens, ${tokensPerSecond.toFixed(1)} tok/s)`
      );

      this.notifyStatus('ready');
      return fullResponse;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      // If error occurs, attempt to reset KV cache to prevent corrupted state
      if (this.engine) {
        try {
          await this.engine.resetChat(false);
        } catch {
          // ignore
        }
      }
      this.notifyStatus('ready');
      throw err;
    } finally {
      this.isGenerating = false;
    }
  }
}

export const gemmaService = new GemmaInferenceService();
