// ae-run: the only way motion-flow runs a JSX script in After Effects.
//   ae-run --ping
//   ae-run --project <work/...aep> --script <script.jsx> --undo <name> [--params '<json>'] [--timeout <seconds>]
// It writes only inside <project>/work/.ipc, reads the script from the project's jsx/ folder (or the plugin's lib/jsx),
// refuses any project outside work/, allows one run at a time (lock file), and waits for the result file.
import {
  appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync,
  statSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { hostname, homedir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, GateError } from './drive-gate.mjs';
import { checkPolicy } from './jsx-source.mjs';
import { launch, LauncherError } from './ae-launcher.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 900;
const MAX_PARAMS_BYTES = 64 * 1024;
const OLD_FILE_MS = 7 * 24 * 60 * 60 * 1000;
const EXIT_GRACE_MS = 1500;

export class RunError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

// ---------- arguments ----------

const OPTIONS = { '--project': 'string', '--script': 'string', '--undo': 'string', '--params': 'string', '--timeout': 'number', '--ping': 'bool', '--step': 'string', '--attempt': 'string' };

/** Keys that can change an object's prototype when a script copies the parameters. */
function dangerousKey(value) {
  if (value === null || typeof value !== 'object') return null;
  for (const key of Object.keys(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return key;
    const nested = dangerousKey(value[key]);
    if (nested) return nested;
  }
  return null;
}

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const kind = OPTIONS[argv[i]];
    if (!kind) throw new RunError('usage', `Unknown argument: ${argv[i]}`);
    if (kind === 'bool') { flags.ping = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new RunError('usage', `${argv[i - 1]} needs a value.`);
    flags[argv[i - 1].slice(2)] = value;
  }
  if (flags.ping) {
    if (Object.keys(flags).length > 1) throw new RunError('usage', '--ping takes no other options.');
    return { ping: true };
  }
  for (const name of ['project', 'script', 'undo']) {
    if (!flags[name]) throw new RunError('usage', `--${name} is required.`, 'Usage: ae-run --project <work/...aep> --script <script.jsx> --undo <name> [--params <json>] [--timeout <s>]  |  ae-run --ping');
  }
  if (flags.undo.length > 100 || /[\u0000-\u001f]/.test(flags.undo)) throw new RunError('usage', '--undo must be a short name (up to 100 characters, no control characters).');
  let timeout = DEFAULT_TIMEOUT_S;
  if (flags.timeout !== undefined) {
    timeout = Number(flags.timeout);
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_S) throw new RunError('usage', `--timeout must be between 0 and ${MAX_TIMEOUT_S} seconds.`);
  }
  let params = {};
  if (flags.params !== undefined) {
    if (Buffer.byteLength(flags.params) > MAX_PARAMS_BYTES) throw new RunError('usage', `--params is larger than ${MAX_PARAMS_BYTES} bytes.`);
    try {
      params = JSON.parse(flags.params);
    } catch (e) {
      throw new RunError('usage', `--params is not valid JSON: ${e.message}`);
    }
    if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new RunError('usage', '--params must be a JSON object.');
    const bad = dangerousKey(params);
    if (bad) throw new RunError('usage', `--params must not contain the key "${bad}".`);
  }
  const whole = (name, text) => {
    if (text === undefined) return undefined;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 9999) throw new RunError('usage', `--${name} must be a whole number from 1 to 9999.`);
    return n;
  };
  const step = whole('step', flags.step);
  const attempt = whole('attempt', flags.attempt);
  if (attempt !== undefined && step === undefined) throw new RunError('usage', '--attempt needs --step.');
  return { ping: false, project: flags.project, script: flags.script, undo: flags.undo, params, timeout, ...(step !== undefined ? { step } : {}), ...(attempt !== undefined ? { attempt } : {}) };
}

// ---------- paths ----------

function isInside(base, target) {
  const fold = (p) => (process.platform === 'linux' ? p : p.toLowerCase());
  const b = fold(base);
  const t = fold(target);
  return t === b || t.startsWith(b.endsWith(sep) ? b : b + sep);
}

function realOf(path, what) {
  try {
    return realpathSync.native(path);
  } catch {
    throw new RunError('bad_path', `${what} not found: ${path}`);
  }
}

function workRoot(cwd, home, { create }) {
  let config;
  try {
    config = loadConfig(join(home, '.motion-flow'));
  } catch (e) {
    if (e instanceof GateError) throw new RunError('bad_config', e.message, e.hint);
    throw e;
  }
  const work = resolve(cwd, config.workDir);
  if (create) mkdirSync(work, { recursive: true });
  return realOf(work, 'The work folder');
}

function checkProject(path, cwd, workReal) {
  if (/[\u0000-\u001f]/.test(path)) throw new RunError('bad_path', 'The project path contains control characters.');
  const real = realOf(resolve(cwd, path), 'Project');
  if (!statSync(real).isFile() || extname(real).toLowerCase() !== '.aep') throw new RunError('bad_path', `The project must be an .aep file: ${path}`);
  if (!isInside(workReal, real) || real === workReal) {
    throw new RunError('outside_work', `The project is outside the work folder: ${path}`, 'ae-run only works on copies inside work/. Copy the project there first (drive-gate fetch ... --to work/).');
  }
  return real;
}

function checkScript(path, cwd, pluginRoot) {
  const real = realOf(resolve(cwd, path), 'Script');
  if (!statSync(real).isFile() || extname(real).toLowerCase() !== '.jsx') throw new RunError('bad_path', `The script must be a .jsx file: ${path}`);
  const allowed = [join(cwd, 'jsx'), join(pluginRoot, 'lib', 'jsx')].map((dir) => { try { return realpathSync.native(dir); } catch { return null; } }).filter(Boolean);
  if (!allowed.some((dir) => isInside(dir, real))) {
    throw new RunError('bad_path', `The script is not in the project's jsx/ folder: ${path}`, 'Save generated scripts as jsx/NN-name.jsx in the project.');
  }
  // Scripts written into the project must stay inside the safety policy; the plugin's own scripts are trusted.
  const pluginJsx = realpathSync.native(join(pluginRoot, 'lib', 'jsx'));
  if (!isInside(pluginJsx, real)) {
    const problems = checkPolicy(readFileSync(real, 'utf8'));
    if (problems.length) {
      throw new RunError('script_policy', `The script is not allowed: ${problems.slice(0, 5).map((p) => `line ${p.line}: ${p.message}`).join('; ')}`,
        'Use the mf helpers instead (mf.workFile, mf.findLayer, ...). See skills/_shared/ae-scripting.md.');
    }
  }
  return real;
}

/** work/.ipc must be a real folder (not a link). Returns its path. */
function ensureIpcDir(workReal) {
  const dir = join(workReal, '.ipc');
  const stats = lstatSync(dir, { throwIfNoEntry: false });
  if (!stats) mkdirSync(dir);
  else if (stats.isSymbolicLink() || !stats.isDirectory()) throw new RunError('bad_path', `${dir} must be a normal folder.`, 'Remove it and run again.');
  return dir;
}

// ---------- lock ----------

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

let activeRelease = null;
export function releaseActiveLock() {
  if (activeRelease) activeRelease();
}

function readLock(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function acquireLock(ipcDir, info) {
  const file = join(ipcDir, 'ae.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify(info));
      closeSync(fd);
      const release = () => {
        const held = readLock(file);
        if (held?.id === info.id) { try { unlinkSync(file); } catch { /* already gone */ } }
        if (activeRelease === release) activeRelease = null;
      };
      activeRelease = release;
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const held = readLock(file);
      const age = Date.now() - (statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      const dead = held && held.host === hostname() && !pidAlive(held.pid);
      const abandoned = !held && age > 10 * 60 * 1000;
      const overdue = held && Date.now() > held.deadline + 5 * 60 * 1000;
      if (dead || abandoned || overdue) {
        try { unlinkSync(file); } catch { /* raced with another cleanup */ }
        continue;
      }
      throw new RunError('busy', `Another ae-run is already running${held ? ` (run ${held.id}, started ${new Date(held.started).toISOString()})` : ''}.`,
        'Wait for it to finish. After Effects runs one script at a time.');
    }
  }
  throw new RunError('busy', 'Could not take the ae-run lock.');
}

// ---------- the wrapper script ----------

const jsString = (value) => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * Line numbers of errors reported from inside the script, relative to the script text. New Function adds a wrapper
 * around the body, so AE may count a line or two more; the exact shift is calibrated on a real After Effects (T2.9).
 */
export const SCRIPT_LINE_OFFSET = 0;

/**
 * One self-contained script: the IPC settings, the helpers, and the user's script as TEXT that is compiled inside
 * try/catch. A syntax error in the user's script therefore becomes an error in the result file; it can never reach
 * After Effects as a modal error dialog (which would block every later run). A BOM makes AE read the file as UTF-8.
 */
export function buildWrapper({ inPath, outPath, undoName, save, workDir }, helpersText, scriptText) {
  const header = `\uFEFF$.global.MF_IPC = { inPath: ${jsString(inPath)}, outPath: ${jsString(outPath)}, undoName: ${jsString(undoName)}, workDir: ${jsString(workDir)}, save: ${save ? 'true' : 'false'} };\n`;
  const runner = `
(function () {
    var source = ${jsString(scriptText)};
    var run;
    try {
        run = new Function(source);
    } catch (compileError) {
        mf.failIpc("Syntax error in the script: " + mf.describeError(compileError));
        return;
    }
    try {
        run.call($.global);
    } catch (runError) {
        mf.failIpc(mf.describeError(runError));
        return;
    }
    mf.failIpc("The script finished without calling mf.runIpc, so there is no result.");
}());
`;
  return { text: `${header}${helpersText}\n${runner}`, scriptLineOffset: SCRIPT_LINE_OFFSET, scriptText };
}

/** Error lines from AE are relative to the script; name the script file so the reader knows which one. */
export function fixErrorLines(message, scriptName, offsets) {
  if (typeof message !== 'string') return message;
  return message.replace(/\(line (\d+)\)/, (all, n) => `(${scriptName} line ${Math.max(1, Number(n) - offsets.scriptLineOffset)})`);
}

// ---------- waiting for the result ----------

async function waitForResult({ outPath, exited, timeoutMs, pollMs, exitGraceMs = EXIT_GRACE_MS }) {
  const deadline = Date.now() + timeoutMs;
  let exitInfo = null;
  let exitSeen = 0;
  exited?.then((info) => { exitInfo = info; exitSeen = Date.now(); });
  for (;;) {
    if (existsSync(outPath)) {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(outPath, 'utf8'));
      } catch (e) {
        throw new RunError('bad_result', `The result file is not valid JSON: ${e.message}`);
      }
      if (!parsed || typeof parsed.ok !== 'boolean') throw new RunError('bad_result', 'The result file has no "ok" field.');
      return parsed;
    }
    if (exitInfo && Date.now() - exitSeen > exitGraceMs) {
      if (exitInfo.code !== 0) {
        throw new RunError('launch_failed', `After Effects could not run the script (exit ${exitInfo.code}): ${exitInfo.stderr || 'no details'}`,
          'On macOS, allow the terminal / Claude Code to control After Effects (System Settings > Privacy & Security > Automation). Make sure After Effects can be opened.');
      }
      throw new RunError('no_result', 'After Effects finished the script but no result file appeared.',
        'The script must call mf.runIpc, and After Effects needs Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network".');
    }
    if (Date.now() >= deadline) {
      throw new RunError('timeout', `No result after ${Math.round(timeoutMs / 1000)} seconds.`,
        'After Effects may be showing a dialog, still busy, or the script may be too long. Look at the After Effects window. A new run is refused until this one has ended; ae-run did not close After Effects.');
    }
    await sleep(pollMs);
  }
}

function cleanOldFiles(ipcDir) {
  try {
    for (const name of readdirSync(ipcDir)) {
      if (!/^[a-z0-9-]+\.(in|out|run)\.(json|jsx)$/.test(name)) continue;
      const file = join(ipcDir, name);
      if (Date.now() - statSync(file).mtimeMs > OLD_FILE_MS) unlinkSync(file);
    }
  } catch { /* cleaning is best effort */ }
}

// ---------- running ----------

/**
 * Runs one script. `options` = parsed arguments plus { cwd, home, pluginRoot, launcher, pollMs }.
 * Returns the result object; throws RunError for anything that stops the run before or around the script.
 */
export async function runAe(options) {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const pluginRoot = options.pluginRoot ?? PLUGIN_ROOT;
  const launcher = options.launcher ?? ((scriptPath) => launch(scriptPath, { home }));
  const pollMs = options.pollMs ?? 250;
  const ping = options.ping === true;

  const workReal = workRoot(cwd, home, { create: ping });
  const project = ping ? null : checkProject(options.project, cwd, workReal);
  const scriptReal = checkScript(ping ? join(pluginRoot, 'lib', 'jsx', 'ping.jsx') : options.script, ping ? pluginRoot : cwd, pluginRoot);
  const ipcDir = ensureIpcDir(workReal);
  cleanOldFiles(ipcDir);

  const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const paths = { in: join(ipcDir, `${id}.in.json`), out: join(ipcDir, `${id}.out.json`), run: join(ipcDir, `${id}.run.jsx`) };
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_S;
  const release = acquireLock(ipcDir, { id, pid: process.pid, host: hostname(), started: Date.now(), deadline: Date.now() + timeout * 1000 });
  try {
    writeFileSync(paths.in, `${JSON.stringify({ id, project, undo: options.undo ?? 'motion-flow ping', params: options.params ?? {} }, null, 2)}\n`, { flag: 'wx' });
    const helpers = readFileSync(join(pluginRoot, 'lib', 'jsx', 'helpers.jsx'), 'utf8');
    const wrapper = buildWrapper({ inPath: paths.in, outPath: paths.out, undoName: options.undo ?? 'motion-flow ping', workDir: workReal, save: !ping }, helpers, readFileSync(scriptReal, 'utf8'));
    writeFileSync(paths.run, wrapper.text, { flag: 'wx' });

    let launched;
    try {
      launched = await launcher(paths.run);
    } catch (e) {
      if (e instanceof LauncherError) throw new RunError(e.code, e.message, e.hint);
      throw e;
    }
    try {
      const result = await waitForResult({ outPath: paths.out, exited: launched?.exited ?? null, timeoutMs: timeout * 1000, pollMs, exitGraceMs: options.exitGraceMs });
      if (!result.ok) result.error = fixErrorLines(result.error, basename(scriptReal), wrapper);
      return { ...result, id, ipc: paths };
    } finally {
      try { launched?.stop?.(); } catch { /* the launching process already ended */ }
    }
  } finally {
    release();
  }
}

/**
 * Appends one line to <project>/.motion/build.log.jsonl for a build step. Only ae-run writes this file, so the log
 * is a record of what really ran; `mf-gate require check` reads it. Returns "written" or "skipped".
 */
function logStep(cwd, line) {
  const dir = join(cwd, '.motion');
  const file = join(dir, 'build.log.jsonl');
  try {
    if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return 'skipped';
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) return 'skipped';
    appendFileSync(file, `${JSON.stringify(line)}\n`);
    return 'written';
  } catch {
    return 'skipped';
  }
}

/** Command line entry. Writes one JSON document to stdout; returns the exit code (0 ok, 1 failed, 2 bad usage). */
export async function main(argv, ctx = {}) {
  const out = ctx.stdout ?? process.stdout;
  const emit = (value) => out.write(`${JSON.stringify(value)}\n`);
  try {
    const parsed = parseArgs(argv);
    const cwd = ctx.cwd ?? process.cwd();
    const started = Date.now();
    let result;
    try {
      result = await runAe({ ...parsed, ...ctx });
    } catch (e) {
      if (parsed.step !== undefined && e instanceof RunError) {
        logStep(cwd, { ts: new Date().toISOString(), step: parsed.step, script: parsed.script, attempt: parsed.attempt ?? 1, ok: false, durationMs: Date.now() - started, error: `${e.code}: ${e.message}` });
      }
      throw e;
    }
    if (parsed.step !== undefined) {
      const line = { ts: new Date().toISOString(), step: parsed.step, script: parsed.script, attempt: parsed.attempt ?? 1, ok: result.ok, durationMs: result.durationMs ?? Date.now() - started };
      if (result.ok) line.result = result.result;
      else line.error = result.error;
      result.log = logStep(cwd, line);
    }
    if (parsed.ping) {
      emit(result.ok
        ? { ok: true, aeVersion: result.result.aeVersion, projectOpen: result.result.projectOpen, projectPath: result.result.projectPath, durationMs: result.durationMs }
        : { ok: false, code: 'script_error', error: result.error });
    } else {
      emit(result.ok ? result : { ...result, code: 'script_error' });
    }
    return result.ok ? 0 : 1;
  } catch (e) {
    if (!(e instanceof RunError)) {
      emit({ ok: false, code: 'internal', error: e.message });
      return 1;
    }
    emit({ ok: false, code: e.code, error: e.message, hint: e.hint });
    return e.code === 'usage' ? 2 : 1;
  }
}
