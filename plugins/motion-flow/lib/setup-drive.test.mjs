import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildRoots, detectDriveFolders, readCurrent, writeRoots } from './setup-drive.mjs';
import { loadConfig } from './drive-gate.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
let base; let home; let drive;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mf-setup-'));
  home = join(base, 'home');
  drive = join(base, 'Drive', 'Assets');
  mkdirSync(home, { recursive: true });
  mkdirSync(drive, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test('detectDriveFolders finds Google Drive for Desktop folders on macOS', () => {
  const myDrive = join(home, 'Library', 'CloudStorage', 'GoogleDrive-anna@example.com', 'My Drive');
  mkdirSync(join(myDrive, 'Studio'), { recursive: true });
  mkdirSync(join(myDrive, '.hidden'));
  writeFileSync(join(myDrive, 'file.txt'), 'x');
  mkdirSync(join(home, 'Library', 'CloudStorage', 'Dropbox'), { recursive: true });
  const found = detectDriveFolders({ home, os: 'darwin' });
  assert.deepEqual(found.map((f) => [f.path, f.kind, f.folders]), [[myDrive, 'my-drive', ['Studio']]]);
});

test('detectDriveFolders returns an empty list when there is no Drive', () => {
  assert.deepEqual(detectDriveFolders({ home, os: 'darwin' }), []);
});

test('buildRoots validates aliases and folders', () => {
  assert.deepEqual(Object.keys(buildRoots([`assets=${drive}`], { home }).roots), ['assets']);
  assert.throws(() => buildRoots([], { home }), /No folders given/);
  assert.throws(() => buildRoots([`bad alias=${drive}`], { home }), /Bad alias/);
  assert.throws(() => buildRoots([`=${drive}`], { home }), /Bad alias/);
  assert.throws(() => buildRoots([drive], { home }), /Bad alias/);
  assert.throws(() => buildRoots([`a=${drive}`, `a=${drive}`], { home }), /used twice/);
  assert.throws(() => buildRoots(['a=relative/path'], { home }), /absolute/);
  assert.throws(() => buildRoots([`a=${join(base, 'nope')}`], { home }), /not a folder/);
  assert.throws(() => buildRoots([`a=${join(drive, '..', '..', 'x')}`], { home }), /not a folder|absolute/);
});

test('buildRoots refuses filesystem root, the home folder and its parents, and the config folder', () => {
  assert.throws(() => buildRoots(['a=/'], { home }), /filesystem root/);
  assert.throws(() => buildRoots([`a=${home}`], { home }), /contains your home folder/);
  assert.throws(() => buildRoots([`a=${base}`], { home }), /contains your home folder/);
  mkdirSync(join(home, '.motion-flow'));
  assert.throws(() => buildRoots([`a=${join(home, '.motion-flow')}`], { home }), /overlaps the drive-gate config/);
});

test('buildRoots stores the real path (symlinks resolved)', () => {
  const link = join(base, 'link');
  symlinkSync(drive, link);
  assert.equal(buildRoots([`a=${link}`], { home }).roots.a, statSync(drive) && buildRoots([`a=${drive}`], { home }).roots.a);
});

test('writeRoots creates a config that drive-gate can load, with private permissions', () => {
  const { roots } = buildRoots([`assets=${drive}`], { home });
  const file = writeRoots({ roots, home });
  assert.equal(file, join(home, '.motion-flow', 'roots.json'));
  assert.deepEqual(loadConfig(join(home, '.motion-flow')).roots, roots);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0, 'file is not readable by others');
  assert.deepEqual(readCurrent(home), { roots, work_dir: 'work' });
});

test('writeRoots does not overwrite without replace', () => {
  const { roots } = buildRoots([`assets=${drive}`], { home });
  writeRoots({ roots, home });
  assert.throws(() => writeRoots({ roots, home }), /already exists/);
  writeRoots({ roots: { other: roots.assets }, home, replace: true });
  assert.deepEqual(Object.keys(readCurrent(home).roots), ['other']);
});

test('readCurrent: none, broken', () => {
  assert.equal(readCurrent(home), null);
  mkdirSync(join(home, '.motion-flow'));
  writeFileSync(join(home, '.motion-flow', 'roots.json'), '{ nope');
  assert.deepEqual(readCurrent(home), { invalid: true });
});

test('CLI: --detect, --dry-run, write, and refusing a second write', () => {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'mf-setup'), ...args], { encoding: 'utf8', env });
  assert.equal(run('--detect').status, 0);
  assert.deepEqual(JSON.parse(run('--detect').stdout), { folders: [] });
  assert.equal(JSON.parse(run('--show').stdout).config, null);
  const dry = run('--dry-run', '--root', `assets=${drive}`);
  assert.equal(JSON.parse(dry.stdout).dry_run, true);
  assert.equal(existsSync(join(home, '.motion-flow', 'roots.json')), false);
  assert.equal(run('--root', `assets=${drive}`).status, 0);
  assert.equal(existsSync(join(home, '.motion-flow', 'roots.json')), true);
  const again = run('--root', `assets=${drive}`);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
  assert.equal(run('--root', 'bad').status, 1);
});
