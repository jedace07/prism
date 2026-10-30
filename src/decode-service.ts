// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FrameReader, FrameWriter } from './decoder-protocol.js';
import type { DecoderMethods } from './types.js';

export function getRuntimePath(): string {
  if (process.env.PRISM_DECODER_RUNTIME) {
    return process.env.PRISM_DECODER_RUNTIME;
  }
  const bundled = path.join(
    __dirname,
    '..',
    'runtime',
    process.platform === 'win32' ? 'bun.exe' : 'bun',
  );
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  if (process.versions.bun) {
    return process.execPath;
  }
  throw new Error(
    'Decoder runtime is missing. Start development with bun run start, or rebuild the application package.',
  );
}
interface Task {
  id: number;
  method: keyof DecoderMethods;
  args: unknown[];
  resolve(value: unknown): void;
  reject(error: unknown): void;
}
export class DecodeService {
  private queue: Task[] = [];
  private pending = new Map<number, Task>();
  private next = 0;
  private active = 0;
  private closed = false;
  private exited = false;
  private stderr = '';
  private worker: ChildProcessWithoutNullStreams;
  private writer: FrameWriter;
  constructor() {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // Source tests run directly in Bun; packaged applications use emitted JS.
    const worker = path.join(
      __dirname,
      fs.existsSync(path.join(__dirname, 'decode-worker.ts'))
        ? 'decode-worker.ts'
        : 'decode-worker.js',
    );
    this.worker = spawn(getRuntimePath(), [worker], {
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.writer = new FrameWriter(this.worker.stdin);
    const reader = new FrameReader(({ id, result, error }) => {
      const task = this.pending.get(id);
      if (!task) {
        return;
      }
      this.pending.delete(id);
      this.active--;
      error ? task.reject(new Error(error)) : task.resolve(result);
      this.drain();
    });
    this.worker.stdout.on('data', (chunk: Buffer) => {
      try {
        reader.feed(chunk);
      } catch (error) {
        this.fail(error);
        this.worker.kill();
      }
    });
    this.worker.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-8192);
    });
    this.worker.stdin.on('error', (error) => this.fail(error));
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('close', (code, signal) => {
      this.exited = true;
      if (!this.closed) {
        this.fail(
          new Error(
            `Image decoder stopped (${signal || code}). ${this.stderr.trim()} Restart the viewer.`,
          ),
        );
      }
    });
  }
  private fail(error: unknown): void {
    this.closed = true;
    for (const task of [...this.pending.values(), ...this.queue]) {
      task.reject(error);
    }
    this.pending.clear();
    this.queue = [];
  }
  request<M extends keyof DecoderMethods>(
    method: M,
    ...args: DecoderMethods[M]['args']
  ): Promise<DecoderMethods[M]['result']> {
    if (this.closed) {
      return Promise.reject(new Error('Image decoder is unavailable. Restart the viewer.'));
    }
    return new Promise((resolve, reject) => {
      const task: Task = {
        id: ++this.next,
        method,
        args,
        resolve: (value) => resolve(value as DecoderMethods[M]['result']),
        reject,
      };
      if (method === 'decode' && (args[1] as { thumbnail?: boolean } | undefined)?.thumbnail) {
        this.queue.push(task);
      } else {
        this.queue.unshift(task);
      }
      this.drain();
    });
  }
  private drain(): void {
    while (!this.closed && this.active < 2 && this.queue.length) {
      const task = this.queue.shift();
      if (!task) {
        break;
      }
      this.active++;
      this.pending.set(task.id, task);
      this.writer
        .send({ id: task.id, method: task.method, args: task.args })
        .catch((error) => this.fail(error));
    }
  }
  close(): Promise<void> {
    if (this.exited) {
      return Promise.resolve();
    }
    const done = new Promise<void>((resolve) => this.worker.once('close', () => resolve()));
    this.fail(new Error('Viewer closed.'));
    this.worker.kill();
    return done;
  }
}
