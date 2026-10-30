const path = require('node:path');
const portable = 'jpg jpeg jpe jfif png apng webp gif bmp dib'.split(' ');
// Chromium can supply these formats when Bun.Image does not decode them.
const browser = 'svg avif ico cur jxl'.split(' ');
const system = process.platform === 'linux' ? [] : 'tif tiff heic heif hif'.split(' ');
const EXTENSIONS = [...new Set([...portable, ...browser, ...system])];
const EXTENSION_SET = new Set(EXTENSIONS);
function isImage(file) { return EXTENSION_SET.has(path.extname(file).slice(1).toLowerCase()); }
module.exports = { EXTENSIONS, isImage };
