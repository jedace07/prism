// Fixture creation runs in the same isolated Bun runtime as production codecs.
const sharp = require('sharp');
const path = require('node:path');
async function main() {
  const directory = process.argv[2];
  const width = 640, height = 400, bytes = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = y < height / 2 ? (x < width / 2 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : (x < width / 2 ? [0, 0, 255, 255] : [255, 255, 255, 255]);
    bytes.set(color, (y * width + x) * 4);
  }
  const image = path.join(directory, '01-quadrants.png');
  await sharp(bytes, { raw: { width, height, channels: 4 } }).png().toFile(image);
  await sharp(image).webp({ lossless: true }).toFile(path.join(directory, '02-photo.webp'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
