const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { decode, probe, capabilities, targetSize, run } = require('../src/decoder.cjs');
const { isImage, parseMagickFormats } = require('../src/formats.cjs');
const { DecodeService } = require('../src/decode-service.cjs');
let temp, source, hasMagick;
before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-test-'));
  source = path.join(temp, 'source.png');
  await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 240, g: 20, b: 40, alpha: .5 } } }).png().toFile(source);
  hasMagick = !!(await capabilities()).magick;
});
after(async () => { await fs.rm(temp, { recursive: true, force: true }); });

test('dimension limits preserve aspect ratio and enforce both texture and pixel budgets', () => {
  assert.deepEqual(targetSize(40000, 20000, 4096), { width: 4096, height: 2048, reduced: true });
  const target = targetSize(16000, 16000, 16384);
  assert.ok(target.width * target.height <= 32000000);
  assert.throws(() => targetSize(0, 100));
  assert.throws(() => targetSize(1000000, 1000000));
  assert.equal(targetSize(64, 32).reduced, false);
});
test('format discovery distinguishes readers and blocks instruction / URL coders', () => {
  const formats = parseMagickFormats('     JPEG* JPEG rw- JPEG image\n      JXL* JXL rw+ JPEG XL\n      PNG* PNG -w- Writer\n     HTTPS* URL r-- Remote URL\n      MSL MSL r-- Script');
  assert.deepEqual(formats.map(f => f.name), ['JPEG', 'JXL']);
  for (const name of ['a.JXL', 'a.HEIC', 'a.CR3', 'a.exr', 'a.psd', 'a.dcm']) assert.ok(isImage(name));
  assert.equal(isImage('a.js'), false);
});
test('PNG decode supplies exact straight-alpha RGBA and thumbnails are bounded PNGs', async () => {
  const result = await decode(source);
  assert.equal(result.bytes.length, 64 * 32 * 4);
  assert.deepEqual([...result.bytes.subarray(0, 4)], [240, 20, 40, 128]);
  assert.equal(result.metadata.alpha, true);
  const small = await decode(source, { maxEdge: 16 });
  assert.equal(small.width, 16); assert.equal(small.height, 8); assert.equal(small.reduced, true);
  const thumb = await decode(source, { thumbnail: true });
  assert.equal((await sharp(thumb.bytes).metadata()).format, 'png');
});
test('EXIF rotation is applied to both raster and reported dimensions', async () => {
  const file = path.join(temp, 'orientation.jpg');
  await sharp(source).flatten({ background: '#fff' }).jpeg().withMetadata({ orientation: 6 }).toFile(file);
  const result = await decode(file);
  assert.equal(result.width, 32); assert.equal(result.height, 64);
  assert.equal(result.metadata.width, 32); assert.equal(result.metadata.height, 64);
});
test('Sharp decodes representative bundled formats', async t => {
  for (const format of ['jpeg', 'webp', 'avif', 'tiff', 'gif']) await t.test(format, async () => {
    const file = path.join(temp, `test.${format}`);
    await sharp(source).toFormat(format).toFile(file);
    const result = await decode(file);
    assert.equal(result.width, 64); assert.equal(result.height, 32);
    assert.equal(result.bytes.length, 64 * 32 * 4);
  });
  const file = path.join(temp, 'vector.svg');
  await fs.writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#f01428"/></svg>');
  assert.equal((await decode(file)).width, 64);
});
test('ImageMagick decodes specialist formats with safe filenames', async t => {
  if (!hasMagick) return t.skip('ImageMagick 7 is not installed');
  const c = await capabilities();
  for (const [extension, coder] of [['bmp', 'BMP'], ['tga', 'TGA'], ['psd', 'PSD'], ['exr', 'EXR'], ['jxl', 'JXL'], ['jp2', 'JP2'], ['qoi', 'QOI'], ['heic', 'HEIC'], ['dds', 'DDS'], ['pdf', 'PDF']]) {
    if (!c.formats.some(f => f.name === coder)) continue;
    await t.test(extension, async () => {
      const file = path.join(temp, `test [0]: tricky.${extension}`);
      // Generated filenames for fixture creation too: ImageMagick parses names.
      const generated = path.join(temp, `generated.${extension}`);
      try { await run('magick', [source, '-background', 'white', '-alpha', 'remove', generated]); }
      catch (error) { return t.skip(`System encoder / policy unavailable: ${error.message}`); }
      await fs.rename(generated, file);
      const result = await decode(file);
      if (extension === 'pdf') {
        // PDF uses page units and rasterizes at the decoder's document density.
        assert.ok(Math.abs(result.width / result.height - 2) < .05);
      } else { assert.equal(result.width, 64); assert.equal(result.height, 32); }
      assert.equal(result.bytes.length, result.width * result.height * 4);
      assert.equal(result.bytes[3], 255);
    });
  }
});
test('multipage TIFF exposes and decodes individual pages', async t => {
  if (!hasMagick) return t.skip('ImageMagick 7 is not installed');
  const file = path.join(temp, 'pages.tiff');
  await run('magick', ['-size', '32x24', 'xc:red', 'xc:lime', file]);
  assert.equal((await probe(file)).pages, 2);
  const first = await decode(file, { page: 0 }); const second = await decode(file, { page: 1 });
  assert.deepEqual([...first.bytes.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...second.bytes.subarray(0, 4)], [0, 255, 0, 255]);
  await assert.rejects(decode(file, { page: 2 }), /outside/);
});
test('worker survives invalid input and transfers a valid raster afterwards', async () => {
  const worker = new DecodeService();
  try {
    const broken = path.join(temp, 'broken.png'); await fs.writeFile(broken, 'not an image');
    await assert.rejects(worker.request('decode', broken));
    const result = await worker.request('decode', source);
    assert.ok(result.bytes instanceof Uint8Array); assert.equal(result.width, 64);
  } finally { await worker.close(); }
});
test('pages with different dimensions retain their own aspect and size', async t => {
  if (!hasMagick) return t.skip('ImageMagick 7 is not installed');
  const file = path.join(temp, 'different-pages.tiff');
  await run('magick', ['(', '-size', '32x24', 'xc:red', ')', '(', '-size', '16x48', 'xc:lime', ')', file]);
  const result = await decode(file, { page: 1 });
  assert.equal(result.width, 16); assert.equal(result.height, 48);
  assert.equal(result.metadata.width, 16); assert.equal(result.metadata.height, 48);
});
