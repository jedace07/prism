// Run with Electron's embedded Node; native codecs stay in the Bun subprocess.
const assert = require('node:assert/strict');
const { DecodeService } = require('./decode-service.cjs');
async function verify() {
  const service = new DecodeService();
  try {
    const [report, capabilities] = await Promise.all([service.request('verify'), service.request('capabilities')]);
    assert.deepEqual([...report.bytes.subarray(0, 4)], [255, 0, 0, 255]);
    assert.equal(report.bytes.length, 48 * 32 * 4);
    assert.ok(capabilities.magick);
    delete report.bytes;
    report.checks.push('Electron main process to bundled Bun decoder binary transport');
    console.log(JSON.stringify(report, null, 2));
  } finally { await service.close(); }
}
if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
