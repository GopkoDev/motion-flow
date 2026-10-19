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
  'task.md': { keys: ['id', 'type', 'flow', 'status', 'inputs', 'deadline'], headings: ['## Опис', '## Критерії готовності', '## Що відомо / припущення', '## Відкриті питання'] },
  'plan.md': { keys: ['task_id', 'status', 'approved_at', 'plan_sha256', 'project_copy', 'touches_protected', 'needs'], headings: ['## Кроки', '## Не охоплено планом', '## Ризики', '## Питання до людини'] },
  'check.md': { keys: ['task_id', 'verdict', 'approved', 'approved_at'], headings: ['## Звірка з планом', '## Критерії готовності', '## Lint', '## Кадри', '## Незалежна перевірка', '## Відкриті питання'] },
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
  assert.deepEqual(files, ['CLAUDE.project.md', 'check.md', 'deliver.md', 'flow-SKILL.md', 'flow.md', 'gitignore.project', 'overrides.md', 'plan.md', 'roots.example.json', 'settings.project.json', 'studio-rules', 'task.md']);
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

// ---------- the studio-rules scaffold (T4.1) ----------

import { existsSync } from 'node:fs';
import { loadChecks } from '../lib/ae-lint.mjs';
import { compilePattern, nextVersionName, patternFromNamingFile } from '../lib/aep-version.mjs';

const SCAFFOLD = fileURLToPath(new URL('../templates/studio-rules/', import.meta.url));
const scaffold = (name) => readFileSync(join(SCAFFOLD, name), 'utf8');
const RULE_FILES = ['naming.md', 'motion-system.md', 'protected.md', 'delivery.md', 'drive.md'];

test('the scaffold has a valid plugin manifest and an index skill with the required frontmatter', () => {
  const manifest = JSON.parse(scaffold('.claude-plugin/plugin.json'));
  assert.equal(manifest.name, 'studio-rules');
  const front = parseFrontmatter(scaffold('skills/studio-rules/SKILL.md'));
  for (const key of ['name', 'description', 'model']) assert.ok(front[key], key);
  assert.equal(front.name, 'studio-rules');
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
  const text = scaffold('skills/studio-rules/SKILL.md');
  for (const name of RULE_FILES) assert.ok(text.includes(`rules/${name}`), name);
  for (const item of ['rules/project-template/', 'rules/checks/', 'flows/', 'CHANGELOG.md']) assert.ok(text.includes(item), item);
  for (const row of [/naming\.md.*build, check/, /project-template.*intake, build/, /motion-system.*plan, build/, /protected\.md.*plan, build/, /delivery\.md.*\| deliver/, /drive\.md.*\| deliver/, /checks\/.*\| check/, /flows\/.*\| intake/]) assert.match(text, row);
  assert.match(text, /status: draft/);
  assert.match(text, /Never turn a draft into `confirmed` yourself/);
  assert.ok(text.includes('${CLAUDE_PLUGIN_ROOT}/rules/'));
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
  assert.match(scaffold('README.md'), /init-rules/);
});

test('the scaffold is also its own catalog: one plugin, same name, relative source', () => {
  const plugin = JSON.parse(scaffold('.claude-plugin/plugin.json'));
  const catalog = JSON.parse(scaffold('.claude-plugin/marketplace.json'));
  assert.equal(catalog.plugins.length, 1);
  assert.equal(catalog.plugins[0].name, plugin.name, 'entry name equals the manifest name');
  assert.equal(catalog.plugins[0].source, './');
  assert.ok(catalog.owner.name);
});

test('the readme explains the local install, one studio per project, and the unique plugin name', () => {
  const text = scaffold('README.md');
  for (const phrase of ['/plugin marketplace add', '--scope project', '<studio>-rules', 'freelancer', 'never at user scope', '/reload-plugins']) assert.ok(text.includes(phrase), phrase);
});

test('init-rules tells the agent to give the plugin a unique <slug>-rules name in the manifest and the catalog', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/init-rules/SKILL.md', import.meta.url)), 'utf8');
  for (const phrase of ['<slug>-rules', 'marketplace.json', 'unique on this computer', 'must not start with `claude` or `anthropic`']) assert.ok(text.includes(phrase), phrase);
});

test('init-project asks which studio rules apply and explains the one-time install', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/init-project/SKILL.md', import.meta.url)), 'utf8');
  for (const phrase of ['--rules', '--no-rules', 'claude plugin install', 'exactly one studio']) assert.ok(text.includes(phrase), phrase);
});

test('after the init-rules renames, the scaffold passes claude plugin validate (when the CLI is available)', (t) => {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('the claude CLI is not installed');
  const dir = mkdtempSync(join(tmpdir(), 'mf-scaffold-'));
  try {
    cpSync(SCAFFOLD, dir, { recursive: true });
    for (const name of ['plugin.json', 'marketplace.json']) {
      const file = join(dir, '.claude-plugin', name);
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('"name": "studio-rules"', '"name": "acme-rules"').replaceAll('<studio name>', 'Acme'));
    }
    for (const target of [dir, join(dir, '.claude-plugin', 'plugin.json')]) {
      const result = spawnSync('claude', ['plugin', 'validate', target], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${target}\n${result.stdout}${result.stderr}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the task, plan and check templates carry the criteria columns and rows the gate traces', () => {
  assert.match(read('task.md'), /- AC1: /);
  assert.match(read('plan.md'), /\| Кадр для перевірки \| Критерії \|/);
  assert.match(read('check.md'), /\| AC \| Доказ \| Вердикт \|/);
});

test('intake, plan and check tell the agent to self-check and, for intake and check, to use an independent pass', () => {
  const skill = (name) => readFileSync(fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)), 'utf8');
  for (const [name, artifact] of [['intake', 'task'], ['plan', 'plan'], ['check', 'check']]) assert.match(skill(name), new RegExp(`mf-gate verify ${artifact}`), name);
  for (const name of ['intake', 'check']) assert.match(skill(name), /independent-review\.md/, name);
  assert.match(skill('intake'), /acceptance criteria/i);
  assert.match(skill('plan'), /Every criterion needs a step, and every step needs a criterion/);
  assert.match(skill('check'), /NOT_VERIFIED/);
});

test('the independent-review doc holds both prompts and the rules for a sub-agent', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/_shared/independent-review.md', import.meta.url)), 'utf8');
  for (const phrase of ['Prompt for `intake`', 'Prompt for `check`', 'NO_FINDINGS', 'cite its evidence', 'read-only', 'never pick the friendlier verdict silently']) assert.ok(text.includes(phrase), phrase);
});
