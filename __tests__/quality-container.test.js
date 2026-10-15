/** Exercise the actual pre-install Docker COPY layer, without copying the app tree. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('manifest-only Docker installation layer can run production postinstall', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'piqniq-container-layer-test-'));
  try {
    const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    const install = dockerfile.search(/^RUN npm ci\b/m);
    expect(install).toBeGreaterThan(0);
    // This deliberately supports only the repository's simple file COPY syntax.
    // New/changed layer syntax must receive an explicit test update, not be ignored.
    const copies = [...dockerfile.slice(0, install).matchAll(/^COPY (\S+) (\S+)\s*$/gm)];
    for (const [, source, target] of copies) {
      const files = source === 'package*.json' ? ['package.json', 'package-lock.json'] : [source];
      for (const file of files) {
        const sourcePath = path.resolve(root, file);
        const destination = path.resolve(fixture, target, path.basename(file));
        if (!sourcePath.startsWith(root + path.sep) || !destination.startsWith(fixture + path.sep) || !fs.statSync(sourcePath).isFile()) throw new Error('Unexpected Docker layer COPY scope');
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(sourcePath, destination);
      }
    }
    expect(fs.existsSync(path.join(fixture, 'app.js'))).toBe(false);
    expect(fs.existsSync(path.join(fixture, 'node_modules'))).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf8'));
    const [command, ...args] = manifest.scripts.postinstall.split(/\s+/);
    expect(command).toBe('node');
    const result = spawnSync(process.execPath, args, { cwd: fixture, encoding: 'utf8' });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(result.stdout).toContain('skipped (production install)');
  } finally {
    // Only the fresh mkdtemp-owned fixture is removed; no application uploads/data.
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
