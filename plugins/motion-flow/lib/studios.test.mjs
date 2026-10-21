import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listStudios, projectStudioName, resolveStudio, studiosDir } from './studios.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
let base; let home; let project;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mf-studios-'));
  home = join(base, 'home');
  project = join(base, 'project');
  mkdirSync(join(home, '.motion-flow'), { recursive: true });
  mkdirSync(join(project, '.motion'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const studio = (name, dir = join(home, 'Documents', 'studios')) => mkdirSync(join(dir, name, 'rules'), { recursive: true });
const choose = (name) => writeFileSync(join(project, '.motion', 'studio.json'), JSON.stringify({ name }));

test('the studios folder is ~/Documents/studios unless studios.json moves it', () => {
  assert.equal(studiosDir(home), join(home, 'Documents', 'studios'));
  writeFileSync(join(home, '.motion-flow', 'studios.json'), JSON.stringify({ dir: '~/work/studios' }));
  assert.equal(studiosDir(home), join(home, 'work', 'studios'));
  writeFileSync(join(home, '.motion-flow', 'studios.json'), '{ nope');
  assert.equal(studiosDir(home), join(home, 'Documents', 'studios'), 'a broken file falls back to the default');
});

test('listStudios finds folders with a rules/ folder, sorted, and ignores the rest', () => {
  const dir = join(home, 'Documents', 'studios');
  assert.deepEqual(listStudios(dir), [], 'no folder yet');
  studio('nova');
  studio('acme');
  mkdirSync(join(dir, 'empty'));
  mkdirSync(join(dir, '.hidden', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'notes.md'), 'x');
  assert.deepEqual(listStudios(dir).map((s) => s.name), ['acme', 'nova']);
});

test('resolveStudio says where the rules are, or why they cannot be found', () => {
  assert.equal(resolveStudio(project, home).reason, 'no_studio');
  choose(null);
  assert.equal(resolveStudio(project, home).reason, 'no_studio');
  choose('acme');
  assert.equal(resolveStudio(project, home).reason, 'studio_missing');
  studio('acme');
  const found = resolveStudio(project, home);
  assert.deepEqual([found.ok, found.name, found.path, found.rules, found.changelog], [true, 'acme', join(home, 'Documents', 'studios', 'acme'), join(home, 'Documents', 'studios', 'acme', 'rules'), null]);
  writeFileSync(join(found.path, 'CHANGELOG.md'), '## 0.1.0\n');
  assert.equal(resolveStudio(project, home).changelog, join(found.path, 'CHANGELOG.md'));
});

test('a studio name that is not a plain folder name is ignored', () => {
  for (const name of ['../acme', 'a/b', '', 5]) {
    choose(name);
    assert.equal(projectStudioName(project), null, String(name));
  }
});

test('CLI: list, dir and path', () => {
  studio('acme');
  choose('acme');
  const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'mf-studio'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.deepEqual(JSON.parse(run('list').stdout).studios, ['acme']);
  assert.equal(JSON.parse(run('dir').stdout).dir, join(home, 'Documents', 'studios'));
  const path = run('path', '--project', project);
  assert.equal(path.status, 0);
  assert.equal(JSON.parse(path.stdout).rules, join(home, 'Documents', 'studios', 'acme', 'rules'));
  choose('other');
  assert.equal(run('path', '--project', project).status, 1);
  assert.equal(run('nonsense').status, 2);
});
