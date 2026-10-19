// setup-drive: finds the local Google Drive folders and writes ~/.motion-flow/roots.json, the list of
// Drive folders available on this computer. Which of them a project may use is chosen per project (init-project).
// Writing the allowlist is a decision for a person; the guard hook makes Claude Code ask for confirmation
// before `mf-setup` is run with anything but --detect/--show/--dry-run.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const ALIAS = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function subfolders(path, limit = 50) {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort().slice(0, limit);
  } catch {
    return [];
  }
}

/** Finds likely Google Drive for Desktop folders. Returns [{ path, kind, folders }]. */
export function detectDriveFolders({ home = homedir(), os = platform() } = {}) {
  const candidates = [];
  const add = (path, kind) => { if (isDirectory(path)) candidates.push({ path, kind, folders: subfolders(path) }); };
  if (os === 'win32') {
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      add(`${letter}:\\My Drive`, 'my-drive');
      add(`${letter}:\\Shared drives`, 'shared-drives');
    }
    add(join(home, 'Google Drive'), 'legacy');
  } else {
    const storage = join(home, 'Library', 'CloudStorage');
    if (isDirectory(storage)) {
      for (const name of readdirSync(storage).filter((n) => n.startsWith('GoogleDrive-')).sort()) {
        add(join(storage, name, 'My Drive'), 'my-drive');
        add(join(storage, name, 'Shared drives'), 'shared-drives');
      }
    }
    add(join(home, 'Google Drive'), 'legacy');
    add(join(home, 'Google Drive', 'My Drive'), 'my-drive');
  }
  return candidates;
}

function isInside(base, target) {
  const fold = (p) => (process.platform === 'linux' ? p : p.toLowerCase());
  const b = fold(base);
  const t = fold(target);
  return t === b || t.startsWith(b.endsWith(sep) ? b : b + sep);
}

/** Parses "alias=path" arguments and validates them. Returns { roots } or throws Error. */
export function buildRoots(entries, { home = homedir() } = {}) {
  if (!entries.length) throw new Error('No folders given. Use --root alias=/path/to/folder (repeat for several).');
  const roots = {};
  let homeReal = resolve(home);
  try { homeReal = realpathSync.native(home); } catch { /* keep lexical */ }
  const configDir = join(homeReal, '.motion-flow');
  for (const entry of entries) {
    const at = entry.indexOf('=');
    const alias = at === -1 ? '' : entry.slice(0, at);
    const path = at === -1 ? '' : entry.slice(at + 1);
    if (!ALIAS.test(alias)) throw new Error(`Bad alias "${alias}" in "${entry}": use letters, digits, "-" or "_".`);
    if (Object.hasOwn(roots, alias)) throw new Error(`Alias "${alias}" is used twice.`);
    if (!path || !isAbsolute(path)) throw new Error(`The path for "${alias}" must be absolute: ${path || '(empty)'}`);
    if (!isDirectory(path)) throw new Error(`"${alias}": not a folder (or Google Drive is not running): ${path}`);
    const real = realpathSync.native(path);
    if (dirname(real) === real) throw new Error(`"${alias}" is a filesystem root. Pick a specific Drive folder.`);
    if (isInside(real, homeReal)) throw new Error(`"${alias}" contains your home folder. Pick a folder inside Google Drive.`);
    if (isInside(real, configDir) || isInside(configDir, real)) throw new Error(`"${alias}" overlaps the drive-gate config folder.`);
    roots[alias] = real;
  }
  return { roots };
}

export function readCurrent(home = homedir()) {
  const file = join(home, '.motion-flow', 'roots.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { invalid: true }; }
}

/** Writes roots.json. Refuses to replace an existing file unless replace is true. */
export function writeRoots({ roots, home = homedir(), replace = false, workDir = 'work' }) {
  const dir = join(home, '.motion-flow');
  const file = join(dir, 'roots.json');
  if (existsSync(file) && !replace) throw new Error(`${file} already exists. Pass --replace to overwrite it.`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ roots, work_dir: workDir }, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* not supported on this file system */ }
  return file;
}
