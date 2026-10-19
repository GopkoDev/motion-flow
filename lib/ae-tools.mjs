// ae-dump and ae-render-frame: thin wrappers around ae-run. They add no logic of their own beyond
// checking their arguments and the output file; every After Effects call goes through runAe.
import { existsSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, GateError } from './drive-gate.mjs';
import { validateDump } from './dump-schema.mjs';
import { RunError, runAe } from './ae-run.mjs';
import { PathError, safeOutputPath, waitForFileSettled } from './work-paths.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

function workReal(cwd, home) {
  let config;
  try {
    config = loadConfig(join(home, '.motion-flow'));
  } catch (e) {
    if (e instanceof GateError) throw new RunError('bad_config', e.message, e.hint);
    throw e;
  }
  try {
    return realpathSync.native(resolve(cwd, config.workDir));
  } catch {
    throw new RunError('bad_path', 'The work folder does not exist yet.', 'Copy the project into work/ first.');
  }
}

function parse(argv, spec, usage) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const kind = spec[argv[i]];
    if (!kind) throw new RunError('usage', `Unknown argument: ${argv[i]}`, usage);
    if (kind === 'bool') { flags[argv[i].slice(2)] = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new RunError('usage', `${argv[i - 1]} needs a value.`, usage);
    flags[argv[i - 1].slice(2)] = value;
  }
  return flags;
}

function wrap(fn) {
  return async (argv, ctx = {}) => {
    const out = ctx.stdout ?? process.stdout;
    const emit = (value) => out.write(`${JSON.stringify(value)}\n`);
    try {
      const result = await fn(argv, ctx);
      emit(result);
      return result.ok ? 0 : 1;
    } catch (e) {
      if (!(e instanceof RunError) && !(e instanceof PathError)) {
        emit({ ok: false, code: 'internal', error: e.message });
        return 1;
      }
      emit({ ok: false, code: e.code, error: e.message, hint: e.hint });
      return e.code === 'usage' ? 2 : 1;
    }
  };
}

function writeAtomically(path, text) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { flag: 'w' });
  renameSync(temp, path);
}

// ---------- ae-dump ----------

const DUMP_USAGE = 'Usage: ae-dump --project <work/...aep> --out <work/...json> [--no-keyframes] [--no-expressions] [--max-keyframes <n>]';

export const dump = wrap(async (argv, ctx) => {
  const flags = parse(argv, { '--project': 'string', '--out': 'string', '--no-keyframes': 'bool', '--no-expressions': 'bool', '--max-keyframes': 'string' }, DUMP_USAGE);
  if (!flags.project || !flags.out) throw new RunError('usage', '--project and --out are required.', DUMP_USAGE);
  const params = {};
  if (flags['no-keyframes']) params.keyframes = false;
  if (flags['no-expressions']) params.expressions = false;
  if (flags['max-keyframes'] !== undefined) {
    const n = Number(flags['max-keyframes']);
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new RunError('usage', '--max-keyframes must be a whole number from 1 to 10000.', DUMP_USAGE);
    params.maxKeyframes = n;
  }
  const cwd = ctx.cwd ?? process.cwd();
  const home = ctx.home ?? homedir();
  const target = safeOutputPath({ outArg: flags.out, cwd, workReal: workReal(cwd, home), extension: '.json' });
  const result = await runAe({
    ...ctx, ping: false, project: flags.project, script: join(ctx.pluginRoot ?? PLUGIN_ROOT, 'lib', 'jsx', 'dump.jsx'), undo: 'ae-dump', params, timeout: 300, cwd, home,
  });
  if (!result.ok) return { ok: false, code: 'script_error', error: result.error };
  const problems = validateDump(result.result);
  if (problems.length) return { ok: false, code: 'bad_dump', error: `After Effects returned a dump that does not match the schema: ${problems.slice(0, 5).join('; ')}` };
  writeAtomically(target, `${JSON.stringify(result.result, null, 2)}\n`);
  return {
    ok: true, out: target, comps: result.result.comps.length,
    layers: result.result.comps.reduce((sum, c) => sum + c.layers.length, 0), durationMs: result.durationMs,
  };
});

// ---------- ae-render-frame ----------

const FRAME_USAGE = 'Usage: ae-render-frame --project <work/...aep> --comp <name> --time <seconds> --out <work/...png>';

export const renderFrame = wrap(async (argv, ctx) => {
  const flags = parse(argv, { '--project': 'string', '--comp': 'string', '--time': 'string', '--out': 'string' }, FRAME_USAGE);
  for (const name of ['project', 'comp', 'time', 'out']) if (flags[name] === undefined || flags[name] === '') throw new RunError('usage', `--${name} is required.`, FRAME_USAGE);
  const time = Number(flags.time);
  if (!Number.isFinite(time) || time < 0 || time > 86400) throw new RunError('usage', '--time must be a number of seconds from 0 to 86400.', FRAME_USAGE);
  if (flags.comp.length > 200 || /[\u0000-\u001f]/.test(flags.comp)) throw new RunError('usage', '--comp must be a comp name (up to 200 characters, no control characters).', FRAME_USAGE);
  const cwd = ctx.cwd ?? process.cwd();
  const home = ctx.home ?? homedir();
  const target = safeOutputPath({ outArg: flags.out, cwd, workReal: workReal(cwd, home), extension: '.png' });
  // An older PNG with the same name must not be mistaken for the new frame; target is inside work/ (checked above).
  rmSync(target, { force: true });
  const result = await runAe({
    ...ctx, ping: false, project: flags.project, script: join(ctx.pluginRoot ?? PLUGIN_ROOT, 'lib', 'jsx', 'render-frame.jsx'), undo: 'ae-render-frame',
    params: { comp: flags.comp, time, out: target }, timeout: 300, cwd, home,
  });
  if (!result.ok) return { ok: false, code: 'script_error', error: result.error };
  // saveFrameToPng returns before the file is written: wait for it to appear and stop growing.
  const size = await waitForFileSettled(target, { timeoutMs: ctx.frameWaitMs ?? 20000, stableMs: ctx.frameStableMs ?? 300 });
  if (size === null) {
    return { ok: false, code: 'no_frame', error: 'After Effects reported success but the PNG file did not appear (or stayed empty).', hint: 'Check that After Effects can write files (Preferences > Scripting & Expressions) and that the comp can render.' };
  }
  return { ok: true, out: target, comp: flags.comp, time, width: result.result.width, height: result.result.height, durationMs: result.durationMs };
});
