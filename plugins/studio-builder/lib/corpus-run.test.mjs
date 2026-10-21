import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { analyzeCorpus, CorpusError, discoverProjects, dumpAll, loadCorpus } from './corpus-run.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
let project;

beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'sb-corpus-')); mkdirSync(join(project, 'work', 'examples'), { recursive: true }); });
afterEach(() => rmSync(project, { recursive: true, force: true }));

function aep(rel, mtime) {
  const path = join(project, 'work', 'examples', rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'binary');
  if (mtime) utimesSync(path, mtime, mtime);
}
const dumpText = (fps = 25, name = 'Main') => JSON.stringify({
  ae: { version: '24.1' }, project: { path: null, bitsPerChannel: 8 }, footage: [], fonts: ['Montserrat-Bold'],
  comps: [{ id: 1, name, width: 1920, height: 1080, fps, duration: 10, layers: [{ index: 1, name: 'Logo', type: 'shape', inPoint: 0, outPoint: 10, parent: null, enabled: true, locked: false, transform: { position: [0, 0], scale: [100, 100], rotation: 0, opacity: 100 }, effects: [], expressions: {}, keyframes: {} }] }],
});
/** A fake ae-dump: writes a dump whose frame rate is 30 for projects in the "nova" group and 25 otherwise. */
const fakeRun = (calls = []) => async (path, out) => {
  calls.push(path);
  writeFileSync(join(project, out), dumpText(path.includes('/nova/') ? 30 : 25));
  return { ok: true };
};
const run = (args) => spawnSync(process.execPath, [join(PLUGIN, 'bin', 'sb-corpus'), ...args], { cwd: project, encoding: 'utf8' });

test('discoverProjects finds every .aep below the folder with a group and a stable id, and skips auto-saves and hidden folders', () => {
  aep('acme/spring_v01.aep');
  aep('acme/sub/spring_v02.aep');
  aep('nova/summer.aep');
  aep('top.aep');
  aep('Adobe After Effects Auto-Save/x.aep');
  aep('.hidden/y.aep');
  writeFileSync(join(project, 'work', 'examples', 'notes.txt'), 'x');
  const found = discoverProjects('work/examples', project);
  assert.deepEqual(found.map((p) => [p.id, p.group, p.path]), [
    ['p001-spring_v01', 'acme', 'work/examples/acme/spring_v01.aep'],
    ['p002-spring_v02', 'acme', 'work/examples/acme/sub/spring_v02.aep'],
    ['p003-summer', 'nova', 'work/examples/nova/summer.aep'],
    ['p004-top', '', 'work/examples/top.aep'],
  ]);
});

test('folders outside work/ and missing folders are refused', () => {
  assert.throws(() => discoverProjects('.', project), (e) => e instanceof CorpusError && e.code === 'outside_work');
  assert.throws(() => discoverProjects('../elsewhere', project), (e) => e.code === 'outside_work');
  assert.throws(() => discoverProjects('work', project), (e) => e.code === 'outside_work', 'work/ itself is not an examples folder');
  assert.throws(() => discoverProjects('work/nope', project), (e) => e.code === 'no_examples');
});

test('dumpAll dumps each project once, reuses fresh dumps, and keeps going after a failure', async () => {
  aep('acme/a_v01.aep', new Date('2026-01-01'));
  aep('acme/b_v01.aep', new Date('2026-01-01'));
  aep('nova/c_v01.aep', new Date('2026-01-01'));
  const calls = [];
  const failing = async (path, out) => (path.includes('b_v01') ? { ok: false, error: 'Another project is open in After Effects (x) has unsaved changes.' } : fakeRun(calls)(path, out));
  const first = await dumpAll({ examples: 'work/examples', out: 'work/corpus', cwd: project, run: failing });
  assert.deepEqual([first.projects, first.dumped, first.reused], [3, 2, 0]);
  assert.deepEqual(first.failed.map((f) => f.id), ['p002-b_v01']);
  assert.match(first.failed[0].error, /unsaved changes/);
  const index = JSON.parse(readFileSync(join(project, 'work', 'corpus', 'index.json'), 'utf8'));
  assert.deepEqual(index.map((p) => p.ok), [true, false, true]);
  calls.length = 0;
  const second = await dumpAll({ examples: 'work/examples', out: 'work/corpus', cwd: project, run: fakeRun(calls) });
  assert.deepEqual(calls, ['work/examples/acme/b_v01.aep'], 'only the project without a dump is dumped again');
  assert.deepEqual([second.dumped, second.reused, second.failed.length], [1, 2, 0]);
});

test('a project changed after its dump is dumped again', async () => {
  aep('acme/a_v01.aep', new Date('2026-01-01'));
  const calls = [];
  await dumpAll({ examples: 'work/examples', out: 'work/corpus', cwd: project, run: fakeRun(calls) });
  aep('acme/a_v01.aep', new Date(Date.now() + 60000));
  await dumpAll({ examples: 'work/examples', out: 'work/corpus', cwd: project, run: fakeRun(calls) });
  assert.equal(calls.length, 2);
});

test('analyzeCorpus writes the analysis, the version pairs and a report, and lists what it had to skip', async () => {
  for (const [rel, time] of [['acme/a_v01.aep', '2026-01-01'], ['acme/a_v02.aep', '2026-02-01'], ['acme/b_v01.aep', '2026-03-01'], ['nova/c_v01.aep', '2026-04-01']]) aep(rel, new Date(time));
  await dumpAll({ examples: 'work/examples', out: 'work/corpus', cwd: project, run: fakeRun() });
  writeFileSync(join(project, 'work', 'corpus', 'p004-c_v01.dump.json'), '{ broken');
  const result = analyzeCorpus({ dir: 'work/corpus', cwd: project });
  assert.deepEqual([result.projects, result.pairs], [3, 1]);
  assert.deepEqual(result.skipped.map((s) => s.id), ['p004-c_v01']);
  assert.match(result.skipped[0].reason, /unreadable dump/);
  for (const file of ['analysis.json', 'pairs.json', 'report.md']) assert.ok(existsSync(join(project, 'work', 'corpus', file)), file);
  assert.match(readFileSync(join(project, 'work', 'corpus', 'report.md'), 'utf8'), /# Corpus report/);
  assert.equal(JSON.parse(readFileSync(join(project, 'work', 'corpus', 'pairs.json'), 'utf8')).diffs[0].before, 'p001-a_v01');
});

test('analyze without a dump step says what to run first, and an invalid dump is skipped, not trusted', async () => {
  assert.throws(() => loadCorpus('work/corpus', project), (e) => e.code === 'no_index');
  aep('acme/a_v01.aep');
  await dumpAll({ examples: 'work/examples', out: 'work/corpus', cwd: project, run: async (path, out) => { writeFileSync(join(project, out), '{"comps": "no"}'); return { ok: true }; } });
  const loaded = loadCorpus('work/corpus', project);
  assert.equal(loaded.rows.length, 0);
  assert.match(loaded.skipped[0].reason, /invalid dump/);
});

test('CLI: usage errors and refusals are JSON with an exit code', () => {
  const none = run([]);
  assert.equal(none.status, 2);
  assert.equal(JSON.parse(none.stdout).reason, 'usage');
  const outside = run(['dump', '--examples', '..']);
  assert.equal(outside.status, 1);
  assert.equal(JSON.parse(outside.stdout).reason, 'outside_work');
  const noIndex = run(['analyze']);
  assert.equal(JSON.parse(noIndex.stdout).reason, 'no_index');
});
