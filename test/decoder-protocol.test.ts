// SPDX-License-Identifier: Apache-2.0
import type { FrameMessage } from '../src/decoder-protocol.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { FrameReader, FrameWriter } from '../src/decoder-protocol.js';

test('binary transport preserves pixels across fragmented and coalesced frames', async () => {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const writer = new FrameWriter(stream);
  const pixels = Uint8Array.from({ length: 4096 }, (_, index) => index % 256);
  await Promise.all([
    writer.send({ id: 1, result: { width: 32, height: 32, bytes: pixels } }),
    writer.send({ id: 2, error: 'invalid image' }),
    writer.send({ id: 3, result: { format: 'PNG' } }),
  ]);
  const data = Buffer.concat(chunks);
  for (const size of [1, 7, 65536]) {
    const messages: FrameMessage[] = [];
    const reader = new FrameReader((message) => messages.push(message));
    for (let offset = 0; offset < data.length; offset += size) {
      reader.feed(data.subarray(offset, offset + size));
    }
    assert.deepEqual(
      messages.map((m) => m.id),
      [1, 2, 3],
    );
    assert.ok(messages[0].result?.bytes);
    assert.deepEqual([...messages[0].result.bytes], [...pixels]);
    assert.equal(messages[1].error, 'invalid image');
    assert.equal(messages[2].result?.format, 'PNG');
  }
});

test('oversized decoder frames are rejected before allocating the payload', () => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(140000001, 4);
  assert.throws(() => new FrameReader(() => {}).feed(header), /message size/);
});
