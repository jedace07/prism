// SPDX-License-Identifier: Apache-2.0
const MAX_INPUT_PIXELS = 268435456;
const MAX_OUTPUT_PIXELS = 32000000;
export function pngBitmap(bytes: Uint8Array<ArrayBuffer>) {
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    premultiplyAlpha: 'none',
    imageOrientation: 'none',
    colorSpaceConversion: 'default',
  });
}
function mime(bytes: Uint8Array<ArrayBuffer>, extension: string) {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (prefix.trimStart().startsWith('<') && /<svg[\s>]/i.test(prefix)) {
    return 'image/svg+xml';
  }
  return (
    (
      {
        JPEG: 'image/jpeg',
        JPG: 'image/jpeg',
        PNG: 'image/png',
        WEBP: 'image/webp',
        GIF: 'image/gif',
        BMP: 'image/bmp',
        SVG: 'image/svg+xml',
        AVIF: 'image/avif',
        JXL: 'image/jxl',
        ICO: 'image/x-icon',
        CUR: 'image/x-icon',
        HEIC: 'image/heic',
        HEIF: 'image/heif',
        TIFF: 'image/tiff',
        TIF: 'image/tiff',
      } as Record<string, string>
    )[extension] || ''
  );
}
export async function browserBitmap(
  bytes: Uint8Array<ArrayBuffer> | null,
  extension: string,
  maxEdge = 16384,
  pixelLimit = MAX_OUTPUT_PIXELS,
) {
  if (!bytes) {
    throw new Error('Browser decoding is limited to local files of 64 MiB or less.');
  }
  const type = mime(bytes, extension);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const image = new Image();
  image.decoding = 'async';
  try {
    image.src = url;
    await image.decode();
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width * height > MAX_INPUT_PIXELS) {
      throw new Error('Image dimensions exceed the browser preview limit.');
    }
    const factor = Math.min(
      1,
      maxEdge / width,
      maxEdge / height,
      Math.sqrt(pixelLimit / (width * height)),
    );
    const bitmap = await createImageBitmap(image, {
      resizeWidth: Math.max(1, Math.floor(width * factor)),
      resizeHeight: Math.max(1, Math.floor(height * factor)),
      resizeQuality: 'high',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'default',
    });
    return {
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      reduced: factor < 1,
      encoding: 'png' as const,
      bytes: null,
      metadata: {
        format: type === 'image/svg+xml' ? 'SVG' : extension || 'IMAGE',
        width,
        height,
        pages: 1,
        depth: 8,
        space: 'RGBA output',
        profile: 'Browser color management',
        decoder: 'Chromium',
        delay: [],
        loop: 0,
      },
    };
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    throw new Error(
      `Bun.Image and Chromium could not open this image on this platform. ${error.message}`,
    );
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
export async function browserThumbnail(bytes: Uint8Array<ArrayBuffer> | null, extension: string) {
  const decoded = await browserBitmap(bytes, extension, 200, 40000);
  try {
    const canvas = new OffscreenCanvas(decoded.width, decoded.height);
    const context = canvas.getContext('bitmaprenderer');
    if (!context) {
      throw new Error('Browser thumbnail conversion is unavailable.');
    }
    context.transferFromImageBitmap(decoded.bitmap);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    decoded.bitmap.close();
  }
}
export async function browserFormats() {
  const names = ['SVG', 'ICO'];
  if ('ImageDecoder' in window) {
    for (const [name, type] of [
      ['AVIF', 'image/avif'],
      ['JXL', 'image/jxl'],
    ]) {
      if (await ImageDecoder.isTypeSupported(type)) {
        names.push(name);
      }
    }
  }
  return names;
}
