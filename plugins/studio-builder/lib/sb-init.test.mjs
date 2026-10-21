// sb-init is the shared init-project code run with the studio-builder templates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));

test('sb-init sets a studio folder up with the studio-builder templates and never overwrites', () => {
  const base = mkdtempSync(join(tmpdir(), 'sb-init-'));
  try {
    const home = join(base, 'home');
    const folder = join(base, 'studios', 'acme');
    mkdirSync(join(home, '.motion-flow'), { recursive: true });
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(home, '.motion-flow', 'roots.json'), JSON.stringify({ roots: { assets: join(base, 'Drive', 'Assets') } }));
    const run = (...args) => spawnSync(process.execPath, [join(PLUGIN, 'bin', 'sb-init'), '--project', folder, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
    const first = run('--no-drive', '--no-studio');
    assert.equal(first.status, 0, first.stderr);
    const settings = JSON.parse(readFileSync(join(folder, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(Object.keys(settings.enabledPlugins), ['studio-builder@motion']);
    assert.ok(settings.permissions.allow.includes('Bash(sb-corpus *)'));
    assert.match(readFileSync(join(folder, 'CLAUDE.md'), 'utf8'), /^# Studio folder/);
    assert.ok(existsSync(join(folder, 'work')) && existsSync(join(folder, '.motion', 'drive.json')) && existsSync(join(folder, '.motion', 'studio.json')));
    writeFileSync(join(folder, 'CLAUDE.md'), 'mine');
    assert.equal(run('--no-drive', '--no-studio').status, 0);
    assert.equal(readFileSync(join(folder, 'CLAUDE.md'), 'utf8'), 'mine', 'an existing file is left alone');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
