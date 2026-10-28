interface GPUAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

interface GPUSupportedFeatures {
  has(name: string): boolean;
  forEach(callbackfn: (value: string, key: string, parent: GPUSupportedFeatures) => void): void;
}

interface GPUSupportedLimits {
  readonly maxBufferSize: number;
  readonly maxStorageBufferBindingSize: number;
  readonly maxComputeWorkgroupStorageSize?: number;
}

interface GPUAdapter {
  readonly features: GPUSupportedFeatures;
  readonly limits: GPUSupportedLimits;
  readonly isFallbackAdapter?: boolean;
  readonly info?: GPUAdapterInfo;
  requestAdapterInfo?(): Promise<GPUAdapterInfo>;
  requestDevice?(descriptor?: unknown): Promise<unknown>;
}

interface GPU {
  requestAdapter(options?: unknown): Promise<GPUAdapter | null>;
  getPreferredCanvasFormat?(): string;
}

interface Navigator {
  readonly gpu?: GPU;
  readonly deviceMemory?: number;
}
