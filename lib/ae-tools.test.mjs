import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dump, renderFrame } from './ae-tools.mjs';
import { safeOutputPath, PathError, waitForFileSettled } from './work-paths.mjs';
import { validateDump } from './dump-schema.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const NORMAL = JSON.parse(readFileSync(join(REPO, 'evals', 'fixtures', 'normal.dump.json'), 'utf8'));
let base; let home; let project; let work;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mf-tools-'));
  home = join(base, 'home');
  project = join(base, 'project');
  work = join(project, 'work');
  for (const dir of [home, work]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(work, 'p.aep'), 'aep');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

/** A fake After Effects: reads the run files, optionally does something, then writes the result. */
function fakeAe(handler) {
  const seen = [];
  const launcher = async (scriptPath) => {
    const wrapper = readFileSync(scriptPath, 'utf8');
    const outPath = JSON.parse(/outPath: ("(?:[^"\\]|\\.)*")/.exec(wrapper)[1]);
    const inPath = JSON.parse(/inPath: ("(?:[^"\\]|\\.)*")/.exec(wrapper)[1]);
    const input = JSON.parse(readFileSync(inPath, 'utf8'));
    seen.push({ wrapper, input });
    const reply = handler({ input, wrapper });
    writeFileSync(outPath, JSON.stringify({ ok: true, result: null, error: null, durationMs: 7, ...reply }));
    return { exited: null };
  };
  launcher.seen = seen;
  return launcher;
}

async function call(tool, argv, launcher, extra = {}) {
  let text = '';
  const exit = await tool(argv, { cwd: project, home, pollMs: 5, frameWaitMs: 1500, frameStableMs: 30, launcher, stdout: { write: (c) => { text += c; } }, ...extra });
  return { exit, out: JSON.parse(text) };
}

// ---------- ae-dump ----------

test('ae-dump runs lib/jsx/dump.jsx on the project and writes a valid dump into work/', async () => {
  const ae = fakeAe(() => ({ result: NORMAL }));
  const { exit, out } = await call(dump, ['--project', 'work/p.aep', '--out', 'work/dumps/p.json'], ae);
  assert.equal(exit, 0);
  assert.equal(out.ok, true);
  assert.equal(out.comps, 2);
  assert.equal(out.layers, 8);
  const written = JSON.parse(readFileSync(join(work, 'dumps', 'p.json'), 'utf8'));
  assert.deepEqual(validateDump(written), []);
  assert.ok(ae.seen[0].wrapper.includes('mf.dumpProject'), 'the plugin dump script was run');
  assert.deepEqual(ae.seen[0].input.params, {});
  assert.equal(ae.seen[0].input.undo, 'ae-dump');
});

test('ae-dump passes its options on as script parameters', async () => {
  const ae = fakeAe(() => ({ result: NORMAL }));
  await call(dump, ['--project', 'work/p.aep', '--out', 'work/d.json', '--no-keyframes', '--no-expressions', '--max-keyframes', '50'], ae);
  assert.deepEqual(ae.seen[0].input.params, { keyframes: false, expressions: false, maxKeyframes: 50 });
});

test('ae-dump refuses an output outside work/ before After Effects is started', async () => {
  symlinkSync(base, join(work, 'jump'));
  const ae = fakeAe(() => ({ result: NORMAL }));
  for (const out of ['d.json', '../d.json', join(base, 'd.json'), 'work/../d.json', 'work/jump/d.json', 'work/d.txt', 'work', 'work/']) {
    const { exit, out: result } = await call(dump, ['--project', 'work/p.aep', '--out', out], ae);
    assert.notEqual(exit, 0, out);
    assert.ok(['outside_work', 'bad_path'].includes(result.code), `${out}: ${result.code}`);
  }
  assert.deepEqual(ae.seen, []);
  assert.equal(existsSync(join(base, 'd.json')), false);
});

test('ae-dump refuses a project outside work/ (the ae-run rule applies)', async () => {
  writeFileSync(join(project, 'top.aep'), 'x');
  const ae = fakeAe(() => ({ result: NORMAL }));
  const { exit, out } = await call(dump, ['--project', 'top.aep', '--out', 'work/d.json'], ae);
  assert.equal(exit, 1);
  assert.equal(out.code, 'outside_work');
  assert.deepEqual(ae.seen, []);
});

test('ae-dump refuses a dump that does not match the schema and writes no file', async () => {
  const bad = JSON.parse(JSON.stringify(NORMAL));
  bad.comps[0].fps = 0;
  const { exit, out } = await call(dump, ['--project', 'work/p.aep', '--out', 'work/d.json'], fakeAe(() => ({ result: bad })));
  assert.equal(exit, 1);
  assert.equal(out.code, 'bad_dump');
  assert.match(out.error, /comps\[0\]\.fps/);
  assert.equal(existsSync(join(work, 'd.json')), false);
});

test('ae-dump reports a script error from After Effects', async () => {
  const { exit, out } = await call(dump, ['--project', 'work/p.aep', '--out', 'work/d.json'], fakeAe(() => ({ ok: false, error: 'Another project is open in After Effects' })));
  assert.equal(exit, 1);
  assert.deepEqual([out.code, out.error], ['script_error', 'Another project is open in After Effects']);
  assert.equal(existsSync(join(work, 'd.json')), false);
});

test('ae-dump argument errors are usage errors (exit 2)', async () => {
  for (const argv of [[], ['--project', 'work/p.aep'], ['--out', 'work/d.json'], ['--bogus'], ['--project'], ['--project', 'work/p.aep', '--out', 'work/d.json', '--max-keyframes', '0'], ['--project', 'work/p.aep', '--out', 'work/d.json', '--max-keyframes', 'x']]) {
    const { exit, out } = await call(dump, argv, fakeAe(() => ({})));
    assert.equal(exit, 2, JSON.stringify(argv));
    assert.equal(out.code, 'usage');
  }
});

test('ae-dump overwrites an older dump in work/ atomically', async () => {
  writeFileSync(join(work, 'd.json'), 'old');
  await call(dump, ['--project', 'work/p.aep', '--out', 'work/d.json'], fakeAe(() => ({ result: NORMAL })));
  assert.deepEqual(validateDump(JSON.parse(readFileSync(join(work, 'd.json'), 'utf8'))), []);
  assert.deepEqual(readdirSync(work).filter((n) => n.endsWith('.tmp')), []);
});

// ---------- ae-render-frame ----------

const png = (input) => writeFileSync(input.params.out, 'PNGDATA');

test('ae-render-frame asks the script for one frame and checks the PNG', async () => {
  const ae = fakeAe(({ input }) => { png(input); return { result: { width: 1920, height: 1080, time: input.params.time } }; });
  const { exit, out } = await call(renderFrame, ['--project', 'work/p.aep', '--comp', 'FINAL "A"', '--time', '2.5', '--out', 'work/frames/a.png'], ae);
  assert.equal(exit, 0);
  assert.deepEqual([out.ok, out.comp, out.time, out.width, out.height], [true, 'FINAL "A"', 2.5, 1920, 1080]);
  assert.equal(readFileSync(join(work, 'frames', 'a.png'), 'utf8'), 'PNGDATA');
  const { input, wrapper } = ae.seen[0];
  assert.deepEqual([input.params.comp, input.params.time], ['FINAL "A"', 2.5]);
  assert.ok(input.params.out.endsWith(join('work', 'frames', 'a.png')));
  assert.ok(wrapper.includes('saveFrameToPng'));
  assert.equal(input.undo, 'ae-render-frame');
});

test('ae-render-frame reports a missing or empty PNG', async () => {
  const none = await call(renderFrame, ['--project', 'work/p.aep', '--comp', 'A', '--time', '1', '--out', 'work/f.png'], fakeAe(() => ({ result: { width: 1, height: 1, time: 1 } })), { frameWaitMs: 150 });
  assert.equal(none.out.code, 'no_frame');
  const empty = await call(renderFrame, ['--project', 'work/p.aep', '--comp', 'A', '--time', '1', '--out', 'work/f.png'], fakeAe(({ input }) => { writeFileSync(input.params.out, ''); return { result: {} }; }), { frameWaitMs: 150 });
  assert.equal(empty.out.code, 'no_frame');
});

test('ae-render-frame waits for a PNG that appears after the script has returned (saveFrameToPng is asynchronous)', async () => {
  const ae = fakeAe(({ input }) => {
    // the file is written in pieces, after the result file: like After Effects does
    setTimeout(() => writeFileSync(input.params.out, 'PN'), 80);
    setTimeout(() => writeFileSync(input.params.out, 'PNGDATA'), 140);
    return { result: { width: 10, height: 10, time: 1 } };
  });
  const { exit, out } = await call(renderFrame, ['--project', 'work/p.aep', '--comp', 'A', '--time', '1', '--out', 'work/late.png'], ae);
  assert.equal(exit, 0);
  assert.equal(out.ok, true);
  assert.equal(readFileSync(join(work, 'late.png'), 'utf8'), 'PNGDATA', 'it waited until the file stopped growing');
});

test('ae-render-frame deletes an older PNG with the same name first, so it cannot pass for the new frame', async () => {
  writeFileSync(join(work, 'old.png'), 'OLDFRAME');
  const none = await call(renderFrame, ['--project', 'work/p.aep', '--comp', 'A', '--time', '1', '--out', 'work/old.png'], fakeAe(() => ({ result: { width: 1, height: 1, time: 1 } })), { frameWaitMs: 150 });
  assert.equal(none.out.code, 'no_frame');
  assert.equal(existsSync(join(work, 'old.png')), false);
});

test('waitForFileSettled: present and stable, appears later, stays empty, never appears', async () => {
  const file = join(work, 'w.bin');
  writeFileSync(file, 'abc');
  assert.equal(await waitForFileSettled(file, { timeoutMs: 500, stableMs: 20, pollMs: 5 }), 3);
  const later = join(work, 'later.bin');
  setTimeout(() => writeFileSync(later, 'xyz'), 50);
  assert.equal(await waitForFileSettled(later, { timeoutMs: 1000, stableMs: 30, pollMs: 5 }), 3);
  writeFileSync(join(work, 'empty.bin'), '');
  assert.equal(await waitForFileSettled(join(work, 'empty.bin'), { timeoutMs: 120, stableMs: 20, pollMs: 5 }), null);
  assert.equal(await waitForFileSettled(join(work, 'never.bin'), { timeoutMs: 80, stableMs: 20, pollMs: 5 }), null);
});

test('ae-render-frame refuses outputs outside work/ and non-PNG names before After Effects is started', async () => {
  symlinkSync(base, join(work, 'jump'));
  const ae = fakeAe(({ input }) => { png(input); return { result: {} }; });
  for (const out of ['f.png', '../f.png', join(base, 'f.png'), 'work/jump/f.png', 'work/f.jpg', 'work/f']) {
    const { exit, out: result } = await call(renderFrame, ['--project', 'work/p.aep', '--comp', 'A', '--time', '1', '--out', out], ae);
    assert.notEqual(exit, 0, out);
    assert.ok(['outside_work', 'bad_path'].includes(result.code), `${out}: ${result.code}`);
  }
  assert.deepEqual(ae.seen, []);
});

test('ae-render-frame validates comp and time', async () => {
  const ae = fakeAe(() => ({}));
  for (const argv of [['--comp', 'A', '--time', '-1'], ['--comp', 'A', '--time', 'x'], ['--comp', 'A', '--time', '100000'], ['--comp', '', '--time', '1'], ['--comp', 'a\nb', '--time', '1'], ['--time', '1'], ['--comp', 'A']]) {
    const { exit } = await call(renderFrame, ['--project', 'work/p.aep', '--out', 'work/f.png', ...argv], ae);
    assert.equal(exit, 2, JSON.stringify(argv));
  }
  assert.deepEqual(ae.seen, []);
});

test('ae-render-frame reports a script error (for example comp not found)', async () => {
  const { exit, out } = await call(renderFrame, ['--project', 'work/p.aep', '--comp', 'Nope', '--time', '1', '--out', 'work/f.png'], fakeAe(() => ({ ok: false, error: 'Comp not found: Nope' })));
  assert.equal(exit, 1);
  assert.deepEqual([out.code, out.error], ['script_error', 'Comp not found: Nope']);
});

// ---------- the shared path helper ----------

test('safeOutputPath creates folders inside work/ and rejects links, other extensions and escapes', () => {
  const workReal = spawnSync(process.execPath, ['-e', 'console.log(require("fs").realpathSync.native(process.argv[1]))', work], { encoding: 'utf8' }).stdout.trim();
  const path = safeOutputPath({ outArg: 'work/a/b/c.json', cwd: project, workReal, extension: '.json' });
  assert.equal(path, join(workReal, 'a', 'b', 'c.json'));
  assert.ok(existsSync(join(work, 'a', 'b')));
  symlinkSync(base, join(work, 'jump'));
  for (const outArg of ['work/jump/x.json', '../x.json', 'work/x.png', '', 'work', 'work/a']) {
    assert.throws(() => safeOutputPath({ outArg, cwd: project, workReal, extension: '.json' }), PathError, outArg);
  }
  assert.equal(existsSync(join(base, 'x.json')), false);
});

// ---------- the binaries ----------

test('the binaries exit 2 on bad usage and report a missing After Effects on this machine', () => {
  for (const name of ['ae-dump', 'ae-render-frame']) {
    const usage = spawnSync(process.execPath, [join(REPO, 'bin', name)], { cwd: project, encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.equal(usage.status, 2, name);
  }
  const result = spawnSync(process.execPath, [join(REPO, 'bin', 'ae-dump'), '--project', 'work/p.aep', '--out', 'work/d.json'], { cwd: project, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(result.status, 1);
  assert.ok(['ae_not_found', 'unsupported_os'].includes(JSON.parse(result.stdout).code));
  assert.equal(existsSync(join(work, 'd.json')), false);
});
