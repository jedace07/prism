const { parentPort } = require('node:worker_threads');
const decoder = require('./decoder.cjs');
parentPort.on('message', async ({ id, method, args }) => {
  try {
    const result = await decoder[method](...args);
    if (result.bytes) {
      // Transfer owned storage, never a pooled Node Buffer's entire slab.
      result.bytes = new Uint8Array(result.bytes);
      parentPort.postMessage({ id, result }, [result.bytes.buffer]);
    } else parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
