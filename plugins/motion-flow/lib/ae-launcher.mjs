// The only module that actually starts After Effects. Everything else (ae-run, tests) goes through `launch`,
// so tests can replace it with a fake. Needs no network and never uses a shell.
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const MAC_APP_NAME = /^Adobe After Effects( (\d{4}|\(Beta\)))?$/;
const SAFE_APP_NAME = /^[A-Za-z0-9 ._()-]+$/;

export class LauncherError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

const yearOf = (name) => {
  const m = /(\d{4})/.exec(name);
  return m ? Number(m[1]) : name.includes('Beta') ? 9999 : 0;
};

/** The user's own choice in ~/.motion-flow/ae.json: { "app": "Adobe After Effects 2025" } (macOS) or { "path": "C:\\...\\AfterFX.exe" } (Windows). */
function readChoice(home) {
  const file = join(home, '.motion-flow', 'ae.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) ?? {};
  } catch {
    throw new LauncherError('bad_ae_config', `${file} is not valid JSON.`, 'Fix or delete the file.');
  }
}

/** Finds the After Effects to use. Returns { os, app } on macOS or { os, exe } on Windows. */
export function findAe({ os = platform(), home = homedir(), env = process.env, list = readdirSync, exists = existsSync } = {}) {
  const choice = readChoice(home);
  if (os === 'darwin') {
    let app = choice.app;
    if (app === undefined) {
      const found = (() => { try { return list('/Applications'); } catch { return []; } })()
        .filter((name) => MAC_APP_NAME.test(name)).sort((a, b) => yearOf(b) - yearOf(a));
      app = found[0];
    }
    if (!app) throw new LauncherError('ae_not_found', 'After Effects was not found in /Applications.', 'Install it, or name it in ~/.motion-flow/ae.json: {"app": "Adobe After Effects 2025"}.');
    if (!SAFE_APP_NAME.test(app)) throw new LauncherError('bad_ae_config', `Unsafe application name in ae.json: ${app}`);
    return { os, app };
  }
  if (os === 'win32') {
    let exe = choice.path;
    if (exe === undefined) {
      const root = join(env.ProgramFiles ?? 'C:\\Program Files', 'Adobe');
      const found = (() => { try { return list(root); } catch { return []; } })()
        .filter((name) => /^Adobe After Effects/.test(name)).sort((a, b) => yearOf(b) - yearOf(a));
      exe = found.length ? join(root, found[0], 'Support Files', 'AfterFX.exe') : undefined;
    }
    if (!exe || !exists(exe)) throw new LauncherError('ae_not_found', 'AfterFX.exe was not found.', 'Install After Effects, or name the file in ~/.motion-flow/ae.json: {"path": "C:\\\\Program Files\\\\Adobe\\\\...\\\\AfterFX.exe"}.');
    return { os, exe };
  }
  throw new LauncherError('unsupported_os', `Running After Effects is supported on macOS and Windows only (this is ${os}).`);
}

const BAD_PATH_CHARS = /[\u0000-\u001f\u2028\u2029]/;
const MAC_EVENT_TIMEOUT_S = 7200; // AppleScript gives up after 2 minutes by default; DoScript blocks until the script ends

/** JavaScript single-quoted string literal for a path. */
export function jsString(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** AppleScript double-quoted string literal. */
export function appleScriptString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The exact command to run, as { file, args } (no shell).
 * macOS: AppleScript DoScript with a one-line bootstrap that evalFiles the wrapper. DoScriptFile is avoided: it is
 * reported to hang on After Effects 2024+ (Adobe community bug report); DoScript + evalFile is what a tool tested
 * against After Effects 26.5 uses.
 * Windows: AfterFX.exe -r <script>.
 */
export function buildLaunch(ae, scriptPath) {
  if (BAD_PATH_CHARS.test(scriptPath)) throw new LauncherError('bad_path', 'The script path contains a control character that cannot be passed to After Effects.');
  if (ae.os === 'darwin') {
    const bootstrap = `$.evalFile(${jsString(scriptPath)});`;
    return {
      file: 'osascript',
      args: [
        '-e', `with timeout of ${MAC_EVENT_TIMEOUT_S} seconds`,
        '-e', `tell application ${appleScriptString(ae.app)} to DoScript ${appleScriptString(bootstrap)}`,
        '-e', 'end timeout',
      ],
    };
  }
  return { file: ae.exe, args: ['-r', scriptPath] };
}

/**
 * Starts the script in After Effects. Returns { exited, stop }: `exited` resolves with { code, stderr } when the
 * launching process ends (macOS: when AE finished the script) or is null when it cannot be tracked (Windows);
 * `stop()` ends a launching process that is still waiting (used after a timeout). It never closes After Effects.
 */
export function launch(scriptPath, options = {}) {
  const ae = findAe(options);
  const { file, args } = buildLaunch(ae, scriptPath);
  if (ae.os === 'win32') {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return { exited: null, stop: null, ae };
  }
  let child;
  const exited = new Promise((resolve) => {
    child = execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stderr: `${stderr}${error && typeof error.code !== 'number' ? error.message : ''}`.trim() }));
  });
  return { exited, stop: () => child?.kill(), ae };
}
