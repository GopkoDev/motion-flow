import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLaunch, findAe, LauncherError } from './ae-launcher.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'mf-ael-'));

test('macOS: the newest Adobe After Effects in /Applications is chosen', () => {
  const list = () => ['Safari.app', 'Adobe After Effects 2023', 'Adobe After Effects 2025', 'Adobe After Effects 2024', 'Adobe Premiere Pro 2025', 'Adobe After Effects (Beta)'];
  const home = tmp();
  try {
    assert.deepEqual(findAe({ os: 'darwin', home, list }), { os: 'darwin', app: 'Adobe After Effects (Beta)' });
    assert.equal(findAe({ os: 'darwin', home, list: () => ['Adobe After Effects 2023', 'Adobe After Effects 2025'] }).app, 'Adobe After Effects 2025');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('macOS: ae.json overrides the choice; unsafe names and missing installs are refused', () => {
  const home = tmp();
  try {
    mkdirSync(join(home, '.motion-flow'));
    const write = (data) => writeFileSync(join(home, '.motion-flow', 'ae.json'), typeof data === 'string' ? data : JSON.stringify(data));
    write({ app: 'Adobe After Effects 2022' });
    assert.equal(findAe({ os: 'darwin', home, list: () => ['Adobe After Effects 2025'] }).app, 'Adobe After Effects 2022');
    write({ app: 'x" to quit' });
    assert.throws(() => findAe({ os: 'darwin', home }), /Unsafe application name/);
    write('{ nope');
    assert.throws(() => findAe({ os: 'darwin', home }), /not valid JSON/);
    rmSync(join(home, '.motion-flow', 'ae.json'));
    assert.throws(() => findAe({ os: 'darwin', home, list: () => ['Safari.app'] }), (e) => e instanceof LauncherError && e.code === 'ae_not_found');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Windows: AfterFX.exe of the newest version, or the path from ae.json', () => {
  const home = tmp();
  try {
    const env = { ProgramFiles: 'C:\\Program Files' };
    const list = () => ['Adobe After Effects 2023', 'Adobe After Effects 2025', 'Adobe Bridge'];
    const found = findAe({ os: 'win32', home, env, list, exists: () => true });
    assert.equal(found.os, 'win32');
    assert.match(found.exe, /Adobe After Effects 2025.*AfterFX\.exe$/);
    assert.throws(() => findAe({ os: 'win32', home, env, list: () => [], exists: () => false }), /AfterFX\.exe was not found/);
    mkdirSync(join(home, '.motion-flow'));
    writeFileSync(join(home, '.motion-flow', 'ae.json'), JSON.stringify({ path: 'D:\\AE\\AfterFX.exe' }));
    assert.equal(findAe({ os: 'win32', home, env, exists: () => true }).exe, 'D:\\AE\\AfterFX.exe');
    assert.throws(() => findAe({ os: 'win32', home, env, exists: () => false }), /not found/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('other systems are refused', () => {
  assert.throws(() => findAe({ os: 'linux', home: tmp() }), /macOS and Windows only/);
});

/** Reads an AppleScript string literal back into its text (to prove the escaping round-trips). */
const unAppleScript = (literal) => literal.slice(1, -1).replace(/\\(["\\])/g, '$1');
/** Reads a JavaScript single-quoted literal back into its text. */
const unJs = (literal) => literal.slice(1, -1).replace(/\\(['\\])/g, '$1');

test('buildLaunch gives the exact command, with no shell', () => {
  assert.deepEqual(buildLaunch({ os: 'darwin', app: 'Adobe After Effects 2025' }, '/w/.ipc/a.run.jsx'), {
    file: 'osascript',
    args: [
      '-e', 'with timeout of 7200 seconds',
      '-e', 'tell application "Adobe After Effects 2025" to DoScript "$.evalFile(\'/w/.ipc/a.run.jsx\');"',
      '-e', 'end timeout',
    ],
  });
  assert.deepEqual(buildLaunch({ os: 'win32', exe: 'C:\\AE\\AfterFX.exe' }, 'C:\\w\\.ipc\\a.run.jsx'), { file: 'C:\\AE\\AfterFX.exe', args: ['-r', 'C:\\w\\.ipc\\a.run.jsx'] });
});

test('macOS uses DoScript with an evalFile bootstrap, never DoScriptFile, and lifts the 2 minute AppleScript timeout', () => {
  const { args } = buildLaunch({ os: 'darwin', app: 'Adobe After Effects 2025' }, '/w/a.run.jsx');
  assert.ok(!args.join(' ').includes('DoScriptFile'));
  assert.match(args.join(' '), /to DoScript /);
  assert.equal(args[1], 'with timeout of 7200 seconds');
  assert.equal(args.at(-1), 'end timeout');
});

test('awkward paths (quotes, apostrophes, backslashes, spaces, Ukrainian) round-trip through both layers of quoting', () => {
  for (const path of ['/w/it\'s here/a.run.jsx', '/w/say "hi"/a.run.jsx', '/w/back\\slash/a.run.jsx', '/w/Мій проєкт/a b.run.jsx', "/w/'\"\\'\"/x.jsx"]) { // non-ASCII test data
    const { args } = buildLaunch({ os: 'darwin', app: 'Adobe After Effects 2025' }, path);
    const line = args[3];
    const applescript = /^tell application "Adobe After Effects 2025" to DoScript (".*")$/.exec(line)[1];
    const bootstrap = unAppleScript(applescript);
    const js = /^\$\.evalFile\((.*)\);$/.exec(bootstrap)[1];
    assert.equal(unJs(js), path, path);
  }
});

test('buildLaunch refuses control characters and line separators in the path', () => {
  for (const bad of ['/w/a\nb.jsx', '/w/a\u2028b.jsx', '/w/a\u0000b.jsx']) {
    assert.throws(() => buildLaunch({ os: 'darwin', app: 'Adobe After Effects 2025' }, bad), /control character/, JSON.stringify(bad));
    assert.throws(() => buildLaunch({ os: 'win32', exe: 'C:\\AE\\AfterFX.exe' }, bad), /control character/, JSON.stringify(bad));
  }
});
