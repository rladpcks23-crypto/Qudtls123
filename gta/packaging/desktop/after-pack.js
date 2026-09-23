// wine 없이 리눅스에서 빌드하려고 electron-builder의 rcedit 단계(signAndEditExecutable)를 끄고,
// 대신 순수 JS 라이브러리 resedit으로 exe 안의 아이콘과 버전 정보를 바꾼다.
const fs = require('fs');
const path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const ntExe = R.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const rs = R.NtExecutableResource.from(ntExe);
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(rs.entries);
  const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  R.Resource.IconGroupEntry.replaceIconsForResource(rs.entries, gid, lang, ico.icons.map(i => i.data));
  const vi = R.Resource.VersionInfo.fromEntries(rs.entries)[0];
  if (vi) {
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'Neon Harbor', FileDescription: '네온 하버', CompanyName: 'Neon Harbor', OriginalFilename: 'NeonHarbor.exe' });
    vi.setFileVersion(1, 0, 0, 0); vi.setProductVersion(1, 0, 0, 0);
    vi.outputToResourceEntries(rs.entries);
  }
  rs.outputResource(ntExe);
  fs.writeFileSync(exe, Buffer.from(ntExe.generate()));
  console.log('  • icon/version patched with resedit:', path.basename(exe));
};
