#!/usr/bin/env node
// Validates the motion-flow plugin layout. Usage: node scripts/validate_plugin.mjs [pluginRoot]
// Exits 1 when any check fails.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQUIRED_SKILL_FIELDS = ['name', 'description', 'model'];

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

/** Runs all checks against a plugin root. Returns the list of error strings. */
export function validatePlugin(root) {
  const errors = [];
  const plugin = checkPluginManifest(root, errors);
  checkMarketplace(root, plugin, errors);
  checkHooks(root, errors);
  checkSkills(root, errors);
  checkSharedRefs(root, errors);
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
