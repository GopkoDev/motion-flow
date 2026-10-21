import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cellHeight, ffmpegArgs, main, makeSheets, parseArgs, pngSize, sheetNames, splitIntoSheets, DEFAULTS } from './contact-sheet.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
let project;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mf-sheet-'));
  mkdirSync(join(project, 'work', 'frames'), { recursive: true });
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

/** The first 24 bytes of a PNG: signature, IHDR length and type, width, height. Enough for pngSize. */
function png(name, width, height) {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  writeFileSync(join(project, 'work', 'frames', name), head);
  return `work/frames/${name}`;
}
const names = (count) => Array.from({ length: count }, (_, i) => png(`step${String(i + 1).padStart(2, '0')}.png`, 1920, 1080));
const fakeRun = (calls) => async (args) => { calls.push(args); return { ok: true }; };

test('pngSize reads the size from the header and returns null for anything else', () => {
  png('a.png', 1080, 1920);
  assert.deepEqual(pngSize(join(project, 'work', 'frames', 'a.png')), { width: 1080, height: 1920 });
  writeFileSync(join(project, 'x.txt'), 'not a png at all, just text of some length');
  assert.equal(pngSize(join(project, 'x.txt')), null);
  assert.equal(pngSize(join(project, 'missing.png')), null);
});

test('the cell is tall enough for the tallest frame, capped, and falls back without sizes', () => {
  assert.equal(cellHeight([{ width: 1920, height: 1080 }], DEFAULTS), 270);
  assert.equal(cellHeight([{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }], DEFAULTS), 640, 'a 9:16 frame needs a tall cell, capped at 640');
  assert.equal(cellHeight([null], DEFAULTS), 270);
  assert.equal(cellHeight([{ width: 1000, height: 333 }], DEFAULTS) % 2, 0, 'the height is even');
});

test('frames are split into sheets in order and the sheets are named', () => {
  assert.deepEqual(splitIntoSheets(['a', 'b', 'c', 'd', 'e'], 2), [['a', 'b'], ['c', 'd'], ['e']]);
  assert.deepEqual(sheetNames('work/frames/sheet.png', 1), ['work/frames/sheet.png']);
  assert.deepEqual(sheetNames('work/frames/sheet.png', 2), ['work/frames/sheet-1.png', 'work/frames/sheet-2.png']);
});

test('the ffmpeg arguments scale every frame into a cell, then tile them with the right grid', () => {
  const args = ffmpegArgs({ files: ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'], out: 'sheet.png', cols: 4, cellWidth: 480, cellHeight: 270, padding: 4 });
  assert.deepEqual(args.slice(0, 3), ['-y', '-v', 'error']);
  assert.equal(args.filter((a) => a === '-i').length, 5);
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /\[4:v\]scale=480:270:force_original_aspect_ratio=decrease,pad=480:270/);
  assert.match(filter, /\[c0\]\[c1\]\[c2\]\[c3\]\[c4\]concat=n=5:v=1:a=0,tile=4x2:padding=4:margin=4/);
  assert.deepEqual(args.slice(-3), ['-frames:v', '1', 'sheet.png']);
  const few = ffmpegArgs({ files: ['a.png', 'b.png'], out: 's.png', cols: 4, cellWidth: 480, cellHeight: 270, padding: 4 });
  assert.match(few[few.indexOf('-filter_complex') + 1], /tile=2x1/, 'no empty columns');
});

test('makeSheets makes one sheet for up to 12 frames and a numbered legend', async () => {
  const calls = [];
  const files = names(12);
  const result = await makeSheets({ files, out: 'work/frames/sheet.png', cwd: project, run: fakeRun(calls) });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0].path, 'work/frames/sheet.png');
  assert.deepEqual(result.sheets[0].cells[0], { n: 1, file: files[0] });
  assert.deepEqual(result.sheets[0].cells[11], { n: 12, file: files[11] });
  assert.equal(result.cell, '480x270');
});

test('more than 12 frames make several sheets, and the numbering restarts on each', async () => {
  const calls = [];
  const result = await makeSheets({ files: names(14), out: 'work/frames/sheet.png', cwd: project, run: fakeRun(calls) });
  assert.equal(calls.length, 2);
  assert.deepEqual(result.sheets.map((s) => [s.path, s.cells.length]), [['work/frames/sheet-1.png', 12], ['work/frames/sheet-2.png', 2]]);
  assert.equal(result.sheets[1].cells[0].n, 1);
});

test('frames and output outside work/, missing frames and bad extensions are refused without running ffmpeg', async () => {
  const calls = [];
  const run = fakeRun(calls);
  writeFileSync(join(project, 'outside.png'), 'x');
  const refuse = async (files, out) => (await makeSheets({ files, out, cwd: project, run })).reason;
  assert.equal(await refuse(['outside.png'], 'work/frames/s.png'), 'outside_work');
  assert.equal(await refuse(['../x.png'], 'work/frames/s.png'), 'outside_work');
  assert.equal(await refuse(names(1), 'sheet.png'), 'outside_work');
  assert.equal(await refuse(names(1), 'work/frames/s.jpg'), 'bad_path');
  assert.equal(await refuse(['work/frames/nope.png'], 'work/frames/s.png'), 'file_missing');
  assert.equal(await refuse([], 'work/frames/s.png'), 'no_frames');
  assert.equal(calls.length, 0);
});

test('an ffmpeg failure is passed on, and a missing ffmpeg says how to continue', async () => {
  const failing = async () => ({ ok: false, reason: 'ffmpeg_missing', detail: 'ffmpeg is not installed or not on PATH.' });
  const result = await makeSheets({ files: names(2), out: 'work/frames/sheet.png', cwd: project, run: failing });
  assert.deepEqual([result.ok, result.reason], [false, 'ffmpeg_missing']);
});

test('parseArgs reads the options and the frames, and rejects bad numbers and unknown options', () => {
  assert.deepEqual(parseArgs(['--out', 'o.png', '--cols', '3', 'a.png', 'b.png']), { out: 'o.png', files: ['a.png', 'b.png'], options: { cols: 3 } });
  assert.throws(() => parseArgs(['a.png']), /Usage/);
  assert.throws(() => parseArgs(['--out', 'o.png', '--cols', 'x']), /whole number/);
  assert.throws(() => parseArgs(['--out', 'o.png', '--wat']), /Unknown option/);
});

test('main prints JSON and the exit code', async () => {
  const lines = [];
  const stdout = { write: (text) => lines.push(text) };
  const calls = [];
  assert.equal(await main(['--out', 'work/frames/s.png', ...names(2)], { cwd: project, stdout, run: fakeRun(calls) }), 0);
  assert.equal(JSON.parse(lines[0]).ok, true);
  assert.equal(await main(['nope.png'], { cwd: project, stdout }), 2);
  assert.equal(JSON.parse(lines[1]).reason, 'usage');
});

test('with a real ffmpeg the sheet file is written (skipped where ffmpeg is not installed)', (t) => {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) return t.skip('ffmpeg is not installed');
  const made = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x36', '-frames:v', '1', join(project, 'work', 'frames', 'one.png')]);
  assert.equal(made.status, 0);
  const result = spawnSync(process.execPath, [join(REPO, 'bin', 'mf-sheet'), '--out', 'work/frames/sheet.png', 'work/frames/one.png', 'work/frames/one.png'], { cwd: project, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(join(project, 'work', 'frames', 'sheet.png')));
});
