// SPDX-License-Identifier: Apache-2.0
import type { Capabilities, DisplayResult, GPUInfo, ImageFile, Selection } from '../types.js';
import { GPUCanvas } from './gpu.js';
import { GPUAnimation } from './animation.js';
import { pngBitmap, browserBitmap, browserThumbnail, browserFormats } from './browser-images.js';

type Elements = {
  'background': HTMLElementTagNameMap['button'];
  'detail-format': HTMLElementTagNameMap['span'];
  'detail-name': HTMLElementTagNameMap['strong'];
  'diagnostics': HTMLElementTagNameMap['dialog'];
  'directory-name': HTMLElementTagNameMap['span'];
  'drop-overlay': HTMLElementTagNameMap['div'];
  'empty': HTMLElementTagNameMap['div'];
  'empty-open': HTMLElementTagNameMap['button'];
  'error': HTMLElementTagNameMap['div'];
  'error-dismiss': HTMLElementTagNameMap['button'];
  'error-message': HTMLElementTagNameMap['p'];
  'error-title': HTMLElementTagNameMap['strong'];
  'file-name': HTMLElementTagNameMap['strong'];
  'file-subtitle': HTMLElementTagNameMap['span'];
  'filmstrip': HTMLElementTagNameMap['div'];
  'filmstrip-section': HTMLElementTagNameMap['section'];
  'fit': HTMLElementTagNameMap['button'];
  'flip': HTMLElementTagNameMap['button'];
  'folder': HTMLElementTagNameMap['button'];
  'format-details': HTMLElementTagNameMap['div'];
  'fullscreen': HTMLElementTagNameMap['button'];
  'gpu-badge': HTMLElementTagNameMap['button'];
  'gpu-details': HTMLElementTagNameMap['div'];
  'gpu-label': HTMLElementTagNameMap['span'];
  'help': HTMLElementTagNameMap['button'];
  'image-canvas': HTMLElementTagNameMap['canvas'];
  'image-controls': HTMLElementTagNameMap['div'];
  'image-count': HTMLElementTagNameMap['span'];
  'info-close': HTMLElementTagNameMap['button'];
  'info-toggle': HTMLElementTagNameMap['button'];
  'inspector': HTMLElementTagNameMap['aside'];
  'loading': HTMLElementTagNameMap['div'];
  'metadata': HTMLElementTagNameMap['dl'];
  'next': HTMLElementTagNameMap['button'];
  'open': HTMLElementTagNameMap['button'];
  'page-controls': HTMLElementTagNameMap['div'];
  'page-label': HTMLElementTagNameMap['span'];
  'page-next': HTMLElementTagNameMap['button'];
  'page-prev': HTMLElementTagNameMap['button'];
  'pixel': HTMLElementTagNameMap['button'];
  'play': HTMLElementTagNameMap['button'];
  'previous': HTMLElementTagNameMap['button'];
  'reveal': HTMLElementTagNameMap['button'];
  'rotate': HTMLElementTagNameMap['button'];
  'shortcuts': HTMLElementTagNameMap['dialog'];
  'stage': HTMLElementTagNameMap['div'];
  'status': HTMLElementTagNameMap['span'];
  'zoom-in': HTMLElementTagNameMap['button'];
  'zoom-out': HTMLElementTagNameMap['button'];
  'zoom-value': HTMLElementTagNameMap['button'];
};
function $<K extends keyof Elements>(id: K): Elements[K];
function $(id: string): HTMLElement;
function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing viewer element: ${id}`);
  return element;
}
const api = window.viewer;
interface ViewerState {
  files: ImageFile[]; index: number; page: number; pages: number; generation: number;
  result: DisplayResult | null; gpu: GPUCanvas | null; gpuInfo: GPUInfo | null;
  animation: GPUAnimation | null; slideshow: ReturnType<typeof setTimeout> | undefined;
  directory: string; capabilities: Capabilities | null; background: number;
  thumbnailURLs: string[]; thumbnailGeneration: number; busy: boolean;
}
const state: ViewerState = { files: [], index: 0, page: 0, pages: 1, generation: 0, result: null, gpu: null, gpuInfo: null, animation: null, slideshow: undefined, directory: '', capabilities: null, background: 0, thumbnailURLs: [], thumbnailGeneration: 0, busy: false };
let gpuFailure: unknown = null;
const niceBytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
const number = (n: number) => Number(n).toLocaleString();
function errorMessage(error: unknown) { return String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, ''); }
function showError(error: unknown, title = 'Couldn’t open this image') {
  $('error-title').textContent = title; $('error-message').textContent = errorMessage(error); $('error').hidden = false;
  $('status').textContent = 'Unable to display image';
}
function hideError() { $('error').hidden = true; }
function setPlaying(playing: boolean) {
  $('play').setAttribute('aria-pressed', String(playing));
  $('play').setAttribute('aria-label', playing ? 'Pause animation or slideshow' : 'Play animation or slideshow');
  $('play').querySelector('use')!.setAttribute('href', playing ? '#i-pause' : '#i-play');
}
function stopSlideshow() { clearTimeout(state.slideshow); state.slideshow = undefined; if (!state.animation?.playing) setPlaying(false); }
function stopAnimation() { state.animation?.close(); state.animation = null; }
function updatePageLabel() {
  $('page-controls').hidden = state.pages <= 1;
  $('page-label').textContent = `${state.animation ? 'Frame' : 'Page'} ${state.page + 1} / ${state.pages}`;
  $('page-prev').disabled = state.pages < 2; $('page-next').disabled = state.pages < 2;
}
function updateTransform(gpu: GPUCanvas) {
  $('zoom-value').textContent = `${(gpu.scale * 100).toFixed(gpu.scale < .1 ? 1 : 0)}%`;
  $('fit').setAttribute('aria-pressed', String(gpu.fitMode));
  $('flip').setAttribute('aria-pressed', String(gpu.flip[0] < 0));
}
function setMetadata(result: DisplayResult) {
  const { metadata: m, file } = result;
  $('detail-name').textContent = file.name;
  $('detail-format').textContent = `${m.format} · ${niceBytes(file.size)}`;
  const data = [
    ['Dimensions', `${number(m.width)} × ${number(m.height)} px`],
    ['Display texture', `${number(result.width)} × ${number(result.height)}${result.reduced ? ' (reduced preview)' : ''}`],
    ['Color', `${m.depth}-bit · ${m.space || 'unknown'}`],
    ['Profile', m.profile],
    ['Frames', number(state.pages)],
    ['Decoder', m.decoder],
    ['Modified', new Date(file.modified).toLocaleString()],
    ['Location', file.path]
  ];
  $('metadata').replaceChildren(...data.flatMap(([label, value]) => {
    const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value;
    return [dt, dd];
  }));
  $('reveal').disabled = false;
}
function updateNavigation() {
  $('previous').hidden = $('next').hidden = state.files.length <= 1;
  $('previous').disabled = state.index <= 0; $('next').disabled = state.index >= state.files.length - 1;
  $('image-count').textContent = `${state.files.length} image${state.files.length === 1 ? '' : 's'}`;
  $('file-subtitle').textContent = `${state.index + 1} of ${state.files.length}`;
  for (const button of Array.from($('filmstrip').children) as HTMLButtonElement[]) button.setAttribute('aria-current', String(Number(button.dataset.index) === state.index));
  $('filmstrip').children[state.index]?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
}

async function loadImage(index: number, { page = 0, preserve = false, keepSlideshow = false } = {}) {
  if (!state.files.length || index < 0 || index >= state.files.length) return;
  if (!keepSlideshow) stopSlideshow();
  stopAnimation();
  const generation = ++state.generation;
  state.index = index; state.page = page; state.pages = 1; state.busy = true;
  hideError(); $('empty').hidden = true; $('loading').hidden = false;
  $('image-controls').hidden = true; $('page-controls').hidden = true;
  if (!preserve) { state.gpu?.clear(); state.result = null; $('metadata').replaceChildren(); $('reveal').disabled = true; }
  const item = state.files[index];
  $('file-name').textContent = item.name; document.title = `${item.name} — Prism`;
  $('status').textContent = `Opening ${item.name}…`; updateNavigation();
  try {
    if (!state.gpu) throw gpuFailure || new Error('GPU rendering is unavailable.');
    const response = await api.decode(item.id, { page, maxEdge: state.gpu.maxTextureSize });
    if (generation !== state.generation) return;
    let bitmap: ImageBitmap;
    let result: DisplayResult;
    if (response.browser) {
      const decoded = await browserBitmap(await api.original(item.id), item.extension, state.gpu.maxTextureSize);
      bitmap = decoded.bitmap;
      const { bitmap: _bitmap, ...preview } = decoded;
      result = { ...preview, file: response.file };
    } else {
      result = response;
      if (!result.bytes) throw new Error('Decoder returned no image.');
      bitmap = await pngBitmap(result.bytes);
    }
    if (generation !== state.generation) { bitmap.close(); return; }
    // Use source dimensions for zoom percentages even when a preview is reduced.
    const displayWidth = result.reduced ? result.metadata.width : result.width;
    const displayHeight = result.reduced ? result.metadata.height : result.height;
    try { await state.gpu.setBitmap(bitmap, displayWidth, displayHeight, !preserve); }
    finally { bitmap.close(); }
    if (generation !== state.generation) return;
    state.result = result; state.pages = result.metadata.pages;
    // Release the encoded preview after its texture is uploaded.
    result.bytes = null;
    $('image-controls').hidden = false; updatePageLabel(); setMetadata(result);
    $('status').textContent = `${result.metadata.format} · ${number(result.metadata.width)} × ${number(result.metadata.height)} · ${niceBytes(result.file.size)}${result.reduced ? ' · Reduced preview (GPU / memory limit)' : ''}`;
    if (page === 0 && !result.reduced) await setupAnimation(item, generation, result);
  } catch (error) {
    if (generation === state.generation) showError(error, state.gpu ? 'Couldn’t open this image' : 'GPU rendering unavailable');
  } finally {
    if (generation === state.generation) { state.busy = false; $('loading').hidden = true; }
  }
}

async function setupAnimation(item: ImageFile, generation: number, result: DisplayResult) {
  const type = ({ GIF: 'image/gif', WEBP: 'image/webp', PNG: 'image/png', AVIF: 'image/avif', HEIF: item.extension === 'AVIF' ? 'image/avif' : null } as Record<string, string | null>)[result.metadata.format];
  if (!type) return;
  let animation;
  try {
    const bytes = await api.original(item.id);
    if (!bytes || generation !== state.generation) return;
    animation = await GPUAnimation.create(bytes, type, {
      draw: frame => state.gpu?.setFrame(frame),
      onFrame: index => { if (generation === state.generation) { state.page = index; updatePageLabel(); } },
      onPlaying: playing => { if (generation === state.generation) setPlaying(playing); },
      onError: error => { if (generation === state.generation) showError(error, 'Animation playback stopped'); }
    });
    if (generation !== state.generation) { animation?.close(); return; }
    if (animation) {
      state.animation = animation; state.pages = animation.count; updatePageLabel(); setMetadata(result); animation.play();
    }
  } catch (error) {
    // Keep the decoded still image usable if Chromium cannot animate this codec.
    animation?.close();
    if (generation === state.generation && result.metadata.pages > 1) $('status').textContent += ' · Use page controls for frames';
  }
}

async function setSelection(selection: Selection | null) {
  if (!selection) return;
  hideError();
  stopSlideshow(); stopAnimation(); state.generation++;
  state.files = selection.files; state.directory = selection.directory; state.index = selection.index;
  $('directory-name').textContent = selection.directory || 'Images';
  $('filmstrip-section').hidden = !state.files.length;
  buildFilmstrip();
  if (state.files.length) await loadImage(selection.index);
  else {
    state.gpu?.clear(); state.result = null; state.pages = 1; state.page = 0; state.busy = false;
    $('empty').hidden = false; $('loading').hidden = true; $('image-controls').hidden = true; $('page-controls').hidden = true; $('previous').hidden = $('next').hidden = true;
    $('file-name').textContent = 'No images in this folder'; $('file-subtitle').textContent = selection.directory; $('metadata').replaceChildren(); $('reveal').disabled = true;
    $('status').textContent = 'Folder contains no recognized image files';
  }
}

let thumbObserver: IntersectionObserver | undefined;
function buildFilmstrip() {
  thumbObserver?.disconnect();
  for (const url of state.thumbnailURLs) URL.revokeObjectURL(url);
  state.thumbnailURLs = [];
  const generation = ++state.thumbnailGeneration;
  const queue: HTMLButtonElement[] = []; let active = 0;
  const pump = () => {
    if (generation !== state.thumbnailGeneration || active >= 1 || !queue.length) return;
    const button = queue.shift()!; const item = state.files[Number(button.dataset.index)]; active++;
    api.thumbnail(item.id).then(async bytes => {
      if (generation !== state.thumbnailGeneration) return;
      return 'browser' in bytes ? browserThumbnail(await api.original(item.id), item.extension) : new Blob([bytes], { type: 'image/png' });
    }).then(blob => {
      if (generation !== state.thumbnailGeneration || !blob) return;
      const url = URL.createObjectURL(blob); state.thumbnailURLs.push(url);
      const img = document.createElement('img'); img.src = url; img.alt = ''; img.draggable = false;
      button.firstChild!.replaceWith(img);
    }).catch(() => { if (generation === state.thumbnailGeneration) button.title = `${item.name} — preview unavailable`; })
      .finally(() => { active--; pump(); });
  };
  thumbObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { thumbObserver!.unobserve(entry.target); queue.push(entry.target as HTMLButtonElement); }
    pump();
  }, { root: $('filmstrip'), rootMargin: '0px 180px' });
  const fragment = document.createDocumentFragment();
  state.files.forEach((file, index) => {
    const button = document.createElement('button'); button.className = 'thumbnail'; button.dataset.index = String(index); button.title = file.name; button.setAttribute('aria-label', `Open ${file.name}`);
    const placeholder = document.createElement('span'); placeholder.className = 'thumb-placeholder';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-image'); svg.append(use); placeholder.append(svg);
    const name = document.createElement('span'); name.textContent = file.name;
    button.append(placeholder, name); button.addEventListener('click', () => loadImage(index)); fragment.append(button);
  });
  $('filmstrip').replaceChildren(fragment);
  for (const button of Array.from($('filmstrip').children) as HTMLButtonElement[]) thumbObserver!.observe(button);
}

async function open(folder = false) { try { await setSelection(await api.open(folder)); } catch (error) { showError(error); } }
function navigate(delta: number) { return loadImage(state.index + delta); }
async function pageStep(delta: number) {
  if (!state.result || state.busy || state.pages <= 1) return;
  stopSlideshow();
  const page = (state.page + delta + state.pages) % state.pages;
  if (state.animation) await state.animation.seek(page);
  else await loadImage(state.index, { page, preserve: true });
}
function toggleInfo() {
  $('inspector').hidden = !$('inspector').hidden;
  $('info-toggle').setAttribute('aria-pressed', String(!$('inspector').hidden));
}
function cycleBackground() {
  state.background = (state.background + 1) % 3; $('stage').dataset.background = ['dark', 'checker', 'light'][state.background];
}
function togglePixel() {
  if (!state.gpu) return;
  state.gpu.setNearest(!state.gpu.nearest); $('pixel').setAttribute('aria-pressed', String(state.gpu.nearest));
}
function togglePlay() {
  if (!state.result || state.busy) return;
  if (state.animation) { state.animation.playing ? state.animation.pause() : state.animation.play(); return; }
  if (state.slideshow) { stopSlideshow(); return; }
  if (state.files.length < 2) return;
  const advance = async () => {
    const timer = state.slideshow;
    await loadImage((state.index + 1) % state.files.length, { keepSlideshow: true });
    if (state.slideshow !== timer) return;
    state.animation?.pause(); setPlaying(true); state.slideshow = setTimeout(advance, 4000);
  };
  setPlaying(true); state.slideshow = setTimeout(advance, 4000);
}

async function showDiagnostics() {
  if (!$('diagnostics').open) $('diagnostics').showModal();
  const section = document.createElement('div'); section.className = `gpu-summary${!state.gpu || state.gpu.software ? ' warning' : ''}`;
  const title = document.createElement('strong'); title.textContent = state.gpu ? (state.gpu.software ? 'Software WebGPU — explicit fallback' : 'WebGPU image rendering') : 'Hardware WebGPU unavailable'; section.append(title);
  const details = [
    state.gpu?.renderer || errorMessage(gpuFailure || 'No renderer'),
    state.gpu ? `Maximum texture edge: ${number(state.gpu.maxTextureSize)} px · Image textures capped at 32 megapixels` : '',
    state.gpuInfo ? `Chromium WebGPU: ${state.gpuInfo.features.webgpu || 'unknown'} · GPU compositing: ${state.gpuInfo.features.gpu_compositing || 'unknown'}` : '',
    `Electron ${state.gpuInfo?.electron || '?'} · Chromium ${state.gpuInfo?.chromium || '?'}`,
    `Experimental driver support: ${state.gpuInfo?.experimentalWebGPU ? 'enabled' : 'off'}`,
    'Image decoding runs on the CPU. Image drawing, zoom, pan, rotation, and sampling run in WebGPU shaders.'
  ].filter(Boolean);
  for (const line of details) { const p = document.createElement('p'); p.textContent = line; section.append(p); }
  $('gpu-details').replaceChildren(section);
  $('format-details').textContent = 'Checking image support…';
  try {
    state.capabilities ||= await api.capabilities();
    const c = state.capabilities;
    const heading = document.createElement('h2'); heading.textContent = 'Image support';
    const description = document.createElement('p'); description.className = 'format-description';
    const browser = await browserFormats();
    description.textContent = `Bun.Image ${c.version} (${c.backend}) decodes ${c.native.join(', ')}. Chromium adds ${browser.join(', ')} where supported.${c.system.length ? ` System-dependent formats: ${c.system.join(', ')}.` : ''} No external image tools are required.`;
    const grid = document.createElement('div'); grid.className = 'supported-grid';
    const names = [...new Set([...c.native, ...browser, ...c.system])].sort();
    for (const name of names) { const span = document.createElement('span'); span.textContent = name; grid.append(span); }
    const note = document.createElement('p'); note.className = 'format-description'; note.textContent = 'Format availability varies by platform. Bun.Image decodes the first image; Chromium provides GIF, WebP, APNG and AVIF animation where available. Display output is 8-bit. Browser-only files are limited to 64 MiB.';
    $('format-details').replaceChildren(heading, description, grid, note);
  } catch (error) { $('format-details').textContent = errorMessage(error); }
}

$('open').onclick = $('empty-open').onclick = () => open(); $('folder').onclick = () => open(true);
$('previous').onclick = () => navigate(-1); $('next').onclick = () => navigate(1);
$('zoom-in').onclick = () => state.gpu?.zoom(1.25); $('zoom-out').onclick = () => state.gpu?.zoom(.8);
$('zoom-value').onclick = () => state.gpu?.actualSize(); $('fit').onclick = () => state.gpu?.fit();
$('rotate').onclick = () => state.gpu?.rotate(); $('flip').onclick = () => state.gpu?.flipHorizontal();
$('pixel').onclick = togglePixel; $('background').onclick = cycleBackground; $('play').onclick = togglePlay;
$('page-prev').onclick = () => pageStep(-1); $('page-next').onclick = () => pageStep(1);
$('info-toggle').onclick = $('info-close').onclick = toggleInfo;
$('fullscreen').onclick = () => api.fullscreen();
$('reveal').onclick = () => { if (state.files[state.index]) api.reveal(state.files[state.index].id).catch(showError); };
$('error-dismiss').onclick = hideError;
for (const id of ['gpu-badge', 'formats-link', 'formats-footer']) $(id).onclick = showDiagnostics;
$('help').onclick = () => $('shortcuts').showModal();
for (const button of document.querySelectorAll<HTMLButtonElement>('.dialog-close')) button.onclick = () => button.closest('dialog')?.close();
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement | null)?.tagName || '')) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'o') { event.preventDefault(); open(event.shiftKey); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const actions: Record<string, () => unknown> = { arrowleft: () => navigate(-1), arrowright: () => navigate(1), '+': () => state.gpu?.zoom(1.25), '=': () => state.gpu?.zoom(1.25), '-': () => state.gpu?.zoom(.8), '0': () => state.gpu?.fit(), '1': () => state.gpu?.actualSize(), r: () => state.gpu?.rotate(event.shiftKey ? -1 : 1), h: () => state.gpu?.flipHorizontal(), f: () => api.fullscreen(), i: toggleInfo, b: cycleBackground, p: togglePixel, ' ': togglePlay, pageup: () => pageStep(-1), pagedown: () => pageStep(1), '?': () => $('shortcuts').showModal(), escape: () => { stopSlideshow(); state.animation?.pause(); hideError(); } };
  if (actions[key]) { event.preventDefault(); actions[key](); }
});
let dragDepth = 0;
document.addEventListener('dragenter', event => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) { dragDepth++; $('drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
document.addEventListener('drop', async event => {
  event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  if (!event.dataTransfer?.files.length) return;
  try { await setSelection(await api.openDropped(Array.from(event.dataTransfer.files))); } catch (error) { showError(error); }
});
api.onSelection(selection => setSelection(selection)); api.onError(error => showError(error)); api.onDiagnostics(showDiagnostics);
api.onFullscreen(enabled => $('fullscreen').setAttribute('aria-pressed', String(enabled)));

async function initialize() {
  try {
    state.gpuInfo = await api.gpu();
    state.gpu = await GPUCanvas.create($('image-canvas'), { allowSoftware: state.gpuInfo.allowSoftware, readback: state.gpuInfo.smoke, onChange: updateTransform, onError: error => { gpuFailure = error; stopSlideshow(); stopAnimation(); showError(error, 'GPU rendering interrupted'); $('gpu-label').textContent = 'GPU lost'; $('gpu-badge').classList.add('warning'); } });
    state.gpu.resize();
    // Adapter/device selection confirms the backend actually used for drawing.
    if (state.gpuInfo.smoke) {
      const gpu = state.gpu;
      window.prismTest = {
        info: () => ({ api: 'WebGPU', renderer: gpu.renderer, vendor: gpu.vendor, software: gpu.software, maxTextureSize: gpu.maxTextureSize }),
        pixel: (x, y) => gpu.readPixel(x, y),
        transform: () => ({ pan: { ...gpu.pan }, scale: gpu.scale, rotation: gpu.rotation, nearest: gpu.nearest }),
        loseDevice: () => gpu.loseDeviceForTest()
      };
    }
    state.gpuInfo = await api.gpu();
    $('gpu-label').textContent = state.gpu.software ? 'Software WebGPU' : 'GPU · WebGPU';
    $('gpu-badge').classList.toggle('warning', state.gpu.software);
  } catch (error) {
    gpuFailure = error; state.gpu = null; $('gpu-label').textContent = 'GPU unavailable'; $('gpu-badge').classList.add('warning'); showError(error, 'GPU rendering unavailable');
  }
  try { await setSelection(await api.initial()); } catch (error) { showError(error); }
  document.body.dataset.ready = 'true';
}
initialize();

window.addEventListener('beforeunload', () => { stopSlideshow(); stopAnimation(); state.gpu?.dispose(); });
