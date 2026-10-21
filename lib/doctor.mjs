// doctor: read-only environment check. Never installs or changes anything.
// Shows a table (ok / missing / old version / manual) and, per missing item, the install command to run by hand.
import { execFile } from 'node:child_process';
import { findAe, LauncherError } from './ae-launcher.mjs';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadProjectDrive, GateError } from './drive-gate.mjs';
import { parseFrontmatter } from '../scripts/validate_plugin.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

const DETECTORS = ['after-effects'];

/** Validates the shape of deps.json and returns the entries. Throws Error with a readable message. */
export function parseDeps(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`deps.json is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(data)) throw new Error('deps.json must be an array of dependency objects');
  const seen = new Set();
  data.forEach((dep, i) => {
    const at = `deps.json[${i}]`;
    if (!dep || typeof dep !== 'object') throw new Error(`${at} must be an object`);
    if (typeof dep.name !== 'string' || !dep.name) throw new Error(`${at}.name is required`);
    if (seen.has(dep.name)) throw new Error(`${at}: duplicate name "${dep.name}"`);
    seen.add(dep.name);
    if (dep.check !== null && typeof dep.check !== 'string') throw new Error(`${at}.check must be a command string or null`);
    if (dep.check !== null && typeof dep.version_regex === 'string') {
      try { new RegExp(dep.version_regex); } catch (e) { throw new Error(`${at}.version_regex is not a valid regex: ${e.message}`); }
    }
    if (dep.min_version != null && !/^\d+(\.\d+)*$/.test(dep.min_version)) throw new Error(`${at}.min_version must look like 1.2.3`);
    if (dep.detect !== undefined && !DETECTORS.includes(dep.detect)) throw new Error(`${at}.detect must be one of: ${DETECTORS.join(', ')}`);
    if (!dep.install || typeof dep.install.macos !== 'string' || typeof dep.install.windows !== 'string') {
      throw new Error(`${at}.install needs "macos" and "windows" strings`);
    }
    if (!Array.isArray(dep.required_by)) throw new Error(`${at}.required_by must be an array`);
  });
  return data;
}

/** Compares dotted numeric versions: returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function extractVersion(output, versionRegex) {
  if (!versionRegex) return null;
  const match = new RegExp(versionRegex).exec(output);
  return match ? match[1] : null;
}

/** Real command runner (no shell). Resolves { ok, output }; ok=false when the command is missing or fails. */
export function runCommand(commandLine) {
  const [file, ...args] = commandLine.split(/\s+/).filter(Boolean);
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 15000, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`;
      // A tool that starts but exits non-zero while printing usage (some --help forms) still counts as installed.
      const started = !error || (typeof error.code === 'number' && output.trim() !== '');
      resolve({ ok: started, output });
    });
  });
}

export function currentOs(osName = platform()) {
  return osName === 'win32' ? 'windows' : 'macos';
}

/** Checks one dependency. Status: ok | missing | old | manual | unknown. */
export async function checkDependency(dep, run, os = currentOs(), detectors = {}) {
  const base = { name: dep.name, optional: !!dep.optional, required_by: dep.required_by, min_version: dep.min_version ?? null, install: dep.install[os], notes: dep.notes ?? '' };
  if (dep.detect) {
    const found = await detectors[dep.detect]?.();
    if (found) return { ...base, status: found.ok ? 'ok' : 'missing', version: found.version ?? null, notes: found.note ?? base.notes };
  }
  if (dep.check === null) return { ...base, status: 'manual', version: null };
  const result = await run(dep.check);
  if (!result.ok) return { ...base, status: 'missing', version: null };
  const version = extractVersion(result.output, dep.version_regex);
  if (dep.min_version && !version) return { ...base, status: 'unknown', version: null };
  if (dep.min_version && compareVersions(version, dep.min_version) < 0) return { ...base, status: 'old', version };
  return { ...base, status: 'ok', version };
}

/** Reads the `needs` list of a flow from its SKILL.md frontmatter, e.g. `needs: ffmpeg, whisper` or `needs: [ffmpeg]`. */
export function flowNeeds(flowName, searchDirs) {
  for (const dir of searchDirs) {
    const file = join(dir, flowName, 'SKILL.md');
    if (!existsSync(file)) continue;
    const front = parseFrontmatter(readFileSync(file, 'utf8')) ?? {};
    const raw = (front.needs ?? '').replace(/^\[|\]$/g, '');
    return raw.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  throw new Error(`Flow "${flowName}" not found in: ${searchDirs.join(', ')}`);
}

// ---------- configuration checks ----------

export function checkDriveGateConfig(home = homedir(), projectDir = null) {
  const problems = [];
  const notes = [];
  let roots = {};
  try {
    const config = loadConfig(join(home, '.motion-flow'));
    roots = config.roots;
    if (Object.keys(roots).length === 0) {
      notes.push('No Google Drive folders are set up on this computer. Fine if you do not use Drive; otherwise run /motion-flow:setup.');
    }
    for (const [alias, path] of Object.entries(roots)) {
      try {
        if (!statSync(realpathSync.native(path)).isDirectory()) problems.push(`alias "${alias}" is not a folder: ${path}`);
      } catch {
        problems.push(`alias "${alias}" folder is not available: ${path} (is Google Drive for Desktop running?)`);
      }
    }
  } catch (e) {
    if (!(e instanceof GateError)) throw e;
    problems.push(`${e.message}${e.hint ? ` ${e.hint}` : ''}`);
  }
  if (projectDir && !problems.length) {
    try {
      const { aliases } = loadProjectDrive(projectDir);
      if (aliases.length) notes.push(`This project may read these Drive folders: ${aliases.join(', ')}.`);
      else notes.push('This project does not use Drive: copy source files into work/ yourself.');
      for (const alias of aliases) if (!Object.hasOwn(roots, alias)) problems.push(`this project enables "${alias}", but the computer has no such Drive folder (run /motion-flow:setup or /motion-flow:init-project)`);
    } catch (e) {
      if (!(e instanceof GateError)) throw e;
      problems.push(e.message);
    }
  }
  return { name: 'drive-gate config', status: problems.length ? 'problem' : 'ok', details: [...problems, ...notes], roots };
}

export function checkProjectSettings(projectDir, roots = {}) {
  const file = join(projectDir, '.claude', 'settings.json');
  const problems = [];
  if (!existsSync(file)) return { name: 'project settings.json', status: 'problem', details: [`${file} not found. Run /motion-flow:init-project to create it from the template.`] };
  let settings;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { name: 'project settings.json', status: 'problem', details: [`not valid JSON: ${e.message}`] };
  }
  const deny = settings.permissions?.deny ?? [];
  if (deny.some((rule) => /REPLACE/.test(rule))) problems.push('deny rules still contain the REPLACE placeholder: put the real Drive path in');
  const rootsList = Object.values(roots);
  const hasRead = deny.some((rule) => rule.startsWith('Read(') && !/REPLACE/.test(rule));
  if (rootsList.length && !hasRead) problems.push('no Read deny rule for the Drive folder');
  for (const root of rootsList) {
    const covered = deny.some((rule) => rule.startsWith('Read(') && rule.includes(root.replace(/\\/g, '/')));
    if (!covered) problems.push(`no Read deny rule covers the alias folder ${root}`);
  }
  for (const tool of ['trash_file', 'update_file', 'share_file']) {
    if (!deny.some((rule) => rule.startsWith('mcp__') && rule.endsWith(`__${tool}`))) problems.push(`Drive tool ${tool} is not denied`);
  }
  if (!settings.enabledPlugins?.['motion-flow@motion']) problems.push('motion-flow@motion is not enabled');
  const allow = settings.permissions?.allow ?? [];
  if (!allow.includes('Bash(mf-gate *)') || !allow.includes('Bash(ae-run *)')) {
    problems.push('the plugin tools (mf-gate, ae-run, ...) are not allowed, so every step asks for confirmation: run mf-init --update-permissions');
  }
  return { name: 'project settings.json', status: problems.length ? 'problem' : 'ok', details: problems };
}

/** Which studio rules plugins this project enables (information only: a freelancer may work without or with several studios). */
export function checkStudioRules(projectDir) {
  const file = join(projectDir, '.claude', 'settings.json');
  let enabled = [];
  try {
    enabled = Object.entries(JSON.parse(readFileSync(file, 'utf8')).enabledPlugins ?? {}).filter(([id, on]) => on === true && id !== 'motion-flow@motion').map(([id]) => id);
  } catch { /* no settings file: reported by the settings check */ }
  const details = enabled.length
    ? [`this project uses the plugin(s): ${enabled.join(', ')}`]
    : ['no studio rules plugin is enabled in this project (fine without a studio; otherwise run /motion-flow:init-project and choose the studio)'];
  if (enabled.length > 1) details.push('more than one extra plugin is enabled: make sure only one studio\'s rules apply to this project');
  return { name: 'studio rules', status: 'ok', details };
}

export async function checkPluginVersions(run, pluginRoot = PLUGIN_ROOT) {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  const list = await run('claude plugin list');
  const details = [`motion-flow plugin files: v${manifest.version}`];
  if (!list.ok) {
    return { name: 'plugin versions', status: 'unknown', details: [...details, 'could not run "claude plugin list"'] };
  }
  const found = {};
  let current = null;
  for (const line of list.output.split('\n')) {
    const id = /(?:^|\s)([\w.-]+)@([\w.-]+)\s*$/.exec(line.trim());
    if (id) current = id[1];
    const version = /Version:\s*(\S+)/.exec(line);
    if (version && current) found[current] = version[1];
  }
  for (const name of ['motion-flow', 'studio-rules']) details.push(found[name] ? `${name} installed: v${found[name]}` : `${name} is not installed`);
  const mismatch = found['motion-flow'] && found['motion-flow'] !== manifest.version;
  if (mismatch) details.push(`installed motion-flow v${found['motion-flow']} differs from these files (v${manifest.version}); run /reload-plugins or update`);
  return { name: 'plugin versions', status: !found['motion-flow'] || mismatch ? 'problem' : 'ok', details };
}

// ---------- After Effects ----------

/** Passive check: is After Effects installed (no process is started)? */
export function detectAfterEffects({ os = platform(), home = homedir(), env = process.env, list, exists } = {}) {
  try {
    const ae = findAe({ os: os === 'windows' ? 'win32' : os === 'macos' ? 'darwin' : os, home, env, ...(list ? { list } : {}), ...(exists ? { exists } : {}) });
    return { ok: true, version: ae.app ? ae.app.replace('Adobe After Effects', '').trim() || 'installed' : 'installed' };
  } catch (e) {
    if (e instanceof LauncherError) return { ok: false, note: e.message };
    throw e;
  }
}

/** Live check: runs `ae-run --ping` in the project (starts After Effects, writes files under work/.ipc). */
export function pingAeViaCli(projectDir, pluginRoot = PLUGIN_ROOT) {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(pluginRoot, 'bin', 'ae-run'), '--ping'], { cwd: projectDir, timeout: 150000, windowsHide: true }, (error, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: false, code: 'internal', error: error ? error.message : 'ae-run printed no result' });
      }
    });
  });
}

export function checkAePing(result) {
  if (result.ok) {
    return { name: 'after effects ping', status: 'ok', details: [`After Effects ${result.aeVersion} answered in ${result.durationMs} ms`, result.projectOpen ? `a project is open: ${result.projectPath ?? '(unsaved)'}` : 'no project is open'] };
  }
  const hints = { timeout: 'Look at the After Effects window for a dialog; the script may also be waiting for the "Allow Scripts to Write Files and Access Network" setting.',
    no_result: 'In After Effects enable Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network".',
    launch_failed: 'Allow the terminal / Claude Code to control After Effects (macOS: System Settings > Privacy & Security > Automation).' };
  return { name: 'after effects ping', status: 'problem', details: [`${result.code ?? 'error'}: ${result.error}`, ...(result.hint ? [result.hint] : hints[result.code] ? [hints[result.code]] : [])] };
}

// ---------- whisper model ----------

// Memory figures from the whisper.cpp README (multilingual models, CPU).
export const WHISPER_MODELS = [
  { name: 'tiny', memoryMb: 273 },
  { name: 'base', memoryMb: 388 },
  { name: 'small', memoryMb: 852 },
  { name: 'medium', memoryMb: 2100 },
  { name: 'large', memoryMb: 3900 },
];
const WHISPER_RAM_SHARE = 0.5; // the biggest model that fits half of the RAM; the rest stays for the OS and After Effects

/** Picks the largest model whose memory fits half of the RAM. Returns null when even tiny does not fit. */
export function recommendWhisperModel(totalBytes) {
  const budgetMb = (totalBytes / (1024 * 1024)) * WHISPER_RAM_SHARE;
  const fitting = WHISPER_MODELS.filter((m) => m.memoryMb <= budgetMb);
  const model = fitting.at(-1) ?? null;
  return { model, budgetMb: Math.round(budgetMb), totalGb: Math.round(totalBytes / 1024 ** 3) };
}

export function checkWhisperModel(home = homedir(), totalBytes = totalmem()) {
  const { model, budgetMb, totalGb } = recommendWhisperModel(totalBytes);
  if (!model) {
    return { name: 'whisper model', status: 'problem', details: [`${totalGb} GB RAM leaves about ${budgetMb} MB for whisper: not enough even for the smallest model`] };
  }
  const file = join(home, '.motion-flow', 'models', `ggml-${model.name}.bin`);
  const details = [`${totalGb} GB RAM: recommended model "${model.name}" (needs about ${model.memoryMb} MB, budget ${budgetMb} MB = half of the RAM)`];
  if (existsSync(file)) details.push(`model file present: ${file}`);
  else details.push(`model file not downloaded yet. Download by hand: curl -L -o "${file}" --create-dirs https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model.name}.bin`);
  return { name: 'whisper model', status: 'ok', details };
}

// ---------- report ----------

const LABEL = { ok: 'ok', missing: 'MISSING', old: 'OLD VERSION', manual: 'check by hand', unknown: 'version unknown', problem: 'PROBLEM' };

export function formatReport(report) {
  const lines = ['Dependencies', ''];
  const rows = report.dependencies.map((d) => [d.name + (d.optional ? ' (optional)' : ''), LABEL[d.status], d.version ?? '-', d.min_version ?? '-']);
  const header = ['name', 'status', 'version', 'minimum'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const row = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  lines.push(row(header), row(widths.map((w) => '-'.repeat(w))), ...rows.map(row), '');
  const needsAction = report.dependencies.filter((d) => d.status === 'missing' || d.status === 'old');
  if (needsAction.length) {
    lines.push(`Install commands for ${report.os} (run them yourself; doctor installs nothing):`);
    for (const d of needsAction) lines.push(`  ${d.name}: ${d.install}`);
    lines.push('');
  }
  for (const check of report.checks) {
    lines.push(`${check.name}: ${LABEL[check.status] ?? check.status}`);
    for (const detail of check.details ?? []) lines.push(`  - ${detail}`);
  }
  return lines.join('\n');
}

/** Runs the whole check. Returns { os, dependencies, checks, ok }. Reads only; changes nothing. */
export async function runDoctor(options = {}) {
  const {
    depsFile = join(PLUGIN_ROOT, 'deps.json'),
    flow = null,
    flowDirs = [],
    projectDir = process.cwd(),
    home = homedir(),
    run = runCommand,
    os = currentOs(),
    pluginRoot = PLUGIN_ROOT,
    totalBytes = totalmem(),
    pingAe = false,
    pingFn = pingAeViaCli,
    detectors = { 'after-effects': () => detectAfterEffects({ os, home }) },
  } = options;
  let deps = parseDeps(readFileSync(depsFile, 'utf8'));
  if (flow) {
    const needs = flowNeeds(flow, flowDirs);
    deps = deps.filter((d) => needs.includes(d.name));
  }
  const dependencies = [];
  for (const dep of deps) dependencies.push(await checkDependency(dep, run, os, detectors));
  const checks = [];
  if (deps.some((d) => d.name === 'whisper')) checks.push(checkWhisperModel(home, totalBytes));
  if (pingAe && deps.some((d) => d.name === 'after-effects')) checks.push(checkAePing(await pingFn(projectDir)));
  if (!flow) {
    const drive = checkDriveGateConfig(home, projectDir);
    checks.push(drive, checkProjectSettings(projectDir, drive.roots), checkStudioRules(projectDir), await checkPluginVersions(run, pluginRoot));
  }
  const ok = dependencies.every((d) => d.status === 'ok' || d.status === 'manual' || (d.optional && d.status !== 'old'))
    && checks.every((c) => c.status === 'ok' || c.status === 'unknown');
  return { os, dependencies, checks: checks.map(({ roots, ...rest }) => rest), ok };
}
