// The project templates must stay valid and consistent with docs/schemas-notes.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
