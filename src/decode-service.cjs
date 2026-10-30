const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { FrameReader, FrameWriter } = require('./decoder-protocol.cjs');

function getRuntimePath() {
  if (process.env.PRISM_DECODER_RUNTIME) return process.env.PRISM_DECODER_RUNTIME;
  const bundled = path.join(__dirname, '..', 'runtime', process.platform === 'win32' ? 'bun.exe' : 'bun');
  if (fs.existsSync(bundled)) return bundled;
  if (process.versions.bun) return process.execPath;
  throw new Error('Decoder runtime is missing. Start development with bun run start, or rebuild the application package.');
}

class DecodeService {
  constructor() {
    this.queue = []; this.pending = new Map(); this.next = 0; this.active = 0; this.closed = false; this.exited = false; this.stderr = '';
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    this.worker = spawn(getRuntimePath(), [path.join(__dirname, 'decode-worker.cjs')], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.writer = new FrameWriter(this.worker.stdin);
    const reader = new FrameReader(({ id, result, error }) => {
      const task = this.pending.get(id);
      if (!task) return;
      this.pending.delete(id); this.active--;
      error ? task.reject(new Error(error)) : task.resolve(result);
      this.drain();
    });
    this.worker.stdout.on('data', chunk => {
      try { reader.feed(chunk); } catch (error) { this.fail(error); this.worker.kill(); }
    });
    this.worker.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-8192); });
    this.worker.stdin.on('error', error => this.fail(error));
    this.worker.on('error', error => this.fail(error));
    this.worker.on('close', (code, signal) => {
      this.exited = true;
      if (!this.closed) this.fail(new Error(`Image decoder stopped (${signal || code}). ${this.stderr.trim()} Restart the viewer.`));
    });
  }
  fail(error) {
    this.closed = true;
    for (const task of [...this.pending.values(), ...this.queue]) task.reject(error);
    this.pending.clear(); this.queue = [];
  }
  request(method, ...args) {
    if (this.closed) return Promise.reject(new Error('Image decoder is unavailable. Restart the viewer.'));
    return new Promise((resolve, reject) => {
      const task = { id: ++this.next, method, args, resolve, reject };
      if (args[1]?.thumbnail) this.queue.push(task); else this.queue.unshift(task);
      this.drain();
    });
  }
  drain() {
    while (!this.closed && this.active < 2 && this.queue.length) {
      const task = this.queue.shift(); this.active++; this.pending.set(task.id, task);
      this.writer.send({ id: task.id, method: task.method, args: task.args }).catch(error => this.fail(error));
    }
  }
  close() {
    if (this.exited) return Promise.resolve();
    const done = new Promise(resolve => this.worker.once('close', resolve));
    this.fail(new Error('Viewer closed.')); this.worker.kill();
    return done;
  }
}
module.exports = { DecodeService, getRuntimePath };
