'use strict';
// Downloads the Microsoft Visual C++ 2015-2022 x64 redistributable into
// vendor/prereqs so the installer can set it up silently on machines that
// lack it. Non-fatal: if the download is unavailable the installer simply
// skips this step (Windows 10/11 normally ships the runtime already).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const URL = process.env.VCREDIST_URL || 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
const dest = path.join(__dirname, '..', 'vendor', 'prereqs');
const file = path.join(dest, 'vc_redist.x64.exe');
fs.mkdirSync(dest, { recursive: true });
if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) { console.log('[fetch-vcredist] already present.'); process.exit(0); }
try {
  console.log(`[fetch-vcredist] downloading ${URL}`);
  execFileSync('curl', ['-L', '--fail', '--retry', '2', '-o', file, URL], { stdio: 'inherit' });
  console.log('[fetch-vcredist] ready');
} catch (e) {
  try { fs.unlinkSync(file); } catch (_) {}
  console.warn('[fetch-vcredist] download failed; installer will skip the VC++ runtime step.');
  fs.writeFileSync(path.join(dest, '.keep'), '');
}
