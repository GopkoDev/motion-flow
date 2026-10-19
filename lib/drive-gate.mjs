// drive-gate: read-only gateway to the local Google Drive folders.
// Commands: ls, info, fetch, log. There is no write/delete/move/rename command on the Drive side.
// Writes happen only inside the project's work directory. Every call is appended to a log.
import {
  closeSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_TIMEOUT_S = 120;

export class GateError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

// The config directory is fixed to ~/.motion-flow. It is deliberately not overridable through an
// environment variable: otherwise the agent could point drive-gate at a roots.json it wrote itself.
// Tests pass `home` explicitly.
export function homeDir(home) {
  return home ?? join(homedir(), '.motion-flow');
}

export function loadConfig(home) {
  const file = join(homeDir(home), 'roots.json');
  if (!existsSync(file)) {
    throw new GateError('no_config', `Config not found: ${file}`, 'Create it from templates/roots.example.json.');
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new GateError('bad_config', `Config is not valid JSON: ${error.message}`, `Fix ${file}.`);
  }
  if (!cfg || typeof cfg.roots !== 'object' || cfg.roots === null || Array.isArray(cfg.roots)) {
    throw new GateError('bad_config', 'Config needs a "roots" object (alias -> folder).', `Fix ${file}.`);
  }
  const workDir = cfg.work_dir ?? 'work';
  if (typeof workDir !== 'string' || !workDir || isAbsolute(workDir) || splitSegments(workDir).includes('..')) {
    throw new GateError('bad_config', '"work_dir" must be a relative path without "..".', `Fix ${file}.`);
  }
  return { roots: cfg.roots, workDir };
}

/** Splits on both separators so a Windows-style path cannot sneak a ".." past a posix check. */
function splitSegments(path) {
  return path.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.');
}

function isInside(base, target) {
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
}

/** Validates a user-supplied relative path and returns its safe segments. */
function relSegments(rel) {
  if (typeof rel !== 'string') throw new GateError('bad_path', 'Path must be a string.');
  if (rel.includes('\0')) throw new GateError('bad_path', 'Path contains a NUL byte.');
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || /^[\\/]/.test(rel)) {
    throw new GateError('bad_path', 'Absolute paths are not allowed.', 'Use a path relative to the alias root.');
  }
  const segs = splitSegments(rel);
  // Windows trims trailing dots and spaces, so "..  " or "..." can act like "..". Refuse such names.
  if (segs.some((segment) => segment === '..' || /^[.\s]+$/.test(segment))) {
    throw new GateError('bad_path', 'Path escapes the alias root (".." is not allowed).', 'Use a path inside the alias.');
  }
  return segs;
}

function rootReal(config, alias) {
  if (typeof alias !== 'string' || !Object.hasOwn(config.roots, alias)) {
    throw new GateError('unknown_alias', `Unknown alias: ${alias}`, `Known aliases: ${Object.keys(config.roots).join(', ') || '(none)'}.`);
  }
  let real;
  try {
    real = realpathSync.native(config.roots[alias]);
  } catch {
    throw new GateError('root_missing', `Root folder for "${alias}" is not available.`, 'Is Google Drive for Desktop running and the folder present?');
  }
  if (dirname(real) === real) {
    throw new GateError('bad_config', `Root "${alias}" is a filesystem root.`, 'Point the alias at a specific Drive folder.');
  }
  return real;
}

/** Resolves rel under the alias root; the real path must stay inside the real root. */
export function resolveInside(config, alias, rel = '') {
  const root = rootReal(config, alias);
  const candidate = join(root, ...relSegments(rel));
  let real;
  try {
    real = realpathSync.native(candidate);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new GateError('not_found', `Not found: ${alias}/${rel}`);
    if (error.code === 'EACCES' || error.code === 'EPERM') throw new GateError('no_access', `No permission: ${alias}/${rel}`);
    throw error;
  }
  if (!isInside(root, real)) {
    throw new GateError('outside_root', `Path resolves outside the alias root: ${alias}/${rel}`, 'Symlinks leaving the root are not followed.');
  }
  return { root, real };
}

const iso = (date) => date.toISOString();

function isLocal(stats) {
  if (!stats.isFile()) return null;
  if (stats.size === 0) return false;
  if (typeof stats.blocks === 'number' && stats.blocks === 0) return false; // dataless stream placeholder
  return true;
}

function sha256File(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', rejectPromise).on('end', () => resolvePromise(hash.digest('hex')));
  });
}

function cmdLs(config, [alias, sub = '']) {
  const { root, real } = resolveInside(config, alias, sub);
  if (!statSync(real).isDirectory()) throw new GateError('not_dir', `Not a directory: ${alias}/${sub}`);
  const entries = readdirSync(real).sort().map((name) => {
    const entryPath = join(real, name);
    const entryStats = lstatSync(entryPath);
    const entryType = entryStats.isSymbolicLink() ? 'symlink' : entryStats.isDirectory() ? 'dir' : 'file';
    const entry = { name, type: entryType, mtime: iso(entryStats.mtime) };
    if (entryType === 'file') entry.size = entryStats.size;
    return entry;
  });
  return { ok: true, alias, path: relative(root, real).split(sep).join('/'), entries };
}

async function cmdInfo(config, [alias, rel], flags) {
  if (rel === undefined) throw new GateError('usage', 'info needs <alias> <relpath>.');
  const { real } = resolveInside(config, alias, rel);
  const stats = statSync(real);
  const out = { ok: true, alias, path: rel, type: stats.isDirectory() ? 'dir' : 'file', size: stats.size, mtime: iso(stats.mtime), local: isLocal(stats) };
  if (flags.checksum) {
    if (!stats.isFile()) throw new GateError('not_file', 'Checksum needs a file.');
    out.sha256 = await sha256File(real);
  }
  return out;
}

/** Creates dir (inside workReal) segment by segment, refusing symlinks, so nothing is created outside work/. */
function ensureDirInside(workReal, dir) {
  const rel = relative(workReal, dir);
  if (splitSegments(rel).some((segment) => segment !== '..' && /^[.\s]+$/.test(segment))) {
    throw new GateError('outside_work', 'Destination contains a dots-only path segment.', 'Write only under work/.');
  }
  if (rel.startsWith('..') || isAbsolute(rel)) throw new GateError('outside_work', 'Destination is outside the work directory.', 'Write only under work/.');
  let cur = workReal;
  for (const seg of splitSegments(rel)) {
    cur = join(cur, seg);
    let stats = null;
    try { stats = lstatSync(cur); } catch { /* missing */ }
    if (!stats) mkdirSync(cur);
    else if (stats.isSymbolicLink()) throw new GateError('outside_work', `Symlink in destination path: ${cur}`, 'Remove the symlink from work/.');
    else if (!stats.isDirectory()) throw new GateError('bad_dest', `Not a directory: ${cur}`);
  }
}

function workRoot(config, cwd) {
  const work = resolve(cwd, config.workDir);
  mkdirSync(work, { recursive: true });
  const real = realpathSync.native(work);
  for (const alias of Object.keys(config.roots)) {
    let rootPath;
    try { rootPath = realpathSync.native(config.roots[alias]); } catch { continue; }
    if (isInside(rootPath, real)) {
      throw new GateError('work_in_drive', 'The work directory is inside a Drive root.', 'Keep the project (and work/) outside Google Drive.');
    }
  }
  return real;
}

async function waitLocal(real, timeoutS, pollMs) {
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    const stats = statSync(real);
    if (isLocal(stats)) return stats;
    if (Date.now() >= deadline) {
      throw new GateError('not_downloaded', 'The file is not downloaded from Google Drive (empty or placeholder).',
        'Open the file once in Finder/Explorer or set the folder to "Available offline", then retry.');
    }
    await sleep(pollMs);
  }
}

/** Copies one Drive file into destDir/<rel>, verifying size and sha256. Never touches the source. */
async function copyOne(config, alias, rel, workReal, toDir, opts) {
  const { real } = resolveInside(config, alias, rel);
  if (!statSync(real).isFile()) throw new GateError('not_file', `Not a file: ${alias}/${rel}`);
  const before = await waitLocal(real, opts.timeoutS, opts.pollMs);
  const dest = join(toDir, ...relSegments(rel));
  ensureDirInside(workReal, dirname(dest));
  if (lstatSync(dest, { throwIfNoEntry: false }) && !opts.overwrite) {
    throw new GateError('dest_exists', `Destination exists: ${relative(workReal, dest)}`, 'Pass --overwrite to replace the copy in work/.');
  }
  const part = `${dest}.part`;
  const hash = createHash('sha256');
  let partCreated = false;
  try {
    const source = createReadStream(real);
    source.on('data', (chunk) => hash.update(chunk));
    const sink = createWriteStream(part, { flags: 'wx', mode: 0o644 }); // 'wx': never touch an existing file
    sink.once('open', () => { partCreated = true; });
    await pipeline(source, sink);
    const after = statSync(real);
    const copied = statSync(part);
    if (copied.size !== before.size || after.size !== before.size) {
      throw new GateError('size_mismatch', `Size mismatch after copy (${copied.size} vs ${before.size}).`, 'The file may still be syncing; retry.');
    }
    const checksum = hash.digest('hex');
    if ((await sha256File(part)) !== checksum) throw new GateError('checksum_mismatch', 'Checksum mismatch after copy.', 'Retry the fetch.');
    renameSync(part, dest);
    return { path: rel, to: relative(workReal, dest).split(sep).join('/'), size: copied.size, sha256: checksum };
  } catch (error) {
    if (partCreated) rmSync(part, { force: true });
    if (error.code === 'EEXIST') throw new GateError('dest_busy', `Temporary file already exists: ${relative(workReal, part)}`, 'Remove the stale .part file from work/ and retry.');
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new GateError('no_access', `No permission to read: ${alias}/${rel}`, 'Ask for access to the file or pick another one.');
    }
    throw error;
  }
}

function depsFromDump(file, root) {
  let dump;
  try {
    dump = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new GateError('bad_deps', `Cannot read dump ${file}: ${error.message}`);
  }
  const footage = Array.isArray(dump.footage) ? dump.footage : [];
  const depRels = [];
  const skipped = [];
  for (const item of footage) {
    if (!item || typeof item.path !== 'string' || item.missing) { skipped.push({ path: item?.path ?? null, reason: 'missing_or_invalid' }); continue; }
    let absolute = resolve(item.path);
    try { absolute = realpathSync.native(absolute); } catch { /* not on this machine: compare as written */ }
    if (isInside(root, absolute) && absolute !== root) depRels.push(relative(root, absolute).split(sep).join('/'));
    else skipped.push({ path: item.path, reason: 'outside_alias_root' });
  }
  return { rels: [...new Set(depRels)], skipped };
}

async function cmdFetch(config, [alias, rel], flags, ctx) {
  if (rel === undefined || !flags.to) throw new GateError('usage', 'fetch needs <alias> <relpath> --to <dir>.');
  if (flags['with-deps'] && !flags['deps-from']) throw new GateError('usage', '--with-deps needs --deps-from <dump.json>.', 'Run ae-dump on the project first.');
  const workReal = workRoot(config, ctx.cwd);
  const toDir = resolve(realpathSync.native(ctx.cwd), flags.to); // same base as workReal, so symlinked cwd paths compare correctly
  ensureDirInside(workReal, toDir);
  const opts = { timeoutS: flags.timeout ?? DEFAULT_TIMEOUT_S, pollMs: ctx.pollMs, overwrite: !!flags.overwrite };
  const mainFile = await copyOne(config, alias, rel, workReal, toDir, opts);
  const out = { ok: true, alias, file: mainFile };
  if (flags['with-deps']) {
    const { rels, skipped } = depsFromDump(resolve(ctx.cwd, flags['deps-from']), rootReal(config, alias));
    out.deps = [];
    out.deps_failed = [];
    out.deps_skipped = skipped;
    for (const depRel of rels) {
      try {
        out.deps.push(await copyOne(config, alias, depRel, workReal, toDir, opts));
      } catch (error) {
        if (!(error instanceof GateError)) throw error;
        out.deps_failed.push({ path: depRel, code: error.code, error: error.message });
      }
    }
    if (out.deps_failed.length) {
      out.ok = false;
      out.error = `${out.deps_failed.length} dependency file(s) could not be fetched.`;
      out.hint = 'The main file was copied; see deps_failed.';
    }
  }
  return out;
}

function cmdLog(config, args, flags, ctx) {
  const tailCount = flags.tail ?? 20;
  const file = join(homeDir(ctx.home), 'drive-gate.log');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  const entries = lines.slice(-tailCount).map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
  return { ok: true, entries };
}

const FLAGS = {
  to: 'string', timeout: 'number', tail: 'number', checksum: 'bool',
  'with-deps': 'bool', 'deps-from': 'string', overwrite: 'bool',
};

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    const kind = Object.hasOwn(FLAGS, key) ? FLAGS[key] : null;
    if (!kind) throw new GateError('usage', `Unknown option: ${arg}`);
    if (kind === 'bool') { flags[key] = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new GateError('usage', `Option ${arg} needs a value.`);
    if (kind === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) throw new GateError('usage', `Option ${arg} needs a non-negative number.`);
      flags[key] = number;
    } else flags[key] = value;
  }
  return { cmd: positional[0], args: positional.slice(1), flags };
}

const USAGE = 'Usage: drive-gate ls <alias> [subpath] | info <alias> <relpath> [--checksum] | fetch <alias> <relpath> --to <dir> [--with-deps --deps-from <dump.json>] [--timeout S] [--overwrite] | log [--tail N]';

/** Runs the CLI. Returns the process exit code; writes one JSON document to stdout. */
export async function main(argv, ctx = {}) {
  const out = ctx.stdout ?? process.stdout;
  const full = { home: ctx.home, cwd: ctx.cwd ?? process.cwd(), pollMs: ctx.pollMs ?? 1000 };
  const emit = (obj) => out.write(`${JSON.stringify(obj)}\n`);
  let logFd = null;
  let cmd = argv[0];
  let alias = null;
  let path = null;
  let result;
  try {
    // Open the log first: if it cannot be written, nothing runs (fail closed).
    try {
      const dir = homeDir(ctx.home);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      logFd = openSync(join(dir, 'drive-gate.log'), 'a', 0o600);
    } catch (error) {
      throw new GateError('log_unavailable', `Cannot open the audit log: ${error.message}`, 'drive-gate refuses to run without its log.');
    }
    const parsed = parseArgs(argv);
    ({ cmd } = parsed);
    [alias = null, path = null] = parsed.args;
    if (!['ls', 'info', 'fetch', 'log'].includes(cmd)) throw new GateError('usage', `Unknown command: ${cmd ?? '(none)'}`, USAGE);
    const config = cmd === 'log' ? null : loadConfig(ctx.home);
    if (cmd === 'ls') result = cmdLs(config, parsed.args);
    else if (cmd === 'info') result = await cmdInfo(config, parsed.args, parsed.flags);
    else if (cmd === 'fetch') result = await cmdFetch(config, parsed.args, parsed.flags, full);
    else result = cmdLog(config, parsed.args, parsed.flags, full);
  } catch (error) {
    if (!(error instanceof GateError)) {
      result = { ok: false, code: 'internal', error: error.message, hint: '' };
    } else {
      result = { ok: false, code: error.code, error: error.message, hint: error.hint };
    }
  }
  if (logFd !== null) {
    try {
      const entry = { ts: new Date().toISOString(), cmd, alias, path, ok: result.ok, ...(result.ok ? {} : { code: result.code, error: result.error }) };
      writeSync(logFd, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      result = { ok: false, code: 'log_unavailable', error: `Cannot write the audit log: ${error.message}`, hint: '' };
    } finally {
      closeSync(logFd);
    }
  }
  emit(result);
  if (result.ok) return 0;
  return result.code === 'usage' ? 2 : 1;
}
