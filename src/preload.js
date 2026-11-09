'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, fn) => { const h = (_e, data) => fn(data); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); };

contextBridge.exposeInMainWorld('forge', {
  init: () => ipcRenderer.invoke('app:init'),
  detectHardware: () => ipcRenderer.invoke('hardware:detect'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  chooseOutputDir: () => ipcRenderer.invoke('dialog:outputDir'),
  addPaths: (paths) => ipcRenderer.invoke('queue:addPaths', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  removeJob: (id) => ipcRenderer.invoke('queue:remove', id),
  cancelJob: (id) => ipcRenderer.invoke('queue:cancel', id),
  clearFinished: () => ipcRenderer.invoke('queue:clearFinished'),
  start: () => ipcRenderer.invoke('queue:start'),
  stop: () => ipcRenderer.invoke('queue:stop'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  openExternal: (u) => ipcRenderer.invoke('shell:openExternal', u),
  onJobUpdate: (fn) => on('job:update', fn),
  onJobRemoved: (fn) => on('job:removed', fn),
  onQueueIdle: (fn) => on('queue:idle', fn),
  onHardwareProgress: (fn) => on('hardware:progress', fn),
  onHardwareReady: (fn) => on('hardware:ready', fn),
});
