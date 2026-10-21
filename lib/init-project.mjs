// init-project: prepares a project folder from the plugin templates. Touches only the project folder.
// Never overwrites an existing file; .gitignore only gets missing lines appended.
// The one exception is .motion/drive.json, which is rewritten when the Drive choice is given explicitly
// (--drive / --no-drive): it says which of the computer's Drive folders this project may use.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadProjectDrive, GateError } from './drive-gate.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN_ID = /^[A-Za-z0-9][\w.-]*@[A-Za-z0-9][\w.-]*$/;
const STATE = { last_seen_rules_version: '', commit_artifacts: false };

/** Permission-rule path for a folder: "//abs/path/**" (Windows drive letters become "//c/path/**"). */
export function ruleGlob(folder) {
  const posix = resolve(folder).split(sep).join('/').replace(/^([A-Za-z]):/, (_, letter) => `/${letter.toLowerCase()}`);
  return `/${posix}/**`.replace(/\/\*\*$/, '/**');
}

/** Fills the template's REPLACE placeholders with one Read and one Edit deny rule per Drive folder. */
export function buildSettings(template, folders) {
  const settings = JSON.parse(JSON.stringify(template));
  const isPlaceholder = (rule) => /REPLACE/.test(rule);
  const deny = [];
  for (const rule of settings.permissions.deny) {
    if (!isPlaceholder(rule)) { deny.push(rule); continue; }
    const tool = rule.slice(0, rule.indexOf('('));
    for (const folder of folders) deny.push(`${tool}(${ruleGlob(folder)})`);
  }
  settings.permissions.deny = [...new Set(deny)];
  return settings;
}

/** Adds the template's allow rules and defaultMode to existing settings; the user's own rules and mode are kept. */
export function addPermissions(settings, template) {
  settings.permissions = settings.permissions ?? {};
  const allow = settings.permissions.allow ?? [];
  settings.permissions.allow = [...allow, ...template.allow.filter((rule) => !allow.includes(rule))];
  if (settings.permissions.defaultMode === undefined) settings.permissions.defaultMode = template.defaultMode;
  return settings;
}

function driveFolders(config) {
  const folders = new Set();
  for (const path of Object.values(config.roots)) {
    folders.add(resolve(path));
    try { folders.add(realpathSync.native(path)); } catch { /* folder not mounted right now */ }
  }
  return [...folders];
}

function isInside(base, target) {
  const normalize = (p) => (process.platform === 'linux' ? p : p.toLowerCase());
  const b = normalize(base);
  const t = normalize(target);
  return t === b || t.startsWith(b.endsWith(sep) ? b : b + sep);
}

/**
 * Decides what to do. `drive` is the Drive choice: undefined (leave as is), or an array of aliases ([] = no Drive).
 * `rules` is the studio rules plugin to enable in this project: undefined or null (leave as is) or an id like "acme-rules@acme-rules".
 * `permissions` true adds the template's allow rules and defaultMode to an existing settings.json (projects made before v0.1.1).
 * Returns { project, actions, aliases }; each action is { path, kind: create|update|append|skip, content?, reason? }.
 */
export function planInit({ projectDir, home = homedir(), pluginRoot = PLUGIN_ROOT, drive, rules, permissions = false }) {
  const project = resolve(projectDir);
  let config;
  try {
    config = loadConfig(join(home, '.motion-flow'));
  } catch (e) {
    if (e instanceof GateError) throw new Error(`${e.message} ${e.hint}`.trim());
    throw e;
  }
  const catalog = Object.keys(config.roots);
  if (drive?.length) {
    if (!catalog.length) throw new Error('No Google Drive folders are set up on this computer yet. Run /motion-flow:setup first.');
    const unknown = drive.filter((alias) => !catalog.includes(alias));
    if (unknown.length) throw new Error(`Unknown Drive folder(s): ${unknown.join(', ')}. Available: ${catalog.join(', ')}.`);
  }
  if (typeof rules === 'string' && !PLUGIN_ID.test(rules)) throw new Error(`"${rules}" is not a plugin id. Use <plugin>@<marketplace>, for example acme-rules@acme-rules.`);
  const folders = driveFolders(config);
  let projectReal = project;
  try { projectReal = realpathSync.native(project); } catch { /* new folder */ }
  if (folders.some((folder) => isInside(folder, projectReal))) {
    throw new Error('The project folder is inside a Google Drive folder. Create the project outside Drive; work/ must not live on Drive.');
  }
  const templates = join(pluginRoot, 'templates');
  const read = (name) => readFileSync(join(templates, name), 'utf8');
  const built = buildSettings(JSON.parse(read('settings.project.json')), folders);
  if (typeof rules === 'string') built.enabledPlugins = { ...built.enabledPlugins, [rules]: true };
  const settings = `${JSON.stringify(built, null, 2)}\n`;
  const file = (relative, content) => {
    const path = join(project, relative);
    return existsSync(path) ? { path, kind: 'skip', reason: 'already exists, left unchanged' } : { path, kind: 'create', content };
  };
  // An existing settings.json is never rewritten, except to add the studio rules plugin when that was asked for.
  const settingsPath = join(project, '.claude', 'settings.json');
  let settingsAction = file(join('.claude', 'settings.json'), settings);
  if (existsSync(settingsPath) && (typeof rules === 'string' || permissions)) {
    let current;
    try {
      current = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      throw new Error(`${settingsPath} is not valid JSON (${e.message}); fix it before adding the studio rules.`);
    }
    const before = JSON.stringify(current);
    if (typeof rules === 'string') current.enabledPlugins = { ...(current.enabledPlugins ?? {}), [rules]: true };
    if (permissions) addPermissions(current, built.permissions);
    if (JSON.stringify(current) === before) settingsAction = { path: settingsPath, kind: 'skip', reason: typeof rules === 'string' && !permissions ? 'studio rules already enabled' : 'already up to date' };
    else settingsAction = { path: settingsPath, kind: 'update', content: `${JSON.stringify(current, null, 2)}\n` };
  }
  const driveFile = join(project, '.motion', 'drive.json');
  const wantedDrive = `${JSON.stringify({ aliases: drive ?? [] }, null, 2)}\n`;
  let driveAction;
  if (!existsSync(driveFile)) driveAction = { path: driveFile, kind: 'create', content: wantedDrive };
  else if (drive === undefined) driveAction = { path: driveFile, kind: 'skip', reason: 'already exists, left unchanged' };
  else if (readFileSync(driveFile, 'utf8') === wantedDrive) driveAction = { path: driveFile, kind: 'skip', reason: 'already set to this choice' };
  else driveAction = { path: driveFile, kind: 'update', content: wantedDrive };
  const actions = [
    settingsAction,
    file('CLAUDE.md', read('CLAUDE.project.md')),
    file(join('.motion', 'state.json'), `${JSON.stringify(STATE, null, 2)}\n`),
    driveAction,
  ];
  const ignorePath = join(project, '.gitignore');
  const wanted = read('gitignore.project').split('\n').filter(Boolean);
  const have = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8').split('\n').map((l) => l.trim()) : null;
  const missing = have ? wanted.filter((line) => !have.includes(line)) : wanted;
  if (have === null) actions.push({ path: ignorePath, kind: 'create', content: `${wanted.join('\n')}\n` });
  else if (missing.length) actions.push({ path: ignorePath, kind: 'append', content: `${missing.join('\n')}\n`, existing: readFileSync(ignorePath, 'utf8') });
  else actions.push({ path: ignorePath, kind: 'skip', reason: 'already has the needed lines' });
  actions.push({ path: join(project, 'work'), kind: existsSync(join(project, 'work')) ? 'skip' : 'create', dir: true, reason: 'already exists, left unchanged' });
  const aliases = driveAction.kind === 'skip' && drive === undefined ? loadProjectDriveSafe(project) : (drive ?? []);
  return { project, actions, aliases, catalog, rules: typeof rules === 'string' ? rules : null };
}

function loadProjectDriveSafe(project) {
  try { return loadProjectDrive(project).aliases; } catch { return []; }
}

/** Writes the planned actions. Returns the same actions (for reporting). */
export function applyPlan({ actions }) {
  for (const action of actions) {
    if (action.kind === 'skip') continue;
    if (action.dir) { mkdirSync(action.path, { recursive: true }); continue; }
    mkdirSync(dirname(action.path), { recursive: true });
    if (action.kind === 'update') {
      writeFileSync(action.path, action.content);
      continue;
    }
    if (action.kind === 'append') {
      const separator = action.existing.endsWith('\n') || action.existing === '' ? '' : '\n';
      writeFileSync(action.path, `${action.existing}${separator}${action.content}`);
    } else {
      writeFileSync(action.path, action.content, { flag: 'wx' }); // 'wx': never overwrite
    }
  }
  return actions;
}

export function formatPlan({ project, actions, aliases, catalog, rules }, applied) {
  const verb = { create: applied ? 'created' : 'will create', update: applied ? 'updated' : 'will update', append: applied ? 'appended to' : 'will append to', skip: 'skipped' };
  const lines = [`Project: ${project}`, ''];
  for (const action of actions) {
    const rel = action.path.slice(project.length + 1) || '.';
    lines.push(`  ${verb[action.kind].padEnd(14)} ${rel}${action.dir ? '/' : ''}${action.reason && action.kind === 'skip' ? `  (${action.reason})` : ''}`);
  }
  lines.push('');
  if (rules) lines.push(`Studio rules plugin enabled for this project: ${rules}. Install it once on this computer if it is not installed yet: claude plugin install ${rules} --scope project`);
  if (aliases.length) {
    lines.push(`Drive folders this project may read (through drive-gate): ${aliases.join(', ')}`);
  } else {
    lines.push('Drive is not used in this project. Copy the files you need (.aep, footage, fonts) into the work/ folder yourself; the agent works only there.');
    if (catalog.length) lines.push(`(Drive folders available on this computer: ${catalog.join(', ')}. Enable them with: mf-init --drive <name>[,<name>])`);
  }
  return lines.join('\n');
}
