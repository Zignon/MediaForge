'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const hardware = require('./hardware');
const { JobQueue } = require('./jobs');
const { CONTAINERS } = require('./encoder-args');

const VIDEO_EXT = ['mkv', 'mp4', 'avi', 'mpg', 'mpeg', 'mov', 'wmv', 'ts', 'm2ts', 'mts', 'webm', 'flv', 'm4v', 'vob', '3gp', 'ogv', 'divx', 'asf', 'mxf', 'm2v'];

const DEFAULT_SETTINGS = {
  container: 'mp4', videoCodec: 'h264', encoder: 'auto', hwDecode: true, speed: 'balanced',
  qualityMode: 'quality', quality: 22, bitrateKbps: 6000, resolution: 'source', fps: 'source',
  audioCodec: 'aac', audioBitrate: 192, subtitles: 'keep', outputMode: 'custom', outputDir: '', suffix: '', stripMetadata: true,
  concurrency: 1, openFolderWhenDone: false,
};

let win = null;
let settings = { ...DEFAULT_SETTINGS };
const queue = new JobQueue();
let blockerId = null;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch (_) {}
  if (!settings.outputDir) settings.outputDir = path.join(app.getPath('videos'), 'Media Forge');
}
function saveSettings() { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (_) {} }

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
function jobView(j) { const { probe, ...rest } = j; return rest; }

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 980, minHeight: 640,
    backgroundColor: '#07101f',
    title: 'Media Forge',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon-256.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function collectFiles(paths) {
  const out = [];
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        for (const f of fs.readdirSync(p)) { const fp = path.join(p, f); try { if (fs.statSync(fp).isFile() && VIDEO_EXT.includes(path.extname(f).slice(1).toLowerCase())) out.push(fp); } catch (_) {} }
      } else if (VIDEO_EXT.includes(path.extname(p).slice(1).toLowerCase())) out.push(p);
    } catch (_) {}
  }
  return out;
}

// ---------- IPC ----------
ipcMain.handle('app:init', () => ({
  settings, jobs: queue.list().map(jobView), hardware: hardware.getCached(), containers: CONTAINERS,
  version: app.getVersion(), cpuCount: os.cpus().length,
}));
ipcMain.handle('hardware:detect', async () => {
  const info = await hardware.detect((msg) => send('hardware:progress', msg));
  send('hardware:ready', info);
  return info;
});
ipcMain.handle('settings:update', (_e, patch) => { settings = { ...settings, ...patch }; saveSettings(); return settings; });
ipcMain.handle('dialog:openFiles', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Video files', extensions: VIDEO_EXT }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled) return [];
  return (await queue.add(collectFiles(r.filePaths))).map(jobView);
});
ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled) return [];
  return (await queue.add(collectFiles(r.filePaths))).map(jobView);
});
ipcMain.handle('dialog:outputDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outputDir });
  if (r.canceled) return null;
  settings.outputDir = r.filePaths[0]; saveSettings(); return settings.outputDir;
});
ipcMain.handle('queue:addPaths', async (_e, paths) => (await queue.add(collectFiles(paths))).map(jobView));
ipcMain.handle('queue:remove', (_e, id) => queue.remove(id));
ipcMain.handle('queue:cancel', (_e, id) => queue.cancel(id));
ipcMain.handle('queue:clearFinished', () => queue.clearFinished());
ipcMain.handle('queue:start', () => { queue.start(settings); if (blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension'); return true; });
ipcMain.handle('queue:stop', () => queue.stop());
ipcMain.handle('shell:openPath', (_e, p) => { try { if (p === settings.outputDir) fs.mkdirSync(p, { recursive: true }); } catch (_) {} return shell.openPath(p); });
ipcMain.handle('shell:showInFolder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:openExternal', (_e, u) => shell.openExternal(u));

queue.on('update', (j) => send('job:update', jobView(j)));
queue.on('removed', (id) => send('job:removed', id));
queue.on('idle', () => {
  if (blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
  send('queue:idle');
  if (settings.openFolderWhenDone && settings.outputMode !== 'source') shell.openPath(settings.outputDir);
});

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  // Files passed on the command line (double-clicked associations, "Open with")
  const argPaths = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('--') && fs.existsSync(a));
  if (argPaths.length) win.webContents.once('did-finish-load', () => queue.add(collectFiles(argPaths)));
});
app.on('second-instance', (_e, argv) => {
  const argPaths = argv.slice(1).filter((a) => !a.startsWith('--') && fs.existsSync(a));
  if (argPaths.length) queue.add(collectFiles(argPaths));
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
if (!app.requestSingleInstanceLock()) app.quit();
app.on('window-all-closed', () => { queue.stop(); app.quit(); });
