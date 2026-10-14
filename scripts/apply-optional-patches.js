/**
 * The existing tr46 patch only removes a deprecation warning. Apply it for
 * development installs; production omits the development patch tool entirely.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'node_modules', 'patch-package', 'index.js');
if (fs.existsSync(entry)) {
  const result = spawnSync(process.execPath, [entry], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  console.log('Optional development deprecation patch skipped (production install).');
}
