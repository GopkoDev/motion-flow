// ae-run tests: no After Effects needed, a fake launcher plays its part.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LauncherError } from './ae-launcher.mjs';
import { buildWrapper, fixErrorLines, main, parseArgs, runAe, SCRIPT_LINE_OFFSET } from './ae-run.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
let base; let home; let project; let work;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mf-run-'));
  home = join(base, 'home');
  project = join(base, 'project');
  work = join(project, 'work');
  for (const dir of [home, work, join(project, 'jsx')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(work, 'p.aep'), 'aep');
  writeFileSync(join(project, 'jsx', '01-step.jsx'), 'mf.runIpc(function (input) { return { n: 1 }; });\n');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

/** A launcher that behaves like After Effects: reads the wrapper, writes the result file. */
function fakeLauncher(behavior = 'ok', extra = {}) {
  const calls = [];
  const launcher = async (scriptPath) => {
    calls.push(scriptPath);
    const text = readFileSync(scriptPath, 'utf8');
    const outPath = JSON.parse(/outPath: ("(?:[^"\\]|\\.)*")/.exec(text)[1]);
    if (behavior === 'ok') writeFileSync(outPath, JSON.stringify({ ok: true, result: { n: 1 }, error: null, durationMs: 5, ...extra }));
    if (behavior === 'error') writeFileSync(outPath, JSON.stringify({ ok: false, result: null, error: extra.error ?? 'boom', durationMs: 3 }));
    if (behavior === 'exit-fail') return { exited: Promise.resolve({ code: 1, stderr: 'execution error: not allowed' }) };
    if (behavior === 'exit-zero') return { exited: Promise.resolve({ code: 0, stderr: '' }) };
    if (behavior === 'slow') await new Promise((r) => setTimeout(r, extra.ms ?? 150)).then(() => writeFileSync(outPath, JSON.stringify({ ok: true, result: 1, error: null, durationMs: 1 })));
    return { exited: null };
  };
  launcher.calls = calls;
  return launcher;
}

const run = (overrides = {}) => runAe({
  ping: false, project: 'work/p.aep', script: 'jsx/01-step.jsx', undo: 'Step', params: {}, timeout: 5,
  cwd: project, home, pollMs: 5, exitGraceMs: 30, launcher: fakeLauncher(), ...overrides,
});
const code = async (promise) => { try { await promise; return null; } catch (e) { return e.code; } };

// ---------- arguments ----------

test('parseArgs accepts a full run and --ping', () => {
  assert.deepEqual(parseArgs(['--project', 'work/a.aep', '--script', 'jsx/1.jsx', '--undo', 'Do it', '--params', '{"a":1}', '--timeout', '30']),
    { ping: false, project: 'work/a.aep', script: 'jsx/1.jsx', undo: 'Do it', params: { a: 1 }, timeout: 30 });
  assert.equal(parseArgs(['--project', 'a', '--script', 'b', '--undo', 'c']).timeout, 120);
  assert.deepEqual(parseArgs(['--ping']), { ping: true });
});

test('parseArgs rejects bad input with the usage code', () => {
  const bad = (argv) => { try { parseArgs(argv); return null; } catch (e) { return e.code; } };
  assert.equal(bad([]), 'usage');
  assert.equal(bad(['--project', 'a']), 'usage');
  assert.equal(bad(['--bogus']), 'usage');
  assert.equal(bad(['--project']), 'usage');
  assert.equal(bad(['--ping', '--project', 'a']), 'usage');
  assert.equal(bad(['--project', 'a', '--script', 'b', '--undo', 'x'.repeat(101)]), 'usage');
  assert.equal(bad(['--project', 'a', '--script', 'b', '--undo', 'a\nb']), 'usage');
  for (const timeout of ['0', '-1', 'abc', '901']) assert.equal(bad(['--project', 'a', '--script', 'b', '--undo', 'c', '--timeout', timeout]), 'usage', timeout);
  for (const params of ['{ nope', '[1]', '"x"', 'null']) assert.equal(bad(['--project', 'a', '--script', 'b', '--undo', 'c', '--params', params]), 'usage', params);
  assert.equal(bad(['--project', 'a', '--script', 'b', '--undo', 'c', '--params', JSON.stringify({ a: 'x'.repeat(70000) })]), 'usage');
});

// ---------- a normal run ----------

test('a run writes the IPC files, launches the wrapper and returns the result', async () => {
  const launcher = fakeLauncher();
  const result = await run({ launcher, params: { comp: 'Main "A"', text: 'Привіт' } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { n: 1 });
  assert.deepEqual(launcher.calls, [result.ipc.run]);
  const input = JSON.parse(readFileSync(result.ipc.in, 'utf8'));
  assert.equal(input.id, result.id);
  assert.equal(input.undo, 'Step');
  assert.deepEqual(input.params, { comp: 'Main "A"', text: 'Привіт' });
  assert.equal(input.project, join(statSync(work) && require_real(work), 'p.aep'));
  for (const path of Object.values(result.ipc)) assert.ok(path.includes(`${join('work', '.ipc')}`), path);
});

function require_real(path) {
  return spawnSync(process.execPath, ['-e', 'console.log(require("fs").realpathSync.native(process.argv[1]))', path], { encoding: 'utf8' }).stdout.trim();
}

test('the wrapper holds the settings, the helpers and the script as text, with a BOM', async () => {
  const result = await run();
  const text = readFileSync(result.ipc.run, 'utf8');
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.match(text, /^\uFEFF\$\.global\.MF_IPC = \{ inPath: ".*\.in\.json", outPath: ".*\.out\.json", undoName: "Step", workDir: ".*work", save: true \};\n/);
  assert.ok(text.includes('var mf = (function ()'), 'helpers are included');
  const script = readFileSync(join(project, 'jsx', '01-step.jsx'), 'utf8');
  const embedded = JSON.parse(/var source = ("(?:[^"\\]|\\.)*");/.exec(text)[1]);
  assert.equal(embedded, script, 'the script is embedded as a string, not as code that AE would parse up front');
  assert.ok(!text.includes('mf.runIpc(function (input) { return { n: 1 }; });\n(function'), 'the script text is not inlined as code');
  assert.ok(text.includes('new Function(source)') && text.includes('mf.failIpc('));
});

test('the lock is released after success, error, timeout and launch failure', async () => {
  const lock = join(work, '.ipc', 'ae.lock');
  await run();
  assert.equal(existsSync(lock), false);
  await run({ launcher: fakeLauncher('error') });
  assert.equal(existsSync(lock), false);
  await code(run({ launcher: fakeLauncher('never'), timeout: 0.05 }));
  assert.equal(existsSync(lock), false);
  await code(run({ launcher: fakeLauncher('exit-fail') }));
  assert.equal(existsSync(lock), false);
});

test('a script error is returned (not thrown) and names the script', async () => {
  const launcher = async (scriptPath) => {
    const wrapper = readFileSync(scriptPath, 'utf8');
    const outPath = JSON.parse(/outPath: ("(?:[^"\\]|\\.)*")/.exec(wrapper)[1]);
    writeFileSync(outPath, JSON.stringify({ ok: false, result: null, error: 'Layer not found: X (line 4)', durationMs: 2 }));
    return { exited: null };
  };
  const result = await run({ launcher });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Layer not found: X (01-step.jsx line 4)');
});

test('fixErrorLines names the script and applies the calibrated offset', () => {
  assert.equal(fixErrorLines('bad (line 5)', 's.jsx', { scriptLineOffset: 0 }), 'bad (s.jsx line 5)');
  assert.equal(fixErrorLines('bad (line 5)', 's.jsx', { scriptLineOffset: 2 }), 'bad (s.jsx line 3)');
  assert.equal(fixErrorLines('bad (line 1)', 's.jsx', { scriptLineOffset: 2 }), 'bad (s.jsx line 1)', 'never below line 1');
  assert.equal(fixErrorLines('no line info', 's.jsx', { scriptLineOffset: 0 }), 'no line info');
  assert.equal(fixErrorLines(null, 's.jsx', { scriptLineOffset: 0 }), null);
  const wrapper = buildWrapper({ inPath: 'i', outPath: 'o', undoName: 'u', workDir: 'w', save: true }, 'a\nb', 'script');
  assert.equal(wrapper.scriptLineOffset, SCRIPT_LINE_OFFSET);
});

test('the launching process is stopped when the run ends (success or timeout) but After Effects is never touched', async () => {
  let stops = 0;
  const waiting = async (scriptPath) => ({ exited: new Promise(() => {}), stop: () => { stops++; }, scriptPath });
  await code(run({ launcher: waiting, timeout: 0.05 }));
  assert.equal(stops, 1);
  const finishing = async (scriptPath) => {
    const outPath = JSON.parse(/outPath: ("(?:[^"\\]|\\.)*")/.exec(readFileSync(scriptPath, 'utf8'))[1]);
    writeFileSync(outPath, JSON.stringify({ ok: true, result: 1, error: null, durationMs: 1 }));
    return { exited: new Promise(() => {}), stop: () => { stops++; } };
  };
  await run({ launcher: finishing });
  assert.equal(stops, 2);
});

// ---------- only work/ ----------

test('a project outside work/ is refused in every form', async () => {
  const outside = join(base, 'outside.aep');
  writeFileSync(outside, 'x');
  writeFileSync(join(project, 'top.aep'), 'x');
  mkdirSync(join(base, 'elsewhere'));
  writeFileSync(join(base, 'elsewhere', 'e.aep'), 'x');
  symlinkSync(outside, join(work, 'link.aep'));
  symlinkSync(join(base, 'elsewhere'), join(work, 'dir-link'));
  const launcher = fakeLauncher();
  for (const path of ['top.aep', '../outside.aep', 'work/../top.aep', outside, join(project, 'top.aep'), 'work/link.aep', 'work/dir-link/e.aep', 'work']) {
    assert.ok(['outside_work', 'bad_path'].includes(await code(run({ project: path, launcher }))), path);
  }
  assert.deepEqual(launcher.calls, [], 'After Effects was never started');
});

test('the project must exist and be an .aep file', async () => {
  writeFileSync(join(work, 'notes.txt'), 'x');
  assert.equal(await code(run({ project: 'work/missing.aep' })), 'bad_path');
  assert.equal(await code(run({ project: 'work/notes.txt' })), 'bad_path');
  assert.equal(await code(run({ project: 'work/p.aep\n' })), 'bad_path');
});

test('the script must be a .jsx file in the project jsx/ folder', async () => {
  writeFileSync(join(work, 'evil.jsx'), 'x');
  writeFileSync(join(project, 'jsx', 'notes.txt'), 'x');
  writeFileSync(join(base, 'outside.jsx'), 'x');
  symlinkSync(join(base, 'outside.jsx'), join(project, 'jsx', 'link.jsx'));
  for (const script of ['work/evil.jsx', '../outside.jsx', join(base, 'outside.jsx'), 'jsx/notes.txt', 'jsx/link.jsx', 'jsx/missing.jsx', 'jsx']) {
    assert.equal(await code(run({ script })), 'bad_path', script);
  }
  assert.equal((await run({ script: 'jsx/01-step.jsx' })).ok, true);
});

test('the plugin scripts in lib/jsx are allowed', async () => {
  const result = await run({ script: join(REPO, 'lib', 'jsx', 'dump.jsx') });
  assert.equal(result.ok, true);
});

test('work/.ipc cannot be a link', async () => {
  mkdirSync(join(base, 'elsewhere'));
  symlinkSync(join(base, 'elsewhere'), join(work, '.ipc'));
  assert.equal(await code(run()), 'bad_path');
  assert.deepEqual(readdirSync(join(base, 'elsewhere')), []);
});

test('nothing is written outside work/.ipc', async () => {
  const list = (dir) => readdirSync(dir, { recursive: true }).filter((n) => !n.startsWith(join('work', '.ipc'))).sort();
  const before = list(project);
  await run();
  await code(run({ project: '../x.aep' }));
  await code(run({ launcher: fakeLauncher('never'), timeout: 0.05 }));
  assert.deepEqual(list(project).filter((n) => n !== join('work', '.ipc')), before.filter((n) => n !== join('work', '.ipc')));
  assert.deepEqual(readdirSync(base).sort(), ['home', 'project']);
});

// ---------- timeout, launch failures ----------

test('timeout gives a clear error and does not wait longer', async () => {
  const started = Date.now();
  const error = await run({ launcher: fakeLauncher('never'), timeout: 0.1 }).catch((e) => e);
  assert.equal(error.code, 'timeout');
  assert.match(error.hint, /dialog/);
  assert.ok(Date.now() - started < 2000);
});

test('a failed launch is reported with the process message', async () => {
  const error = await run({ launcher: fakeLauncher('exit-fail') }).catch((e) => e);
  assert.equal(error.code, 'launch_failed');
  assert.match(error.message, /not allowed/);
  assert.match(error.hint, /Automation/);
});

test('a finished script without a result file is reported', async () => {
  assert.equal(await code(run({ launcher: fakeLauncher('exit-zero') })), 'no_result');
});

test('an unreadable result file is reported', async () => {
  const launcher = async (scriptPath) => {
    const outPath = JSON.parse(/outPath: ("(?:[^"\\]|\\.)*")/.exec(readFileSync(scriptPath, 'utf8'))[1]);
    writeFileSync(outPath, '{ nope');
    return { exited: null };
  };
  assert.equal(await code(run({ launcher })), 'bad_result');
  const launcher2 = async (scriptPath) => {
    const outPath = JSON.parse(/outPath: ("(?:[^"\\]|\\.)*")/.exec(readFileSync(scriptPath, 'utf8'))[1]);
    writeFileSync(outPath, '{"x":1}');
    return { exited: null };
  };
  assert.equal(await code(run({ launcher: launcher2 })), 'bad_result');
});

test('launcher errors keep their code and hint', async () => {
  const launcher = async () => { throw new LauncherError('ae_not_found', 'After Effects was not found', 'Install it'); };
  const error = await run({ launcher }).catch((e) => e);
  assert.deepEqual([error.code, error.hint], ['ae_not_found', 'Install it']);
});

// ---------- the lock ----------

test('a second run at the same time is refused, and works once the first has finished', async () => {
  const first = run({ launcher: fakeLauncher('slow', { ms: 200 }) });
  await new Promise((r) => setTimeout(r, 50));
  const error = await run().catch((e) => e);
  assert.equal(error.code, 'busy');
  assert.match(error.message, /Another ae-run is already running/);
  assert.equal((await first).ok, true);
  assert.equal((await run()).ok, true);
});

test('a lock left by a dead process is cleaned up; one held by a live process is respected', async () => {
  mkdirSync(join(work, '.ipc'), { recursive: true });
  const lock = join(work, '.ipc', 'ae.lock');
  const write = (info) => writeFileSync(lock, JSON.stringify({ id: 'old', host: hostname(), started: Date.now(), deadline: Date.now() + 60000, ...info }));
  write({ pid: 2 ** 22 + 12345 }); // no such process
  assert.equal((await run()).ok, true);
  write({ pid: process.pid });
  assert.equal(await code(run()), 'busy');
  rmSync(lock);
});

test('an unreadable old lock and an overdue lock are cleaned up, a fresh unreadable one is respected', async () => {
  mkdirSync(join(work, '.ipc'), { recursive: true });
  const lock = join(work, '.ipc', 'ae.lock');
  writeFileSync(lock, '{ nope');
  assert.equal(await code(run()), 'busy');
  const old = new Date(Date.now() - 20 * 60 * 1000);
  utimesSync(lock, old, old);
  assert.equal((await run()).ok, true);
  writeFileSync(lock, JSON.stringify({ id: 'x', pid: process.pid, host: hostname(), started: 0, deadline: Date.now() - 10 * 60 * 1000 }));
  assert.equal((await run()).ok, true);
});

// ---------- housekeeping ----------

test('old IPC files are removed, recent ones are kept', async () => {
  mkdirSync(join(work, '.ipc'), { recursive: true });
  const oldFile = join(work, '.ipc', 'abc-123.out.json');
  const newFile = join(work, '.ipc', 'def-456.out.json');
  writeFileSync(oldFile, '{}');
  writeFileSync(newFile, '{}');
  writeFileSync(join(work, '.ipc', 'keep.txt'), 'x');
  const week = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(oldFile, week, week);
  utimesSync(join(work, '.ipc', 'keep.txt'), week, week);
  await run();
  assert.equal(existsSync(oldFile), false);
  assert.equal(existsSync(newFile), true);
  assert.equal(existsSync(join(work, '.ipc', 'keep.txt')), true, 'unknown files are never touched');
});

// ---------- ping ----------

test('--ping runs ping.jsx read-only without a project and creates work/.ipc', async () => {
  rmSync(work, { recursive: true });
  const launcher = async (scriptPath) => {
    const text = readFileSync(scriptPath, 'utf8');
    assert.match(text, /save: false/);
    assert.ok(text.includes('aeVersion: app.version'));
    const outPath = JSON.parse(/outPath: ("(?:[^"\\]|\\.)*")/.exec(text)[1]);
    writeFileSync(outPath, JSON.stringify({ ok: true, result: { aeVersion: '24.1.0', projectOpen: true, projectPath: '/w/p.aep' }, error: null, durationMs: 9 }));
    return { exited: null };
  };
  let text = '';
  const exit = await main(['--ping'], { cwd: project, home, pollMs: 5, launcher, stdout: { write: (c) => { text += c; } } });
  assert.equal(exit, 0);
  assert.deepEqual(JSON.parse(text), { ok: true, aeVersion: '24.1.0', projectOpen: true, projectPath: '/w/p.aep', durationMs: 9 });
  assert.ok(existsSync(join(project, 'work', '.ipc')));
});

// ---------- main ----------

async function runMain(argv, ctx = {}) {
  let text = '';
  const exit = await main(argv, { cwd: project, home, pollMs: 5, exitGraceMs: 30, launcher: fakeLauncher(), stdout: { write: (c) => { text += c; } }, ...ctx });
  return { exit, out: JSON.parse(text) };
}

test('main: exit 0 with the result, 1 for a failed script or run, 2 for bad usage', async () => {
  const ok = await runMain(['--project', 'work/p.aep', '--script', 'jsx/01-step.jsx', '--undo', 'Step']);
  assert.equal(ok.exit, 0);
  assert.equal(ok.out.ok, true);
  const scriptFailed = await runMain(['--project', 'work/p.aep', '--script', 'jsx/01-step.jsx', '--undo', 'Step'], { launcher: fakeLauncher('error') });
  assert.equal(scriptFailed.exit, 1);
  assert.deepEqual([scriptFailed.out.ok, scriptFailed.out.code, scriptFailed.out.error], [false, 'script_error', 'boom']);
  const outside = await runMain(['--project', '../x.aep', '--script', 'jsx/01-step.jsx', '--undo', 'Step']);
  assert.equal(outside.exit, 1);
  assert.equal(outside.out.code, 'bad_path');
  const usage = await runMain(['--nope']);
  assert.equal(usage.exit, 2);
  assert.equal(usage.out.code, 'usage');
});

test('the CLI binary reports a missing After Effects clearly on a machine without it', () => {
  const result = spawnSync(process.execPath, [join(REPO, 'bin', 'ae-run'), '--project', 'work/p.aep', '--script', 'jsx/01-step.jsx', '--undo', 'Step'], {
    cwd: project, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  const out = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(out.ok, false);
  assert.ok(['ae_not_found', 'unsupported_os'].includes(out.code), out.code);
  assert.equal(existsSync(join(work, '.ipc', 'ae.lock')), false, 'the lock is released');
  assert.equal(spawnSync(process.execPath, [join(REPO, 'bin', 'ae-run')], { cwd: project, encoding: 'utf8', env: { ...process.env, HOME: home } }).status, 2);
});

// ---------- T2.3 security review findings ----------

test('scripts in the project may not run system commands, dynamic code, the network or raw File/Folder access', async () => {
  const launcher = fakeLauncher();
  const bad = {
    'system.callSystem("rm -rf ~")': /system commands/,
    'var r = callSystem("x");': /system commands/,
    'new File("/etc/passwd").execute();': /launches files|File\/Folder/,
    'eval("1+1");': /dynamic code/,
    '$.eval("1");': /dynamic code/,
    '$.evalFile("/x.jsx");': /dynamic code/,
    'var f = new Function("return 1");': /dynamic code/,
    'var s = new Socket();': /network/,
    'var f = new File("/x"); f.remove();': /File\/Folder/,
    'Folder.temp.getFiles();': /File\/Folder/,
    '$.global["sys" + "tem"].callSystem("x");': /looks up globals/,
    'this["ev" + "al"]("1");': /looks up globals/,
    'app.quit();': /opens, closes/,
    'app.open(x);': /opens, closes/,
    'app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);': /opens, closes/,
    'app.project.saveWithDialog();': /opens, closes/,
    'app.executeCommand(4);': /opens, closes/,
    'var home = $.getenv("HOME");': /environment/,
  };
  for (const [source, expected] of Object.entries(bad)) {
    writeFileSync(join(project, 'jsx', '02-bad.jsx'), `${source}\n`);
    const error = await run({ script: 'jsx/02-bad.jsx', launcher }).catch((e) => e);
    assert.equal(error.code, 'script_policy', source);
    assert.match(error.message, expected, source);
  }
  assert.deepEqual(launcher.calls, [], 'After Effects never saw any of them');
});

test('ordinary scripts and mentions inside comments and strings are allowed', async () => {
  writeFileSync(join(project, 'jsx', '03-ok.jsx'), [
    '// we do not call system.callSystem or eval() here',
    'var note = "File and Folder are not used; app.quit() is just text";',
    'mf.runIpc(function (input) {',
    '    var comp = mf.findComp(input.params.comp);',
    '    var layer = mf.findLayer(comp, "Logo");',
    '    layer.remove();',
    '    var file = mf.workFile(input.params.path);',
    '    return { ok: true };',
    '});',
  ].join('\n'));
  assert.equal((await run({ script: 'jsx/03-ok.jsx' })).ok, true);
});

test('the policy line numbers point at the offending line', async () => {
  writeFileSync(join(project, 'jsx', '04.jsx'), 'var a = 1;\nvar b = 2;\nsystem.callSystem("x");\n');
  const error = await run({ script: 'jsx/04.jsx' }).catch((e) => e);
  assert.match(error.message, /line 3: runs system commands/);
});

test('the plugin scripts are trusted and may use File', async () => {
  assert.equal((await run({ script: join(REPO, 'lib', 'jsx', 'helpers.jsx') })).ok, true);
});

test('parameters cannot carry keys that alter prototypes', () => {
  for (const params of ['{"__proto__":{"x":1}}', '{"a":{"constructor":1}}', '{"a":[{"prototype":2}]}']) {
    assert.throws(() => parseArgs(['--project', 'a', '--script', 'b', '--undo', 'c', '--params', params]), /must not contain the key/, params);
  }
  assert.deepEqual(parseArgs(['--project', 'a', '--script', 'b', '--undo', 'c', '--params', '{"constructors":1,"a":{"b":[1]}}']).params, { constructors: 1, a: { b: [1] } });
});

test('hostile values in arguments cannot break out of the wrapper or the AppleScript line', async () => {
  const nasty = '"; system.callSystem("touch /tmp/pwned"); //\u2028\u2029\\';
  const result = await run({ undo: nasty, params: { comp: nasty } });
  assert.equal(result.ok, true);
  const text = readFileSync(result.ipc.run, 'utf8');
  const header = text.split('\n')[0];
  assert.ok(!header.includes('\u2028') && !header.includes('\u2029'), 'line separators are escaped');
  assert.equal(text.split('\n')[1].includes('system.callSystem'), false, 'the injected text did not escape its string');
  const wrapperUndo = JSON.parse(/undoName: ("(?:[^"\\]|\\.)*")/.exec(header)[1]);
  assert.equal(wrapperUndo, nasty, 'the name round-trips as plain data');
  assert.equal(JSON.parse(readFileSync(result.ipc.in, 'utf8')).params.comp, nasty);
});

test('a project path with quotes or unusual characters stays data', async () => {
  const odd = 'p "quoted" \' $(x) `y`.aep';
  writeFileSync(join(work, odd), 'aep');
  const result = await run({ project: `work/${odd}` });
  assert.equal(result.ok, true);
  assert.ok(JSON.parse(readFileSync(result.ipc.in, 'utf8')).project.endsWith(odd));
});
