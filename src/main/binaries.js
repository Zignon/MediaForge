'use strict';
// Locates ffmpeg / ffprobe. In a packaged build they live in resources/ffmpeg;
// in development they are read from vendor/ffmpeg or, failing that, from PATH.
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const EXE = process.platform === 'win32' ? '.exe' : '';

function candidates(name) {
  const list = [];
  if (app.isPackaged) {
    list.push(path.join(process.resourcesPath, 'ffmpeg', name + EXE));
    list.push(path.join(process.resourcesPath, 'ffmpeg', 'bin', name + EXE));
  }
  const root = path.join(__dirname, '..', '..');
  list.push(path.join(root, 'vendor', 'ffmpeg', name + EXE));
  list.push(path.join(root, 'vendor', 'ffmpeg', 'bin', name + EXE));
  return list;
}

function resolve(name) {
  for (const c of candidates(name)) {
    if (fs.existsSync(c)) return c;
  }
  return name + EXE; // hope it is on PATH
}

let cache = null;
function getBinaries() {
  if (!cache) {
    cache = { ffmpeg: resolve('ffmpeg'), ffprobe: resolve('ffprobe') };
  }
  return cache;
}

module.exports = { getBinaries };
