const path = require('path');
const rcedit = require('rcedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const icon = path.join(context.packager.projectDir, 'build', 'icon.ico');
  await rcedit(exe, {
    icon,
    'version-string': {
      ProductName: 'JSPDF',
      FileDescription: 'JSPDF',
      CompanyName: 'jiseok',
      LegalCopyright: 'Copyright © 2026 jiseok',
      OriginalFilename: 'JSPDF.exe',
      InternalName: 'JSPDF'
    }
  });
  console.log('afterPack: embedded JS icon and JSPDF metadata ->', exe);
};
