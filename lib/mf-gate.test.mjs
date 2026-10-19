import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { approve, archive, failedSteps, main, normalizeBody, parseArtifact, planBodyHash, readBuildLog, requireStep, setFrontmatter, status } from './mf-gate.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
let project;
const motion = (name) => join(project, '.motion', name);

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mf-gate-'));
  mkdirSync(join(project, '.motion'));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

const TASK = (status = 'ready', id = '2026-10-19-resize-01') => `---\nid: ${id}\ntype: resize\nflow: null\nstatus: ${status}\ninputs:\n  - alias: projects\n    path: a.aep\ndeadline: null\n---\n## Опис\n\nResize.\n\n## Що відомо / припущення\n\n- none\n`;
const PLAN = (extra = '', id = '2026-10-19-resize-01') => `---\ntask_id: ${id}\nstatus: draft\napproved_at: null\nplan_sha256: null\nproject_copy: work/a_v02.aep\ntouches_protected: false\nneeds: []\n---\n## Кроки\n\n| # | Ціль | Зміна | Очікуваний результат | Кадр |\n|---|---|---|---|---|\n| 1 | Main / Logo | scale 50% | smaller logo | Main, 1s |\n${extra}\n## Ризики\n\n- none\n\n## Питання до людини\n\n- none\n`;
const LOG_OK = '{"ts":"2026-10-19T14:31:02Z","step":1,"script":"jsx/01.jsx","attempt":1,"ok":true,"durationMs":5}\n';
const CHECK = (id = '2026-10-19-resize-01', verdict = 'PASS') => `---\ntask_id: ${id}\nverdict: ${verdict}\napproved: false\napproved_at: null\n---\n## Звірка з планом\n\n| # | Очікувалось | Факт | Вердикт |\n|---|---|---|---|\n| 1 | smaller logo | scale 50 | PASS |\n\n## Lint\n\nclean\n`;

function write(name, text) { writeFileSync(motion(name), text); }
const at = (name) => readFileSync(motion(name), 'utf8');

/** A project that went through intake, plan (approved) and build. */
function approvedProject() {
  write('task.md', TASK());
  write('plan.md', PLAN());
  assert.equal(approve('plan', project).ok, true);
  write('build.log.jsonl', LOG_OK);
}

// ---------- the hash ----------

test('the plan hash covers the body only, with normalized line endings and no trailing whitespace', () => {
  const base = planBodyHash(PLAN());
  assert.equal(planBodyHash(PLAN().replace(/\n/g, '\r\n')), base, 'CRLF');
  assert.equal(planBodyHash(`${PLAN()}\n\n   \n`), base, 'trailing whitespace');
  assert.equal(planBodyHash(PLAN().replace('status: draft', 'status: approved').replace('approved_at: null', 'approved_at: 2026-01-01T00:00:00Z')), base, 'approval fields are not part of the hash');
  assert.notEqual(planBodyHash(PLAN().replace('scale 50%', 'scale 60%')), base, 'a changed step changes the hash');
  assert.notEqual(planBodyHash(PLAN().replace('- none\n\n## Питання', '- risk\n\n## Питання')), base);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(normalizeBody('a\r\nb  \n\n'), 'a\nb');
  assert.throws(() => planBodyHash('no frontmatter'), /no frontmatter/);
});

test('setFrontmatter changes only the named keys and keeps everything else byte for byte', () => {
  const text = '---\nid: 1\n# a comment\nstatus: draft\n---\n## Body\n\nText: status: draft\n';
  assert.equal(setFrontmatter(text, { status: 'approved' }), '---\nid: 1\n# a comment\nstatus: approved\n---\n## Body\n\nText: status: draft\n');
  assert.equal(setFrontmatter(text, { extra: 'x' }), '---\nid: 1\n# a comment\nstatus: draft\nextra: x\n---\n## Body\n\nText: status: draft\n');
  assert.equal(setFrontmatter(text.replace(/\n/g, '\r\n'), { status: 'approved' }), text.replace('draft\n---', 'approved\n---').replace('status: approved\n---', 'status: approved\n---').replace(/\n/g, '\r\n').replace('Text: status: approved', 'Text: status: draft'));
  assert.throws(() => setFrontmatter('nothing', { a: 1 }), /no frontmatter/);
  const tricky = '---\nnote: a --- b\nstatus: draft\n---\nbody\n';
  assert.equal(setFrontmatter(tricky, { status: 'approved' }), '---\nnote: a --- b\nstatus: approved\n---\nbody\n');
});

test('parseArtifact reads flat keys and ignores list lines', () => {
  const { front, body } = parseArtifact(TASK());
  assert.equal(front.id, '2026-10-19-resize-01');
  assert.equal(front.status, 'ready');
  assert.ok(body.startsWith('## Опис'));
  assert.equal(parseArtifact('no frontmatter'), null);
});

// ---------- plan gate ----------

test('plan: refused without task.md, refused for a draft task, allowed for a ready one', () => {
  const missing = requireStep('plan', project);
  assert.deepEqual([missing.ok, missing.reason, missing.missing, missing.create_with], [false, 'file_missing', '.motion/task.md', '/motion-flow:intake']);
  write('task.md', TASK('draft'));
  assert.equal(requireStep('plan', project).reason, 'task_not_ready');
  write('task.md', 'no frontmatter');
  assert.equal(requireStep('plan', project).reason, 'task_not_ready');
  write('task.md', TASK('ready'));
  assert.deepEqual(requireStep('plan', project), { ok: true, step: 'plan' });
});

// ---------- build gate ----------

test('build: refused without a plan, with a draft plan, and with a plan whose approval fields are incomplete', () => {
  write('task.md', TASK());
  const none = requireStep('build', project);
  assert.deepEqual([none.reason, none.missing, none.create_with], ['file_missing', '.motion/plan.md', '/motion-flow:plan']);
  write('plan.md', PLAN());
  assert.equal(requireStep('build', project).reason, 'plan_not_approved');
  write('plan.md', PLAN().replace('status: draft', 'status: approved'));
  assert.equal(requireStep('build', project).reason, 'plan_not_approved', 'approved without a hash and date is not approved');
  write('plan.md', 'no frontmatter');
  assert.equal(requireStep('build', project).reason, 'plan_not_approved');
});

test('build: allowed after approval, refused when the plan is changed afterwards, allowed again after a new approval', () => {
  approvedProject();
  assert.deepEqual(requireStep('build', project), { ok: true, step: 'build' });
  write('plan.md', at('plan.md').replace('scale 50%', 'scale 90%'));
  const changed = requireStep('build', project);
  assert.deepEqual([changed.ok, changed.reason, changed.create_with], [false, 'plan_changed_after_approval', '/motion-flow:plan']);
  assert.equal(approve('plan', project).ok, true);
  assert.equal(requireStep('build', project).ok, true);
});

test('build: editing only the frontmatter of an approved plan does not break the approval; a hand-forged hash does', () => {
  approvedProject();
  write('plan.md', at('plan.md').replace('needs: []', 'needs: [ffmpeg]'));
  assert.equal(requireStep('build', project).ok, true);
  write('plan.md', at('plan.md').replace(/plan_sha256: .*/, `plan_sha256: ${'0'.repeat(64)}`));
  assert.equal(requireStep('build', project).reason, 'plan_changed_after_approval');
});

test('build: a plan for another task is refused', () => {
  approvedProject();
  write('task.md', TASK('ready', '2026-10-20-other-01'));
  const result = requireStep('build', project);
  assert.equal(result.reason, 'task_mismatch');
  assert.match(result.detail, /2026-10-19-resize-01.*2026-10-20-other-01/);
});

// ---------- check gate ----------

test('check: refused without a build log, with an empty or broken one, and with a failed step', () => {
  approvedProject();
  rmSync(motion('build.log.jsonl'));
  assert.equal(requireStep('check', project).reason, 'build_log_missing');
  write('build.log.jsonl', '\n\n');
  assert.equal(requireStep('check', project).reason, 'build_log_missing');
  write('build.log.jsonl', 'not json\n');
  const broken = requireStep('check', project);
  assert.equal(broken.reason, 'build_log_invalid');
  assert.match(broken.detail, /^line 1:/);
  write('build.log.jsonl', '{"step":1,"ok":"yes"}\n');
  assert.equal(requireStep('check', project).reason, 'build_log_invalid');
  write('build.log.jsonl', `${LOG_OK}{"step":2,"script":"jsx/02.jsx","attempt":1,"ok":false,"error":"Layer not found: Headline"}\n`);
  const failed = requireStep('check', project);
  assert.deepEqual([failed.reason, failed.failed], ['build_failed', [{ step: 2, script: 'jsx/02.jsx', error: 'Layer not found: Headline' }]]);
  assert.equal(failed.create_with, '/motion-flow:build');
});

test('check: a failed step that succeeded on a retry counts as good; a retry that failed again does not', () => {
  approvedProject();
  const failedLine = '{"step":2,"script":"jsx/02.jsx","attempt":1,"ok":false,"error":"x"}\n';
  write('build.log.jsonl', `${LOG_OK}${failedLine}{"step":2,"script":"jsx/02.jsx","attempt":2,"ok":true}\n`);
  assert.equal(requireStep('check', project).ok, true);
  write('build.log.jsonl', `${LOG_OK}${failedLine}{"step":2,"script":"jsx/02.jsx","attempt":2,"ok":false,"error":"y"}\n`);
  assert.equal(requireStep('check', project).reason, 'build_failed');
  assert.deepEqual(failedSteps(readBuildLog(motion('build.log.jsonl')).lines).map((f) => f.error), ['y']);
});

test('check: refused when the plan was changed after the build', () => {
  approvedProject();
  write('plan.md', at('plan.md').replace('scale 50%', 'scale 70%'));
  assert.equal(requireStep('check', project).reason, 'plan_changed_after_approval');
});

// ---------- deliver gate ----------

test('deliver: refused without check.md, with an unapproved check, allowed after approval', () => {
  approvedProject();
  assert.deepEqual([requireStep('deliver', project).reason, requireStep('deliver', project).create_with], ['file_missing', '/motion-flow:check']);
  write('check.md', CHECK());
  assert.equal(requireStep('deliver', project).reason, 'check_not_approved');
  write('check.md', CHECK().replace('approved: false', 'approved: true'));
  assert.equal(requireStep('deliver', project).reason, 'check_not_approved', 'approved without a date is not approved');
  assert.equal(approve('check', project).ok, true);
  assert.deepEqual(requireStep('deliver', project), { ok: true, step: 'deliver' });
});

test('deliver: refused when the plan changed after approval or the check belongs to another task', () => {
  approvedProject();
  write('check.md', CHECK());
  approve('check', project);
  write('plan.md', at('plan.md').replace('scale 50%', 'scale 80%'));
  assert.equal(requireStep('deliver', project).reason, 'plan_changed_after_approval');
  approvedProject();
  write('check.md', CHECK('2026-10-20-other-01').replace('approved: false', 'approved: true').replace('approved_at: null', 'approved_at: 2026-10-19T15:00:00Z'));
  assert.equal(requireStep('deliver', project).reason, 'task_mismatch');
});

test('an unknown step throws a clear error', () => {
  assert.throws(() => requireStep('intake', project), /Unknown step "intake"/);
});

// ---------- approvals ----------

test('approve plan records status, time and hash, leaves the body alone, and leaves no temp file', () => {
  write('task.md', TASK());
  write('plan.md', PLAN());
  const before = at('plan.md');
  const now = new Date('2026-10-19T14:00:00Z');
  const result = approve('plan', project, now);
  assert.equal(result.ok, true);
  assert.equal(result.approved_at, '2026-10-19T14:00:00.000Z');
  const after = at('plan.md');
  assert.equal(parseArtifact(after).body, parseArtifact(before).body);
  assert.deepEqual([parseArtifact(after).front.status, parseArtifact(after).front.plan_sha256], ['approved', planBodyHash(before)]);
  assert.deepEqual(readdirSync(join(project, '.motion')).filter((n) => n.endsWith('.tmp')), []);
});

test('approve plan is refused for a missing task, a draft task, an unfilled template, another task and a missing plan', () => {
  assert.equal(approve('plan', project).reason, 'file_missing');
  write('task.md', TASK('draft'));
  assert.equal(approve('plan', project).reason, 'task_not_ready');
  write('task.md', TASK());
  assert.equal(approve('plan', project).reason, 'file_missing');
  write('plan.md', PLAN('| 2 | <comp / layer / property> | <what changes> | <what should be true afterwards> | x |\n'));
  const incomplete = approve('plan', project);
  assert.equal(incomplete.reason, 'plan_incomplete');
  assert.match(incomplete.detail, /Unfilled template text/);
  write('plan.md', PLAN('', 'YYYY-MM-DD-<type>-01'));
  assert.equal(approve('plan', project).reason, 'task_mismatch');
  write('task.md', TASK('ready', 'YYYY-MM-DD-<type>-01'));
  assert.equal(approve('plan', project).reason, 'plan_incomplete');
  assert.equal(parseArtifact(at('plan.md')).front.status, 'draft', 'nothing was approved');
});

test('approve check needs a good build, a verdict and a filled check; it records the time', () => {
  approvedProject();
  assert.equal(approve('check', project).reason, 'file_missing');
  write('check.md', CHECK('2026-10-19-resize-01', 'MAYBE'));
  assert.equal(approve('check', project).reason, 'check_incomplete');
  write('check.md', CHECK().replace('| 1 | smaller logo | scale 50 | PASS |', '| 1 | <from plan.md> | <what the dump or frame shows> | PASS |'));
  assert.equal(approve('check', project).reason, 'check_incomplete');
  write('check.md', CHECK());
  const result = approve('check', project, new Date('2026-10-19T15:00:00Z'));
  assert.equal(result.ok, true);
  assert.deepEqual([parseArtifact(at('check.md')).front.approved, parseArtifact(at('check.md')).front.approved_at], ['true', '2026-10-19T15:00:00.000Z']);
  write('check.md', CHECK('2026-10-20-x-01'));
  assert.equal(approve('check', project).reason, 'task_mismatch');
  rmSync(motion('build.log.jsonl'));
  write('check.md', CHECK());
  assert.equal(approve('check', project).reason, 'build_log_missing', 'the check cannot be approved on top of a missing build');
});

test('approve check accepts a verdict of ISSUES (the designer may accept known issues)', () => {
  approvedProject();
  write('check.md', CHECK('2026-10-19-resize-01', 'ISSUES'));
  assert.equal(approve('check', project).ok, true);
});

test('approving an unknown thing throws', () => {
  assert.throws(() => approve('deliver', project), /Cannot approve/);
});

// ---------- status ----------

test('status summarizes every artifact', () => {
  assert.deepEqual(status(project), { ok: true, task: 'missing', plan: 'missing', build: 'missing', check: 'missing', deliver: 'missing' });
  approvedProject();
  write('check.md', CHECK());
  assert.deepEqual(status(project), { ok: true, task: 'ready', plan: 'approved', build: 'ok', check: 'PASS, not approved', deliver: 'missing' });
  write('plan.md', at('plan.md').replace('scale 50%', 'scale 1%'));
  assert.equal(status(project).plan, 'changed_after_approval');
  write('build.log.jsonl', '{"step":1,"ok":false}\n');
  assert.equal(status(project).build, 'failed');
});

// ---------- the command line ----------

function cli(...args) {
  const result = spawnSync(process.execPath, [join(REPO, 'bin', 'mf-gate'), ...args], { cwd: project, encoding: 'utf8' });
  return { status: result.status, out: JSON.parse(result.stdout) };
}

test('CLI: exit 0 when allowed, 1 when refused, 2 for bad usage; one JSON object each time', () => {
  const refused = cli('require', 'build');
  assert.equal(refused.status, 1);
  assert.deepEqual([refused.out.ok, refused.out.reason], [false, 'file_missing']);
  write('task.md', TASK());
  assert.equal(cli('require', 'plan').status, 0);
  write('plan.md', PLAN());
  const approved = cli('approve', 'plan');
  assert.equal(approved.status, 0);
  assert.equal(cli('hash', 'plan').out.plan_sha256, approved.out.plan_sha256);
  assert.equal(cli('require', 'build').status, 0);
  assert.equal(cli('status').out.plan, 'approved');
  for (const args of [[], ['require'], ['require', 'nope'], ['approve', 'deliver'], ['bogus']]) {
    const bad = cli(...args);
    assert.equal(bad.status, 2, JSON.stringify(args));
    assert.equal(bad.out.reason, 'usage');
  }
});

test('CLI: --project points at another folder', () => {
  const other = mkdtempSync(join(tmpdir(), 'mf-gate-other-'));
  try {
    const result = spawnSync(process.execPath, [join(REPO, 'bin', 'mf-gate'), 'status', '--project', other], { cwd: project, encoding: 'utf8' });
    assert.equal(JSON.parse(result.stdout).task, 'missing');
    assert.equal(main(['status', '--project', other], { stdout: { write() {} } }), 0);
  } finally { rmSync(other, { recursive: true, force: true }); }
});

test('the example templates of this plugin pass through the gate once filled in', () => {
  // the shipped templates have the keys mf-gate reads and writes
  const plan = readFileSync(join(REPO, 'templates', 'plan.md'), 'utf8');
  const filled = plan.replace('YYYY-MM-DD-<type>-01', '2026-10-19-resize-01').replace('<comp / layer / property>', 'Main').replace('<what changes>', 'x').replace('<what should be true afterwards>', 'y').replace('<comp, time in seconds>', 'Main, 1s').replace('<What could go wrong, and what protects against it.>', 'none').replace('<Open questions the designer must answer before approving.>', 'none');
  write('task.md', readFileSync(join(REPO, 'templates', 'task.md'), 'utf8').replace('YYYY-MM-DD-<type>-01', '2026-10-19-resize-01').replace('status: draft', 'status: ready'));
  write('plan.md', filled);
  assert.equal(approve('plan', project).ok, true);
  assert.equal(requireStep('build', project).ok, true);
});

// ---------- archive ----------

test('archive moves the artifacts of a delivered task into .motion/archive/<id>/ and keeps the settings files', () => {
  approvedProject();
  write('check.md', CHECK());
  write('deliver.md', '---\ntask_id: 2026-10-19-resize-01\n---\n');
  mkdirSync(motion('snapshots'));
  writeFileSync(join(motion('snapshots'), 'project-map-1.json'), '{}');
  write('state.json', '{}');
  write('drive.json', '{"aliases":[]}');
  write('overrides.md', 'keep');
  const result = archive(project);
  assert.equal(result.ok, true);
  assert.equal(result.archived_to, '.motion/archive/2026-10-19-resize-01');
  assert.deepEqual(result.moved.sort(), ['build.log.jsonl', 'check.md', 'deliver.md', 'plan.md', 'snapshots', 'task.md']);
  assert.deepEqual(readdirSync(join(project, '.motion')).sort(), ['archive', 'drive.json', 'overrides.md', 'state.json']);
  assert.deepEqual(readdirSync(join(project, '.motion', 'archive', '2026-10-19-resize-01')).sort(), ['build.log.jsonl', 'check.md', 'deliver.md', 'plan.md', 'snapshots', 'task.md']);
  assert.equal(status(project).task, 'missing');
  assert.equal(requireStep('plan', project).reason, 'file_missing', 'a fresh task can start');
});

test('archive refuses an unfinished task unless it is abandoned, and never overwrites an older archive', () => {
  approvedProject();
  const refused = archive(project);
  assert.deepEqual([refused.ok, refused.reason, refused.abandon_flag], [false, 'not_delivered', '--abandon']);
  assert.ok(readdirSync(join(project, '.motion')).includes('plan.md'), 'nothing was moved');
  const abandoned = archive(project, { abandon: true, now: new Date('2026-10-19T16:00:00Z') });
  assert.equal(abandoned.ok, true);
  assert.equal(abandoned.abandoned, true);
  approvedProject();
  const again = archive(project, { abandon: true, now: new Date('2026-10-19T17:00:00Z') });
  assert.match(again.archived_to, /^\.motion\/archive\/2026-10-19-resize-01-2026-10-19T17-00-00-000Z$/);
  assert.equal(readdirSync(join(project, '.motion', 'archive')).length, 2);
});

test('archive with no task says so, and refuses an id that is not a safe folder name', () => {
  assert.equal(archive(project).reason, 'file_missing');
  write('task.md', TASK('ready', '../escape'));
  write('deliver.md', 'x');
  assert.equal(archive(project).reason, 'bad_task_id');
  assert.deepEqual(readdirSync(join(project, '.motion')).sort(), ['deliver.md', 'task.md']);
});

test('CLI: archive and the usage line', () => {
  approvedProject();
  assert.equal(cli('archive').status, 1);
  const result = cli('archive', '--abandon');
  assert.equal(result.status, 0);
  assert.equal(result.out.task_id, '2026-10-19-resize-01');
});
