// SPDX-License-Identifier: Apache-2.0
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { decode, probe, capabilities, targetSize } from '../src/decoder.js';
import { isImage } from '../src/formats.js';
import { DecodeService } from '../src/decode-service.js';
import { png, readPNG, bmp, gif, orientJPEG } from '../src/test-images.js';
let temp: string, source: string;
before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-test-'));
  source = path.join(temp, 'source.png');
  await fs.writeFile(source, png(64, 32, [240, 20, 40, 128]));
});
after(async () => { await fs.rm(temp, { recursive: true, force: true }); });

test('preview dimensions preserve aspect ratio and both texture/pixel limits', () => {
  assert.deepEqual(targetSize(40000, 2000, 4096), { width: 4096, height: 204, reduced: true });
  const target = targetSize(16000, 16000, 16384);
  assert.ok(target.width * target.height <= 32000000);
  assert.throws(() => targetSize(0, 100)); assert.throws(() => targetSize(1000000, 1000000));
  assert.equal(targetSize(64, 32).reduced, false);
});
test('file discovery reflects Bun and browser image candidates', () => {
  for (const name of ['a.PNG','a.jpg','a.gif','a.bmp','a.avif','a.svg']) assert.ok(isImage(name));
  for (const name of ['a.js','a.psd','a.cr3','a.exr','a.pdf']) assert.equal(isImage(name), false);
});
test('Bun.Image output preserves straight-alpha PNG pixels and bounded thumbnails', async () => {
  const result = await decode(source); assert.ok(!result.browser && result.bytes);
  assert.equal(result.encoding, 'png'); assert.equal(result.metadata.decoder, 'Bun.Image');
  assert.deepEqual([...readPNG(result.bytes).bytes.subarray(0,4)], [240,20,40,128]);
  const small = await decode(source, { maxEdge:16 }); assert.ok(!small.browser && small.bytes);
  assert.equal(small.width,16); assert.equal(small.height,8); assert.equal(small.reduced,true);
  const thumb = await decode(source,{thumbnail:true}); assert.ok(!thumb.browser && thumb.bytes);
  assert.ok(readPNG(thumb.bytes).width<=200);
});
test('Bun.Image applies EXIF orientation to metadata and the encoded preview', async () => {
  const jpeg=await new Bun.Image(png(64,32,[255,0,0,255])).jpeg().buffer();
  const file=path.join(temp,'orientation.jpg');await fs.writeFile(file,orientJPEG(jpeg));
  const result=await decode(file); assert.ok(!result.browser && result.bytes);
  assert.equal(result.width,32);assert.equal(result.height,64);assert.equal(result.metadata.width,32);assert.equal(result.metadata.height,64);
});
test('Bun.Image decodes JPEG, lossless WebP, BMP and the first GIF frame', async t => {
  const input=png(32,24,[255,0,0,255]);
  for(const [extension,bytes,w,h] of [
    ['jpeg',await new Bun.Image(input).jpeg({quality:95}).buffer(),32,24],
    ['webp',await new Bun.Image(input).webp({lossless:true}).buffer(),32,24],
    ['bmp',bmp(32,24),32,24],['gif',gif(),2,2]
  ] as [string, Uint8Array, number, number][]) await t.test(extension,async()=>{
    const file=path.join(temp,`sample.${extension}`);await fs.writeFile(file,bytes);
    const result=await decode(file); assert.ok(!result.browser && result.bytes); const decoded=readPNG(result.bytes);
    assert.equal(decoded.width,w);assert.equal(decoded.height,h);
    assert.ok(decoded.bytes[0]>245&&decoded.bytes[1]<10&&decoded.bytes[2]<10);
  });
});
test('unsupported formats request the browser fallback without suggesting native tools', async () => {
  const file=path.join(temp,'vector.svg');await fs.writeFile(file,'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"/>');
  assert.equal((await decode(file)).browser,true);
  await assert.rejects(decode(source,{page:1}),/first image/);
});
test('pixel limit rejects a decompression-bomb header before decoding',async()=>{
  const bytes=png(1,1,[255,0,0,255]);bytes.writeUInt32BE(50000,16);bytes.writeUInt32BE(50000,20);bytes.writeUInt32BE(Bun.hash.crc32(bytes.subarray(12,29))>>>0,29);
  const file=path.join(temp,'huge.png');await fs.writeFile(file,bytes);
  await assert.rejects(probe(file));
});
test('file paths containing brackets and colons are treated as literal filenames',async()=>{
  const file=path.join(temp,'test [0]: literal.png');await fs.copyFile(source,file);const result = await decode(file); assert.ok(!result.browser); assert.equal(result.width,64);
});
test('Bun subprocess recovers from an error and preserves concurrent PNG payloads',async()=>{
  const service=new DecodeService();
  try {
    await assert.rejects(service.request('decode',source,{page:2}),/first image/);
    const [full,thumb,c]=await Promise.all([service.request('decode',source),service.request('decode',source,{thumbnail:true}),service.request('capabilities')]);
    assert.ok(!full.browser && full.bytes && !thumb.browser && thumb.bytes);
    assert.deepEqual([...readPNG(full.bytes).bytes.subarray(0,4)],[240,20,40,128]);
    assert.equal(readPNG(thumb.bytes).width,64);assert.equal(c.engine,'Bun.Image');assert.equal('magick' in c,false);
  } finally {await service.close();}
});
test('capabilities have no native codec package dependency',async()=>{
  const c=await capabilities();assert.equal(c.engine,'Bun.Image');assert.deepEqual(c.native,['JPEG','PNG','WEBP','GIF','BMP']);
  if(process.platform==='linux')assert.deepEqual(c.system,[]);
});
