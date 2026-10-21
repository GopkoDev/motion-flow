import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedFiles, syncShared } from './sync-shared.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = ['a', 'b'];

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'mf-sync-'));
  for (const plugin of PLUGINS) mkdirSync(join(root, 'plugins', plugin), { recursive: true });
  for (const [rel, text] of Object.entries(files)) write(root, `shared/${rel}`, text);
  return root;
}
function write(root, rel, text) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
const sync = (root, check = false) => syncShared({ root, check, plugins: PLUGINS });

test('sync copies every shared file into every plugin and writes the marker', () => {
  const root = repo({ 'lib/x.mjs': 'one', 'bin/tool': '#!/usr/bin/env node\n' });
  chmodSync(join(root, 'shared/bin/tool'), 0o755);
  try {
    assert.deepEqual(sharedFiles(root), ['bin/tool', 'lib/x.mjs']);
    const result = sync(root);
    assert.deepEqual(result.problems, []);
    for (const plugin of PLUGINS) {
      assert.equal(readFileSync(join(root, 'plugins', plugin, 'lib/x.mjs'), 'utf8'), 'one');
      assert.ok(statSync(join(root, 'plugins', plugin, 'bin/tool')).mode & 0o100, 'the executable bit is kept');
      assert.deepEqual(JSON.parse(readFileSync(join(root, 'plugins', plugin, '.shared.json'), 'utf8')).files, ['bin/tool', 'lib/x.mjs']);
    }
    assert.deepEqual(sync(root).changed, [], 'a second sync has nothing to do');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('check reports a missing copy, an edited copy and an outdated marker, and changes nothing', () => {
  const root = repo({ 'lib/x.mjs': 'one' });
  try {
    assert.equal(sync(root, true).problems.length, 4, 'two copies and two markers are missing');
    sync(root);
    assert.deepEqual(sync(root, true).problems, []);
    write(root, 'plugins/a/lib/x.mjs', 'edited in the plugin');
    assert.deepEqual(sync(root, true).problems, ['plugins/a/lib/x.mjs differs from shared/']);
    assert.equal(readFileSync(join(root, 'plugins/a/lib/x.mjs'), 'utf8'), 'edited in the plugin', 'check never writes');
    sync(root);
    assert.equal(readFileSync(join(root, 'plugins/a/lib/x.mjs'), 'utf8'), 'one', 'sync puts the shared source back');
    write(root, 'shared/lib/y.mjs', 'new');
    assert.ok(sync(root, true).problems.some((p) => p.includes('y.mjs is missing')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a file removed from shared/ is removed from the plugins, but only if sync put it there', () => {
  const root = repo({ 'lib/x.mjs': 'one', 'lib/y.mjs': 'two' });
  try {
    sync(root);
    write(root, 'plugins/a/lib/own.mjs', "the plugin's own file");
    rmSync(join(root, 'shared/lib/y.mjs'));
    assert.deepEqual(sync(root, true).problems.filter((p) => p.includes('y.mjs')).length, 2, 'both stale copies are reported');
    sync(root);
    assert.ok(!existsSync(join(root, 'plugins/a/lib/y.mjs')) && !existsSync(join(root, 'plugins/b/lib/y.mjs')));
    assert.ok(existsSync(join(root, 'plugins/a/lib/own.mjs')), "the plugin's own files are never touched");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a plugin folder that does not exist is a problem', () => {
  const root = repo({ 'lib/x.mjs': 'one' });
  try {
    rmSync(join(root, 'plugins/b'), { recursive: true });
    assert.deepEqual(sync(root, true).problems.filter((p) => p.includes('plugins/b does not exist')).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('in this repository every plugin copy matches shared/', () => {
  const { problems } = syncShared({ root: REPO, check: true });
  assert.deepEqual(problems, [], 'Run: npm run sync');
});
