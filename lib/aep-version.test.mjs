import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compilePattern, nextVersionName, nextVersionPath, patternFromNamingFile } from './aep-version.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const next = (name, options) => nextVersionName(name, options).name;

test('increments the version and keeps zero padding', () => {
  assert.equal(next('проєкт_v03.aep'), 'проєкт_v04.aep');
  assert.equal(next('spring_v09.aep'), 'spring_v10.aep');
  assert.equal(next('spring_v99.aep'), 'spring_v100.aep');
  assert.equal(next('spring_v1.aep'), 'spring_v2.aep');
  assert.equal(next('spring_v007.aep'), 'spring_v008.aep');
});

test('understands other separators and an upper-case V', () => {
  assert.equal(next('Brand Spring v12.aep'), 'Brand Spring v13.aep');
  assert.equal(next('brand-V02.aep'), 'brand-V03.aep');
});

test('only the version right before the extension counts', () => {
  assert.equal(next('v2_final_v05.aep'), 'v2_final_v06.aep');
  assert.equal(next('shot_v02_notes.aep'), 'shot_v02_notes_v01.aep'); // no version at the end: starts at v01
});

test('a name without a version starts at v01 and keeps the extension', () => {
  assert.equal(next('promo.aep'), 'promo_v01.aep');
  assert.equal(next('promo'), 'promo_v01');
  assert.equal(nextVersionName('promo.aep').previous, null);
});

test('taken names are skipped, never overwritten', () => {
  const taken = new Set(['a_v04.aep', 'a_v05.aep']);
  assert.equal(next('a_v03.aep', { exists: (n) => taken.has(n) }), 'a_v06.aep');
  assert.equal(next('a_v03.aep', { exists: () => false }), 'a_v04.aep');
});

test('a custom regex from the studio rules is used', () => {
  assert.equal(next('Spring.R3.aep', { pattern: '\\.R(?<version>\\d+)(?=\\.aep$)' }), 'Spring.R4.aep');
  assert.equal(next('Spring_ver_7_final.aep', { pattern: 'ver_(?<version>\\d+)' }), 'Spring_ver_8_final.aep');
});

test('bad patterns are refused with a clear message', () => {
  assert.throws(() => compilePattern('('), /not a valid regex/);
  assert.throws(() => compilePattern('v\\d+'), /named group/);
  assert.throws(() => compilePattern(''), /non-empty/);
  assert.throws(() => compilePattern('x'.repeat(400)), /at most/);
  assert.throws(() => next('a_v99999999999999999999.aep'), /too large/);
});

test('nextVersionPath looks at the folder for taken names and creates nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mf-aepv-'));
  try {
    writeFileSync(join(dir, 'p_v03.aep'), 'x');
    writeFileSync(join(dir, 'p_v04.aep'), 'x');
    const before = readdirSync(dir).sort();
    const result = nextVersionPath(join(dir, 'p_v03.aep'));
    assert.deepEqual([result.current, result.next, result.version], ['p_v03.aep', 'p_v05.aep', 5]);
    assert.equal(result.path, join(dir, 'p_v05.aep'));
    assert.deepEqual(readdirSync(dir).sort(), before);
    assert.equal(nextVersionPath('p_v03.aep', { dir }).next, 'p_v05.aep');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the pattern can come from the frontmatter of naming.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mf-aepv-'));
  try {
    const file = join(dir, 'naming.md');
    writeFileSync(file, '---\nstatus: confirmed\nversion_regex: \'\\.R(?<version>\\d+)(?=\\.aep$)\'\n---\n# Naming\n');
    assert.equal(patternFromNamingFile(file), '\\.R(?<version>\\d+)(?=\\.aep$)');
    writeFileSync(file, '---\nstatus: draft\n---\n');
    assert.equal(patternFromNamingFile(file), undefined);
    writeFileSync(file, 'no frontmatter');
    assert.equal(patternFromNamingFile(file), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: prints JSON, supports --pattern and --naming, fails clearly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mf-aepv-'));
  const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'aep-version'), ...args], { encoding: 'utf8' });
  try {
    writeFileSync(join(dir, 'a_v01.aep'), 'x');
    const ok = JSON.parse(run(join(dir, 'a_v01.aep')).stdout);
    assert.deepEqual([ok.ok, ok.next], [true, 'a_v02.aep']);
    assert.equal(JSON.parse(run('b.R2.aep', '--pattern', '\\.R(?<version>\\d+)').stdout).next, 'b.R3.aep');
    writeFileSync(join(dir, 'naming.md'), '---\nversion_regex: "-r(?<version>\\d+)"\n---\n');
    assert.equal(JSON.parse(run('c-r4.aep', '--naming', join(dir, 'naming.md')).stdout).next, 'c-r5.aep');
    const bad = run('c.aep', '--pattern', '(');
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).ok, false);
    assert.equal(run().status, 1);
    assert.deepEqual(readdirSync(dir).sort(), ['a_v01.aep', 'naming.md']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
