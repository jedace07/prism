// SPDX-License-Identifier: Apache-2.0
import type { Preview, VerifyReport } from '../../src/types.js';
// Runs only in the bundled Bun decoder, without external image libraries/tools.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { capabilities, decode } from '../../src/decoder.js';
import { png, readPNG, bmp, gif, orientJPEG } from './test-images.js';
async function verify(): Promise<VerifyReport> {
  const report = await capabilities();
  assert.equal(report.engine, 'Bun.Image');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-package-')),
    checks = [];
  try {
    const input = png(48, 32, [255, 0, 0, 255]);
    let first: Preview | undefined;
    const samples: [string, Uint8Array, number, number][] = [
      ['png', input, 48, 32],
      ['jpeg', await new Bun.Image(input).jpeg({ quality: 95 }).buffer(), 48, 32],
      ['webp', await new Bun.Image(input).webp({ lossless: true }).buffer(), 48, 32],
      ['bmp', bmp(48, 32), 48, 32],
      ['gif', gif(), 2, 2],
      [
        'oriented.jpeg',
        orientJPEG(await new Bun.Image(input).jpeg({ quality: 95 }).buffer()),
        32,
        48,
      ],
    ];
    for (const [name, bytes, width, height] of samples) {
      console.error(`[verify] Bun.Image ${name}`);
      const file = path.join(temp, name);
      await fs.writeFile(file, bytes);
      const result = await decode(file);
      assert.ok(!result.browser && result.bytes);
      const decoded = readPNG(result.bytes);
      assert.equal(decoded.width, width);
      assert.equal(decoded.height, height);
      assert.ok(
        decoded.bytes[0] > 245 && decoded.bytes[1] < 10 && decoded.bytes[2] < 10,
        `Incorrect ${name} pixels`,
      );
      first ||= result;
      checks.push(`${name}: dimensions and pixel colors`);
    }
    const alpha = path.join(temp, 'alpha.png');
    await fs.writeFile(alpha, png(4, 2, [240, 20, 40, 128]));
    const alphaResult = await decode(alpha);
    assert.ok(!alphaResult.browser && alphaResult.bytes);
    assert.deepEqual([...readPNG(alphaResult.bytes).bytes.subarray(0, 4)], [240, 20, 40, 128]);
    checks.push('PNG alpha preservation');
    assert.ok(first?.bytes);
    return { passed: true, checks, ...report, runtime: process.versions.bun, bytes: first.bytes };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
export { verify };
