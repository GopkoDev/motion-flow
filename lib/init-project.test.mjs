import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { applyPlan, buildSettings, formatPlan, planInit, ruleGlob } from './init-project.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
let base; let home; let drive; let project;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mf-init-'));
  home = join(base, 'home');
  drive = join(base, 'Drive', 'Assets');
  project = join(base, 'project');
  for (const dir of [home, join(home, '.motion-flow'), drive, project]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, '.motion-flow', 'roots.json'), JSON.stringify({ roots: { assets: drive } }));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const settingsOf = () => JSON.parse(readFileSync(join(project, '.claude', 'settings.json'), 'utf8'));

test('ruleGlob builds absolute permission paths', () => {
  assert.equal(ruleGlob('/Users/a/Drive'), '//Users/a/Drive/**');
});

test('buildSettings replaces the placeholders with one Read and one Edit rule per folder', () => {
  const template = JSON.parse(readFileSync(join(REPO, 'templates', 'settings.project.json'), 'utf8'));
  const settings = buildSettings(template, ['/d/One', '/d/Two']);
  assert.ok(settings.permissions.deny.includes('Read(//d/One/**)'));
  assert.ok(settings.permissions.deny.includes('Edit(//d/Two/**)'));
  assert.ok(!settings.permissions.deny.some((rule) => rule.includes('REPLACE')));
  assert.ok(settings.permissions.deny.includes('Edit(~/.motion-flow/**)'), 'fixed rules are kept');
});

test('init creates settings, CLAUDE.md, state, .gitignore and work/', () => {
  applyPlan(planInit({ projectDir: project, home }));
  const settings = settingsOf();
  assert.ok(settings.permissions.deny.some((rule) => rule.startsWith('Read(//') && rule.includes('Drive/Assets')));
  assert.ok(!JSON.stringify(settings).includes('REPLACE'));
  assert.match(readFileSync(join(project, 'CLAUDE.md'), 'utf8'), /drive-gate/);
  assert.deepEqual(JSON.parse(readFileSync(join(project, '.motion', 'state.json'), 'utf8')), { last_seen_rules_version: '', commit_artifacts: false });
  assert.deepEqual(readFileSync(join(project, '.gitignore'), 'utf8').split('\n').filter(Boolean), ['work/', '.motion/state.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(project, '.motion', 'drive.json'), 'utf8')), { aliases: [] }, 'default: no Drive in the project');
  assert.ok(existsSync(join(project, 'work')));
});

test('init never overwrites existing files and appends only missing .gitignore lines', () => {
  mkdirSync(join(project, '.claude'));
  writeFileSync(join(project, '.claude', 'settings.json'), '{"mine":true}');
  writeFileSync(join(project, 'CLAUDE.md'), 'my notes');
  writeFileSync(join(project, '.gitignore'), 'node_modules\nwork/');
  applyPlan(planInit({ projectDir: project, home }));
  assert.equal(readFileSync(join(project, '.claude', 'settings.json'), 'utf8'), '{"mine":true}');
  assert.equal(readFileSync(join(project, 'CLAUDE.md'), 'utf8'), 'my notes');
  assert.equal(readFileSync(join(project, '.gitignore'), 'utf8'), 'node_modules\nwork/\n.motion/state.json\n');
});

test('running init twice changes nothing the second time', () => {
  applyPlan(planInit({ projectDir: project, home }));
  const snapshot = (dir) => readdirSync(dir, { recursive: true }).sort().map((n) => `${n}`).join(',');
  const before = snapshot(project);
  const content = readFileSync(join(project, '.claude', 'settings.json'), 'utf8');
  const plan = planInit({ projectDir: project, home });
  assert.ok(plan.actions.every((a) => a.kind === 'skip'));
  applyPlan(plan);
  assert.equal(snapshot(project), before);
  assert.equal(readFileSync(join(project, '.claude', 'settings.json'), 'utf8'), content);
});

test('planning writes nothing (dry run)', () => {
  const plan = planInit({ projectDir: project, home });
  assert.deepEqual(readdirSync(project), []);
  assert.match(formatPlan(plan, false), /will create\s+\.claude\/settings\.json|will create\s+\.claude[\\/]settings\.json/);
});

test('init refuses a project folder inside a Drive folder', () => {
  const inDrive = join(drive, 'myproject');
  mkdirSync(inDrive);
  assert.throws(() => planInit({ projectDir: inDrive, home }), /inside a Google Drive folder/);
});

test('the project settings produced by init pass the doctor settings check', async () => {
  const { checkProjectSettings } = await import('./doctor.mjs');
  applyPlan(planInit({ projectDir: project, home }));
  assert.deepEqual(checkProjectSettings(project, { assets: drive }), { name: 'project settings.json', status: 'ok', details: [] });
});

test('CLI: --dry-run writes nothing, real run creates files', () => {
  const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'mf-init'), '--project', project, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  const dry = run('--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run: nothing was written/);
  assert.deepEqual(readdirSync(project), []);
  assert.equal(run().status, 0);
  assert.ok(existsSync(join(project, '.claude', 'settings.json')));
});

test('no Drive config on the computer is fine: the project simply has no Drive', async () => {
  rmSync(join(home, '.motion-flow', 'roots.json'));
  const plan = planInit({ projectDir: project, home });
  assert.deepEqual(plan.aliases, []);
  assert.match(formatPlan(plan, true), /Drive is not used in this project.*into the work\/ folder/);
  applyPlan(plan);
  const settings = settingsOf();
  assert.ok(!JSON.stringify(settings).includes('REPLACE'));
  assert.ok(!settings.permissions.deny.some((rule) => /^(Read|Edit)\(\/\//.test(rule)));
  assert.ok(settings.permissions.deny.includes('Edit(~/.motion-flow/**)'));
  assert.match(readFileSync(join(project, 'CLAUDE.md'), 'utf8'), /copies them there by hand/);
  const { checkProjectSettings } = await import('./doctor.mjs');
  assert.equal(checkProjectSettings(project, {}).status, 'ok');
  assert.throws(() => planInit({ projectDir: project, home, drive: ['assets'] }), /No Google Drive folders are set up/);
});

test('--drive enables chosen folders for this project only; unknown names are refused', () => {
  assert.throws(() => planInit({ projectDir: project, home, drive: ['ghost'] }), /Unknown Drive folder\(s\): ghost/);
  const plan = planInit({ projectDir: project, home, drive: ['assets'] });
  assert.deepEqual(plan.aliases, ['assets']);
  applyPlan(plan);
  assert.deepEqual(JSON.parse(readFileSync(join(project, '.motion', 'drive.json'), 'utf8')), { aliases: ['assets'] });
  assert.match(formatPlan(plan, true), /may read \(through drive-gate\): assets/);
});

test('the Drive choice can be changed later; an unchanged choice is skipped; no flag leaves it alone', () => {
  applyPlan(planInit({ projectDir: project, home, drive: [] }));
  const driveFile = join(project, '.motion', 'drive.json');
  const change = planInit({ projectDir: project, home, drive: ['assets'] });
  assert.equal(change.actions.find((a) => a.path === driveFile).kind, 'update');
  applyPlan(change);
  assert.deepEqual(JSON.parse(readFileSync(driveFile, 'utf8')), { aliases: ['assets'] });
  assert.equal(planInit({ projectDir: project, home, drive: ['assets'] }).actions.find((a) => a.path === driveFile).reason, 'already set to this choice');
  const keep = planInit({ projectDir: project, home });
  assert.equal(keep.actions.find((a) => a.path === driveFile).kind, 'skip');
  assert.deepEqual(keep.aliases, ['assets']);
  applyPlan(planInit({ projectDir: project, home, drive: [] }));
  assert.deepEqual(JSON.parse(readFileSync(driveFile, 'utf8')), { aliases: [] });
});

test('two projects can make different Drive choices', () => {
  const second = join(base, 'second');
  mkdirSync(second);
  applyPlan(planInit({ projectDir: project, home, drive: ['assets'] }));
  applyPlan(planInit({ projectDir: second, home, drive: [] }));
  assert.deepEqual(JSON.parse(readFileSync(join(project, '.motion', 'drive.json'), 'utf8')).aliases, ['assets']);
  assert.deepEqual(JSON.parse(readFileSync(join(second, '.motion', 'drive.json'), 'utf8')).aliases, []);
});

test('CLI: --drive, --no-drive and their conflict', () => {
  const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'mf-init'), '--project', project, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(run('--drive', 'assets', '--no-drive').status, 1);
  assert.equal(run('--drive', 'ghost').status, 1);
  assert.equal(run('--drive', 'assets').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(project, '.motion', 'drive.json'), 'utf8')).aliases, ['assets']);
  assert.equal(run('--no-drive').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(project, '.motion', 'drive.json'), 'utf8')).aliases, []);
});

// ---------- studio rules plugin per project ----------

test('--rules enables the studio rules plugin in a new settings.json, next to motion-flow', () => {
  const plan = planInit({ projectDir: project, home, rules: 'acme-rules@acme-rules' });
  assert.equal(plan.rules, 'acme-rules@acme-rules');
  applyPlan(plan);
  assert.deepEqual(settingsOf().enabledPlugins, { 'motion-flow@motion': true, 'acme-rules@acme-rules': true });
  assert.match(formatPlan(plan, true), /Studio rules plugin enabled for this project: acme-rules@acme-rules.*claude plugin install acme-rules@acme-rules --scope project/);
});

test('without --rules (or with undefined) only motion-flow is enabled and no rules line is printed', () => {
  const plan = planInit({ projectDir: project, home });
  applyPlan(plan);
  assert.deepEqual(settingsOf().enabledPlugins, { 'motion-flow@motion': true });
  assert.ok(!/Studio rules plugin/.test(formatPlan(plan, true)));
  assert.equal(plan.rules, null);
});

test('--rules with a bad id is refused', () => {
  for (const id of ['acme-rules', '@x', 'a@', 'a b@c', 'a@b@c', '../x@y', '']) {
    assert.throws(() => planInit({ projectDir: project, home, rules: id }), /is not a plugin id/, id);
  }
});

test('--rules on an existing settings.json adds the plugin and keeps everything else', () => {
  mkdirSync(join(project, '.claude'));
  const own = { permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'motion-flow@motion': true, 'other@x': false }, env: { A: '1' } };
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify(own));
  const plan = planInit({ projectDir: project, home, rules: 'acme-rules@acme-rules' });
  const action = plan.actions.find((a) => a.path.endsWith('settings.json'));
  assert.equal(action.kind, 'update');
  applyPlan(plan);
  assert.deepEqual(settingsOf(), { ...own, enabledPlugins: { ...own.enabledPlugins, 'acme-rules@acme-rules': true } });
});

test('--rules on an existing settings.json that already has it changes nothing; without --rules the file is never touched', () => {
  mkdirSync(join(project, '.claude'));
  const file = join(project, '.claude', 'settings.json');
  writeFileSync(file, JSON.stringify({ enabledPlugins: { 'acme-rules@acme-rules': true } }));
  const same = planInit({ projectDir: project, home, rules: 'acme-rules@acme-rules' });
  assert.equal(same.actions.find((a) => a.path === file).reason, 'studio rules already enabled');
  const untouched = planInit({ projectDir: project, home });
  assert.equal(untouched.actions.find((a) => a.path === file).kind, 'skip');
  const before = readFileSync(file, 'utf8');
  applyPlan(untouched);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('--rules refuses an existing settings.json that is not valid JSON', () => {
  mkdirSync(join(project, '.claude'));
  writeFileSync(join(project, '.claude', 'settings.json'), '{ nope');
  assert.throws(() => planInit({ projectDir: project, home, rules: 'acme-rules@acme-rules' }), /not valid JSON/);
  assert.equal(readFileSync(join(project, '.claude', 'settings.json'), 'utf8'), '{ nope');
});

test('two studios in two projects on one computer stay separate', () => {
  const second = join(base, 'second-studio');
  mkdirSync(second);
  applyPlan(planInit({ projectDir: project, home, rules: 'acme-rules@acme-rules' }));
  applyPlan(planInit({ projectDir: second, home, rules: 'beta-rules@beta-rules' }));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(second, '.claude', 'settings.json'), 'utf8')).enabledPlugins).sort(), ['beta-rules@beta-rules', 'motion-flow@motion']);
  assert.ok(!('beta-rules@beta-rules' in settingsOf().enabledPlugins));
});

test('the settings with a rules plugin still pass the doctor settings check', async () => {
  const { checkProjectSettings } = await import('./doctor.mjs');
  applyPlan(planInit({ projectDir: project, home, rules: 'acme-rules@acme-rules' }));
  assert.deepEqual(checkProjectSettings(project, { assets: drive }), { name: 'project settings.json', status: 'ok', details: [] });
});

test('CLI: --rules, --no-rules and their conflict', () => {
  const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'mf-init'), '--project', project, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(run('--rules', 'acme-rules@acme-rules', '--no-rules').status, 1);
  assert.equal(run('--rules', 'bad').status, 1);
  const ok = run('--rules', 'acme-rules@acme-rules');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(settingsOf().enabledPlugins['acme-rules@acme-rules'], true);
  assert.equal(run('--no-rules').status, 0);
  assert.equal(settingsOf().enabledPlugins['acme-rules@acme-rules'], true, '--no-rules leaves the file alone');
});

test('a new project lets the plugin tools and file edits run without a prompt', () => {
  applyPlan(planInit({ projectDir: project, home }));
  const { permissions } = settingsOf();
  assert.equal(permissions.defaultMode, 'acceptEdits');
  for (const tool of ['mf-gate', 'ae-run', 'ae-dump', 'ae-render-frame', 'ae-lint', 'aep-version', 'mf-sum', 'mf-flow']) {
    assert.ok(permissions.allow.includes(`Bash(${tool} *)`), tool);
  }
  assert.ok(permissions.ask.includes('Bash(git push *)'), 'dangerous git still asks');
});

test('--update-permissions adds the allow rules to an older settings.json and keeps the user\'s own', () => {
  mkdirSync(join(project, '.claude'));
  const own = { permissions: { allow: ['Bash(ls)'], defaultMode: 'default' }, env: { A: '1' } };
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify(own));
  const plan = planInit({ projectDir: project, home, permissions: true });
  assert.equal(plan.actions.find((a) => a.path.endsWith('settings.json')).kind, 'update');
  applyPlan(plan);
  const after = settingsOf();
  assert.equal(after.permissions.defaultMode, 'default', 'the user\'s mode is kept');
  assert.ok(after.permissions.allow.includes('Bash(ls)') && after.permissions.allow.includes('Bash(mf-gate *)'));
  assert.deepEqual(after.env, own.env);
  const again = planInit({ projectDir: project, home, permissions: true });
  assert.equal(again.actions.find((a) => a.path.endsWith('settings.json')).kind, 'skip', 'running it twice changes nothing');
});
