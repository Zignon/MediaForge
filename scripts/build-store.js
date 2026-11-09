'use strict';
// Builds the Microsoft Store package (dist-store/MediaForge-Store-<version>-x64.appx).
//
//   1. Copy store.identity.example.json → store.identity.json and paste the values
//      from Partner Center → your product → Product management → Product identity.
//   2. On Windows 10/11 with the Windows 10/11 SDK installed:  npm run store
//
// The package is left UNSIGNED on purpose: the Store signs it with Microsoft's
// certificate after you upload it. To sideload for testing, see store/SUBMISSION-CHECKLIST.md.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const identityFile = path.join(root, 'store.identity.json');
const baseConfig = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.store.json'), 'utf8'));

if (process.platform !== 'win32') {
  console.error('The AppX/MSIX target needs Microsoft\'s makeappx.exe from the Windows SDK: run this on Windows 10/11.');
  process.exit(1);
}
if (!fs.existsSync(identityFile)) {
  console.error('store.identity.json not found.\nCopy store.identity.example.json to store.identity.json and fill it from Partner Center (Product identity page).');
  process.exit(1);
}
const id = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
for (const k of ['identityName', 'publisher', 'publisherDisplayName']) {
  if (!id[k] || /PARTNER_CENTER/.test(id[k])) { console.error(`store.identity.json: "${k}" is missing or still a placeholder.`); process.exit(1); }
}
if (!/^CN=/.test(id.publisher)) { console.error('store.identity.json: "publisher" must be the full Package/Identity/Publisher string, e.g. "CN=12345678-ABCD-...".'); process.exit(1); }
if (!fs.existsSync(path.join(root, 'vendor', 'ffmpeg', 'ffmpeg.exe'))) {
  console.log('[store] fetching FFmpeg…');
  execFileSync(process.execPath, [path.join(__dirname, 'fetch-ffmpeg.js')], { stdio: 'inherit' });
}

const config = { ...baseConfig, appx: { ...baseConfig.appx, ...id } };
delete config.$comment;
const tmpConfig = path.join(root, 'dist-store', 'electron-builder.resolved.json');
fs.mkdirSync(path.dirname(tmpConfig), { recursive: true });
fs.writeFileSync(tmpConfig, JSON.stringify(config, null, 2));

console.log(`[store] building AppX for ${config.appx.identityName} (${config.appx.publisherDisplayName})`);
const eb = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
execFileSync(eb, ['--win', '--x64', '--config', tmpConfig], { stdio: 'inherit', shell: process.platform === 'win32' });

const out = fs.readdirSync(path.join(root, 'dist-store')).filter((f) => f.endsWith('.appx') || f.endsWith('.msix'));
console.log('\n[store] package ready for upload to Partner Center:');
for (const f of out) console.log('  ' + path.join('dist-store', f));
console.log('\nNext: Partner Center → your product → Packages → drag the .appx in, then fill the Store listing from store/LISTING.md.');
