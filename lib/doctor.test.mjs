import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  checkDependency, checkDriveGateConfig, checkProjectSettings, checkWhisperModel, compareVersions, currentOs, extractVersion,
  flowNeeds, formatReport, parseDeps, recommendWhisperModel, runDoctor,
} from './doctor.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const dep = (overrides = {}) => ({
  name: 'tool', check: 'tool --version', version_regex: 'v(\\d+(?:\\.\\d+)*)', min_version: '2.0',
  install: { macos: 'brew install tool', windows: 'winget install tool' }, required_by: ['build'], ...overrides,
});
const tmp = () => mkdtempSync(join(tmpdir(), 'mf-doctor-'));

// ---------- deps.json ----------

test('the shipped deps.json is valid and lists the expected tools', () => {
  const deps = parseDeps(readFileSync(join(REPO, 'deps.json'), 'utf8'));
  const names = deps.map((d) => d.name);
  for (const name of ['node', 'ffmpeg', 'after-effects', 'whisper']) assert.ok(names.includes(name), name);
  assert.equal(deps.find((d) => d.name === 'whisper').optional, true);
  assert.equal(deps.find((d) => d.name === 'node').min_version, '24.0.0');
  assert.ok(!names.includes('git'));
  assert.equal(deps.find((d) => d.name === 'whisper').check, 'whisper-cli --help');
});

test('parseDeps rejects malformed files with a readable message', () => {
  assert.throws(() => parseDeps('{ nope'), /not valid JSON/);
  assert.throws(() => parseDeps('{}'), /must be an array/);
  assert.throws(() => parseDeps('[1]'), /must be an object/);
  assert.throws(() => parseDeps(JSON.stringify([{ ...dep(), name: '' }])), /name is required/);
  assert.throws(() => parseDeps(JSON.stringify([dep(), dep()])), /duplicate name/);
  assert.throws(() => parseDeps(JSON.stringify([{ ...dep(), min_version: 'v2' }])), /min_version/);
  assert.throws(() => parseDeps(JSON.stringify([{ ...dep(), version_regex: '(' }])), /not a valid regex/);
  assert.throws(() => parseDeps(JSON.stringify([{ ...dep(), install: { macos: 'x' } }])), /install needs/);
  assert.throws(() => parseDeps(JSON.stringify([{ ...dep(), required_by: 'build' }])), /required_by/);
});

// ---------- versions ----------

test('compareVersions orders dotted versions numerically', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('18', '18.0.0'), 0);
  assert.equal(compareVersions('5.1', '6'), -1);
  assert.equal(compareVersions('24.0.1', '24'), 1);
});

test('extractVersion reads the first capture group', () => {
  assert.equal(extractVersion('v22.4.1\n', 'v(\\d+\\.\\d+\\.\\d+)'), '22.4.1');
  assert.equal(extractVersion('ffmpeg version n6.1.1-static', 'ffmpeg version n?(\\d+(?:\\.\\d+)*)'), '6.1.1');
  assert.equal(extractVersion('garbage', 'v(\\d+)'), null);
  assert.equal(extractVersion('v1', null), null);
});

// ---------- one dependency ----------

test('checkDependency: ok, old, missing, unknown, manual', async () => {
  const run = (output, ok = true) => async () => ({ ok, output });
  assert.equal((await checkDependency(dep(), run('v2.1'))).status, 'ok');
  assert.equal((await checkDependency(dep(), run('v1.9'))).status, 'old');
  assert.equal((await checkDependency(dep(), run('', false))).status, 'missing');
  assert.equal((await checkDependency(dep(), run('no version here'))).status, 'unknown');
  assert.equal((await checkDependency(dep({ check: null }), run('x'))).status, 'manual');
  assert.equal((await checkDependency(dep({ min_version: null }), run('whatever'))).status, 'ok');
});

test('checkDependency returns the install command for the chosen OS', async () => {
  const result = await checkDependency(dep(), async () => ({ ok: false, output: '' }), 'windows');
  assert.equal(result.install, 'winget install tool');
  assert.equal(currentOs('win32'), 'windows');
  assert.equal(currentOs('darwin'), 'macos');
});

// ---------- configuration checks ----------

test('drive-gate config check: missing, broken, unavailable folder, ok', () => {
  const home = tmp();
  try {
    assert.equal(checkDriveGateConfig(home).status, 'problem');
    mkdirSync(join(home, '.motion-flow'));
    writeFileSync(join(home, '.motion-flow', 'roots.json'), '{ nope');
    assert.match(checkDriveGateConfig(home).details[0], /not valid JSON/);
    writeFileSync(join(home, '.motion-flow', 'roots.json'), JSON.stringify({ roots: { assets: join(home, 'missing') } }));
    assert.match(checkDriveGateConfig(home).details[0], /not available/);
    mkdirSync(join(home, 'Assets'));
    writeFileSync(join(home, '.motion-flow', 'roots.json'), JSON.stringify({ roots: { assets: join(home, 'Assets') } }));
    assert.equal(checkDriveGateConfig(home).status, 'ok');
    writeFileSync(join(home, '.motion-flow', 'roots.json'), JSON.stringify({ roots: {} }));
    assert.match(checkDriveGateConfig(home).details[0], /no aliases/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('project settings check finds missing deny rules and the placeholder', () => {
  const project = tmp();
  try {
    assert.match(checkProjectSettings(project).details[0], /not found/);
    mkdirSync(join(project, '.claude'));
    const write = (settings) => writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify(settings));
    write({});
    const empty = checkProjectSettings(project, { assets: '/Drive/Assets' });
    assert.equal(empty.status, 'problem');
    assert.ok(empty.details.some((d) => d.includes('trash_file')));
    assert.ok(empty.details.some((d) => d.includes('/Drive/Assets')));
    const template = JSON.parse(readFileSync(join(REPO, 'templates', 'settings.project.json'), 'utf8'));
    write(template);
    assert.ok(checkProjectSettings(project, {}).details.some((d) => d.includes('REPLACE')));
    template.permissions.deny = template.permissions.deny.map((rule) => rule.replace('REPLACE/WITH/ABSOLUTE/DRIVE/ROOT', 'Drive/Assets'));
    write(template);
    assert.deepEqual(checkProjectSettings(project, { assets: '/Drive/Assets' }), { name: 'project settings.json', status: 'ok', details: [] });
  } finally { rmSync(project, { recursive: true, force: true }); }
});

// ---------- flows ----------

test('flowNeeds reads the needs list and --flow limits the checked dependencies', async () => {
  const flows = tmp();
  try {
    mkdirSync(join(flows, 'resize'));
    writeFileSync(join(flows, 'resize', 'SKILL.md'), '---\nname: resize\ndescription: x\nneeds: [ffmpeg, "whisper"]\n---\n');
    assert.deepEqual(flowNeeds('resize', [flows]), ['ffmpeg', 'whisper']);
    assert.throws(() => flowNeeds('nope', [flows]), /not found/);
    const report = await runDoctor({ flow: 'resize', flowDirs: [flows], run: async () => ({ ok: true, output: 'ffmpeg version 6.0' }), home: flows, projectDir: flows });
    assert.deepEqual(report.dependencies.map((d) => d.name), ['ffmpeg', 'whisper']);
    assert.deepEqual(report.checks.map((c) => c.name), ['whisper model']); // the flow needs whisper; no project-wide checks
  } finally { rmSync(flows, { recursive: true, force: true }); }
});

// ---------- the report and the read-only guarantee ----------

test('formatReport shows a status table and install commands only for missing or old items', async () => {
  const report = await runDoctor({
    home: tmp(), projectDir: tmp(), os: 'macos',
    run: async (command) => (command.startsWith('ffmpeg') ? { ok: false, output: '' } : { ok: true, output: 'v99.0.0 git version 9.9 claude' }),
  });
  const text = formatReport(report);
  assert.match(text, /ffmpeg\s+MISSING/);
  assert.match(text, /brew install ffmpeg/);
  assert.ok(!/brew install node/.test(text));
  assert.equal(report.ok, false);
});

test('doctor writes nothing to disk', async () => {
  const home = tmp();
  const project = tmp();
  const list = (dir) => readdirSync(dir, { recursive: true }).map((name) => `${name}:${statSync(join(dir, name)).mtimeMs}`);
  try {
    const before = [list(home), list(project), list(REPO).filter((e) => !e.startsWith('_temp') && !e.startsWith('.git/'))];
    await runDoctor({ home, projectDir: project, run: async () => ({ ok: false, output: '' }) });
    const after = [list(home), list(project), list(REPO).filter((e) => !e.startsWith('_temp') && !e.startsWith('.git/'))];
    assert.deepEqual(after, before);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('CLI: runs, prints a table and exits non-zero while setup is incomplete; --json is parseable', () => {
  const project = tmp();
  try {
    const text = spawnSync(process.execPath, [join(REPO, 'bin', 'mf-doctor'), '--project', project], { encoding: 'utf8', env: { ...process.env, HOME: project, USERPROFILE: project } });
    assert.equal(text.status, 1);
    assert.match(text.stdout, /Dependencies/);
    assert.match(text.stdout, /drive-gate config: PROBLEM/);
    const json = spawnSync(process.execPath, [join(REPO, 'bin', 'mf-doctor'), '--project', project, '--json'], { encoding: 'utf8', env: { ...process.env, HOME: project, USERPROFILE: project } });
    assert.equal(JSON.parse(json.stdout).os.length > 0, true);
    const bad = spawnSync(process.execPath, [join(REPO, 'bin', 'mf-doctor'), '--flow', 'nope', '--project', project], { encoding: 'utf8', env: { ...process.env, HOME: project } });
    assert.equal(bad.status, 2);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

// ---------- whisper model choice ----------

test('recommendWhisperModel picks the largest model within half of the RAM', () => {
  const gb = (n) => n * 1024 ** 3;
  assert.equal(recommendWhisperModel(gb(1)).model.name, 'base'); // budget 512 MB
  assert.equal(recommendWhisperModel(gb(2)).model.name, 'small'); // budget 1 GB
  assert.equal(recommendWhisperModel(gb(4)).model.name, 'small'); // budget 2 GB, medium needs 2.1 GB
  assert.equal(recommendWhisperModel(gb(8)).model.name, 'large'); // budget 4 GB
  assert.equal(recommendWhisperModel(gb(64)).model.name, 'large');
  assert.equal(recommendWhisperModel(gb(0.5)).model, null); // budget 256 MB is below tiny's 273 MB
});

test('checkWhisperModel explains the choice and says how to download the model by hand', () => {
  const home = tmp();
  try {
    const check = checkWhisperModel(home, 16 * 1024 ** 3);
    assert.equal(check.status, 'ok');
    assert.match(check.details[0], /recommended model "large"/);
    assert.match(check.details[1], /curl .*ggml-large\.bin/);
    mkdirSync(join(home, '.motion-flow', 'models'), { recursive: true });
    writeFileSync(join(home, '.motion-flow', 'models', 'ggml-large.bin'), 'x');
    assert.match(checkWhisperModel(home, 16 * 1024 ** 3).details[1], /model file present/);
    assert.equal(checkWhisperModel(home, 256 * 1024 * 1024).status, 'problem');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
