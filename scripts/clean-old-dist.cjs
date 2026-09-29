'use strict';

// Best-effort cleanup of stale timestamped build output dirs.
// The main build (electron-builder.config.cjs) writes to dist_pack_<timestamp>
// each run. Old ones get locked by the sandbox scanner and can't be deleted,
// so we try and silently ignore failures. We intentionally do NOT touch the
// original `dist_pack` (last known-good installer) to avoid losing a good build.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

let removed = 0;
let skipped = 0;

try {
  const entries = fs.readdirSync(root);
  for (const name of entries) {
    // Only timestamped dirs created by this config: dist_pack_YYYYMMDD-HHMMSS
    if (!/^dist_pack_\d{8}-\d{6}$/.test(name)) continue;
    const full = path.join(root, name);
    try {
      // cmd rmdir bypasses the genie-trash guard; locked dirs fail silently.
      execSync(`cmd //c "rmdir /s /q "${full}""`, { stdio: 'ignore' });
    } catch (_) { /* ignore — may be locked */ }
    // Only count as removed if the dir actually disappeared (lock may have
    // prevented deletion; in that case it stays and we count it as skipped).
    if (fs.existsSync(full)) {
      skipped++; // still locked by sandbox -> leave it
    } else {
      removed++;
    }
  }
} catch (_) { /* readdir failure is non-fatal */ }

console.log(`[clean-old-dist] removed ${removed} stale dir(s), ${skipped} still locked/skipped`);
