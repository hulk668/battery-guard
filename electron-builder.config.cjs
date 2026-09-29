'use strict';

// electron-builder reads this instead of the "build" block in package.json.
// Why a separate file: the sandbox process locks the previously built
// default_app.asar inside <output>/win-unpacked/resources, so re-running the
// build on the SAME output dir fails with EBUSY on unlink. Pointing each build
// at a brand-new, never-locked directory sidesteps that entirely.
//
// The installer file name stays stable via artifactName, so callers can always
// find <output>/BatteryGuard-Setup-1.0.0.exe regardless of the timestamped dir.

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const stamp =
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
  `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const outputDir = `dist_pack_${stamp}`;

// Persist the chosen path so a helper/script can locate the latest installer.
const fs = require('fs');
try {
  fs.writeFileSync(
    require('path').join(__dirname, 'dist_pack_last.txt'),
    outputDir + '\n'
  );
} catch (_) { /* non-fatal */ }

module.exports = {
  appId: 'com.batteryguard.app',
  productName: 'BatteryGuard',
  directories: {
    output: outputDir,
    buildResources: 'build'
  },
  files: [
    'dist/**',
    'electron/**',
    'package.json'
  ],
  asar: true,
  asarUnpack: [
    '**/*.node'
  ],
  electronDist: 'node_modules/electron/dist',
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    icon: 'build/icon.ico'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '电池守护',
    language: '2052',
    artifactName: 'BatteryGuard-Setup-${version}.${ext}'
  }
};
