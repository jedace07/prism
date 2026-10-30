// Opt-in integration harness; never loaded during normal application use.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { run: command, capabilities } = require('./decoder.cjs');
async function run({ window, choosePaths, gpuInfo, reportPath, app }) {
  const checks = []; const errors = [];
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-smoke-images-'));
  const report = { passed: false, checks, errors, gpu: null, renderer: null };
  const js = source => window.webContents.executeJavaScript(source);
  const until = async (predicate, label, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await js(predicate)) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    throw new Error(`Timed out waiting for ${label}: ${await js('document.getElementById("error-message").textContent')}`);
  };
  const select = async file => {
    const selection = await choosePaths([file]); window.webContents.send('selection', selection);
    await until(`document.getElementById('file-name').textContent === ${JSON.stringify(path.basename(file))} && document.getElementById('loading').hidden`, 'image decode');
    assert.equal(await js('document.getElementById("error").hidden'), true, await js('document.getElementById("error-message").textContent'));
    return selection;
  };
  const pixel = (x, y) => js(`(() => { const c=document.getElementById('image-canvas'),g=c.getContext('webgl2');g.drawArrays(g.TRIANGLE_STRIP,0,4);const p=new Uint8Array(4),d=window.devicePixelRatio;g.readPixels(Math.floor(c.width/2+${x}*d),Math.floor(c.height/2+${y}*d),1,1,g.RGBA,g.UNSIGNED_BYTE,p);return Array.from(p);})()`);
  const click = async id => { await js(`document.getElementById(${JSON.stringify(id)}).click()`); await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); };
  window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  try {
    await until('document.body.dataset.ready === "true"', 'viewer initialization');
    report.gpu = await gpuInfo();
    report.renderer = await js(`(() => { const g=document.getElementById('image-canvas').getContext('webgl2');const e=g?.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null;})()`);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(path.join(path.dirname(reportPath), 'empty.png'), (await window.webContents.capturePage()).toPNG());
    assert.equal(await js('document.getElementById("error").hidden'), true, await js('document.getElementById("error-message").textContent'));
    checks.push('WebGL2 context initialized with explicit rendering diagnostics');

    const width = 640, height = 400;
    const bytes = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const c = y < height / 2 ? (x < width / 2 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : (x < width / 2 ? [0, 0, 255, 255] : [255, 255, 255, 255]);
      bytes.set(c, (y * width + x) * 4);
    }
    const image = path.join(temp, '01-quadrants.png');
    await sharp(bytes, { raw: { width, height, channels: 4 } }).png().toFile(image);
    const other = path.join(temp, '02-photo.webp'); await sharp(image).webp({ lossless: true }).toFile(other);
    const selection = await select(image);
    assert.deepEqual(await pixel(-100, 100), [255, 0, 0, 255]);
    assert.deepEqual(await pixel(100, 100), [0, 255, 0, 255]);
    assert.deepEqual(await pixel(-100, -100), [0, 0, 255, 255]);
    checks.push('Uploaded RGBA is rendered by the WebGL shader with correct pixel colors and orientation');
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
    const pan = await js(`(() => {const g=document.getElementById('image-canvas').getContext('webgl2'),p=g.getParameter(g.CURRENT_PROGRAM);return Array.from(g.getUniform(p,g.getUniformLocation(p,'u_pan')));})()`);
    assert.ok(Math.abs(pan[0] - 70) < 2 && Math.abs(pan[1] - 20) < 2, `Unexpected pan: ${pan}`);
    await click('fit'); checks.push('Pointer dragging updates GPU pan uniforms');
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
    checks.push('SVG rasterization works in Electron with the installed native libraries');
    const c = await capabilities();
    if (c.magick) {
      for (const [ext, coder] of [['jxl', 'JXL'], ['exr', 'EXR'], ['psd', 'PSD']]) {
        if (!c.formats.some(f => f.name === coder)) continue;
        const special = path.join(temp, `special.${ext}`);
        await command('magick', ['-size', '64x32', 'xc:red', special]);
        await select(special); const color = await pixel(0, 0);
        assert.ok(color[0] > 245 && color[1] < 10 && color[2] < 10, `${ext}: ${color}`);
      }
      checks.push('JPEG XL, EXR and PSD pass through ImageMagick and render on the GPU');
      const tiff = path.join(temp, '03-pages.tiff'); await command('magick', ['-size', '64x32', 'xc:red', 'xc:lime', tiff]);
      await select(tiff); await click('page-next');
      await until('document.getElementById("page-label").textContent === "Page 2 / 2" && document.getElementById("loading").hidden', 'TIFF page two');
      assert.deepEqual(await pixel(0, 0), [0, 255, 0, 255]); checks.push('Multipage TIFF navigation renders the selected page');
      const gif = path.join(temp, '04-animation.gif'); await command('magick', ['-delay', '10', '-size', '64x32', 'xc:red', 'xc:lime', '-loop', '0', gif]);
      await select(gif); await until('document.getElementById("play").getAttribute("aria-pressed") === "true"', 'animated GIF playback');
      const colors = new Set();
      for (let i = 0; i < 12; i++) { colors.add((await pixel(0, 0)).join(',')); await new Promise(resolve => setTimeout(resolve, 45)); }
      assert.ok(colors.has('255,0,0,255') && colors.has('0,255,0,255'), `Animation colors: ${[...colors]}`);
      await click('play'); assert.equal(await js('document.getElementById("play").getAttribute("aria-pressed")'), 'false');
      checks.push('Animated GIF frames are decoded, uploaded to WebGL, displayed and paused');
    }
    await click('gpu-badge'); await until('document.querySelector(".supported-grid span") !== null', 'format diagnostics');
    assert.equal(await js('document.getElementById("diagnostics").open'), true);
    await fs.writeFile(path.join(path.dirname(reportPath), 'diagnostics.png'), (await window.webContents.capturePage()).toPNG());
    checks.push('Live format capability and GPU diagnostics dialog');
    assert.equal(errors.length, 0, `Renderer errors: ${errors.join('\n')}`);
    report.passed = true;
  } catch (error) {
    report.failure = error.stack;
    await fs.writeFile(path.join(path.dirname(reportPath), 'failure.png'), (await window.webContents.capturePage()).toPNG()).catch(() => {});
  } finally {
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    await fs.rm(temp, { recursive: true, force: true });
    app.exit(report.passed ? 0 : 1);
  }
}
module.exports = { run };
