// Opt-in CI verification. Run with Electron's embedded Node in the Flatpak runtime.
// This exercises the actual packaged codecs without requiring a display or GPU.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { capabilities, decode, run } = require('./decoder.cjs');

async function verify() {
  const report = await capabilities();
  assert.ok(report.magick, 'The Flatpak must bundle ImageMagick 7.');
  const names = new Set(report.formats.map(format => format.name));
  for (const required of ['JXL', 'HEIC', 'EXR', 'CR3', 'PDF', 'PSD', 'JP2']) {
    assert.ok(names.has(required), `Missing ImageMagick reader: ${required}`);
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-package-'));
  const checks = [];
  try {
    const png = path.join(temp, 'source.png');
    await sharp({ create: { width: 48, height: 32, channels: 4, background: '#ff0000' } }).png().toFile(png);
    const first = await decode(png);
    assert.equal(first.width, 48); assert.equal(first.height, 32);
    assert.deepEqual([...first.bytes.subarray(0, 4)], [255, 0, 0, 255]);
    checks.push('Bundled Sharp loads and decodes RGBA correctly');

    for (const extension of ['jxl', 'exr', 'psd', 'jp2', 'qoi', 'pdf']) {
      const file = path.join(temp, `sample.${extension}`);
      await run(process.env.PRISM_MAGICK || 'magick', ['-size', '48x32', 'xc:red', file]);
      const image = await decode(file);
      assert.ok(Math.abs(image.width / image.height - 1.5) < .05, `Incorrect ${extension} dimensions`);
      assert.equal(image.bytes.length, image.width * image.height * 4);
      assert.ok(image.bytes[0] > 245 && image.bytes[1] < 10 && image.bytes[2] < 10, `Incorrect ${extension} pixels`);
      checks.push(`${extension.toUpperCase()} conversion and decoding`);
    }
    console.log(JSON.stringify({ passed: true, checks, ...report }, null, 2));
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
