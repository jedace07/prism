// SPDX-License-Identifier: Apache-2.0
/** A secure local origin with access only to the shipped renderer assets. */
export const APP_URL = 'prism://viewer/index.html';
const assets: Record<string, string> = {
  '/index.html': 'text/html; charset=utf-8', '/style.css': 'text/css; charset=utf-8',
  '/app.js': 'text/javascript; charset=utf-8', '/gpu.js': 'text/javascript; charset=utf-8',
  '/animation.js': 'text/javascript; charset=utf-8', '/browser-images.js': 'text/javascript; charset=utf-8'
};
export function rendererAsset(url: string, method: string): { name: string; type: string } | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'prism:' || parsed.host !== 'viewer' || parsed.username || parsed.password) return null;
    const type = Object.hasOwn(assets, parsed.pathname) ? assets[parsed.pathname] : null;
    return type ? { name: parsed.pathname.slice(1), type } : null;
  } catch { return null; }
}
