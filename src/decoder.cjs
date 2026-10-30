const MAX_INPUT_PIXELS = 268_435_456;
const MAX_OUTPUT_PIXELS = 32_000_000;
const MAX_EDGE = 16384;
const UNSUPPORTED = new Set(['ERR_IMAGE_FORMAT_UNSUPPORTED', 'ERR_IMAGE_UNKNOWN_FORMAT', 'ERR_IMAGE_DECODE_FAILED']);

function targetSize(width, height, edge = MAX_EDGE, pixelLimit = MAX_OUTPUT_PIXELS) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > MAX_INPUT_PIXELS) throw new Error('Invalid dimensions or image exceeds the 268 megapixel input limit.');
  const maxEdge = Math.max(1, Math.min(MAX_EDGE, Number(edge) || MAX_EDGE));
  const factor = Math.min(1, maxEdge / width, maxEdge / height, Math.sqrt(pixelLimit / (width * height)));
  return { width: Math.max(1, Math.floor(width * factor)), height: Math.max(1, Math.floor(height * factor)), reduced: factor < 1 };
}
function image(file) {
  if (typeof Bun === 'undefined' || typeof Bun.Image !== 'function') throw new Error('Bun 1.4.4 or newer with Bun.Image is required.');
  // Paths originate from the main process's authorized file-token registry.
  return new Bun.Image(file, { maxPixels: MAX_INPUT_PIXELS, autoOrient: true });
}
async function probe(file) {
  const m = await image(file).metadata();
  targetSize(m.width, m.height);
  return { format: m.format.toUpperCase(), width: m.width, height: m.height, pages: 1, depth: 8, space: 'RGBA output', alpha: null, profile: 'Browser color management', decoder: 'Bun.Image', delay: [], loop: 0 };
}
async function decode(file, { page = 0, maxEdge = MAX_EDGE, thumbnail = false } = {}) {
  if (page !== 0) throw new Error('Bun.Image decodes the first image only. Use browser animation controls for frames.');
  try {
    const metadata = await probe(file);
    const target = targetSize(metadata.width, metadata.height, thumbnail ? 200 : maxEdge, thumbnail ? 40000 : MAX_OUTPUT_PIXELS);
    const pipeline = image(file).resize(target.width, target.height, { fit: 'inside', withoutEnlargement: true }).png();
    const bytes = await pipeline.buffer();
    return { bytes, encoding: 'png', width: pipeline.width, height: pipeline.height, reduced: target.reduced, metadata };
  } catch (error) {
    if (UNSUPPORTED.has(error.code)) return { browser: true, reason: error.message };
    throw error;
  }
}
async function capabilities() {
  const native = ['JPEG', 'PNG', 'WEBP', 'GIF', 'BMP'];
  const system = process.platform === 'linux' ? [] : ['TIFF', 'HEIC', 'AVIF'];
  return { engine: 'Bun.Image', version: Bun.version, platform: process.platform, backend: Bun.Image.backend, native, system };
}
module.exports = { decode, probe, capabilities, targetSize, MAX_INPUT_PIXELS, MAX_OUTPUT_PIXELS };
