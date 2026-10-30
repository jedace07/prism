// SPDX-License-Identifier: Apache-2.0
// Run with Electron's embedded Node; native codecs stay in the Bun subprocess.
import assert from 'node:assert/strict';
import { DecodeService } from './decode-service.js';
import { readPNG } from './test-images.js';
async function verify() {
  const service = new DecodeService();
  try {
    const [report, capabilities] = await Promise.all([
      service.request('verify'),
      service.request('capabilities'),
    ]);
    assert.ok(report.bytes);
    const decoded = readPNG(report.bytes);
    assert.deepEqual([...decoded.bytes.subarray(0, 4)], [255, 0, 0, 255]);
    assert.equal(decoded.width, 48);
    assert.equal(decoded.height, 32);
    assert.equal(capabilities.engine, 'Bun.Image');
    delete report.bytes;
    report.checks.push('Electron main process to bundled Bun decoder PNG transport');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await service.close();
  }
}
if (require.main === module) {
  verify().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
export { verify };
