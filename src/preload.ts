// SPDX-License-Identifier: Apache-2.0
import type { ViewerAPI } from './types.js';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
const on = <T>(channel: string, callback: (value: T) => void) => {
  const listener = (_: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const viewer: ViewerAPI = {
  initial: () => ipcRenderer.invoke('initial'),
  open: folder => ipcRenderer.invoke('open', folder),
  openDropped: files => ipcRenderer.invoke('open-paths', Array.from(files, file => webUtils.getPathForFile(file)).filter(Boolean)),
  decode: (id, options) => ipcRenderer.invoke('decode', id, options),
  thumbnail: id => ipcRenderer.invoke('thumbnail', id),
  original: id => ipcRenderer.invoke('original', id),
  capabilities: () => ipcRenderer.invoke('capabilities'),
  gpu: () => ipcRenderer.invoke('gpu'),
  fullscreen: () => ipcRenderer.invoke('fullscreen'),
  reveal: id => ipcRenderer.invoke('reveal', id),
  onSelection: callback => on('selection', callback),
  onError: callback => on('viewer-error', callback),
  onFullscreen: callback => on('fullscreen', callback),
  onDiagnostics: callback => on('show-diagnostics', callback)
};
contextBridge.exposeInMainWorld('viewer', viewer);
