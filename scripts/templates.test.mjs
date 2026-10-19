// The project templates must stay valid and consistent with docs/schemas-notes.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`../templates/${name}`, import.meta.url)), 'utf8');
const settings = JSON.parse(read('settings.project.json'));

test('settings.project.json registers the marketplace and enables the plugin', () => {
  const marketplace = settings.extraKnownMarketplaces.motion;
  assert.equal(marketplace.source.source, 'github');
  assert.match(marketplace.source.repo, /^[\w.-]+\/[\w.-]+$/);
  for (const [id, enabled] of Object.entries(settings.enabledPlugins)) {
    assert.match(id, /^[\w.-]+@[\w.-]+$/);
    assert.equal(typeof enabled, 'boolean');
  }
  assert.equal(settings.enabledPlugins['motion-flow@motion'], true);
});

test('deny rules use Read/Edit path rules (Write path rules are never consulted)', () => {
  const deny = settings.permissions.deny;
  assert.ok(deny.every((rule) => !rule.startsWith('Write(')), 'no Write(path) rules');
  assert.ok(deny.some((rule) => rule.startsWith('Read(//')), 'absolute Drive read rule');
  assert.ok(deny.some((rule) => rule.startsWith('Edit(//')), 'absolute Drive edit rule');
  assert.ok(deny.includes('Edit(~/.motion-flow/**)'), 'drive-gate config is protected');
});

test('deny rules cover every Drive write tool by exact MCP name', () => {
  for (const tool of ['trash_file', 'update_file', 'share_file', 'create_file', 'copy_file']) {
    assert.ok(settings.permissions.deny.some((rule) => rule.startsWith('mcp__') && rule.endsWith(`__${tool}`)), tool);
  }
  assert.ok(settings.permissions.deny.every((rule) => !rule.startsWith('mcp__') || !rule.includes('(')), 'mcp rules with parentheses are skipped by Claude Code');
});

test('dangerous git commands ask for confirmation instead of being hard-denied', () => {
  const ask = settings.permissions.ask.join('\n');
  for (const command of ['git push', 'git reset --hard', 'git clean -f', 'git checkout --force']) assert.ok(ask.includes(command), command);
  assert.ok(!settings.permissions.deny.some((rule) => rule.startsWith('Bash(git')), 'git is in ask, not deny');
});

test('gitignore keeps work/ and local state out of git', () => {
  const lines = read('gitignore.project').split('\n');
  assert.ok(lines.includes('work/'));
  assert.ok(lines.includes('.motion/state.json'));
});

test('roots.example.json matches what drive-gate reads', () => {
  const roots = JSON.parse(read('roots.example.json'));
  assert.ok(Object.keys(roots.roots).length >= 1);
  assert.ok(Object.values(roots.roots).every((path) => typeof path === 'string' && path.startsWith('/')));
  assert.equal(roots.work_dir, 'work');
});

// ---------- artifact templates (spec section 8) ----------

import { readdirSync } from 'node:fs';
import { parseFrontmatter } from './validate_plugin.mjs';

const TEMPLATES = {
  'task.md': { keys: ['id', 'type', 'flow', 'status', 'inputs', 'deadline'], headings: ['## Опис', '## Що відомо / припущення'] },
  'plan.md': { keys: ['task_id', 'status', 'approved_at', 'plan_sha256', 'project_copy', 'touches_protected', 'needs'], headings: ['## Кроки', '## Ризики', '## Питання до людини'] },
  'check.md': { keys: ['task_id', 'verdict', 'approved', 'approved_at'], headings: ['## Звірка з планом', '## Lint', '## Кадри', '## Відкриті питання'] },
  'deliver.md': { keys: ['task_id', 'status', 'delivered_at'], headings: ['## Файли', '## Куди покласти', '## Відкриті питання'] },
  'overrides.md': { keys: ['project'], headings: ['## Винятки з правил студії'] },
  'flow.md': { keys: ['name', 'version', 'owner', 'status', 'needs'], headings: ['## Для чого цей флоу', '## Що його запускає (3 приклади фраз)', '## Входи', '## Кроки по порядку', '## Де рішення людини', '## Що не можна чіпати', '## Як зрозуміти, що готово', '## Приклади (посилання на example/)'] },
  'flow-SKILL.md': { keys: ['name', 'description', 'model'], headings: ['## Safety'] },
};

test('every artifact template has valid frontmatter with the keys of spec section 8 and its sections', () => {
  for (const [name, expected] of Object.entries(TEMPLATES)) {
    const text = read(name);
    const front = parseFrontmatter(text);
    assert.ok(front, `${name}: frontmatter is missing`);
    for (const key of expected.keys) assert.ok(key in front, `${name}: key "${key}" is missing`);
    for (const heading of expected.headings) assert.ok(text.includes(`\n${heading}\n`), `${name}: heading "${heading}" is missing`);
  }
});

test('plan and check templates start unapproved and with no hash', () => {
  const plan = parseFrontmatter(read('plan.md'));
  assert.deepEqual([plan.status, plan.approved_at, plan.plan_sha256], ['draft', 'null', 'null']);
  const check = parseFrontmatter(read('check.md'));
  assert.deepEqual([check.approved, check.approved_at], ['false', 'null']);
});

test('the flow skill template promises not to weaken safety.md and uses model: inherit', () => {
  const text = read('flow-SKILL.md');
  assert.equal(parseFrontmatter(text).model, 'inherit');
  assert.match(text, /does not change or weaken `_shared\/safety\.md`/);
});

test('templates live next to the config templates and nothing else unexpected is in the folder', () => {
  const files = readdirSync(fileURLToPath(new URL('../templates/', import.meta.url))).sort();
  assert.deepEqual(files, ['CLAUDE.project.md', 'check.md', 'deliver.md', 'flow-SKILL.md', 'flow.md', 'gitignore.project', 'overrides.md', 'plan.md', 'roots.example.json', 'settings.project.json', 'task.md']);
});

// ---------- shared reference docs ----------

test('every shared reference doc exists, has a title, and the six step-independent ones are present', () => {
  const dir = fileURLToPath(new URL('../skills/_shared/', import.meta.url));
  for (const name of ['gating.md', 'handoff.md', 'socratic-loop.md', 'safety.md', 'artifact-formats.md', 'drive-access.md', 'ae-scripting.md']) {
    const text = readFileSync(join(dir, name), 'utf8');
    assert.match(text, /^# .+/m, name);
    assert.ok(text.length > 500, `${name} is suspiciously short`);
  }
});

test('the invariants of spec section 9 are all in safety.md', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/_shared/safety.md', import.meta.url)), 'utf8');
  for (const phrase of ['copies in `work/`', 'undo group', 'No delete, move or rename on Drive', 'drive-gate', 'Install nothing', 'cannot weaken', 'only from a person', 'stop and ask', 'client content']) {
    assert.ok(text.includes(phrase), phrase);
  }
});

test('gating.md describes the five gates, the hash rule and human-only approval', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/_shared/gating.md', import.meta.url)), 'utf8');
  for (const phrase of ['mf-gate require', 'plan_sha256', 'AskUserQuestion', 'plan_changed_after_approval', 'twice']) assert.ok(text.includes(phrase), phrase);
  for (const step of ['intake', 'plan', 'build', 'check', 'deliver']) assert.ok(text.includes(`| ${step} |`), step);
});
