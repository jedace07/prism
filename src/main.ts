// SPDX-License-Identifier: Apache-2.0
import type { ViewerAPI, GPUInfo } from './types.js';
type Handlers = Pick<ViewerAPI, 'initial' | 'open' | 'decode' | 'thumbnail' | 'original' | 'capabilities' | 'gpu' | 'fullscreen' | 'reveal'> & { 'open-paths': (paths: string[]) => ReturnType<ViewerAPI['initial']> };
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DecodeService } from './decode-service.js';
import { EXTENSIONS, isImage } from './formats.js';

const allowSoftware = process.argv.includes('--allow-software-rendering');
const smokeIndex = process.argv.indexOf('--smoke');
const smokeReport = smokeIndex >= 0 ? process.argv[smokeIndex + 1] : null;
// Do not silently replace actual GPU rendering with SwiftShader on normal runs.
if (!allowSoftware) app.commandLine.appendSwitch('disable-software-rasterizer');
app.setName('Prism');
let window: BrowserWindow | null = null;
let decoder: DecodeService;
let files = new Map<string, string>();
let selectionVersion = 0;
let pendingOpen: string[] | null = null;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const indexFile = path.join(__dirname, 'renderer', 'index.html');
const indexURL = pathToFileURL(indexFile).href;

function fileArguments(argv: string[]) {
  const args = argv.slice(process.defaultApp ? 2 : 1);
  const skipValues = new Set(['--smoke', '--user-data-dir', '--ozone-platform', '--remote-debugging-port']);
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (skipValues.has(args[i])) { i++; continue; }
    if (!args[i].startsWith('-')) result.push(path.resolve(args[i]));
  }
  return result;
}

async function listDirectory(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.filter(e => (e.isFile() || e.isSymbolicLink()) && isImage(e.name)).map(e => path.join(directory, e.name)).sort((a, b) => collator.compare(path.basename(a), path.basename(b))).slice(0, 10000);
}

async function choosePaths(paths: string[], browseSiblings = true) {
  const version = ++selectionVersion;
  if (!Array.isArray(paths) || paths.length > 10000 || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0'))) throw new Error('Select local files or a folder.');
  let selected: string | null = null;
  let candidates: string[] = [];
  for (const file of paths) {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) candidates.push(...await listDirectory(file));
    else if (stat.isFile()) { selected ||= file; candidates.push(file); }
  }
  if (paths.length === 1 && selected && browseSiblings) {
    const siblings = await listDirectory(path.dirname(selected));
    candidates = siblings.includes(selected) ? siblings : [...siblings, selected].sort(collator.compare);
  }
  const unique = [...new Set(candidates)].slice(0, 10000);
  const next = new Map<string, string>();
  const list = unique.map(file => {
    const id = randomUUID(); next.set(id, file);
    return { id, name: path.basename(file), extension: path.extname(file).slice(1).toUpperCase() };
  });
  if (version !== selectionVersion) return null;
  files = next;
  const selectedIndex = selected ? unique.indexOf(selected) : 0;
  return { files: list, index: Math.max(0, selectedIndex), directory: unique.length ? path.dirname(unique[0]) : paths[0] || '' };
}

async function selectDialog(folder = false) {
  const result = await dialog.showOpenDialog(window!, {
    title: folder ? 'Open image folder' : 'Open images',
    properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
    filters: folder ? undefined : [{ name: 'Images', extensions: EXTENSIONS }, { name: 'All files', extensions: ['*'] }]
  });
  return result.canceled ? null : choosePaths(result.filePaths);
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (!window || event.sender !== window!.webContents || event.senderFrame !== window!.webContents.mainFrame || event.senderFrame.url !== indexURL) throw new Error('Untrusted request.');
}
function authorized(id: string) {
  const file = files.get(id);
  if (!file) throw new Error('Image is no longer in the open folder.');
  return file;
}
function handle<K extends keyof Handlers>(name: K, fn: Handlers[K]) { ipcMain.handle(name, (event, ...args) => { trusted(event); return (fn as (...args: unknown[]) => unknown)(...args); }); }

async function gpuInfo(): Promise<GPUInfo> {
  let info: GPUInfo['info'] = {};
  try { info = await app.getGPUInfo('basic') as GPUInfo['info']; } catch { /* shown as unknown */ }
  return { features: { ...app.getGPUFeatureStatus() }, info, allowSoftware, electron: process.versions.electron, chromium: process.versions.chrome };
}

app.on('open-file', (event, file) => {
  event.preventDefault();
  if (window?.webContents && !window!.webContents.isLoading()) choosePaths([file]).then(selection => window!.webContents.send('selection', selection)).catch(showError);
  else pendingOpen = [file];
});
function showError(error: Error) { if (window) window!.webContents.send('viewer-error', error.message); }
if (!smokeReport && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_, argv) => {
    if (window?.isMinimized()) window!.restore();
    window?.focus();
    const paths = fileArguments(argv);
    if (paths.length) choosePaths(paths).then(selection => window!.webContents.send('selection', selection)).catch(showError);
  });
  app.whenReady().then(async () => {
    decoder = new DecodeService();
    session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_, callback) => callback({ cancel: true }));
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 800, minHeight: 580, backgroundColor: '#111216', title: 'Prism — Local image viewer', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
    window!.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window!.webContents.on('will-navigate', event => event.preventDefault());
    window!.webContents.on('will-attach-webview', event => event.preventDefault());
    window!.on('enter-full-screen', () => window!.webContents.send('fullscreen', true));
    window!.on('leave-full-screen', () => window!.webContents.send('fullscreen', false));
    window!.on('closed', () => { window = null; });

    handle('initial', async () => {
      const paths = pendingOpen || fileArguments(process.argv);
      pendingOpen = null;
      return paths.length ? choosePaths(paths) : null;
    });
    handle('open', folder => selectDialog(folder === true));
    handle('open-paths', paths => choosePaths(paths));
    handle('decode', async (id, options = {}) => {
      const file = authorized(id);
      const page = options.page ?? 0;
      const maxEdge = options.maxEdge ?? 16384;
      if (!Number.isInteger(page) || !Number.isFinite(maxEdge)) throw new Error('Invalid rendering options.');
      const result = await decoder.request('decode', file, { page, maxEdge, thumbnail: false });
      const stat = await fs.stat(file);
      return { ...result, file: { name: path.basename(file), path: file, size: stat.size, modified: stat.mtime.toISOString() } };
    });
    handle('thumbnail', async id => {
      const result = await decoder.request('decode', authorized(id), { thumbnail: true });
      if (result.browser) return { browser: true };
      if (!result.bytes) throw new Error('Decoder returned no thumbnail.');
      return result.bytes;
    });
    handle('original', async id => {
      const file = authorized(id);
      const stat = await fs.stat(file);
      if (stat.size > 64 * 1024 * 1024) return null;
      return new Uint8Array(await fs.readFile(file));
    });
    handle('capabilities', () => decoder.request('capabilities'));
    handle('gpu', gpuInfo);
    handle('fullscreen', async () => { window!.setFullScreen(!window!.isFullScreen()); return window!.isFullScreen(); });
    handle('reveal', async id => shell.showItemInFolder(authorized(id)));
    const openFromMenu = (folder: boolean) => selectDialog(folder).then(selection => { if (selection) window!.webContents.send('selection', selection); }).catch(showError);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [{ label: 'Open images…', accelerator: 'CmdOrCtrl+O', click: () => openFromMenu(false) }, { label: 'Open folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => openFromMenu(true) }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'toggleDevTools' }, { label: 'Rendering diagnostics', click: () => window!.webContents.send('show-diagnostics') }] }
    ] as Electron.MenuItemConstructorOptions[]));
    await window!.loadFile(indexFile);
    if (smokeReport) {
      const { run } = await import('./smoke.js');
      run({ window, choosePaths, gpuInfo, reportPath: smokeReport, app }).catch(error => { console.error(error); app.exit(1); });
    }
  }).catch(error => { console.error(error); app.exit(1); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// Recreate the app on macOS after the final window closes.
app.on('activate', () => { if (!window) { app.relaunch(); app.exit(0); } });
app.on('before-quit', () => { decoder?.close(); });
