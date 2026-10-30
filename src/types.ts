// SPDX-License-Identifier: Apache-2.0
/** Shared contracts for the isolated renderer, Electron main, and Bun decoder. */
export interface ImageFile { id: string; name: string; extension: string }
export interface Selection { files: ImageFile[]; index: number; directory: string }
export interface DecodeOptions { page?: number; maxEdge?: number; thumbnail?: boolean }
export interface ImageMetadata {
  format: string; width: number; height: number; pages: number; depth: number;
  space: string; alpha?: boolean | null; profile: string; decoder: string;
  delay: number[]; loop: number;
}
export interface Preview {
  browser?: false; bytes: Uint8Array<ArrayBuffer> | null; encoding: 'png';
  width: number; height: number; reduced: boolean; metadata: ImageMetadata;
}
export interface BrowserFallback { browser: true; reason: string }
export type DecodeResult = Preview | BrowserFallback;
export interface FileDetails { name: string; path: string; size: number; modified: string }
export type FileResult = DecodeResult & { file: FileDetails };
export type DisplayResult = Preview & { file: FileDetails };
export interface Capabilities { engine: string; version: string; platform: string; backend: string; native: string[]; system: string[] }
export interface GPUInfo {
  features: Record<string, string>;
  info: { auxAttributes?: { softwareRendering?: boolean }; [key: string]: unknown };
  allowSoftware: boolean; experimentalWebGPU: boolean; smoke: boolean; electron?: string; chromium?: string;
}
export interface VerifyReport extends Capabilities { passed: boolean; checks: string[]; runtime?: string; bytes?: Uint8Array<ArrayBuffer> }
export interface DecoderMethods {
  decode: { args: [file: string, options?: DecodeOptions]; result: DecodeResult };
  probe: { args: [file: string]; result: ImageMetadata };
  capabilities: { args: []; result: Capabilities };
  verify: { args: []; result: VerifyReport };
}
export interface ViewerAPI {
  initial(): Promise<Selection | null>;
  open(folder?: boolean): Promise<Selection | null>;
  openDropped(files: File[]): Promise<Selection | null>;
  decode(id: string, options?: DecodeOptions): Promise<FileResult>;
  thumbnail(id: string): Promise<Uint8Array<ArrayBuffer> | { browser: true }>;
  original(id: string): Promise<Uint8Array<ArrayBuffer> | null>;
  capabilities(): Promise<Capabilities>;
  gpu(): Promise<GPUInfo>;
  fullscreen(): Promise<boolean>;
  reveal(id: string): Promise<void>;
  onSelection(callback: (selection: Selection | null) => void): () => void;
  onError(callback: (error: string) => void): () => void;
  onFullscreen(callback: (enabled: boolean) => void): () => void;
  onDiagnostics(callback: () => void): () => void;
}
declare global { interface Window { viewer: ViewerAPI } }

export interface RendererInfo { api: 'WebGPU'; renderer: string; vendor: string; software: boolean; maxTextureSize: number }
export interface RendererProbe {
  info(): RendererInfo;
  pixel(x: number, y: number): Promise<number[]>;
  transform(): { pan: { x: number; y: number }; scale: number; rotation: number; nearest: boolean };
  loseDevice(): void;
}
declare global { interface Window { prismTest?: RendererProbe } }
