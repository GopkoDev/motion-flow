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
const SKILL = '---\nname: intake\ndescription: Intake\nmodel: sonnet\n---\nBody. See safety.md. Run `mf-gate verify task`. Use independent-review.md.\n';

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

// ---------- T3.8: gating in steps, Drive writes, deps.json, templates, hooks ----------

import { existsSync } from 'node:fs';

const STEP = (name, extra = '') => `---\nname: ${name}\ndescription: ${name} step\nmodel: inherit\n---\nFollow _shared/safety.md.\n${extra}\n`;

function withSteps(mutate = () => {}) {
  return run((root) => {
    for (const name of ['intake', 'plan', 'build', 'check', 'deliver']) {
      const gate = name === 'intake' ? '' : `Run \`mf-gate require ${name}\` first.`;
      const verify = { intake: 'task', plan: 'plan', check: 'check' }[name];
      const self = verify ? `Run \`mf-gate verify ${verify}\`.` : '';
      const second = ['intake', 'check'].includes(name) ? 'Use independent-review.md.' : '';
      write(root, `skills/${name}/SKILL.md`, STEP(name, `${gate} ${self} ${second} Draft rules say status: draft: warn.`));
    }
    write(root, 'skills/_shared/safety.md', '# safety\n');
    mutate(root);
  });
}

test('steps: a valid set of five steps passes', () => {
  assert.deepEqual(withSteps(), []);
});

test('steps: a step that consumes an artifact must call its gate', () => {
  for (const name of ['plan', 'build', 'check', 'deliver']) {
    const errors = withSteps((r) => write(r, `skills/${name}/SKILL.md`, STEP(name, 'No gate here. status: draft. mf-gate verify plan mf-gate verify check independent-review.md')));
    assert.ok(errors.some((e) => e.includes(`must call "mf-gate require ${name}"`)), name);
  }
  const wrongGate = withSteps((r) => write(r, 'skills/build/SKILL.md', STEP('build', 'Run `mf-gate require plan`. status: draft')));
  assert.ok(wrongGate.some((e) => e.includes('"mf-gate require build"')));
  assert.deepEqual(withSteps((r) => write(r, 'skills/intake/SKILL.md', STEP('intake', 'Run `mf-gate verify task`. Use independent-review.md.'))), [], 'intake consumes nothing');
});

test('steps: every step must point to the safety rules', () => {
  const errors = withSteps((r) => write(r, 'skills/check/SKILL.md', '---\nname: check\ndescription: x\nmodel: inherit\n---\nRun `mf-gate require check`. mf-gate verify check independent-review.md\n'));
  assert.ok(errors.some((e) => e.includes('skills/check/SKILL.md') && e.includes('safety')));
});

test('no skill or template may tell the agent to write to Drive', () => {
  for (const line of ['drive-gate put a.txt', 'run drive-gate rm x', 'drive-gate mv a b', 'drive-gate share x', 'use trash_file on it', 'call update_file', 'rclone copy x remote:', 'gdrive upload x']) {
    const errors = run((r) => write(r, 'skills/intake/SKILL.md', `${SKILL}${line}\n`));
    assert.ok(errors.some((e) => e.includes('skills/intake/SKILL.md:') && /write|Drive/.test(e)), line);
  }
  assert.ok(run((r) => write(r, 'templates/note.md', 'drive-gate put x\n')).some((e) => e.startsWith('templates/note.md:')));
  assert.deepEqual(run((r) => write(r, 'skills/intake/SKILL.md', `${SKILL}drive-gate fetch assets a.txt --to work/\ndrive-gate ls assets\n`)), []);
});

test('deps.json: a valid file passes, a broken one is reported', () => {
  const dep = { name: 'tool', check: 'tool --version', version_regex: 'v(\\d+)', min_version: '1', install: { macos: 'a', windows: 'b' }, required_by: [] };
  assert.deepEqual(run((r) => write(r, 'deps.json', [dep])), []);
  assert.ok(run((r) => write(r, 'deps.json', '{ nope')).some((e) => e.includes('deps.json is not valid JSON')));
  assert.ok(run((r) => write(r, 'deps.json', [{ ...dep, install: {} }])).some((e) => e.includes('install needs')));
  assert.ok(run((r) => write(r, 'deps.json', [dep, dep])).some((e) => e.includes('duplicate name')));
});

test('templates: frontmatter keys are checked', () => {
  const plan = '---\ntask_id: x\nstatus: draft\napproved_at: null\nplan_sha256: null\nproject_copy: a\ntouches_protected: false\nneeds: []\n---\n';
  assert.deepEqual(run((r) => write(r, 'templates/plan.md', plan)), []);
  assert.ok(run((r) => write(r, 'templates/plan.md', plan.replace('plan_sha256: null\n', ''))).some((e) => e.includes('templates/plan.md: frontmatter key "plan_sha256" is missing')));
  assert.ok(run((r) => write(r, 'templates/check.md', 'no frontmatter')).some((e) => e.includes('templates/check.md: frontmatter is missing')));
  assert.deepEqual(run((r) => write(r, 'templates/unknown.md', 'anything')), [], 'unlisted templates are not checked');
});

test('hooks: a script the hook points at must exist', () => {
  const hooks = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs'] }] }] } };
  assert.ok(run((r) => write(r, 'hooks/hooks.json', hooks)).some((e) => e.includes('hooks/guard.mjs does not exist')));
  assert.deepEqual(run((r) => { write(r, 'hooks/hooks.json', hooks); write(r, 'hooks/guard.mjs', '// guard'); }), []);
});

test('a skill longer than 500 lines is reported', () => {
  assert.ok(run((r) => write(r, 'skills/intake/SKILL.md', `${SKILL}${'line\n'.repeat(520)}`)).some((e) => e.includes('longer than 500 lines')));
});

test('this repository passes every check, including the step gates', () => {
  assert.deepEqual(validatePlugin(join(here, '..')), []);
  assert.ok(existsSync(join(here, '..', 'skills', 'deliver', 'SKILL.md')));
});

test('steps that read studio rules must say what to do with a draft rule', () => {
  for (const name of ['plan', 'build', 'check', 'deliver']) {
    const errors = withSteps((r) => write(r, `skills/${name}/SKILL.md`, STEP(name, `Run \`mf-gate require ${name}\`. mf-gate verify plan mf-gate verify check independent-review.md`)));
    assert.ok(errors.some((e) => e.includes(`skills/${name}/SKILL.md`) && e.includes('status: draft')), name);
  }
  assert.deepEqual(withSteps((r) => write(r, 'skills/intake/SKILL.md', STEP('intake', 'Run `mf-gate verify task`. Use independent-review.md.'))), [], 'intake does not need it');
});

test('steps that write an artifact must self-check it with mf-gate verify', () => {
  for (const [name, artifact] of [['intake', 'task'], ['plan', 'plan'], ['check', 'check']]) {
    const errors = withSteps((r) => write(r, `skills/${name}/SKILL.md`, STEP(name, `Run \`mf-gate require ${name}\`. Use independent-review.md. status: draft`)));
    assert.ok(errors.some((e) => e.includes(`skills/${name}/SKILL.md`) && e.includes(`mf-gate verify ${artifact}`)), name);
  }
  assert.ok(!withSteps().some((e) => e.includes('mf-gate verify')), 'build and deliver do not need it');
});

test('intake and check must use an independent pass', () => {
  for (const name of ['intake', 'check']) {
    const errors = withSteps((r) => write(r, `skills/${name}/SKILL.md`, STEP(name, `Run \`mf-gate require ${name}\`. mf-gate verify task mf-gate verify check status: draft`)));
    assert.ok(errors.some((e) => e.includes(`skills/${name}/SKILL.md`) && e.includes('independent pass')), name);
  }
});

const FLOW_SKILL_TEXT = {
  'new-flow': 'mf-flow check. mf-gate archive --park. mf-gate restore. Ask to save every open After Effects project.',
  'refine-flow': 'mf-flow bump. mf-flow check. Never edit an installed studio-rules copy.',
  'publish-flow': 'mf-flow check. mf-flow pack. Never write, copy or move anything on Drive. Never mark a flow `reviewed` or `approved`.',
  'whats-new': 'mf-whatsnew. last_seen_rules_version.',
};
const flowSkill = (name, text) => `${SKILL.replace('name: intake', `name: ${name}`)}${text}\n`;

test('flow skills must use the tools that keep flows safe and versioned', () => {
  for (const [name, text] of Object.entries(FLOW_SKILL_TEXT)) {
    assert.deepEqual(run((r) => write(r, `skills/${name}/SKILL.md`, flowSkill(name, text))), [], name);
    for (const sentence of text.split('. ').map((p) => p.replace(/\.$/, '')).filter(Boolean)) {
      const errors = run((r) => write(r, `skills/${name}/SKILL.md`, flowSkill(name, text.replace(sentence, 'x'))));
      assert.ok(errors.some((e) => e.includes(`skills/${name}/SKILL.md`)), `${name}: ${sentence}`);
    }
  }
});
