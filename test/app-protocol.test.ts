// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_URL, rendererAsset } from '../src/app-protocol.js';

test('secure app origin serves only bundled renderer assets', () => {
  assert.deepEqual(rendererAsset(APP_URL, 'GET'), { name: 'index.html', type: 'text/html; charset=utf-8' });
  assert.equal(rendererAsset('prism://viewer/gpu.js', 'HEAD')?.type, 'text/javascript; charset=utf-8');
  for (const url of ['file:///etc/passwd', 'https://viewer/app.js', 'prism://other/app.js', 'prism://user@viewer/app.js', 'prism://viewer/../main.js', 'prism://viewer/%2e%2e%2fmain.js', 'prism://viewer/%2fetc%2fpasswd', 'prism://viewer/decode-service.js', 'prism://viewer/toString', 'not a URL']) assert.equal(rendererAsset(url, 'GET'), null, url);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(rendererAsset(APP_URL, method), null);
});
