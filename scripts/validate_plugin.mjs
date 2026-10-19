#!/usr/bin/env node
// Validates the motion-flow plugin layout. Usage: node scripts/validate_plugin.mjs [pluginRoot]
// Exits 1 when any check fails.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeps } from '../lib/doctor.mjs';

const SEMVER = /^\d+\.\d+\.\d+$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQUIRED_SKILL_FIELDS = ['name', 'description', 'model'];
const MAX_SKILL_LINES = 500;

// Steps that consume an earlier artifact must start with the gate for their own step, and follow the safety rules.
const GATED_STEPS = ['plan', 'build', 'check', 'deliver'];
const STEP_SKILLS = ['intake', 'plan', 'build', 'check', 'deliver'];
// Steps that read studio rules must warn when a rule is still a draft.
const DRAFT_AWARE_STEPS = ['plan', 'build', 'check', 'deliver'];

// Drive is read-only for the agent: no skill may tell it to write, delete, move, rename or share on Drive.
const DRIVE_WRITE_PATTERNS = [
  [/drive-gate\s+(put|rm|mv|delete|remove|rename|share|write|upload|cp)\b/, 'a drive-gate write command (drive-gate has none)'],
  [/\b(trash_file|update_file|share_file|create_file|copy_file)\b/, 'a Drive write tool'],
  [/\b(gdrive|rclone)\b/, 'a tool that writes to Drive'],
];

// Frontmatter keys every artifact template must have (spec section 8).
const TEMPLATE_KEYS = {
  'task.md': ['id', 'type', 'flow', 'status', 'inputs', 'deadline'],
  'plan.md': ['task_id', 'status', 'approved_at', 'plan_sha256', 'project_copy', 'touches_protected', 'needs'],
  'check.md': ['task_id', 'verdict', 'approved', 'approved_at'],
  'deliver.md': ['task_id', 'status', 'delivered_at'],
  'overrides.md': ['project'],
  'flow.md': ['name', 'version', 'owner', 'status', 'needs'],
  'flow-SKILL.md': ['name', 'description', 'model'],
};

/** Parses a flat `key: value` frontmatter block. Returns null when there is none. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

function readJson(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`${label} is missing`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    errors.push(`${label} is not valid JSON: ${e.message}`);
    return null;
  }
}

function checkPluginManifest(root, errors) {
  const label = '.claude-plugin/plugin.json';
  const m = readJson(join(root, label), label, errors);
  if (!m) return null;
  if (typeof m.name !== 'string' || !KEBAB.test(m.name)) errors.push(`${label}: "name" must be kebab-case`);
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) errors.push(`${label}: "version" must be semver (x.y.z)`);
  if (typeof m.description !== 'string' || !m.description.trim()) errors.push(`${label}: "description" is required`);
  if (!m.author || typeof m.author.name !== 'string' || !m.author.name) errors.push(`${label}: "author.name" is required`);
  return m;
}

function checkMarketplace(root, plugin, errors) {
  const label = '.claude-plugin/marketplace.json';
  if (!existsSync(join(root, label))) return; // optional: the catalog may live elsewhere
  const m = readJson(join(root, label), label, errors);
  if (!m) return;
  if (typeof m.name !== 'string' || !m.name) errors.push(`${label}: "name" is required`);
  if (!m.owner || typeof m.owner.name !== 'string' || !m.owner.name) errors.push(`${label}: "owner.name" is required`);
  if (!Array.isArray(m.plugins) || m.plugins.length === 0) {
    errors.push(`${label}: "plugins" must be a non-empty array`);
    return;
  }
  const seen = new Set();
  m.plugins.forEach((p, i) => {
    if (typeof p.name !== 'string' || !p.name) errors.push(`${label}: plugins[${i}].name is required`);
    else if (seen.has(p.name)) errors.push(`${label}: duplicate plugin name "${p.name}"`);
    else seen.add(p.name);
    const src = p.source;
    if (typeof src === 'string') {
      if (src !== '.' && !src.startsWith('./')) errors.push(`${label}: plugins[${i}].source must start with "./"`);
      if (src.split('/').includes('..')) errors.push(`${label}: plugins[${i}].source must not contain ".."`);
      if (plugin && (src === './' || src === '.') && p.name !== plugin.name) {
        errors.push(`${label}: plugins[${i}].name "${p.name}" differs from plugin.json name "${plugin.name}"`);
      }
    } else if (!src || typeof src !== 'object' || typeof src.source !== 'string') {
      errors.push(`${label}: plugins[${i}].source must be a path string or an object with "source"`);
    }
  });
}

function checkHooks(root, errors) {
  const label = 'hooks/hooks.json';
  if (!existsSync(join(root, label))) return;
  const h = readJson(join(root, label), label, errors);
  if (h && (typeof h.hooks !== 'object' || h.hooks === null || Array.isArray(h.hooks))) {
    errors.push(`${label}: top-level "hooks" object is required`);
  }
}

function listSkillDirs(root) {
  const dir = join(root, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
}

function checkSkills(root, errors) {
  for (const name of listSkillDirs(root)) {
    if (name.startsWith('_')) continue; // _shared holds common docs, not skills
    const rel = `skills/${name}/SKILL.md`;
    const file = join(root, rel);
    if (!existsSync(file)) {
      errors.push(`${rel} is missing`);
      continue;
    }
    const fm = parseFrontmatter(readFileSync(file, 'utf8'));
    if (!fm) {
      errors.push(`${rel}: frontmatter is missing`);
      continue;
    }
    for (const f of REQUIRED_SKILL_FIELDS) {
      if (!fm[f]) errors.push(`${rel}: frontmatter "${f}" is required`);
    }
    if (fm.name && fm.name !== name) errors.push(`${rel}: name "${fm.name}" must match the directory "${name}"`);
  }
}

function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...markdownFiles(p));
    else if (n.endsWith('.md')) out.push(p);
  }
  return out;
}

function checkSharedRefs(root, errors) {
  const ref = /_shared\/([A-Za-z0-9._-]+\.md)/g;
  for (const file of markdownFiles(join(root, 'skills'))) {
    const rel = file.slice(root.length + 1).split('\\').join('/');
    for (const m of readFileSync(file, 'utf8').matchAll(ref)) {
      if (!existsSync(join(root, 'skills', '_shared', m[1]))) {
        errors.push(`${rel}: reference to missing skills/_shared/${m[1]}`);
      }
    }
  }
}

function checkStepSkills(root, errors) {
  for (const name of STEP_SKILLS) {
    const rel = `skills/${name}/SKILL.md`;
    const file = join(root, rel);
    if (!existsSync(file)) continue; // a missing skill is reported by checkSkills when the folder exists
    const text = readFileSync(file, 'utf8');
    if (GATED_STEPS.includes(name) && !new RegExp(`mf-gate\\s+require\\s+${name}\\b`).test(text)) {
      errors.push(`${rel}: a step that consumes an artifact must call "mf-gate require ${name}"`);
    }
    if (!/_shared\/safety\.md|safety\.md/.test(text)) errors.push(`${rel}: must point to the shared safety rules (safety.md)`);
    if (DRAFT_AWARE_STEPS.includes(name) && !/status: draft/.test(text)) errors.push(`${rel}: must say what to do with a studio rule that has "status: draft" (warn the designer)`);
  }
}

function checkDriveWrites(root, errors) {
  const dirs = [join(root, 'skills'), join(root, 'templates')];
  for (const dir of dirs) {
    for (const file of markdownFiles(dir)) {
      const rel = file.slice(root.length + 1).split('\\').join('/');
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        for (const [pattern, what] of DRIVE_WRITE_PATTERNS) {
          if (pattern.test(line)) errors.push(`${rel}:${index + 1}: mentions ${what}`);
        }
      });
    }
  }
}

function checkSkillSize(root, errors) {
  for (const name of listSkillDirs(root)) {
    if (name.startsWith('_')) continue;
    const file = join(root, 'skills', name, 'SKILL.md');
    if (existsSync(file) && readFileSync(file, 'utf8').split('\n').length > MAX_SKILL_LINES) errors.push(`skills/${name}/SKILL.md: longer than ${MAX_SKILL_LINES} lines; move detail into a shared file`);
  }
}

function checkDeps(root, errors) {
  const file = join(root, 'deps.json');
  if (!existsSync(file)) return; // a plugin without dependencies is fine
  try {
    parseDeps(readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(e.message);
  }
}

function checkTemplates(root, errors) {
  const dir = join(root, 'templates');
  if (!existsSync(dir)) return;
  for (const [name, keys] of Object.entries(TEMPLATE_KEYS)) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    const front = parseFrontmatter(readFileSync(file, 'utf8'));
    if (!front) { errors.push(`templates/${name}: frontmatter is missing`); continue; }
    for (const key of keys) if (!(key in front)) errors.push(`templates/${name}: frontmatter key "${key}" is missing`);
  }
}

function checkHookScripts(root, errors) {
  const file = join(root, 'hooks', 'hooks.json');
  if (!existsSync(file)) return;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return; }
  for (const match of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
    if (!existsSync(join(root, match[1]))) errors.push(`hooks/hooks.json: the script ${match[1]} does not exist`);
  }
}

/** Runs all checks against a plugin root. Returns the list of error strings. */
export function validatePlugin(root) {
  const errors = [];
  const plugin = checkPluginManifest(root, errors);
  checkMarketplace(root, plugin, errors);
  checkHooks(root, errors);
  checkSkills(root, errors);
  checkSharedRefs(root, errors);
  checkStepSkills(root, errors);
  checkDriveWrites(root, errors);
  checkSkillSize(root, errors);
  checkDeps(root, errors);
  checkTemplates(root, errors);
  checkHookScripts(root, errors);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const errors = validatePlugin(root);
  if (errors.length === 0) {
    console.log('validate_plugin: ok');
  } else {
    for (const e of errors) console.error(`FAIL ${e}`);
    console.error(`validate_plugin: ${errors.length} problem(s)`);
    process.exit(1);
  }
}
