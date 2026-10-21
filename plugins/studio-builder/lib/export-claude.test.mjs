import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { claudeBlock, exportClaude, readFlows, standaloneSkill } from './export-claude.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
let base; let studio; let target;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sb-export-'));
  studio = join(base, 'studios', 'acme');
  target = join(base, 'designer');
  mkdirSync(join(studio, 'rules'), { recursive: true });
  mkdirSync(target, { recursive: true });
  write(join(studio, 'rules', 'naming.md'), '---\nstatus: draft\n---\n# Naming\n\nVersions end in _v##.\n');
  write(join(studio, 'rules', 'OPEN-QUESTIONS.md'), '# Open questions\n');
  flow(join(studio, 'flows'), 'resize-formats', 'approved');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function flow(dir, name, status = 'draft') {
  write(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Resize a title for all social formats. Use for "resize", "make 9:16", "all formats".\nmodel: inherit\n---\n# ${name}\n\nHow the flow changes the five motion-flow steps.\n`);
  write(join(dir, name, 'flow.md'), `---\nname: ${name}\nversion: 0.2.0\nowner: Anna\nstatus: ${status}\nneeds: []\n---\n## What this flow is for\n\nMake the other social formats from the main comp.\n\n## Inputs\n\nThe main .aep.\n\n## Steps in order\n\n1. Duplicate the main comp.\n2. Set the size.\n\n## Where the designer decides\n\nThe safe zone.\n\n## What must not be touched\n\nThe brand precomp.\n\n## How to tell it is done\n\nAll formats exist.\n`);
}
const text = (rel) => readFileSync(join(target, rel), 'utf8');
const run = (...args) => spawnSync(process.execPath, [join(PLUGIN, 'bin', 'sb-export'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: base, USERPROFILE: base } });

test('readFlows reads the name, status, description and sections of every flow folder', () => {
  const flows = readFlows(join(studio, 'flows'));
  assert.equal(flows.length, 1);
  assert.deepEqual([flows[0].name, flows[0].version, flows[0].status], ['resize-formats', '0.2.0', 'approved']);
  assert.match(flows[0].description, /^Resize a title/);
  assert.equal(flows[0].sections['Steps in order'], '1. Duplicate the main comp.\n2. Set the size.');
  assert.deepEqual(readFlows(join(base, 'nope')), []);
});

test('a standalone skill carries the flow\'s steps and the working rules, and nothing of the pipeline', () => {
  const skill = standaloneSkill(readFlows(join(studio, 'flows'))[0]);
  assert.match(skill, /^---\nname: resize-formats\ndescription: Resize a title/);
  for (const part of ['Make the other social formats', '## Steps in order', '1. Duplicate the main comp.', '## What must not be touched', 'The brand precomp.', '.claude/rules/design-system/', 'Work on a copy of the project']) assert.ok(skill.includes(part), part);
  assert.ok(!/five motion-flow steps|mf-gate|intake/.test(skill), 'no pipeline in a standalone skill');
});

test('the export writes the design system, one skill per flow, a CLAUDE.md block and a manifest', () => {
  const result = exportClaude({ studioDir: studio, studioName: 'acme', target });
  assert.deepEqual(result.flows, ['resize-formats']);
  assert.deepEqual(result.written.sort(), ['.claude/rules/design-system/naming.md', '.claude/skills/resize-formats/SKILL.md', 'CLAUDE.md']);
  assert.equal(text('.claude/rules/design-system/naming.md'), readFileSync(join(studio, 'rules', 'naming.md'), 'utf8'));
  assert.ok(!existsSync(join(target, '.claude/rules/design-system/OPEN-QUESTIONS.md')), 'open questions are not part of the design system');
  const claude = text('CLAUDE.md');
  assert.match(claude, /## Studio: acme/);
  assert.match(claude, /- `\.claude\/rules\/design-system\/naming\.md`/);
  assert.match(claude, /- `\/resize-formats` \(approved, v0\.2\.0\): Resize a title/);
  assert.deepEqual(Object.keys(JSON.parse(text('.claude/studio-export.json')).files).sort(), ['.claude/rules/design-system/naming.md', '.claude/skills/resize-formats/SKILL.md']);
  assert.ok(!existsSync(join(target, '.claude/settings.json')), 'the export never writes settings or permissions');
});

test('exporting again changes nothing, and picks up a changed rule', () => {
  exportClaude({ studioDir: studio, studioName: 'acme', target });
  const again = exportClaude({ studioDir: studio, studioName: 'acme', target });
  assert.deepEqual(again.written, []);
  assert.equal(again.unchanged.length, 3);
  write(join(studio, 'rules', 'naming.md'), '---\nstatus: confirmed\n---\n# Naming\n\nVersions end in _v##.\n');
  assert.deepEqual(exportClaude({ studioDir: studio, studioName: 'acme', target }).written, ['.claude/rules/design-system/naming.md']);
});

test('a file the designer edited is kept, and --force brings the studio\'s version back', () => {
  exportClaude({ studioDir: studio, studioName: 'acme', target });
  write(join(target, '.claude/skills/resize-formats/SKILL.md'), 'my own version\n');
  write(join(studio, 'rules', 'naming.md'), '---\nstatus: confirmed\n---\n# Naming\n');
  const second = exportClaude({ studioDir: studio, studioName: 'acme', target });
  assert.deepEqual(second.kept, ['.claude/skills/resize-formats/SKILL.md']);
  assert.deepEqual(second.written, ['.claude/rules/design-system/naming.md'], 'the untouched rule is still refreshed');
  assert.equal(text('.claude/skills/resize-formats/SKILL.md'), 'my own version\n');
  const forced = exportClaude({ studioDir: studio, studioName: 'acme', target, force: true });
  assert.deepEqual(forced.written, ['.claude/skills/resize-formats/SKILL.md']);
  assert.match(text('.claude/skills/resize-formats/SKILL.md'), /^---\nname: resize-formats/);
});

test('a file that existed before the first export is kept, not overwritten', () => {
  write(join(target, '.claude/rules/design-system/naming.md'), 'the designer\'s own naming rules\n');
  const result = exportClaude({ studioDir: studio, studioName: 'acme', target });
  assert.deepEqual(result.kept, ['.claude/rules/design-system/naming.md']);
  assert.equal(text('.claude/rules/design-system/naming.md'), 'the designer\'s own naming rules\n');
});

test('CLAUDE.md keeps the designer\'s text and only its own block is replaced', () => {
  write(join(target, 'CLAUDE.md'), '# My notes\n\nAlways answer briefly.\n');
  exportClaude({ studioDir: studio, studioName: 'acme', target });
  flow(join(studio, 'flows'), 'new-title', 'draft');
  exportClaude({ studioDir: studio, studioName: 'acme', target });
  const claude = text('CLAUDE.md');
  assert.ok(claude.startsWith('# My notes\n\nAlways answer briefly.\n'));
  assert.equal(claude.split('<!-- studio-builder:start -->').length, 2, 'one block, not two');
  assert.match(claude, /`\/new-title` \(draft/);
});

test('the export refuses the studio folder as target, a missing folder, a folder without rules and duplicate flow names', () => {
  assert.throws(() => exportClaude({ studioDir: studio, target: studio }), /another folder than the studio folder/);
  assert.throws(() => exportClaude({ studioDir: studio, target: join(base, 'nope') }), /does not exist/);
  assert.throws(() => exportClaude({ studioDir: target, target: base }), /not a studio folder/);
  const extra = join(base, 'extra');
  flow(extra, 'resize-formats');
  assert.throws(() => exportClaude({ studioDir: studio, target, extraFlows: [extra] }), /Two flows are named "resize-formats"/);
});

test('draft flows from another folder are exported when asked', () => {
  const drafts = join(base, 'drafts');
  flow(drafts, 'wip-flow');
  const result = exportClaude({ studioDir: studio, studioName: 'acme', target, extraFlows: [drafts] });
  assert.deepEqual(result.flows, ['resize-formats', 'wip-flow']);
  assert.ok(existsSync(join(target, '.claude/skills/wip-flow/SKILL.md')));
});

test('claudeBlock lists the flows and the design system files', () => {
  assert.match(claudeBlock({ studio: 's', rules: [], flows: [] }), /- none yet/);
});

test('CLI: exports by studio name from the studios folder, and says what is wrong', () => {
  const dir = join(base, 'Documents', 'studios', 'acme');
  mkdirSync(join(dir, 'rules'), { recursive: true });
  write(join(dir, 'rules', 'naming.md'), '---\nstatus: draft\n---\n# Naming\n');
  const ok = run('--to', target, '--studio', 'acme');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  assert.ok(existsSync(join(target, '.claude/rules/design-system/naming.md')));
  const unknown = run('--to', target, '--studio', 'nova');
  assert.equal(unknown.status, 1);
  assert.match(JSON.parse(unknown.stdout).error, /Unknown studio "nova"/);
  assert.equal(JSON.parse(run().stdout).ok, false);
});
