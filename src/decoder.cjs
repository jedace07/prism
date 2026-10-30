const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { parseMagickFormats } = require('./formats.cjs');

sharp.cache({ memory: 64, files: 0, items: 32 });
sharp.concurrency(2);
const MAX_INPUT_PIXELS = 1_000_000_000;
const MAX_OUTPUT_PIXELS = 32_000_000;
const MAX_EDGE = 16384;
const limits = ['-limit', 'thread', '2', '-limit', 'memory', '256MiB', '-limit', 'map', '512MiB', '-limit', 'disk', '1GiB', '-limit', 'time', '45'];
let magickPromise;

function run(command, args, { maxBuffer = 140_000_000, timeout = 60000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0; let error = ''; let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      err ? reject(err) : resolve(data);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Image decoding timed out (60 seconds).')); }, timeout);
    child.on('error', e => finish(e));
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBuffer) { child.kill('SIGKILL'); finish(new Error('Decoded image exceeds the memory limit.')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { if (error.length < 8192) error += chunk.toString(); });
    child.on('close', code => finish(code === 0 ? null : new Error(error.trim().slice(0, 1200) || `Decoder exited with code ${code}.`), Buffer.concat(chunks)));
  });
}

async function magick() {
  if (!magickPromise) magickPromise = (async () => {
    for (const command of [process.env.PRISM_MAGICK, 'magick'].filter(Boolean)) {
      try { const version = await run(command, ['-version'], { maxBuffer: 16384 }); return { command, version: version.toString().split('\n')[0] }; }
      catch { /* optional system decoder */ }
    }
    return null;
  })();
  return magickPromise;
}

async function withSafePath(file, fn) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-decode-'));
  try {
    const extension = path.extname(file).replace(/[^a-z0-9.]/gi, '').slice(0, 16);
    const safe = path.join(temp, `source${extension}`);
    // ImageMagick treats brackets, colons and @ in filenames as instructions.
    // Give it a generated name, while retaining the real file's extension.
    try { await fs.symlink(path.resolve(file), safe); }
    catch { await fs.copyFile(file, safe); }
    return await fn(safe, { ...process.env, MAGICK_CONFIGURE_PATH: path.join(__dirname, 'magick'), MAGICK_TEMPORARY_PATH: temp });
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

function targetSize(width, height, edge = MAX_EDGE, pixelLimit = MAX_OUTPUT_PIXELS) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > MAX_INPUT_PIXELS) throw new Error('Invalid dimensions or image exceeds the 1 gigapixel input limit.');
  const maxEdge = Math.max(1, Math.min(MAX_EDGE, Number(edge) || MAX_EDGE));
  const factor = Math.min(1, maxEdge / width, maxEdge / height, Math.sqrt(pixelLimit / (width * height)));
  return { width: Math.max(1, Math.floor(width * factor)), height: Math.max(1, Math.floor(height * factor)), reduced: factor < 1 };
}

async function probe(file, page = 0) {
  try {
    const m = await sharp(file, { page, pages: 1, limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();
    const rotated = [5, 6, 7, 8].includes(m.orientation);
    return { format: m.format.toUpperCase(), width: rotated ? (m.pageHeight || m.height) : m.width, height: rotated ? m.width : (m.pageHeight || m.height), pages: m.pages || 1, depth: m.bitsPerSample || ({ uchar: 8, ushort: 16, float: 32, double: 64 }[m.depth]) || 8, space: m.space, alpha: !!m.hasAlpha, profile: m.hasProfile ? 'Embedded ICC → sRGB' : 'sRGB output', decoder: 'Sharp / libvips', delay: m.delay || [], loop: m.loop || 0 };
  } catch (sharpError) {
    const engine = await magick();
    if (!engine) throw new Error(`Sharp cannot decode this image. Install ImageMagick 7 for additional formats. ${sharpError.message}`);
    return withSafePath(file, async (safe, env) => {
      const result = await run(engine.command, ['identify', ...limits, '-ping', '-format', '%m|%w|%h|%n|%z|%[colorspace]|%[orientation]|%T\n', safe], { maxBuffer: 4_000_000, env });
      const rows = result.toString().trim().split('\n');
      if (page >= rows.length) throw new Error('Page is outside the image.');
      const [format, w, h, n, depth, space, orientation] = rows[page].split('|');
      const rotated = ['LeftTop', 'RightTop', 'RightBottom', 'LeftBottom'].includes(orientation);
      const width = Number(w); const height = Number(h);
      targetSize(width, height);
      return { format, width: rotated ? height : width, height: rotated ? width : height, pages: Math.max(Number(n) || 1, rows.length), depth: Number(depth), space, alpha: null, profile: 'Converted to sRGB', decoder: 'ImageMagick', delay: rows.map(row => (Number(row.split('|')[7]) || 10) * 10), loop: 0 };
    });
  }
}

async function decode(file, { page = 0, maxEdge = MAX_EDGE, thumbnail = false } = {}) {
  let metadata = await probe(file);
  if (!Number.isInteger(page) || page < 0 || page >= metadata.pages) throw new Error('Page is outside the image.');
  if (page > 0) metadata = await probe(file, page);
  const target = targetSize(metadata.width, metadata.height, thumbnail ? 200 : maxEdge, thumbnail ? 40000 : MAX_OUTPUT_PIXELS);
  if (metadata.decoder.startsWith('Sharp')) {
    let pipeline = sharp(file, { page, pages: 1, limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate().resize({ width: target.width, height: target.height, fit: 'inside', withoutEnlargement: true }).toColourspace('srgb');
    if (thumbnail) return { bytes: await pipeline.png().toBuffer(), metadata };
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height, reduced: target.reduced, metadata };
  }
  const engine = await magick();
  return withSafePath(file, async (safe, env) => {
    const output = await run(engine.command, [...limits, `${safe}[${page}]`, '-auto-orient', '-thumbnail', `${target.width}x${target.height}>`, '-colorspace', 'sRGB', '-depth', '8', thumbnail ? 'png:-' : 'pam:-'], { env });
    if (thumbnail) return { bytes: output, metadata };
    // PAM carries actual per-page dimensions (TIFF pages / PSD layers can differ).
    const headerEnd = output.indexOf('ENDHDR\n');
    if (headerEnd < 0 || headerEnd > 2048) throw new Error('Invalid raster data from ImageMagick.');
    const header = output.subarray(0, headerEnd).toString();
    const width = Number(header.match(/\bWIDTH (\d+)/)?.[1]);
    const height = Number(header.match(/\bHEIGHT (\d+)/)?.[1]);
    const channels = Number(header.match(/\bDEPTH (\d+)/)?.[1]);
    const pixels = output.subarray(headerEnd + 7);
    const { data, info } = await sharp(pixels, { raw: { width, height, channels } }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height, reduced: target.reduced, metadata };
  });
}

async function capabilities() {
  const engine = await magick();
  let formats = [];
  if (engine) {
    try { formats = parseMagickFormats((await run(engine.command, ['-list', 'format'], { maxBuffer: 1_000_000 })).toString()); } catch { /* report Sharp formats even if system command fails */ }
  }
  const native = Object.entries(sharp.format).filter(([, value]) => value.input.file).map(([name]) => name.toUpperCase());
  return { sharp: sharp.versions, native, magick: engine?.version || null, formats };
}
module.exports = { decode, probe, capabilities, targetSize, run };
