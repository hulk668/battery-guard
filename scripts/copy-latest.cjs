'use strict';

// After electron-builder produces the installer in a timestamped dir
// (dist_pack_<timestamp>), copy the artifacts into a STABLE dist_pack/ folder
// so the user always finds dist_pack/BatteryGuard-Setup-1.0.0.exe at a known
// path. The old dist_pack/win-unpacked (locked by the sandbox scanner) is left
// untouched; only root-level files are overwritten, which is safe.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lastFile = path.join(root, 'dist_pack_last.txt');

let srcDir;
try {
  srcDir = fs.readFileSync(lastFile, 'utf8').trim();
} catch (_) {
  console.error('[copy-latest] dist_pack_last.txt not found; skipping copy');
  process.exit(0);
}

const src = path.join(root, srcDir);
const dst = path.join(root, 'dist_pack');

if (!fs.existsSync(src)) {
  console.error(`[copy-latest] source dir not found: ${src}`);
  process.exit(0);
}
fs.mkdirSync(dst, { recursive: true });

// Best-effort: drop the stale win-unpacked left over from the very first build
// (its default_app.asar is locked by the sandbox scanner; if so, this fails
// silently and is harmless). Keeps dist_pack/ containing only the new artifacts.
try {
  require('child_process').execSync(`cmd //c "rmdir /s /q "${path.join(dst, 'win-unpacked')}""`, { stdio: 'ignore' });
} catch (_) { /* locked -> leave it */ }

const artifacts = [
  'BatteryGuard-Setup-1.0.0.exe',
  'BatteryGuard-Setup-1.0.0.exe.blockmap',
  'latest.yml',
  'builder-debug.yml'
];

let copied = 0;
for (const name of artifacts) {
  const from = path.join(src, name);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(dst, name));
    copied++;
  }
}

console.log(`[copy-latest] copied ${copied} artifact(s) -> dist_pack/`);
console.log(`[copy-latest] installer: dist_pack\\BatteryGuard-Setup-1.0.0.exe`);
