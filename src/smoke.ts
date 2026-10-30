// SPDX-License-Identifier: Apache-2.0
import type { App, BrowserWindow } from 'electron';
import type { GPUInfo, RendererInfo, Selection } from './types.js';
// Opt-in integration harness; never loaded during normal application use.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
const execFile = promisify(require('node:child_process').execFile);
import { DecodeService, getRuntimePath } from './decode-service.js';
async function capabilities() {
  const decoder = new DecodeService();
  try { return await decoder.request('capabilities'); } finally { await decoder.close(); }
}
async function run({ window, choosePaths, gpuInfo, reportPath, app }: {
  window: BrowserWindow; choosePaths(paths: string[]): Promise<Selection | null>;
  gpuInfo(): Promise<GPUInfo>; reportPath: string; app: App;
}) {
  const checks: string[] = []; const errors: string[] = [];
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-smoke-images-'));
  const report: { passed: boolean; checks: string[]; errors: string[]; gpu: GPUInfo | null; renderer: RendererInfo | null; failure?: string } = { passed: false, checks, errors, gpu: null, renderer: null };
  const js = (source: string) => window.webContents.executeJavaScript(source);
  const until = async (predicate: string, label: string, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await js(predicate)) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    throw new Error(`Timed out waiting for ${label}: ${await js('document.getElementById("error-message").textContent')}`);
  };
  const select = async (file: string) => {
    const selection = await choosePaths([file]); window.webContents.send('selection', selection);
    await until(`document.getElementById('file-name').textContent === ${JSON.stringify(path.basename(file))} && document.getElementById('loading').hidden`, 'image decode');
    assert.equal(await js('document.getElementById("error").hidden'), true, await js('document.getElementById("error-message").textContent'));
    return selection;
  };
  const pixel = (x: number, y: number): Promise<number[]> => js(`window.prismTest.pixel(${x}, ${y})`);
  const click = async (id: string) => { await js(`document.getElementById(${JSON.stringify(id)}).click()`); await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); };
  window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  try {
    await until('document.body.dataset.ready === "true"', 'viewer initialization');
    report.gpu = await gpuInfo();
    report.renderer = await js('window.prismTest?.info() || null');
    assert.equal(await js('window.isSecureContext && location.origin === \"prism://viewer\"'), true);
    assert.equal(report.renderer?.api, 'WebGPU', await js('document.getElementById(\"error-message\").textContent'));
    if (!report.gpu.allowSoftware) assert.equal(report.renderer.software, false);
    else assert.equal(report.renderer.software, true, 'CI must select the explicit software WebGPU adapter');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(path.join(path.dirname(reportPath), 'empty.png'), (await window.webContents.capturePage()).toPNG());
    assert.equal(await js('document.getElementById("error").hidden'), true, await js('document.getElementById("error-message").textContent'));
    checks.push('WebGPU context initialized with explicit rendering diagnostics');

    await execFile(getRuntimePath(), [path.join(__dirname, 'smoke-fixtures.js'), temp]);
    const image = path.join(temp, '01-quadrants.png');
    const selection = await select(image);
    assert.deepEqual(await pixel(-100, 100), [255, 0, 0, 255]);
    assert.deepEqual(await pixel(100, 100), [0, 255, 0, 255]);
    assert.deepEqual(await pixel(-100, -100), [0, 0, 255, 255]);
    checks.push('Uploaded RGBA is rendered by the WebGPU shader with correct pixel colors and orientation');
    await click('rotate'); assert.deepEqual(await pixel(-100, 100), [0, 0, 255, 255]);
    for (let i = 0; i < 3; i++) await click('rotate');
    await click('flip'); assert.deepEqual(await pixel(-100, 100), [0, 255, 0, 255]); await click('flip');
    await click('zoom-in'); assert.equal(await js('document.getElementById("zoom-value").textContent'), '125%');
    await click('zoom-value'); assert.equal(await js('document.getElementById("zoom-value").textContent'), '100%');
    await click('pixel'); assert.equal(await js('document.getElementById("pixel").getAttribute("aria-pressed")'), 'true');
    checks.push('Rotation, flipping, zoom and nearest-neighbor controls update rendered pixels / GPU state');
    const rect = await js('(() => { const r=document.getElementById("image-canvas").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(rect.x + 70), y: Math.round(rect.y + 20), movementX: 70, movementY: 20 });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x + 70), y: Math.round(rect.y + 20), button: 'left', clickCount: 1 });
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { pan } = await js('window.prismTest.transform()');
    assert.ok(Math.abs(pan.x - 70) < 2 && Math.abs(pan.y - 20) < 2, `Unexpected pan: ${pan}`);
    assert.deepEqual(await pixel(30, 100), [255, 0, 0, 255]);
    await click('fit'); checks.push('Pointer dragging updates WebGPU transform uniforms and rendered pixels');
    await click('info-toggle'); assert.equal(await js('document.getElementById("inspector").hidden'), false);
    await until('document.querySelector(".thumbnail img") !== null', 'lazy thumbnail');
    await fs.writeFile(path.join(path.dirname(reportPath), 'viewer.png'), (await window.webContents.capturePage()).toPNG());
    await click('next'); await until('document.getElementById("file-name").textContent === "02-photo.webp" && document.getElementById("loading").hidden', 'folder navigation');
    checks.push('Folder discovery, natural sorting, navigation, metadata and lazy thumbnails');
    assert.equal(await js(`viewer.decode('invalid-file-token').then(()=>false,()=>true)`), true);
    assert.equal(await js('typeof require'), 'undefined'); checks.push('Renderer isolation and file-token authorization');

    const svg = path.join(temp, 'vector.svg');
    await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#f00080"/></svg>');
    await select(svg); assert.deepEqual(await pixel(0, 0), [240, 0, 128, 255]);
    checks.push('SVG browser fallback renders through WebGPU');
    window.setSize(1100, 820);
    await until('Math.abs(document.getElementById("image-canvas").width - Math.round(document.getElementById("image-canvas").getBoundingClientRect().width * devicePixelRatio)) <= 1', 'WebGPU canvas resize');
    assert.deepEqual(await pixel(0, 0), [240, 0, 128, 255]);
    window.setSize(1440, 940);
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    checks.push('Window resizing recreates the WebGPU render target');
    await select(path.join(temp, '03-alpha.png'));
    const alpha = await pixel(0, 0);
    for (const [index, expected] of [120, 10, 20, 128].entries()) assert.ok(Math.abs(alpha[index] - expected) <= 1, `Incorrect premultiplied alpha: ${alpha}`);
    checks.push('PNG straight alpha is converted correctly for canvas composition');
    await select(path.join(temp, '05-sampling.png'));
    if (await js('document.getElementById("pixel").getAttribute("aria-pressed")') !== 'true') await click('pixel');
    for (let i = 0; i < 8; i++) await click('zoom-in');
    assert.deepEqual(await pixel(0, 0), [0, 255, 0, 255]);
    await click('pixel');
    const filtered = await pixel(0, 0);
    assert.ok(filtered[0] > 50 && filtered[0] < 200 && filtered[1] > 50 && filtered[1] < 200, `Incorrect linear filtering: ${filtered}`);
    checks.push('Nearest and linear WebGPU samplers produce different edge pixels');
    const c = await capabilities(); assert.equal(c.engine, 'Bun.Image');
    const gif = path.join(temp, '04-animation.gif');
    await select(gif); await until('document.getElementById("play").getAttribute("aria-pressed") === "true"', 'animated GIF playback');
    const colors = new Set();
    for (let i = 0; i < 12; i++) { colors.add((await pixel(0, 0)).join(',')); await new Promise(resolve => setTimeout(resolve, 45)); }
    assert.ok(colors.has('255,0,0,255') && colors.has('0,255,0,255'), `Animation colors: ${[...colors]}`);
    await click('play'); assert.equal(await js('document.getElementById("play").getAttribute("aria-pressed")'), 'false');
    checks.push('Bun first-frame preview and Chromium animated GIF playback');
    await click('gpu-badge'); await until('document.querySelector(".supported-grid span") !== null', 'format diagnostics');
    assert.equal(await js('document.getElementById("diagnostics").open'), true);
    await fs.writeFile(path.join(path.dirname(reportPath), 'diagnostics.png'), (await window.webContents.capturePage()).toPNG());
    checks.push('Live format capability and GPU diagnostics dialog');
    assert.equal(errors.length, 0, `Renderer errors: ${errors.join('\n')}`);
    await click('play');
    assert.equal(await js('document.getElementById("play").getAttribute("aria-pressed")'), 'true');
    await js('window.prismTest.loseDevice()');
    await until('document.getElementById("gpu-label").textContent === "GPU lost" && !document.getElementById("error").hidden && document.getElementById("play").getAttribute("aria-pressed") === "false"', 'WebGPU device loss diagnostics');
    checks.push('WebGPU device loss stops rendering and reports a recoverable restart action');
    report.passed = true;
  } catch (error) {
    report.failure = error instanceof Error ? error.stack : String(error);
    await fs.writeFile(path.join(path.dirname(reportPath), 'failure.png'), (await window.webContents.capturePage()).toPNG()).catch(() => {});
  } finally {
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    await fs.rm(temp, { recursive: true, force: true });
    app.exit(report.passed ? 0 : 1);
  }
}
export { run };
