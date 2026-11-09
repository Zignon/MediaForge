'use strict';
// Compiles build/mediaforge.nsi into dist/MediaForge-Setup-<version>-x64.exe.
// Works on Windows, Linux and macOS without wine: NSIS writes the uninstaller
// on the target machine, so no exe editing is needed at build time.
//
// Run `electron-builder --win --x64 --dir` first (npm run pack) so that
// dist/win-unpacked exists.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appDir = path.join(root, 'dist', 'win-unpacked');
const outFile = path.join(root, 'dist', `MediaForge-Setup-${pkg.version}-x64.exe`);
const prereqDir = path.join(root, 'vendor', 'prereqs');
const NSIS_VERSION = '3.0.4.1';

if (!fs.existsSync(path.join(appDir, 'Media Forge.exe'))) {
  console.error('dist/win-unpacked not found. Run "npm run pack" first.');
  process.exit(1);
}
fs.mkdirSync(prereqDir, { recursive: true });

function cacheRoot() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || os.homedir(), 'electron-builder', 'Cache');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'electron-builder');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'electron-builder');
}

function ensureNsis() {
  const dir = path.join(cacheRoot(), 'nsis', `nsis-${NSIS_VERSION}`);
  const bin = process.platform === 'win32' ? path.join(dir, 'Bin', 'makensis.exe')
    : process.platform === 'darwin' ? path.join(dir, 'mac', 'makensis') : path.join(dir, 'linux', 'makensis');
  if (fs.existsSync(bin)) return { dir, bin };
  console.log('[installer] downloading NSIS…');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const sevenZip = require('7zip-bin').path7za;
  const tmp = path.join(os.tmpdir(), `nsis-${NSIS_VERSION}.7z`);
  const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-${NSIS_VERSION}/nsis-${NSIS_VERSION}.7z`;
  execFileSync('curl', ['-L', '--fail', '--retry', '3', '-o', tmp, url], { stdio: 'inherit' });
  execFileSync(sevenZip, ['x', '-y', `-o${dir}`, tmp], { stdio: 'inherit' });
  fs.unlinkSync(tmp);
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  return { dir, bin };
}

const { dir, bin } = ensureNsis();
const script = path.join(root, 'build', 'mediaforge.nsi');
const args = [
  '-V2',
  `-DAPP_DIR=${appDir}`,
  `-DVERSION=${pkg.version}`,
  `-DOUT_FILE=${outFile}`,
  `-DPREREQ_DIR=${prereqDir}`,
  script,
];
if (process.platform === 'win32') args.unshift('/V2'); // harmless duplicate verbosity flag for native style
console.log(`[installer] compiling ${path.basename(script)} → ${path.relative(root, outFile)}`);
execFileSync(bin, args.filter((a) => a !== '/V2'), { stdio: 'inherit', env: { ...process.env, NSISDIR: dir } });
const mb = (fs.statSync(outFile).size / 1048576).toFixed(1);
console.log(`[installer] done: ${outFile} (${mb} MB)`);
