// Bun owns decoding and stdin polling; Electron never loads a native image addon.
const decoder = require('./decoder.cjs');
const { FrameReader, FrameWriter } = require('./decoder-protocol.cjs');
const writer = new FrameWriter(process.stdout);
const methods = new Set(['decode', 'probe', 'capabilities', 'verify']);
const jobs = new Set();
const fatal = error => { console.error(error.message); process.exit(1); };
async function handle({ id, method, args }) {
  let response;
  try {
    if (!methods.has(method) || !Array.isArray(args)) throw new Error('Invalid decoder request.');
    const result = method === 'verify' ? await require('./verify-codecs.cjs').verify() : await decoder[method](...args);
    response = { id, result };
  } catch (error) { response = { id, error: error.message }; }
  await writer.send(response);
}
const reader = new FrameReader(message => {
  const job = handle(message); jobs.add(job);
  job.then(() => jobs.delete(job), fatal);
});
async function main() {
  for await (const chunk of Bun.stdin.stream()) reader.feed(Buffer.from(chunk));
  await Promise.all(jobs); await writer.pending;
}
main().catch(fatal);
process.stdout.on('error', fatal);
