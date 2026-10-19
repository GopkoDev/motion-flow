import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseFrontmatter, validatePlugin } from './validate_plugin.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const PLUGIN = { name: 'demo', version: '0.1.0', description: 'Demo', author: { name: 'A' } };
const MARKET = { name: 'm', owner: { name: 'A' }, plugins: [{ name: 'demo', source: './' }] };
const SKILL = '---\nname: intake\ndescription: Intake\nmodel: sonnet\n---\nBody\n';

function write(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
}

/** Builds a valid plugin in a temp dir, applies `mutate`, returns validation errors. */
function run(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'mf-validate-'));
  try {
    write(root, '.claude-plugin/plugin.json', PLUGIN);
    write(root, '.claude-plugin/marketplace.json', MARKET);
    write(root, 'skills/intake/SKILL.md', SKILL);
    write(root, 'skills/_shared/gating.md', '# gating\n');
    mutate(root);
    return validatePlugin(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('valid plugin has no errors', () => {
  assert.deepEqual(run(), []);
});

test('parseFrontmatter reads flat fields and rejects missing block', () => {
  assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: "b c"\n---\nx'), { name: 'a', description: 'b c' });
  assert.equal(parseFrontmatter('no frontmatter'), null);
});

test('broken plugin.json is reported', () => {
  const errors = run((r) => write(r, '.claude-plugin/plugin.json', '{ not json'));
  assert.ok(errors.some((e) => e.includes('plugin.json is not valid JSON')));
});

test('missing plugin.json is reported', () => {
  const errors = run((r) => rmSync(join(r, '.claude-plugin/plugin.json')));
  assert.ok(errors.some((e) => e.includes('plugin.json is missing')));
});

test('plugin.json bad name and version are reported', () => {
  const errors = run((r) => write(r, '.claude-plugin/plugin.json', { ...PLUGIN, name: 'Bad Name', version: '1.0' }));
  assert.ok(errors.some((e) => e.includes('"name" must be kebab-case')));
  assert.ok(errors.some((e) => e.includes('"version" must be semver')));
});

test('marketplace: relative source must start with ./ and not contain ..', () => {
  const bad = (source) => run((r) => write(r, '.claude-plugin/marketplace.json', { ...MARKET, plugins: [{ name: 'demo', source }] }));
  assert.ok(bad('plugins/x').some((e) => e.includes('must start with "./"')));
  assert.ok(bad('./../x').some((e) => e.includes('".."')));
});

test('marketplace: entry name must match plugin.json for self source', () => {
  const errors = run((r) => write(r, '.claude-plugin/marketplace.json', { ...MARKET, plugins: [{ name: 'other', source: './' }] }));
  assert.ok(errors.some((e) => e.includes('differs from plugin.json name')));
});

test('marketplace: github object source is accepted, owner required', () => {
  const ok = run((r) => write(r, '.claude-plugin/marketplace.json', { ...MARKET, plugins: [{ name: 'x', source: { source: 'github', repo: 'a/b' } }] }));
  assert.deepEqual(ok, []);
  const errors = run((r) => write(r, '.claude-plugin/marketplace.json', { ...MARKET, owner: {} }));
  assert.ok(errors.some((e) => e.includes('"owner.name" is required')));
});

test('hooks.json without hooks wrapper is reported', () => {
  const errors = run((r) => write(r, 'hooks/hooks.json', { PreToolUse: [] }));
  assert.ok(errors.some((e) => e.includes('top-level "hooks" object')));
});

test('SKILL.md missing model, frontmatter, or file is reported', () => {
  const noModel = run((r) => write(r, 'skills/intake/SKILL.md', '---\nname: intake\ndescription: x\n---\n'));
  assert.ok(noModel.some((e) => e.includes('"model" is required')));
  const noFm = run((r) => write(r, 'skills/intake/SKILL.md', 'just text'));
  assert.ok(noFm.some((e) => e.includes('frontmatter is missing')));
  const noFile = run((r) => rmSync(join(r, 'skills/intake/SKILL.md')));
  assert.ok(noFile.some((e) => e.includes('skills/intake/SKILL.md is missing')));
});

test('SKILL.md name must match its directory', () => {
  const errors = run((r) => write(r, 'skills/intake/SKILL.md', SKILL.replace('name: intake', 'name: other')));
  assert.ok(errors.some((e) => e.includes('must match the directory')));
});

test('_shared directory is not treated as a skill', () => {
  assert.deepEqual(run((r) => write(r, 'skills/_shared/handoff.md', '# h\n')), []);
});

test('_shared references: resolved ok, missing reported', () => {
  const ok = run((r) => write(r, 'skills/intake/SKILL.md', SKILL + 'See _shared/gating.md\n'));
  assert.deepEqual(ok, []);
  const bad = run((r) => write(r, 'skills/intake/SKILL.md', SKILL + 'See _shared/nope.md\n'));
  assert.ok(bad.some((e) => e.includes('missing skills/_shared/nope.md')));
});

test('CLI: green on this repo, exit 1 on a broken plugin', () => {
  const repo = join(here, '..');
  const good = spawnSync(process.execPath, [join(here, 'validate_plugin.mjs'), repo], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  const root = mkdtempSync(join(tmpdir(), 'mf-validate-cli-'));
  try {
    write(root, '.claude-plugin/plugin.json', '{ broken');
    const bad = spawnSync(process.execPath, [join(here, 'validate_plugin.mjs'), root], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /not valid JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
