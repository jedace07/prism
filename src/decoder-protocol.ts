// SPDX-License-Identifier: Apache-2.0
import type { Writable } from 'node:stream';
export interface FrameMessage { id: number; method?: string; args?: unknown[]; error?: string; result?: { bytes?: Uint8Array | null; [key: string]: unknown } }
const MAX_JSON = 2 * 1024 * 1024;
const MAX_BYTES = 140_000_000;

// Length-prefixed metadata and encoded image bytes avoid base64 and per-byte JSON.
class FrameReader {
  private header!: Buffer;
  private headerOffset!: number;
  private json: Buffer | null = null;
  private jsonOffset = 0;
  private bytes: Buffer | null = null;
  private bytesOffset = 0;
  private onMessage: (message: FrameMessage) => void;
  constructor(onMessage: (message: FrameMessage) => void) { this.onMessage = onMessage; this.reset(); }
  reset() { this.header = Buffer.alloc(8); this.headerOffset = 0; this.json = null; this.jsonOffset = 0; this.bytes = null; this.bytesOffset = 0; }
  feed(chunk: Buffer) {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.headerOffset < 8) {
        const length = Math.min(8 - this.headerOffset, chunk.length - offset);
        chunk.copy(this.header, this.headerOffset, offset, offset + length); offset += length; this.headerOffset += length;
        if (this.headerOffset < 8) continue;
        const jsonLength = this.header.readUInt32BE(0), bytesLength = this.header.readUInt32BE(4);
        if (!jsonLength || jsonLength > MAX_JSON || bytesLength > MAX_BYTES) throw new Error('Invalid decoder message size.');
        this.json = Buffer.allocUnsafe(jsonLength); this.bytes = Buffer.allocUnsafe(bytesLength);
      }
      if (this.jsonOffset < this.json!.length) {
        const length = Math.min(this.json!.length - this.jsonOffset, chunk.length - offset);
        chunk.copy(this.json!, this.jsonOffset, offset, offset + length); offset += length; this.jsonOffset += length;
        if (this.jsonOffset < this.json!.length) continue;
      }
      if (this.bytesOffset < this.bytes!.length) {
        const length = Math.min(this.bytes!.length - this.bytesOffset, chunk.length - offset);
        chunk.copy(this.bytes!, this.bytesOffset, offset, offset + length); offset += length; this.bytesOffset += length;
        if (this.bytesOffset < this.bytes!.length) continue;
      }
      const message = JSON.parse(this.json!.toString('utf8'));
      if (this.bytes!.length) {
        if (!message.result) throw new Error('Unexpected decoder pixel data.');
        message.result.bytes = this.bytes;
      }
      this.reset(); this.onMessage(message);
    }
  }
}

class FrameWriter {
  stream: Writable;
  pending: Promise<void>;
  constructor(stream: Writable) { this.stream = stream; this.pending = Promise.resolve(); }
  send(message: FrameMessage) {
    const pixels = message.result?.bytes;
    const bytes = pixels ? Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength) : Buffer.alloc(0);
    const body = pixels ? { ...message, result: { ...message.result, bytes: undefined } } : message;
    const json = Buffer.from(JSON.stringify(body));
    if (json.length > MAX_JSON || bytes.length > MAX_BYTES) return Promise.reject(new Error('Decoder message exceeds its size limit.'));
    const header = Buffer.alloc(8); header.writeUInt32BE(json.length, 0); header.writeUInt32BE(bytes.length, 4);
    const write = (data: Uint8Array) => new Promise<void>((resolve, reject) => this.stream.write(data, error => error ? reject(error) : resolve()));
    this.pending = this.pending.then(async () => { await write(header); await write(json); if (bytes.length) await write(bytes); });
    return this.pending;
  }
}
export { FrameReader, FrameWriter };
