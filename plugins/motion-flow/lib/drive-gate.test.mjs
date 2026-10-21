// Tests for drive-gate, written from the spec (section 6), not from the implementation.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  statSync, symlinkSync, truncateSync, utimesSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from './drive-gate.mjs';

let base; // temp sandbox root
let driveRoot; // the "Drive" alias root
let home; // MOTION_FLOW_HOME
let project; // cwd of the agent
let outside; // a folder next to the root that must stay unreachable

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mf-dg-'));
  driveRoot = join(base, 'Drive', 'Assets');
  home = join(base, 'home');
  project = join(base, 'project');
  outside = join(base, 'Drive', 'Private');
  for (const dir of [driveRoot, home, project, outside]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, 'roots.json'), JSON.stringify({ roots: { assets: driveRoot }, work_dir: 'work' }));
  writeFileSync(join(outside, 'secret.txt'), 'top secret');
  enableDrive(['assets']);
});

afterEach(() => {
  chmodSafe(join(driveRoot, 'locked.bin'), 0o644);
  rmSync(base, { recursive: true, force: true });
});

function enableDrive(aliases, dir = project) {
  mkdirSync(join(dir, '.motion'), { recursive: true });
  writeFileSync(join(dir, '.motion', 'drive.json'), JSON.stringify({ aliases }));
}

function chmodSafe(path, mode) {
  try { chmodSync(path, mode); } catch { /* may not exist */ }
}

async function run(argv, { cwd = project, home: homeOverride = home } = {}) {
  let text = '';
  const code = await main(argv, {
    cwd,
    home: homeOverride,
    pollMs: 5,
    stdout: { write: (chunk) => { text += chunk; } },
  });
  return { code, out: JSON.parse(text) };
}

function put(rel, content = 'data') {
  const file = join(driveRoot, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  return file;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Lists every file/dir under dir with size and mtime, to detect any change. */
function snapshot(dir) {
  const result = {};
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stats = statSync(path, { throwIfNoEntry: false });
      if (!stats) continue;
      result[relative(dir, path)] = `${stats.isDirectory() ? 'd' : 'f'}:${stats.size}:${stats.mtimeMs}`;
      if (stats.isDirectory()) walk(path);
    }
  };
  walk(dir);
  return result;
}

// ---------- invariant 1: every path stays inside the alias root ----------

test('ls and fetch reject ".." escapes', async () => {
  put('a.txt');
  for (const rel of ['../Private/secret.txt', '..', 'sub/../../Private', '..\\Private\\secret.txt', 'a/../../x']) {
    const ls = await run(['ls', 'assets', rel]);
    assert.equal(ls.out.ok, false, `ls ${rel}`);
    const fetch = await run(['fetch', 'assets', rel, '--to', 'work']);
    assert.equal(fetch.out.ok, false, `fetch ${rel}`);
  }
  assert.equal(existsSync(join(project, 'work', 'secret.txt')), false);
});

test('absolute, drive-letter and NUL paths are rejected', async () => {
  for (const rel of [join(outside, 'secret.txt'), '/etc/passwd', 'C:\\Windows\\win.ini', 'C:/x', 'a\0b']) {
    const result = await run(['info', 'assets', rel]);
    assert.equal(result.out.ok, false, rel);
    assert.equal(result.out.code, 'bad_path', rel);
  }
});

test('symlinked file pointing outside the root is not followed', async () => {
  symlinkSync(join(outside, 'secret.txt'), join(driveRoot, 'link.txt'));
  const result = await run(['fetch', 'assets', 'link.txt', '--to', 'work']);
  assert.equal(result.out.code, 'outside_root');
  assert.equal(existsSync(join(project, 'work', 'link.txt')), false);
});

test('symlinked directory pointing outside the root is not followed', async () => {
  symlinkSync(outside, join(driveRoot, 'linkdir'));
  const ls = await run(['ls', 'assets', 'linkdir']);
  assert.equal(ls.out.code, 'outside_root');
  const info = await run(['info', 'assets', 'linkdir/secret.txt', '--checksum']);
  assert.equal(info.out.code, 'outside_root');
});

test('a sibling folder sharing the root name prefix is not "inside" the root', async () => {
  const sibling = join(base, 'Drive', 'Assets-private');
  mkdirSync(sibling);
  writeFileSync(join(sibling, 'x.txt'), 'x');
  symlinkSync(sibling, join(driveRoot, 'sib'));
  const result = await run(['fetch', 'assets', 'sib/x.txt', '--to', 'work']);
  assert.equal(result.out.code, 'outside_root');
});

test('symlink that stays inside the root is allowed', async () => {
  put('real/a.txt', 'inside');
  symlinkSync(join(driveRoot, 'real'), join(driveRoot, 'alias-dir'));
  const result = await run(['fetch', 'assets', 'alias-dir/a.txt', '--to', 'work']);
  assert.equal(result.out.ok, true);
});

test('unknown alias is rejected, including prototype names', async () => {
  for (const alias of ['nope', '__proto__', 'constructor', '']) {
    const result = await run(['ls', alias]);
    assert.equal(result.out.code, 'unknown_alias', alias);
  }
});

test('odd-looking names are plain names, not shortcuts', async () => {
  for (const rel of ['~', '$HOME', '%2e%2e', '..%2fPrivate', '..;/Private', '. ./x']) {
    const result = await run(['info', 'assets', rel]);
    assert.equal(result.out.ok, false, rel);
    assert.notEqual(result.out.code, 'internal', rel);
  }
});

// ---------- invariant 2: nothing is written to Drive; no write commands ----------

test('write/delete/move/rename/share commands do not exist', async () => {
  put('a.txt');
  const before = snapshot(driveRoot);
  for (const cmd of ['put', 'rm', 'mv', 'rename', 'share', 'delete', 'cp', 'write']) {
    const result = await run([cmd, 'assets', 'a.txt', 'b.txt']);
    assert.equal(result.code, 2, cmd);
    assert.equal(result.out.code, 'usage', cmd);
  }
  assert.deepEqual(snapshot(driveRoot), before);
});

test('fetch leaves the original untouched (mtime and checksum)', async () => {
  const file = put('p/a.aep', 'binary \0 content');
  const old = new Date('2020-01-02T03:04:05Z');
  utimesSync(file, old, old);
  const before = { mtime: statSync(file).mtimeMs, sha: sha(readFileSync(file)) };
  const result = await run(['fetch', 'assets', 'p/a.aep', '--to', 'work']);
  assert.equal(result.out.ok, true);
  assert.equal(statSync(file).mtimeMs, before.mtime);
  assert.equal(sha(readFileSync(file)), before.sha);
  assert.equal(readFileSync(join(project, 'work', 'p', 'a.aep'), 'utf8'), 'binary \0 content');
});

test('every command leaves the Drive tree unchanged', async () => {
  put('a/b.txt', 'b');
  put('c.txt', 'c');
  const before = snapshot(driveRoot);
  await run(['ls', 'assets']);
  await run(['ls', 'assets', 'a']);
  await run(['info', 'assets', 'c.txt', '--checksum']);
  await run(['fetch', 'assets', 'a/b.txt', '--to', 'work']);
  await run(['fetch', 'assets', 'c.txt', '--to', 'work/second']);
  await run(['fetch', 'assets', '../x', '--to', 'work']);
  assert.deepEqual(snapshot(driveRoot), before);
});

// ---------- invariant 3: writes only inside work/ ----------

test('fetch --to must be inside work/', async () => {
  put('a.txt');
  for (const to of ['.', '..', '/tmp', join(base, 'elsewhere'), 'work/../out', 'other', 'workshop']) {
    const result = await run(['fetch', 'assets', 'a.txt', '--to', to]);
    assert.equal(result.out.code, 'outside_work', to);
  }
  assert.deepEqual(readdirSync(project).filter((n) => n !== 'work' && n !== '.motion'), []);
  assert.equal(existsSync(join(base, 'elsewhere')), false);
});

test('a symlink inside work/ cannot redirect the copy outside', async () => {
  put('a.txt');
  const elsewhere = join(base, 'elsewhere');
  mkdirSync(elsewhere);
  mkdirSync(join(project, 'work'));
  symlinkSync(elsewhere, join(project, 'work', 'jump'));
  const result = await run(['fetch', 'assets', 'a.txt', '--to', 'work/jump']);
  assert.equal(result.out.code, 'outside_work');
  assert.deepEqual(readdirSync(elsewhere), []);
});

test('work/ inside a Drive root is refused', async () => {
  put('a.txt');
  const inDrive = join(driveRoot, 'myproject');
  mkdirSync(inDrive);
  const result = await run(['fetch', 'assets', 'a.txt', '--to', 'work'], { cwd: inDrive });
  assert.equal(result.out.code, 'work_in_drive');
  assert.equal(existsSync(join(inDrive, 'work', 'a.txt')), false);
});

test('config work_dir cannot be absolute or contain ".."', async () => {
  put('a.txt');
  for (const workDir of ['/tmp/x', '../x', 'a/../../x']) {
    writeFileSync(join(home, 'roots.json'), JSON.stringify({ roots: { assets: driveRoot }, work_dir: workDir }));
    const result = await run(['fetch', 'assets', 'a.txt', '--to', 'work']);
    assert.equal(result.out.code, 'bad_config', workDir);
  }
});

test('fetch keeps relative paths and does not overwrite without --overwrite', async () => {
  put('x/y/z.txt', 'v1');
  const first = await run(['fetch', 'assets', 'x/y/z.txt', '--to', 'work']);
  assert.equal(first.out.ok, true);
  assert.equal(readFileSync(join(project, 'work', 'x', 'y', 'z.txt'), 'utf8'), 'v1');
  put('x/y/z.txt', 'v2');
  const second = await run(['fetch', 'assets', 'x/y/z.txt', '--to', 'work']);
  assert.equal(second.out.code, 'dest_exists');
  assert.equal(readFileSync(join(project, 'work', 'x', 'y', 'z.txt'), 'utf8'), 'v1');
  const third = await run(['fetch', 'assets', 'x/y/z.txt', '--to', 'work', '--overwrite']);
  assert.equal(third.out.ok, true);
  assert.equal(readFileSync(join(project, 'work', 'x', 'y', 'z.txt'), 'utf8'), 'v2');
});

test('the only thing created in the project is work/', async () => {
  put('a.txt');
  await run(['fetch', 'assets', 'a.txt', '--to', 'work']);
  await run(['fetch', 'assets', 'missing.txt', '--to', 'work']);
  await run(['fetch', 'assets', '../x', '--to', '/tmp']);
  assert.deepEqual(readdirSync(project).sort(), ['.motion', 'work']);
  assert.ok(!readdirSync(join(project, 'work')).some((n) => n.endsWith('.part')));
});

// ---------- invariant 4: audit log ----------

test('every call is logged, including refused ones', async () => {
  put('a.txt');
  await run(['ls', 'assets']);
  await run(['fetch', 'assets', 'a.txt', '--to', 'work']);
  await run(['fetch', 'assets', '../x', '--to', 'work']);
  await run(['rm', 'assets', 'a.txt']);
  const { out } = await run(['log', '--tail', '10']);
  const entries = out.entries;
  assert.deepEqual(entries.map((e) => [e.cmd, e.ok]), [['ls', true], ['fetch', true], ['fetch', false], ['rm', false]]);
  assert.equal(entries[0].alias, 'assets');
  assert.equal(entries[1].path, 'a.txt');
  assert.ok(!Number.isNaN(Date.parse(entries[0].ts)));
});

test('log --tail limits the number of entries', async () => {
  for (let i = 0; i < 5; i++) await run(['ls', 'assets']);
  const { out } = await run(['log', '--tail', '2']);
  assert.equal(out.entries.length, 2);
});

test('the log never contains file contents', async () => {
  put('a.txt', 'CLIENT-SECRET-CONTENT');
  await run(['fetch', 'assets', 'a.txt', '--to', 'work']);
  assert.ok(!readFileSync(join(home, 'drive-gate.log'), 'utf8').includes('CLIENT-SECRET-CONTENT'));
});

test('if the log cannot be opened, nothing runs (fail closed)', async () => {
  put('a.txt');
  const blocked = join(base, 'blocked');
  writeFileSync(blocked, 'a file, not a directory');
  const result = await run(['fetch', 'assets', 'a.txt', '--to', 'work'], { home: blocked });
  assert.equal(result.out.code, 'log_unavailable');
  assert.equal(existsSync(join(project, 'work')), false);
});

// ---------- invariant 5: stream failures are explicit ----------

test('zero-size file (stream stub) gives a human error, not an empty copy', async () => {
  put('stub.mov', '');
  const result = await run(['fetch', 'assets', 'stub.mov', '--to', 'work', '--timeout', '0.05']);
  assert.equal(result.out.code, 'not_downloaded');
  assert.match(result.out.hint, /offline|Finder|Explorer/i);
  assert.equal(existsSync(join(project, 'work', 'stub.mov')), false);
});

test('file that finishes downloading during the wait is fetched', async () => {
  const file = put('late.mov', '');
  setTimeout(() => writeFileSync(file, 'arrived'), 60);
  const result = await run(['fetch', 'assets', 'late.mov', '--to', 'work', '--timeout', '5']);
  assert.equal(result.out.ok, true);
  assert.equal(readFileSync(join(project, 'work', 'late.mov'), 'utf8'), 'arrived');
});

test('file without read permission gives a clear error and leaves no partial copy', async (t) => {
  if (process.getuid?.() === 0 || process.platform === 'win32') return t.skip('needs a non-root POSIX user');
  const file = put('locked.bin', 'nope');
  chmodSync(file, 0o000);
  const result = await run(['fetch', 'assets', 'locked.bin', '--to', 'work']);
  assert.equal(result.out.ok, false);
  assert.equal(result.out.code, 'no_access');
  assert.equal(existsSync(join(project, 'work', 'locked.bin')), false);
  assert.equal(existsSync(join(project, 'work', 'locked.bin.part')), false);
});

test('large file is copied intact', async () => {
  const file = join(driveRoot, 'big.bin');
  writeFileSync(file, '');
  truncateSync(file, 48 * 1024 * 1024); // sparse is fine, but write real bytes at both ends
  const bytes = Buffer.alloc(1024 * 1024, 7);
  writeFileSync(file, Buffer.concat([bytes, Buffer.alloc(46 * 1024 * 1024, 1), bytes]));
  const result = await run(['fetch', 'assets', 'big.bin', '--to', 'work']);
  assert.equal(result.out.ok, true);
  assert.equal(result.out.file.size, 48 * 1024 * 1024);
  assert.equal(result.out.file.sha256, sha(readFileSync(file)));
  assert.equal(sha(readFileSync(join(project, 'work', 'big.bin'))), result.out.file.sha256);
});

// ---------- command behaviour ----------

test('ls lists names, types, sizes and dates', async () => {
  put('b.txt', '12345');
  put('dir/c.txt');
  const { out } = await run(['ls', 'assets']);
  assert.deepEqual(out.entries.map((e) => [e.name, e.type]), [['b.txt', 'file'], ['dir', 'dir']]);
  assert.equal(out.entries[0].size, 5);
  assert.ok(!Number.isNaN(Date.parse(out.entries[0].mtime)));
});

test('ls on a file and info on a missing file fail cleanly', async () => {
  put('a.txt');
  assert.equal((await run(['ls', 'assets', 'a.txt'])).out.code, 'not_dir');
  assert.equal((await run(['info', 'assets', 'missing.txt'])).out.code, 'not_found');
});

test('info reports size, mtime, local flag and optional checksum', async () => {
  put('a.txt', 'hello');
  const plain = (await run(['info', 'assets', 'a.txt'])).out;
  assert.equal(plain.size, 5);
  assert.equal(plain.local, true);
  assert.equal('sha256' in plain, false);
  const withSum = (await run(['info', 'assets', 'a.txt', '--checksum'])).out;
  assert.equal(withSum.sha256, sha('hello'));
});

test('--with-deps copies listed footage under the alias and reports the rest', async () => {
  put('p/main.aep', 'aep');
  put('media/clip.mov', 'clip');
  put('media/empty.mov', '');
  const real = (rel) => join(statSync(driveRoot) && driveRoot, rel);
  writeFileSync(join(project, 'dump.json'), JSON.stringify({
    footage: [
      { path: real('media/clip.mov') },
      { path: real('media/empty.mov') },
      { path: '/somewhere/else.png' },
      { path: real('gone.mov'), missing: true },
    ],
  }));
  const result = await run(['fetch', 'assets', 'p/main.aep', '--to', 'work', '--with-deps', '--deps-from', 'dump.json', '--timeout', '0.05']);
  assert.equal(result.out.ok, false);
  assert.deepEqual(result.out.deps.map((d) => d.path), ['media/clip.mov']);
  assert.deepEqual(result.out.deps_failed.map((d) => d.code), ['not_downloaded']);
  assert.deepEqual(result.out.deps_skipped.map((d) => d.reason).sort(), ['missing_or_invalid', 'outside_alias_root']);
  assert.equal(readFileSync(join(project, 'work', 'media', 'clip.mov'), 'utf8'), 'clip');
});

test('--with-deps without --deps-from is a usage error and copies nothing', async () => {
  put('a.aep');
  const result = await run(['fetch', 'assets', 'a.aep', '--to', 'work', '--with-deps']);
  assert.equal(result.code, 2);
  assert.equal(existsSync(join(project, 'work', 'a.aep')), false);
});

test('missing config, bad JSON and unavailable root give clear errors', async () => {
  rmSync(join(home, 'roots.json'));
  assert.equal((await run(['ls', 'assets'])).out.code, 'no_drive');
  writeFileSync(join(home, 'roots.json'), '{ nope');
  assert.equal((await run(['ls', 'assets'])).out.code, 'bad_config');
  writeFileSync(join(home, 'roots.json'), JSON.stringify({ roots: { assets: join(base, 'not-mounted') } }));
  assert.equal((await run(['ls', 'assets'])).out.code, 'root_missing');
});

test('bad arguments are usage errors with exit code 2', async () => {
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['fetch', 'assets', 'a.txt'])).code, 2);
  assert.equal((await run(['ls', 'assets', '--nope'])).code, 2);
  assert.equal((await run(['log', '--tail'])).code, 2);
  assert.equal((await run(['log', '--tail', 'abc'])).code, 2);
});

// ---------- extra bypass attempts found in the T1.3 review ----------

test('dots-only and whitespace-only segments are refused (Windows trims them to "..")', async () => {
  put('a.txt');
  for (const rel of ['.. ', '...', '. .', 'sub/.. /x', '..\t']) {
    const result = await run(['info', 'assets', rel]);
    assert.equal(result.out.code, 'bad_path', JSON.stringify(rel));
  }
  for (const to of ['work/.. ', 'work/...', 'work/sub/ . ']) {
    const result = await run(['fetch', 'assets', 'a.txt', '--to', to]);
    assert.equal(result.out.code, 'outside_work', to);
  }
});

test('an existing .part file in work/ is never overwritten or deleted', async () => {
  put('a.txt', 'new');
  mkdirSync(join(project, 'work'));
  writeFileSync(join(project, 'work', 'a.txt.part'), 'precious');
  const result = await run(['fetch', 'assets', 'a.txt', '--to', 'work']);
  assert.equal(result.out.code, 'dest_busy');
  assert.equal(readFileSync(join(project, 'work', 'a.txt.part'), 'utf8'), 'precious');
});

test('an alias pointing at a filesystem root is refused', async () => {
  writeFileSync(join(home, 'roots.json'), JSON.stringify({ roots: { all: '/' } }));
  enableDrive(['all']);
  assert.equal((await run(['ls', 'all'])).out.code, 'bad_config');
});

test('the CLI ignores MOTION_FLOW_HOME: the config always comes from ~/.motion-flow', () => {
  const fakeHome = join(base, 'fakehome');
  mkdirSync(fakeHome);
  const evil = join(base, 'evil');
  mkdirSync(evil);
  writeFileSync(join(evil, 'roots.json'), JSON.stringify({ roots: { assets: outside } }));
  const bin = fileURLToPath(new URL('../bin/drive-gate', import.meta.url));
  const result = spawnSync(process.execPath, [bin, 'ls', 'assets'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, MOTION_FLOW_HOME: evil },
  });
  const out = JSON.parse(result.stdout);
  assert.equal(out.code, 'no_drive'); // looked in fakehome/.motion-flow (no config), not in $MOTION_FLOW_HOME
  assert.equal(existsSync(join(fakeHome, '.motion-flow', 'drive-gate.log')), true);
});

test('non-ASCII look-alikes of ".." are ordinary names and cannot escape', async () => {
  put('a.txt');
  for (const rel of ['\uFF0E\uFF0E/Private', '\u2025/Private', '.\u200B./Private']) {
    const result = await run(['info', 'assets', rel]);
    assert.equal(result.out.ok, false, rel);
    assert.notEqual(result.out.code, 'internal', rel);
  }
});

test('different letter case of an existing name cannot escape the root', async () => {
  symlinkSync(outside, join(driveRoot, 'Link'));
  for (const rel of ['Link/secret.txt', 'link/secret.txt', 'LINK/SECRET.TXT']) {
    const result = await run(['fetch', 'assets', rel, '--to', 'work']);
    assert.equal(result.out.ok, false, rel);
  }
  assert.equal(existsSync(join(project, 'work', 'secret.txt')), false);
});

test('with no Drive folders configured, commands explain that files go into work/', async () => {
  writeFileSync(join(home, 'roots.json'), JSON.stringify({ roots: {}, work_dir: 'work' }));
  const result = await run(['ls', 'assets']);
  assert.equal(result.out.code, 'no_drive');
  assert.match(result.out.hint, /work\//);
});

test('Drive is chosen per project: a folder not enabled here is refused, enabled ones work', async () => {
  put('a.txt');
  writeFileSync(join(home, 'roots.json'), JSON.stringify({ roots: { assets: driveRoot, projects: outside }, work_dir: 'work' }));
  const enabled = await run(['ls', 'assets']);
  assert.equal(enabled.out.ok, true);
  const disabled = await run(['ls', 'projects']);
  assert.equal(disabled.out.code, 'drive_disabled');
  assert.match(disabled.out.hint, /init-project/);
  assert.equal((await run(['fetch', 'projects', 'secret.txt', '--to', 'work'])).out.code, 'drive_disabled');
  assert.equal(existsSync(join(project, 'work', 'secret.txt')), false);
});

test('a project without .motion/drive.json has no Drive, an empty list too', async () => {
  put('a.txt');
  rmSync(join(project, '.motion'), { recursive: true });
  assert.equal((await run(['ls', 'assets'])).out.code, 'drive_disabled');
  enableDrive([]);
  assert.equal((await run(['ls', 'assets'])).out.code, 'drive_disabled');
});

test('two projects on one computer can choose differently', async () => {
  put('a.txt');
  const other = join(base, 'other-project');
  mkdirSync(other);
  assert.equal((await run(['ls', 'assets'])).out.ok, true);
  assert.equal((await run(['ls', 'assets'], { cwd: other })).out.code, 'drive_disabled');
  enableDrive(['assets'], other);
  assert.equal((await run(['ls', 'assets'], { cwd: other })).out.ok, true);
});

test('a broken or malformed project drive file is refused with a clear error', async () => {
  writeFileSync(join(project, '.motion', 'drive.json'), '{ nope');
  assert.equal((await run(['ls', 'assets'])).out.code, 'bad_project_drive');
  writeFileSync(join(project, '.motion', 'drive.json'), JSON.stringify({ aliases: 'assets' }));
  assert.equal((await run(['ls', 'assets'])).out.code, 'bad_project_drive');
  writeFileSync(join(project, '.motion', 'drive.json'), JSON.stringify({ aliases: [1] }));
  assert.equal((await run(['ls', 'assets'])).out.code, 'bad_project_drive');
});

test('an alias listed in the project file but missing from the computer config is unknown', async () => {
  enableDrive(['ghost']);
  assert.equal((await run(['ls', 'ghost'])).out.code, 'unknown_alias');
});
