// Studio rules live in plain folders: <studios dir>/<studio>/rules/... No plugin, no marketplace.
// The studios dir is ~/Documents/studios unless ~/.motion-flow/studios.json says {"dir": "<path>"}.
// A project remembers its studio by name in .motion/studio.json; the path is looked up here at run time.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const STUDIO_NAME = /^[A-Za-z0-9][\w.-]*$/;

export function studiosDir(home = homedir()) {
  try {
    const dir = JSON.parse(readFileSync(join(home, '.motion-flow', 'studios.json'), 'utf8')).dir;
    if (typeof dir === 'string' && dir.trim()) return resolve(dir.replace(/^~(?=$|[\\/])/, home));
  } catch { /* no config: use the default */ }
  return join(home, 'Documents', 'studios');
}

const isDir = (path) => {
  try { return statSync(path).isDirectory(); } catch { return false; }
};

/** The studios in the folder: every subfolder that holds a rules/ folder, sorted by name. */
export function listStudios(dir) {
  if (!isDir(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && STUDIO_NAME.test(entry.name) && isDir(join(dir, entry.name, 'rules')))
    .map((entry) => ({ name: entry.name, path: join(dir, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The studio chosen for a project (.motion/studio.json), or null. */
export function projectStudioName(project) {
  try {
    const name = JSON.parse(readFileSync(join(project, '.motion', 'studio.json'), 'utf8')).name;
    return typeof name === 'string' && STUDIO_NAME.test(name) ? name : null;
  } catch { return null; }
}

/** Where the project's studio rules are. { ok: true, name, path, rules, changelog } or { ok: false, reason, detail }. */
export function resolveStudio(project, home = homedir()) {
  const name = projectStudioName(project);
  const dir = studiosDir(home);
  if (!name) return { ok: false, reason: 'no_studio', detail: 'This project uses no studio rules.', studios_dir: dir };
  const path = join(dir, name);
  if (!isDir(join(path, 'rules'))) return { ok: false, reason: 'studio_missing', detail: `Studio "${name}" has no rules/ folder in ${dir}. Put the studio's folder there, or choose another studio.`, name, studios_dir: dir };
  const changelog = join(path, 'CHANGELOG.md');
  return { ok: true, name, path, rules: join(path, 'rules'), changelog: existsSync(changelog) ? changelog : null };
}
