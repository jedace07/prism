// Keep native codecs in a pure Bun process, outside Electron's GLib symbol space.
const decoder = require('./decoder.cjs');
const { FrameReader, FrameWriter } = require('./decoder-protocol.cjs');
const writer = new FrameWriter(process.stdout);
const methods = new Set(['decode', 'probe', 'capabilities', 'verify']);
const fatal = error => { console.error(error.message); process.exit(1); };
const reader = new FrameReader(async ({ id, method, args }) => {
  let response;
  try {
    if (!methods.has(method) || !Array.isArray(args)) throw new Error('Invalid decoder request.');
    const result = method === 'verify' ? await require('./verify-codecs.cjs').verify() : await decoder[method](...args);
    response = { id, result };
  } catch (error) { response = { id, error: error.message }; }
  writer.send(response).catch(fatal);
});
process.stdin.on('data', chunk => { try { reader.feed(chunk); } catch (error) { fatal(error); } });
process.stdin.on('end', () => process.exit(0));
process.stdout.on('error', fatal);
