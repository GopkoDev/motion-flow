// The studio-builder templates: the studio scaffold, the flow templates and the project setup files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../../motion-flow/scripts/validate_plugin.mjs';

const read = (name) => readFileSync(fileURLToPath(new URL(`../templates/${name}`, import.meta.url)), 'utf8');

test('the flow templates have valid frontmatter and their sections', () => {
  const flow = read('flow.md');
  const front = parseFrontmatter(flow);
  for (const key of ['name', 'version', 'owner', 'status', 'needs']) assert.ok(key in front, `flow.md: key "${key}"`);
  for (const heading of ['## What this flow is for', '## What starts it (3 example phrases)', '## Inputs', '## Steps in order', '## Where the designer decides', '## What must not be touched', '## How to tell it is done', '## Examples (links to example/)']) assert.ok(flow.includes(`\n${heading}\n`), heading);
  const skill = read('flow-SKILL.md');
  for (const key of ['name', 'description', 'model']) assert.ok(key in parseFrontmatter(skill), `flow-SKILL.md: key "${key}"`);
  assert.ok(skill.includes('\n## Safety\n'));
});

test('the flow skill template promises not to weaken safety.md and uses model: inherit', () => {
  const text = read('flow-SKILL.md');
  assert.equal(parseFrontmatter(text).model, 'inherit');
  assert.match(text, /does not change or weaken `_shared\/safety\.md`/);
});

// ---------- the studio-rules scaffold (T4.1) ----------

import { loadChecks } from '../../motion-flow/lib/ae-lint.mjs';
import { compilePattern, nextVersionName, patternFromNamingFile } from '../../motion-flow/lib/aep-version.mjs';

const SCAFFOLD = fileURLToPath(new URL('../templates/studio-rules/', import.meta.url));
const scaffold = (name) => readFileSync(join(SCAFFOLD, name), 'utf8');
const RULE_FILES = ['naming.md', 'motion-system.md', 'protected.md', 'delivery.md', 'drive.md'];

test('the scaffold is a plain folder: no plugin manifest, no catalog, no skill', () => {
  for (const path of ['.claude-plugin', 'skills']) assert.ok(!existsSync(join(SCAFFOLD, path)), `${path} must not exist`);
  assert.ok(existsSync(join(SCAFFOLD, 'INDEX.md')));
});

test('every rule file starts as a draft with the confirmation fields', () => {
  for (const name of RULE_FILES) {
    const front = parseFrontmatter(scaffold(`rules/${name}`));
    assert.ok(front, name);
    assert.equal(front.status, 'draft', name);
    for (const key of ['confirmed_by', 'confirmed_at']) assert.ok(key in front, `${name}: ${key}`);
  }
});

test('the index lists every rule file, every folder, and the steps that read them (spec section 10)', () => {
  const text = scaffold('INDEX.md');
  for (const name of RULE_FILES) assert.ok(text.includes(`rules/${name}`), name);
  for (const item of ['rules/project-template/', 'rules/checks/', 'flows/', 'CHANGELOG.md']) assert.ok(text.includes(item), item);
  for (const row of [/naming\.md.*\| plan, build, check, deliver \|/, /project-template.*\| intake, build \|/, /motion-system.*\| plan, build \|/, /protected\.md.*\| plan, build, check \|/, /delivery\.md.*\| plan, deliver \|/, /drive\.md.*\| deliver, publish-flow \|/, /checks\/.*\| check \|/, /flows\/.*\| intake \|/]) assert.match(text, row);
  assert.match(text, /status: draft/);
  assert.match(text, /Never turn a draft into `confirmed` yourself/);
  assert.ok(text.includes('`rules/` folder next to this file'));
  assert.ok(!text.includes('CLAUDE_PLUGIN_ROOT'));
});

test('the version pattern in naming.md is accepted by aep-version and finds the version in a typical name', () => {
  const pattern = patternFromNamingFile(join(SCAFFOLD, 'rules', 'naming.md'));
  assert.ok(pattern);
  compilePattern(pattern);
  assert.equal(nextVersionName('spring_v07.aep', { pattern }).name, 'spring_v08.aep');
});

test('the example checks load in ae-lint, and the live checks folder holds no active check yet', () => {
  const examples = loadChecks(join(SCAFFOLD, 'rules', 'checks', '_examples'));
  assert.deepEqual(examples.map((c) => c.id).sort(), ['brand-fonts', 'comp-names', 'fps-25', 'no-default-names', 'no-missing-media', 'protected-brand']);
  assert.deepEqual(loadChecks(join(SCAFFOLD, 'rules', 'checks')), [], 'a fresh studio has no active checks until the designers confirm them');
  assert.ok(existsSync(join(SCAFFOLD, 'rules', 'checks', 'README.md')));
});

test('the scaffold keeps tool folders out of the studio repository', () => {
  const lines = scaffold('.gitignore').split('\n');
  for (const entry of ['work/', '.motion/', '.claude/', 'CLAUDE.md']) assert.ok(lines.includes(entry), entry);
});

test('the scaffold has the changelog, the readme, the flows folder and the project template notes', () => {
  for (const file of ['CHANGELOG.md', 'README.md', 'flows/.gitkeep', 'rules/project-template/README.md']) assert.ok(existsSync(join(SCAFFOLD, file)), file);
  assert.match(scaffold('README.md'), /learn-studio/);
});

test('the readme explains the studios folder, one studio per project, and sharing with git', () => {
  const text = scaffold('README.md');
  for (const phrase of ['~/Documents/studios/<studio>/', 'mf-studio dir', '.motion/studio.json', 'freelancer', 'git pull', 'outside Google Drive']) assert.ok(text.includes(phrase), phrase);
  for (const phrase of ['/plugin marketplace', 'claude plugin install']) assert.ok(!text.includes(phrase), `no ${phrase}`);
});

test('learn-studio works in the studio folder inside the studios folder, counts the examples in code, and writes English rules', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/learn-studio/SKILL.md', import.meta.url)), 'utf8');
  for (const phrase of ['mf-studio dir', 'direct subfolder of the studios folder', 'INDEX.md', 'cp -Rn', 'never replaced', 'sb-corpus dump', 'sb-corpus analyze', 'the more the better', 'context_split', 'Write the rule files in **English**']) assert.ok(text.includes(phrase), phrase);
  assert.ok(!text.includes('marketplace.json'));
  assert.ok(!/1-2 finished|two examples/i.test(text), 'no cap on the number of examples');
});

test('the studio-builder project templates enable only studio-builder and keep the Drive protections', () => {
  const settings = JSON.parse(read('settings.project.json'));
  assert.deepEqual(Object.keys(settings.enabledPlugins), ['studio-builder@motion']);
  assert.equal(settings.permissions.defaultMode, 'acceptEdits');
  for (const tool of ['sb-corpus', 'sb-init', 'sb-export', 'ae-dump', 'ae-run', 'drive-gate', 'mf-flow', 'mf-studio']) {
    assert.ok(settings.permissions.allow.includes(`Bash(${tool} *)`), tool);
  }
  for (const rule of ['Edit(~/.motion-flow/**)', 'mcp__claude_ai_Google_Drive__trash_file']) assert.ok(settings.permissions.deny.includes(rule), rule);
  assert.ok(settings.permissions.deny.some((rule) => rule.startsWith('Read(//') && rule.includes('REPLACE')), 'the Drive placeholder is there for sb-init to fill');
  assert.ok(settings.permissions.ask.some((rule) => rule.includes('git push')));
  assert.ok(read('gitignore.project').split('\n').includes('work/'));
  assert.match(read('CLAUDE.project.md'), /studio-builder/);
});
