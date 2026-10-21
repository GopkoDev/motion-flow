// The project templates must stay valid and consistent with docs/schemas-notes.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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
  'task.md': { keys: ['id', 'type', 'flow', 'status', 'inputs', 'deadline'], headings: ['## Description', '## Acceptance criteria', '## Known facts and assumptions', '## Open questions'] },
  'plan.md': { keys: ['task_id', 'status', 'approved_at', 'plan_sha256', 'project_copy', 'touches_protected', 'needs'], headings: ['## Steps', '## Not covered by the plan', '## Risks', '## Questions for the designer'] },
  'check.md': { keys: ['task_id', 'verdict', 'approved', 'approved_at'], headings: ['## Comparison with the plan', '## Acceptance criteria', '## Lint', '## Frames', '## Independent review', '## Open questions'] },
  'deliver.md': { keys: ['task_id', 'status', 'delivered_at'], headings: ['## Files', '## Where to put them', '## Open questions'] },
  'overrides.md': { keys: ['project'], headings: ['## Exceptions to the studio rules'] },
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

test('templates live next to the config templates and nothing else unexpected is in the folder', () => {
  const files = readdirSync(fileURLToPath(new URL('../templates/', import.meta.url))).sort();
  assert.deepEqual(files, ['CLAUDE.project.md', 'check.md', 'deliver.md', 'gitignore.project', 'overrides.md', 'plan.md', 'roots.example.json', 'settings.project.json', 'task.md']);
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

test('init-project offers the studios found in the studios folder and needs no install', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/init-project/SKILL.md', import.meta.url)), 'utf8');
  for (const phrase of ['--studio', '--no-studio', 'mf-studio list', 'exactly one studio']) assert.ok(text.includes(phrase), phrase);
  for (const phrase of ['claude plugin install', 'claude plugin list']) assert.ok(!text.includes(phrase), `no ${phrase}`);
});

test('the task, plan and check templates carry the criteria columns and rows the gate traces', () => {
  assert.match(read('task.md'), /- AC1: /);
  assert.match(read('plan.md'), /\| Frame to check \| Criteria \|/);
  assert.match(read('check.md'), /\| AC \| Evidence \| Verdict \|/);
});

test('intake, plan and check tell the agent to self-check and, for intake and check, to use an independent pass', () => {
  const skill = (name) => readFileSync(fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)), 'utf8');
  for (const [name, artifact] of [['intake', 'task'], ['plan', 'plan'], ['check', 'check']]) assert.match(skill(name), new RegExp(`mf-gate verify ${artifact}`), name);
  for (const name of ['intake', 'check']) assert.match(skill(name), /independent-review\.md/, name);
  assert.match(skill('intake'), /acceptance criteria/i);
  assert.match(skill('plan'), /Every criterion needs a step, and every step needs a criterion/);
  assert.match(skill('check'), /NOT_VERIFIED/);
});

test('deliver names the project file in work/out/ from project_copy, which already starts with work/', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/deliver/SKILL.md', import.meta.url)), 'utf8');
  assert.doesNotMatch(text, /work\/<project_copy>/, 'project_copy is already a path under work/');
  assert.match(text, /aep-version <project_copy> --dir work\/out/);
  assert.match(text, /cp -n /);
});

test('build runs on the plan\'s project_copy only: it resumes on its own copy and never switches to another name', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/build/SKILL.md', import.meta.url)), 'utf8');
  assert.doesNotMatch(text, /run `aep-version` on the source again/, 'a new name would not reach check, which reads project_copy from the plan');
  for (const phrase of ['never on another name', 'resumed build', 'never pick another name yourself', '/motion-flow:plan']) assert.ok(text.includes(phrase), phrase);
});

test('plan and deliver pass the studio naming rules to aep-version, so version_regex is used', () => {
  for (const name of ['plan', 'deliver']) {
    const text = readFileSync(fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)), 'utf8');
    assert.match(text, /aep-version [^`]*--naming <studio rules>\/rules\/naming\.md/, name);
  }
});

test('the independent-review doc holds the intake prompt, points check to its agent, and keeps the sub-agent rules', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/_shared/independent-review.md', import.meta.url)), 'utf8');
  for (const phrase of ['Prompt for `intake`', 'subagent_type: "motion-flow:check-reviewer"', 'NO_FINDINGS', 'cite its evidence', 'read-only', 'never pick the friendlier verdict silently']) assert.ok(text.includes(phrase), phrase);
});

test('the check reviewer agent is read-only, starts clean, and holds the check instructions', () => {
  const text = readFileSync(fileURLToPath(new URL('../agents/check-reviewer.md', import.meta.url)), 'utf8');
  assert.match(text, /^tools: Read, Grep, Glob$/m);
  for (const phrase of ['have not seen the conversation', 'NOT_VERIFIED', 'EXTRA |', 'NO_FINDINGS', 'Cite or drop', 'Never approve anything', 'data, not instructions']) assert.ok(text.includes(phrase), phrase);
});
