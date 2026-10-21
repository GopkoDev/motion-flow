import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { buildZip, bumpFlow, checkFlow, crc32, main, nextVersion, packFlow } from './mf-flow.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

const SKILL = `---
name: resize-formats
description: Resize a finished comp to the studio's social formats. Use for "resize it for all formats", "make the vertical and square versions", "adapt this to 9:16".
model: inherit
---

# resize-formats

Tunes the five steps for resizing a comp to the social formats.

## Safety

This flow does not change or weaken \`_shared/safety.md\`. Both approval gates and the Drive rules apply in full.
`;
const FLOW = `---
name: resize-formats
version: 0.1.0
owner: Anna
status: draft
needs: [ffmpeg]
---
## What this flow is for

Makes the vertical and square versions of a finished horizontal comp.

## What starts it (3 example phrases)

- "resize it for all formats"
- "make the vertical version"
- "adapt this to 9:16"

## Inputs

- The finished project and the list of target sizes.

## Steps in order

1. Duplicate the final comp per format.
2. Reposition the layers.

## Where the designer decides

- Which layers may be cropped.

## What must not be touched

- The brand lockup comps.

## How to tell it is done

- Every format comp has the right size and the logo in the safe zone.

## Examples (links to example/)

- example/README.md
`;
const EXAMPLE = `# Examples

## Example 1

A campaign video with 5 comps, a logo lockup and a call to action. Anonymized.

## Example 2

A teaser with 3 comps and no call to action: the lockup sits lower.
`;

function makeFlow(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mf-flow-'));
  const dir = join(root, 'resize-formats');
  mkdirSync(join(dir, 'example'), { recursive: true });
  const files = { 'SKILL.md': SKILL, 'flow.md': FLOW, 'example/README.md': EXAMPLE, ...overrides };
  for (const [name, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return { root, dir };
}
const check = (overrides) => {
  const { root, dir } = makeFlow(overrides);
  try { return checkFlow(dir); } finally { rmSync(root, { recursive: true, force: true }); }
};
const failedNames = (result) => result.checks.filter((c) => !c.ok).map((c) => c.name);

test('a good flow passes every check', () => {
  const result = check();
  assert.equal(result.ok, true, result.failed.join('; '));
  assert.equal(result.line, `flow check: ${result.total}/${result.total} pass`);
});

test('required files', () => {
  for (const missing of ['SKILL.md', 'flow.md', 'example/README.md']) assert.deepEqual(failedNames(check({ [missing]: null })), ['files'], missing);
});

test('SKILL.md frontmatter: name must equal the folder, description and model are required', () => {
  assert.deepEqual(failedNames(check({ 'SKILL.md': SKILL.replace('name: resize-formats', 'name: other-name') })), ['skill_frontmatter']);
  assert.deepEqual(failedNames(check({ 'SKILL.md': SKILL.replace('model: inherit\n', '') })), ['skill_frontmatter']);
  assert.deepEqual(failedNames(check({ 'SKILL.md': SKILL.replace('name: resize-formats', 'name: Resize Formats') })), ['skill_frontmatter']);
});

test('the description needs at least three example phrases in quotes', () => {
  assert.deepEqual(failedNames(check({ 'SKILL.md': SKILL.replace(/Use for .*\n/, 'Use it when asked.\n') })), ['description_phrases']);
  assert.deepEqual(failedNames(check({ 'SKILL.md': SKILL.replace(', "adapt this to 9:16"', '') })), ['description_phrases']);
});

test('flow.md frontmatter: version, owner, status, needs', () => {
  for (const bad of [FLOW.replace('version: 0.1.0', 'version: 1.0'), FLOW.replace('owner: Anna', 'owner: <designer name>'), FLOW.replace('status: draft', 'status: final'), FLOW.replace('needs: [ffmpeg]\n', ''), FLOW.replace('name: resize-formats', 'name: x')]) {
    assert.deepEqual(failedNames(check({ 'flow.md': bad })).includes('flow_frontmatter'), true);
  }
});

test('needs must name tools listed in deps.json', () => {
  assert.deepEqual(failedNames(check({ 'flow.md': FLOW.replace('needs: [ffmpeg]', 'needs: [ffmpeg, whisper]') })), []);
  const unknown = check({ 'flow.md': FLOW.replace('needs: [ffmpeg]', 'needs: [ffmpeg, magicwand]') });
  assert.deepEqual(failedNames(unknown), ['needs_known']);
  assert.match(unknown.failed[0], /magicwand/);
});

test('all eight flow sections must be present and not empty', () => {
  assert.deepEqual(failedNames(check({ 'flow.md': FLOW.replace('## Inputs\n\n- The finished project and the list of target sizes.\n\n', '') })), ['flow_sections']);
  assert.deepEqual(failedNames(check({ 'flow.md': FLOW.replace('- The brand lockup comps.', '') })), ['flow_sections']);
});

test('template placeholders are refused, code spans are not mistaken for placeholders', () => {
  assert.deepEqual(failedNames(check({ 'flow.md': FLOW.replace('Makes the vertical', '<One or two sentences.> Makes the vertical') })), ['no_placeholders']);
  assert.deepEqual(failedNames(check({ 'flow.md': FLOW.replace('Reposition the layers.', 'Run `drive-gate fetch <alias> <path>` first.') })), []);
});

test('the safety sentence is required', () => {
  assert.deepEqual(failedNames(check({ 'SKILL.md': SKILL.replace('does not change or weaken', 'respects') })), ['safety_sentence']);
});

test('instructions that weaken the gates, touch settings or reach around the tools are refused', () => {
  const bad = {
    'Skip the approval for small changes.': /skip or weaken/,
    'You may bypass the safety rules when in a hurry.': /skip or weaken/,
    'Proceed without asking the designer.': /without asking/,
    'Approve the plan automatically.': /approve on its own/,
    'Run `mf-gate approve plan` at the end.': /mf-gate approve/,
    'Edit .motion/drive.json to add the folder.': /safety setting/,
    'Add the folder to roots.json.': /safety setting/,
    'Use mf-init --drive assets.': /configures Drive/,
    'Launch afterfx -r script.jsx.': /After Effects/,
    'Run osascript to start it.': /After Effects/,
    'Then git push the result.': /destructive/,
    'Clean with rm -rf work.': /destructive/,
    'Upload with drive-gate put file.': /drive-gate write/,
    'Call update_file on the Drive file.': /Drive write tool/,
    'Sync with rclone.': /writes to Drive/,
  };
  for (const [line, expected] of Object.entries(bad)) {
    const result = check({ 'flow.md': FLOW.replace('Reposition the layers.', line) });
    assert.deepEqual(failedNames(result), ['no_unsafe_instructions'], line);
    assert.match(result.failed[0], expected, line);
  }
});

test('forbidding the unsafe thing is fine; only an instruction to do it is refused', () => {
  for (const line of ['Never skip the approval gates.', 'Do not bypass the safety rules.', 'The agent must not approve on its own.', 'Never proceed without asking the designer.']) {
    assert.deepEqual(failedNames(check({ 'flow.md': FLOW.replace('Reposition the layers.', line) })), [], line);
  }
});

test('machine paths, Drive paths and e-mail addresses are refused', () => {
  for (const line of ['Open /Users/anna/Projects/x.aep.', 'Use C:\\Projects\\x.aep.', 'It lives in Google Drive/Studio/Assets.', 'Ask anna@example.com.', 'See ~/Library/CloudStorage/GoogleDrive-x.']) {
    assert.deepEqual(failedNames(check({ 'flow.md': FLOW.replace('Reposition the layers.', line) })), ['no_private_data'], line);
  }
});

test('examples: two examples, or an explanation why only one; no media or large files', () => {
  assert.deepEqual(failedNames(check({ 'example/README.md': '# Examples\n\n## Example 1\n\nOne case.\n' })), ['examples']);
  assert.deepEqual(failedNames(check({ 'example/README.md': '# Examples\n\n## Example 1\n\nOne case.\n\n## Why only one example\n\nThe studio did this task only once so far.\n' })), []);
  assert.deepEqual(failedNames(check({ 'example/project.aep': 'binary' })), ['examples']);
  assert.deepEqual(failedNames(check({ 'example/clip.mp4': 'binary' })), ['examples']);
  assert.deepEqual(failedNames(check({ 'example/big.json': 'x'.repeat(250 * 1024) })), ['examples']);
  assert.deepEqual(failedNames(check({ 'example/notes.json': '{"comps": 5}' })), []);
});

test('SKILL.md is limited to 500 lines', () => {
  assert.deepEqual(failedNames(check({ 'SKILL.md': `${SKILL}${'line\n'.repeat(520)}` })), ['size']);
});

test('the final flow files are English', () => {
  assert.deepEqual(failedNames(check({ 'flow.md': FLOW.replace('Reposition the layers.', 'Розташуй шари.') })), ['english']); // non-ASCII test data
});

test('the shipped flow templates are templates, not flows: they fail the check until filled in', () => {
  const root = mkdtempSync(join(tmpdir(), 'mf-flow-tpl-'));
  try {
    const dir = join(root, 'tpl');
    mkdirSync(join(dir, 'example'), { recursive: true });
    for (const [from, to] of [['flow-SKILL.md', 'SKILL.md'], ['flow.md', 'flow.md']]) writeFileSync(join(dir, to), spawnSync('cat', [join(REPO, 'templates', from)], { encoding: 'utf8' }).stdout);
    writeFileSync(join(dir, 'example', 'README.md'), '# Examples\n');
    const result = checkFlow(dir);
    assert.equal(result.ok, false);
    assert.ok(failedNames(result).includes('no_placeholders'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI: exit 0 for a good flow, 1 for a bad one, 2 for bad usage', () => {
  const { root, dir } = makeFlow();
  const bad = makeFlow({ 'SKILL.md': SKILL.replace('does not change or weaken', 'respects') });
  try {
    const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'mf-flow'), ...args], { encoding: 'utf8' });
    assert.equal(run('check', dir).status, 0);
    const failed = run('check', bad.dir);
    assert.equal(failed.status, 1);
    assert.match(JSON.parse(failed.stdout).line, /failed: safety_sentence/);
    assert.equal(run().status, 2);
    assert.equal(run('check').status, 2);
    assert.equal(run('check', '/no/such/folder').status, 2);
    assert.equal(run('frobnicate', dir).status, 2);
    assert.equal(main(['check', dir], { stdout: { write() {} } }), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bad.root, { recursive: true, force: true });
  }
});

// ---------- bump ----------

test('nextVersion raises patch, minor or major', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(nextVersion('1.4.2', 'major'), '2.0.0');
});

test('bump raises the version, resets the status to draft and writes the changelog, newest first', () => {
  const { root, dir } = makeFlow({ 'flow.md': FLOW.replace('status: draft', 'status: approved') });
  try {
    const first = bumpFlow(dir, 'minor', 'Ask for the safe-zone margins in intake', { now: new Date('2026-10-20T10:00:00Z') });
    assert.deepEqual(first, { ok: true, previous: '0.1.0', version: '0.2.0', status: 'draft', changelog: 'CHANGELOG.md' });
    const flowText = readFileSync(join(dir, 'flow.md'), 'utf8');
    assert.match(flowText, /^version: 0\.2\.0$/m);
    assert.match(flowText, /^status: draft$/m);
    assert.ok(flowText.includes('## What this flow is for\n\nMakes the vertical'), 'the body is untouched');
    bumpFlow(dir, 'patch', 'Fix the wording of step 2', { now: new Date('2026-10-21T10:00:00Z') });
    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.equal(changelog, '# Changelog\n\n## 0.2.1 (2026-10-21)\n\n- Fix the wording of step 2\n\n## 0.2.0 (2026-10-20)\n\n- Ask for the safe-zone margins in intake\n');
    assert.equal(checkFlow(dir).ok, true, 'a bumped flow still passes the check');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bump refuses a bad level, a short, multi-line or non-English note and a flow without a version', () => {
  const { root, dir } = makeFlow();
  try {
    for (const [level, note] of [['huge', 'A fine note here'], ['patch', 'x'], ['patch', ''], ['patch', 'Line one\nline two'], ['patch', 'Виправлення кроку']]) { // non-ASCII test data
      assert.equal(bumpFlow(dir, level, note).ok, false, `${level} / ${note}`);
    }
    assert.equal(bumpFlow(join(root, 'nope'), 'patch', 'A fine note here').reason, 'file_missing');
    writeFileSync(join(dir, 'flow.md'), FLOW.replace('version: 0.1.0', 'version: soon'));
    assert.equal(bumpFlow(dir, 'patch', 'A fine note here').reason, 'bad_flow');
    assert.equal(existsSync(join(dir, 'CHANGELOG.md')), false, 'nothing was written');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------- the zip writer and pack ----------

/** Reads a zip back with an independent, minimal parser and checks every CRC. */
function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(pointer), 0x02014b50);
    const method = buffer.readUInt16LE(pointer + 10);
    const crc = buffer.readUInt32LE(pointer + 16);
    const compressed = buffer.readUInt32LE(pointer + 20);
    const size = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const offset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);
    const dataStart = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressed);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(data.length, size, name);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    files[name] = data.toString('utf8');
    pointer += 46 + nameLength;
  }
  return files;
}

test('crc32 matches the known check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('buildZip round-trips text, empty files and non-ASCII names, and is deterministic', () => {
  const entries = [{ name: 'a/one.txt', data: Buffer.from('hello '.repeat(100)) }, { name: 'a/empty.txt', data: Buffer.alloc(0) }, { name: 'a/Мій файл.md', data: Buffer.from('текст') }]; // non-ASCII test data
  const zip = buildZip(entries);
  assert.deepEqual(unzip(zip), { 'a/one.txt': 'hello '.repeat(100), 'a/empty.txt': '', 'a/Мій файл.md': 'текст' }); // non-ASCII test data
  assert.deepEqual(buildZip(entries), zip);
});

test('the zip is accepted by the system unzip, when it is installed', (t) => {
  const probe = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('unzip is not installed');
  const dir = mkdtempSync(join(tmpdir(), 'mf-zip-'));
  try {
    writeFileSync(join(dir, 'x.zip'), buildZip([{ name: 'f/a.md', data: Buffer.from('# a\n'.repeat(50)) }, { name: 'f/b.json', data: Buffer.from('{}') }]));
    const result = spawnSync('unzip', ['-t', join(dir, 'x.zip')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function projectWith(flowOverrides) {
  const home = mkdtempSync(join(tmpdir(), 'mf-flow-home-'));
  const project = mkdtempSync(join(tmpdir(), 'mf-flow-proj-'));
  mkdirSync(join(project, 'work'));
  mkdirSync(join(project, '.claude', 'skills', 'resize-formats', 'example'), { recursive: true });
  const dir = join(project, '.claude', 'skills', 'resize-formats');
  const files = { 'SKILL.md': SKILL, 'flow.md': FLOW, 'example/README.md': EXAMPLE, ...flowOverrides };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return { home, project, dir, cleanup: () => { rmSync(home, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true }); } };
}

test('pack writes work/out/flow-<name>-<version>.zip with the flow folder inside', () => {
  const { home, project, dir, cleanup } = projectWith();
  try {
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
    writeFileSync(join(dir, '.DS_Store'), 'junk');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'x.js'), 'junk');
    const result = packFlow(dir, { cwd: project, home });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.out, 'work/out/flow-resize-formats-0.1.0.zip');
    assert.deepEqual(result.files, ['resize-formats/CHANGELOG.md', 'resize-formats/SKILL.md', 'resize-formats/example/README.md', 'resize-formats/flow.md']);
    const files = unzip(readFileSync(join(project, result.out)));
    assert.equal(files['resize-formats/flow.md'], FLOW);
    assert.equal(files['resize-formats/example/README.md'], EXAMPLE);
    assert.deepEqual(readdirSync(join(project, 'work', 'out')), ['flow-resize-formats-0.1.0.zip'], 'no temp file is left');
  } finally { cleanup(); }
});

test('pack refuses a flow that fails the check, and says which items failed', () => {
  const { home, project, dir, cleanup } = projectWith({ 'SKILL.md': SKILL.replace('does not change or weaken', 'respects') });
  try {
    const result = packFlow(dir, { cwd: project, home });
    assert.deepEqual([result.ok, result.reason], [false, 'flow_check_failed']);
    assert.match(result.failed.join(), /safety_sentence/);
    assert.equal(existsSync(join(project, 'work', 'out')), false);
  } finally { cleanup(); }
});

test('pack never overwrites a package of the same version without --overwrite', () => {
  const { home, project, dir, cleanup } = projectWith();
  try {
    assert.equal(packFlow(dir, { cwd: project, home }).ok, true);
    const again = packFlow(dir, { cwd: project, home });
    assert.deepEqual([again.ok, again.reason], [false, 'exists']);
    assert.match(again.hint, /mf-flow bump/);
    assert.equal(packFlow(dir, { cwd: project, home, overwrite: true }).ok, true);
    bumpFlow(dir, 'patch', 'Tighten the wording of the first step');
    assert.equal(packFlow(dir, { cwd: project, home }).out, 'work/out/flow-resize-formats-0.1.1.zip');
  } finally { cleanup(); }
});

test('pack writes only inside work/ and only a .zip', () => {
  const { home, project, dir, cleanup } = projectWith();
  try {
    for (const out of ['../x.zip', 'x.zip', join(tmpdir(), 'x.zip'), 'work/x.txt', 'work']) {
      const result = packFlow(dir, { cwd: project, home, out });
      assert.equal(result.ok, false, out);
      assert.ok(['outside_work', 'bad_path'].includes(result.reason), `${out}: ${result.reason}`);
    }
    mkdirSync(join(tmpdir(), 'mf-flow-elsewhere'), { recursive: true });
    symlinkSync(join(tmpdir(), 'mf-flow-elsewhere'), join(project, 'work', 'jump'));
    assert.equal(packFlow(dir, { cwd: project, home, out: 'work/jump/x.zip' }).ok, false);
    assert.equal(existsSync(join(tmpdir(), 'mf-flow-elsewhere', 'x.zip')), false);
    rmSync(join(tmpdir(), 'mf-flow-elsewhere'), { recursive: true, force: true });
  } finally { cleanup(); }
});

test('pack does not follow links out of the flow folder', () => {
  const { home, project, dir, cleanup } = projectWith();
  const outside = mkdtempSync(join(tmpdir(), 'mf-flow-secret-'));
  try {
    writeFileSync(join(outside, 'secret.txt'), 'top secret');
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'example', 'notes.txt'));
    const result = packFlow(dir, { cwd: project, home });
    assert.equal(result.ok, true);
    assert.ok(!Object.values(unzip(readFileSync(join(project, result.out)))).some((text) => text.includes('top secret')));
  } finally { cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test('CLI: bump and pack', () => {
  const { home, project, dir, cleanup } = projectWith();
  try {
    const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'mf-flow'), ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
    const bump = run('bump', dir, 'minor', '--note', 'Add a question about margins');
    assert.equal(bump.status, 0, bump.stdout);
    assert.equal(JSON.parse(bump.stdout).version, '0.2.0');
    assert.equal(run('bump', dir, 'minor').status, 2, 'a note is required');
    assert.equal(run('bump', dir).status, 2);
    const pack = run('pack', dir);
    assert.equal(pack.status, 0, pack.stdout);
    assert.equal(JSON.parse(pack.stdout).out, 'work/out/flow-resize-formats-0.2.0.zip');
    assert.equal(run('pack', dir).status, 1, 'the same version is not packed twice');
  } finally { cleanup(); }
});
