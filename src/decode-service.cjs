const { Worker } = require('node:worker_threads');
const path = require('node:path');
class DecodeService {
  constructor() {
    this.queue = []; this.pending = new Map(); this.next = 0; this.active = 0; this.closed = false;
    this.worker = new Worker(path.join(__dirname, 'decode-worker.cjs'));
    this.worker.on('message', ({ id, result, error }) => {
      const task = this.pending.get(id);
      if (!task) return;
      this.pending.delete(id); this.active--;
      error ? task.reject(new Error(error)) : task.resolve(result);
      this.drain();
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => { if (!this.closed) this.fail(new Error(`Image worker stopped (${code}). Restart the viewer.`)); });
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
    while (this.active < 2 && this.queue.length) {
      const task = this.queue.shift(); this.active++; this.pending.set(task.id, task);
      this.worker.postMessage({ id: task.id, method: task.method, args: task.args });
    }
  }
  close() { this.fail(new Error('Viewer closed.')); return this.worker.terminate(); }
}
module.exports = { DecodeService };
