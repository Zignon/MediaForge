'use strict';
// Downloads a static Windows x64 FFmpeg build (BtbN GPL build, which includes
// NVENC, QSV, AMF, x264, x265, SVT-AV1, libvpx, opus, etc.) into vendor/ffmpeg.
// Skipped when ffmpeg.exe is already present. Set FFMPEG_ZIP_URL to override.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const URL = process.env.FFMPEG_ZIP_URL ||
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
const root = path.join(__dirname, '..');
const dest = path.join(root, 'vendor', 'ffmpeg');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-ffmpeg-'));
const zip = path.join(tmp, 'ffmpeg.zip');

if (fs.existsSync(path.join(dest, 'ffmpeg.exe')) && fs.existsSync(path.join(dest, 'ffprobe.exe'))) {
  console.log('[fetch-ffmpeg] vendor/ffmpeg already populated, skipping download.');
  process.exit(0);
}
fs.mkdirSync(dest, { recursive: true });
console.log(`[fetch-ffmpeg] downloading ${URL}`);
execFileSync('curl', ['-L', '--fail', '--retry', '3', '-o', zip, URL], { stdio: 'inherit' });

console.log('[fetch-ffmpeg] extracting');
const extractDir = path.join(tmp, 'x');
fs.mkdirSync(extractDir);
if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', extractDir], { stdio: 'inherit' });
else {
  try { execFileSync('unzip', ['-q', zip, '-d', extractDir], { stdio: 'inherit' }); }
  catch (_) { execFileSync('python3', ['-c', `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`, zip, extractDir], { stdio: 'inherit' }); }
}

function find(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = find(p, name); if (r) return r; }
    else if (e.name.toLowerCase() === name) return p;
  }
  return null;
}
for (const n of ['ffmpeg.exe', 'ffprobe.exe']) {
  const src = find(extractDir, n);
  if (!src) throw new Error(`${n} not found in archive`);
  fs.copyFileSync(src, path.join(dest, n));
}
const lic = find(extractDir, 'license.txt');
if (lic) fs.copyFileSync(lic, path.join(dest, 'FFMPEG-LICENSE.txt'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`[fetch-ffmpeg] ready in ${dest}`);
