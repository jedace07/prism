// SPDX-License-Identifier: Apache-2.0
import type { FrameMessage } from './decoder-protocol.js';
import type { DecodeOptions, DecoderMethods } from './types.js';
// Bun owns decoding and stdin polling; Electron never loads a native image addon.
import * as decoder from './decoder.js';
import { FrameReader, FrameWriter } from './decoder-protocol.js';
const writer = new FrameWriter(process.stdout);
const methods = new Set(['decode', 'probe', 'capabilities']);
const jobs = new Set<Promise<void>>();
const fatal = (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
};
async function handle({ id, method, args }: FrameMessage) {
  let response: FrameMessage;
  try {
    if (!methods.has(method || '') || !Array.isArray(args)) {
      throw new Error('Invalid decoder request.');
    }
    let result: DecoderMethods[keyof DecoderMethods]['result'];
    switch (method) {
      case 'decode':
        result = await decoder.decode(args[0] as string, args[1] as DecodeOptions | undefined);
        break;
      case 'probe':
        result = await decoder.probe(args[0] as string);
        break;
      case 'capabilities':
        result = await decoder.capabilities();
        break;
      default:
        throw new Error('Invalid decoder request.');
    }
    response = { id, result: { ...result } };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  await writer.send(response);
}
const reader = new FrameReader((message) => {
  const job = handle(message);
  jobs.add(job);
  job.then(() => jobs.delete(job), fatal);
});
async function main() {
  for await (const chunk of Bun.stdin.stream()) {
    reader.feed(Buffer.from(chunk));
  }
  await Promise.all(jobs);
  await writer.pending;
}
main().catch(fatal);
process.stdout.on('error', fatal);
