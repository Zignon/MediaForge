'use strict';
// electron-builder afterPack hook. Stamps the Media Forge icon and version
// info into the packaged executable using a pure-JavaScript PE editor, so the
// build works on Windows, Linux and macOS without wine or rcedit.
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const icoPath = path.join(root, 'build', 'icon.ico');

  const exeData = fs.readFileSync(exe);
  const pe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(pe);

  // ---- icon ----
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, 1, 1033, ico.icons.map((i) => i.data));

  // ---- version info ----
  const [maj = 1, min = 0, pat = 0] = pkg.version.split('.').map((n) => parseInt(n, 10) || 0);
  const vi = ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(maj, min, pat, 0, 1033);
  vi.setProductVersion(maj, min, pat, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    CompanyName: pkg.author || 'Media Forge',
    FileDescription: pkg.productName,
    FileVersion: pkg.version,
    InternalName: pkg.productName,
    LegalCopyright: pkg.build.copyright,
    OriginalFilename: `${pkg.productName}.exe`,
    ProductName: pkg.productName,
    ProductVersion: pkg.version,
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log(`  • stamped icon and version info into ${path.basename(exe)}`);
};
