import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { approve, archive, autoEnabled, setAuto, restore, failedSteps, main, normalizeBody, parseArtifact, planBodyHash, readBuildLog, requireStep, setFrontmatter, status } from './mf-gate.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
let project;
const motion = (name) => join(project, '.motion', name);

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mf-gate-'));
  mkdirSync(join(project, '.motion'));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

const TASK = (status = 'ready', id = '2026-10-19-resize-01') => `---\nid: ${id}\ntype: resize\nflow: null\nstatus: ${status}\ninputs:\n  - alias: projects\n    path: a.aep\ndeadline: null\n---\n## Description\n\nMake a vertical version and move the logo.\n\n## Acceptance criteria\n\n- AC1: The logo is 120 px wide in the top right.\n- AC2: The vertical comp is 1080x1920 at 25 fps.\n\n## Known facts and assumptions\n\n- none\n\n## Open questions\n\n- none\n`;
const PLAN = (extra = '', id = '2026-10-19-resize-01') => `---\ntask_id: ${id}\nstatus: draft\napproved_at: null\nplan_sha256: null\nproject_copy: work/a_v02.aep\ntouches_protected: false\nneeds: []\n---\n## Steps\n\n| # | Target | Change | Expected result | Frame | Criteria |\n|---|---|---|---|---|---|\n| 1 | Main / Logo | scale 50% | smaller logo | Main, 1s | AC1 |\n| 2 | Vertical | size 1080x1920 | vertical comp | Vertical, 1s | AC2 |\n${extra}\n## Not covered by the plan\n\n- none\n\n## Risks\n\n- none\n\n## Questions for the designer\n\n- none\n`;
const LOG_OK = '{"ts":"2026-10-19T14:31:02Z","step":1,"script":"jsx/01.jsx","attempt":1,"ok":true,"durationMs":5}\n';
const CHECK = (id = '2026-10-19-resize-01', verdict = 'PASS') => `---\ntask_id: ${id}\nverdict: ${verdict}\napproved: false\napproved_at: null\n---\n## Comparison with the plan\n\n| # | Expected | Actual | Verdict |\n|---|---|---|---|\n| 1 | smaller logo | scale 50 | PASS |\n| 2 | vertical comp | 1080x1920 | PASS |\n\n## Acceptance criteria\n\n| AC | Evidence | Verdict |\n|---|---|---|\n| AC1 | dump.json Main/Logo scale 50, frame a.png | PASS |\n| AC2 | dump.json Vertical 1080x1920 fps 25 | PASS |\n\n## Lint\n\nclean\n\n## Frames\n\n- work/frames/a.png\n\n## Independent review\n\ndone: all criteria confirmed\n\n## Open questions\n\n- none\n`;

function write(name, text) { writeFileSync(motion(name), text); }
function frame(name = 'a.png') { mkdirSync(join(project, 'work', 'frames'), { recursive: true }); writeFileSync(join(project, 'work', 'frames', name), 'PNG'); }
const at = (name) => readFileSync(motion(name), 'utf8');

/** A project that went through intake, plan (approved) and build. */
function approvedProject() {
  write('task.md', TASK());
  write('plan.md', PLAN());
  assert.equal(approve('plan', project).ok, true);
  write('build.log.jsonl', LOG_OK);
  frame();
}

// ---------- the hash ----------

test('the plan hash covers the body only, with normalized line endings and no trailing whitespace', () => {
  const base = planBodyHash(PLAN());
  assert.equal(planBodyHash(PLAN().replace(/\n/g, '\r\n')), base, 'CRLF');
  assert.equal(planBodyHash(`${PLAN()}\n\n   \n`), base, 'trailing whitespace');
  assert.equal(planBodyHash(PLAN().replace('status: draft', 'status: approved').replace('approved_at: null', 'approved_at: 2026-01-01T00:00:00Z')), base, 'approval fields are not part of the hash');
  assert.notEqual(planBodyHash(PLAN().replace('scale 50%', 'scale 60%')), base, 'a changed step changes the hash');
  assert.notEqual(planBodyHash(PLAN().replace('- none\n\n## Questions', '- risk\n\n## Questions')), base);
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
  assert.ok(body.startsWith('## Description'));
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
  write('plan.md', PLAN('| 3 | <comp / layer / property> | <what changes> | <what should be true afterwards> | x | AC1 |\n'));
  const incomplete = approve('plan', project);
  assert.equal(incomplete.reason, 'plan_incomplete');
  assert.ok(incomplete.failed.some((f) => f.startsWith('no_placeholders')));
  write('plan.md', PLAN('', 'YYYY-MM-DD-<type>-01'));
  assert.equal(approve('plan', project).reason, 'task_mismatch');
  write('task.md', TASK('ready', 'YYYY-MM-DD-<type>-01'));
  assert.equal(approve('plan', project).reason, 'task_incomplete', 'a task with a template id is not ready for planning');
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

// ---------- auto mode ----------

test('approve --auto refuses until auto mode is on, then records who approved', () => {
  write('task.md', TASK());
  write('plan.md', PLAN());
  assert.equal(approve('plan', project, undefined, { auto: true }).reason, 'auto_not_enabled');
  assert.equal(parseArtifact(at('plan.md')).front.status, 'draft', 'a refused approval writes nothing');
  assert.equal(setAuto(true, project).mode, 'auto');
  assert.equal(autoEnabled(project), true);
  assert.equal(status(project).mode, 'auto');
  const result = approve('plan', project, undefined, { auto: true });
  assert.equal(result.ok, true);
  const front = parseArtifact(at('plan.md')).front;
  assert.deepEqual([front.status, front.approved_by], ['approved', 'auto']);
  assert.equal(setAuto(false, project).mode, 'ask');
  assert.equal(autoEnabled(project), false);
});

test('auto mode never replaces a human decision about protected items or known issues', () => {
  write('task.md', TASK());
  write('plan.md', PLAN().replace('touches_protected: false', 'touches_protected: true'));
  setAuto(true, project);
  assert.equal(approve('plan', project, undefined, { auto: true }).reason, 'auto_needs_human');
  assert.equal(approve('plan', project).ok, true, 'a person can still approve it');
  write('build.log.jsonl', LOG_OK);
  frame();
  write('check.md', CHECK('2026-10-19-resize-01', 'ISSUES'));
  assert.equal(approve('check', project, undefined, { auto: true }).reason, 'auto_needs_human');
  write('check.md', CHECK());
  const result = approve('check', project, undefined, { auto: true });
  assert.equal(result.ok, true);
  assert.equal(parseArtifact(at('check.md')).front.approved_by, 'auto');
  assert.equal(requireStep('deliver', project).ok, true);
});

test('archiving a task switches auto mode off', () => {
  approvedProject();
  write('check.md', CHECK());
  assert.equal(approve('check', project).ok, true);
  write('deliver.md', 'delivered');
  setAuto(true, project);
  assert.equal(archive(project).ok, true);
  assert.equal(autoEnabled(project), false);
});

// ---------- status ----------

test('status summarizes every artifact', () => {
  assert.deepEqual(status(project), { ok: true, mode: 'ask', task: 'missing', plan: 'missing', build: 'missing', check: 'missing', deliver: 'missing' });
  approvedProject();
  write('check.md', CHECK());
  assert.deepEqual(status(project), { ok: true, mode: 'ask', task: 'ready', plan: 'approved', build: 'ok', check: 'PASS, not approved', deliver: 'missing' });
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

test('the shipped templates, once filled in, pass the self-check and the gate', () => {
  const read = (name) => readFileSync(join(REPO, 'templates', name), 'utf8');
  const id = '2026-10-19-resize-01';
  write('task.md', read('task.md').replace('YYYY-MM-DD-<type>-01', id).replace('type: other', 'type: resize').replace('status: draft', 'status: ready')
    .replace('<What the designer wants, in the designer\'s words.>', 'x').replace(/<What the designer wants[^>]*>/, 'Make the logo smaller.')
    .replace('- AC1: <criterion>', '- AC1: The logo is 120 px wide in the top right.').replace('- <Facts learned from files or answers.>', '- none').replace('- Assumption: <anything decided without asking, one per line.>', '- Assumption: none'));
  assert.equal(verifyTask(at('task.md')).ok, true, verifyTask(at('task.md')).failed.join('; '));
  write('plan.md', read('plan.md').replace('YYYY-MM-DD-<type>-01', id).replace('<comp / layer / property>', 'Main').replace('<what changes>', 'x').replace('<what should be true afterwards>', 'y').replace('<comp, time in seconds>', 'Main, 1s').replace('<What could go wrong, and what protects against it.>', 'none').replace('<Open questions the designer must answer before approving.>', 'none'));
  assert.equal(verifyPlan(at('plan.md'), at('task.md')).ok, true, verifyPlan(at('plan.md'), at('task.md')).failed.join('; '));
  assert.equal(approve('plan', project).ok, true);
  assert.equal(requireStep('build', project).ok, true);
});

// ---------- the structural self-check (mf-gate verify) ----------

import { parseTable, section, taskCriteria, verify, verifyCheck, verifyPlan, verifyTask } from './mf-gate.mjs';

const failedNames = (result) => result.checks.filter((c) => !c.ok).map((c) => c.name);

test('section and parseTable read a Markdown artifact', () => {
  const body = '## A\n\ntext\n\n## B\n\n| x | y |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n## C\n\nend';
  assert.equal(section(body, 'A'), 'text');
  assert.equal(section(body, 'Z'), null);
  assert.deepEqual(parseTable(section(body, 'B')), { headers: ['x', 'y'], rows: [['1', '2'], ['3', '4']] });
  assert.equal(parseTable('no table here'), null);
  assert.equal(parseTable('| only header |'), null);
});

test('taskCriteria reads the AC lines', () => {
  assert.deepEqual(taskCriteria(TASK()), [{ id: 'AC1', text: 'The logo is 120 px wide in the top right.' }, { id: 'AC2', text: 'The vertical comp is 1080x1920 at 25 fps.' }]);
  assert.deepEqual(taskCriteria('---\nid: x\n---\n## Description\n\ntext'), []);
});

test('verifyTask: a good task passes and reports N/N', () => {
  const result = verifyTask(TASK());
  assert.equal(result.ok, true);
  assert.equal(result.line, `self-check: ${result.total}/${result.total} pass`);
  assert.deepEqual(result.failed, []);
});

test('verifyTask: every structural problem is named', () => {
  const bad = (mutate) => failedNames(verifyTask(mutate(TASK())));
  assert.deepEqual(bad((t) => t.replace('## Acceptance criteria\n\n- AC1: The logo is 120 px wide in the top right.\n- AC2: The vertical comp is 1080x1920 at 25 fps.\n\n', '')), ['criteria']);
  assert.deepEqual(bad((t) => t.replace('- AC2: The vertical', '- AC1: The vertical')), ['criteria'], 'ids must be distinct');
  assert.deepEqual(bad((t) => t.replace('- AC2: The vertical comp is 1080x1920 at 25 fps.', '- AC2: ok')), ['criteria'], 'a real sentence');
  assert.deepEqual(bad((t) => t.replace('2026-10-19-resize-01', 'YYYY-MM-DD-<type>-01')), ['id', 'no_placeholders']);
  assert.deepEqual(bad((t) => t.replace('type: resize', 'type: banana')), ['type']);
  assert.deepEqual(bad((t) => t.replace('Make a vertical version and move the logo.', 'short')), ['description']);
  assert.deepEqual(bad((t) => t.replace('  - alias: projects\n    path: a.aep\n', '')), ['inputs']);
  assert.deepEqual(bad((t) => t.replace('type: resize', 'type: new').replace('  - alias: projects\n    path: a.aep\n', '')), [], 'a new task may have no inputs');
  assert.deepEqual(bad((t) => `${t}\n- Assumption: <anything decided without asking`), ['no_placeholders']);
  assert.deepEqual(failedNames(verifyTask('no frontmatter')).slice(0, 1), ['frontmatter']);
});

test('verifyPlan: a good plan passes; the criteria trace both ways', () => {
  assert.equal(verifyPlan(PLAN(), TASK()).ok, true);
  // a step nobody asked for
  const orphan = verifyPlan(PLAN('| 3 | X | y | z | Main, 2s | |\n'), TASK());
  assert.deepEqual(failedNames(orphan), ['steps_trace_to_criteria']);
  assert.match(orphan.failed.join(), /steps without a criterion: 3/);
  // a criterion nobody planned
  const uncovered = verifyPlan(PLAN().replace('| 2 | Vertical | size 1080x1920 | vertical comp | Vertical, 1s | AC2 |\n', ''), TASK());
  assert.deepEqual(failedNames(uncovered), ['criteria_covered']);
  assert.match(uncovered.failed.join(), /AC2/);
  // ... unless it is listed openly with a reason
  const acknowledged = verifyPlan(PLAN().replace('| 2 | Vertical | size 1080x1920 | vertical comp | Vertical, 1s | AC2 |\n', '').replace('## Not covered by the plan\n\n- none', '## Not covered by the plan\n\n- AC2: needs a template the studio has not given'), TASK());
  assert.equal(acknowledged.ok, true);
  // a step pointing at a criterion the task does not have
  assert.deepEqual(failedNames(verifyPlan(PLAN().replace('| AC2 |', '| AC9 |'), TASK())).sort(), ['criteria_covered', 'steps_trace_to_criteria']);
});

test('verifyPlan: structure problems are named', () => {
  const bad = (mutate) => failedNames(verifyPlan(mutate(PLAN()), TASK()));
  assert.deepEqual(bad((p) => p.replace('| 1 | Main / Logo | scale 50% | smaller logo | Main, 1s | AC1 |', '| 1 | Main / Logo | scale 50% | smaller logo |  | AC1 |')), ['frames_and_results']);
  assert.deepEqual(bad((p) => p.replace('Frame | Criteria', 'Snapshot | Crit')), ['steps_table', 'frames_and_results', 'steps_trace_to_criteria', 'criteria_covered']);
  assert.deepEqual(bad((p) => p.replace('project_copy: work/a_v02.aep', 'project_copy: a.aep')), ['project_copy']);
  assert.deepEqual(bad((p) => p.replace('touches_protected: false', 'touches_protected: maybe')), ['touches_protected']);
  assert.deepEqual(bad((p) => p.replace('## Not covered by the plan\n\n- none\n\n', '')), ['sections']);
  assert.deepEqual(bad((p) => p.replace('task_id: 2026-10-19-resize-01', 'task_id: 2026-10-20-other-01')), ['task_id']);
  assert.deepEqual(bad((p) => `${p}\n- <What could go wrong`), ['no_placeholders']);
});

test('verifyCheck: a good check passes', () => {
  approvedProject();
  const result = verifyCheck(CHECK(), TASK(), at('plan.md'), project);
  assert.equal(result.ok, true, result.failed.join('; '));
});

test('verifyCheck: criteria without evidence, missing rows and inconsistent verdicts are named', () => {
  approvedProject();
  const bad = (mutate) => failedNames(verifyCheck(mutate(CHECK()), TASK(), at('plan.md'), project));
  assert.deepEqual(bad((c) => c.replace('| AC2 | dump.json Vertical 1080x1920 fps 25 | PASS |\n', '')), ['criteria_traced', 'verdict_consistent'], 'a missing criterion row also cannot support a PASS');
  assert.deepEqual(bad((c) => c.replace('| AC2 | dump.json Vertical 1080x1920 fps 25 | PASS |', '| AC2 | | PASS |')), ['criteria_traced']);
  assert.deepEqual(bad((c) => c.replace('| AC2 | dump.json Vertical 1080x1920 fps 25 | PASS |', '| AC2 | dump.json x | MAYBE |')), ['criteria_traced', 'verdict_consistent']);
  assert.deepEqual(bad((c) => c.replace('| AC2 | dump.json Vertical 1080x1920 fps 25 | PASS |', '| AC2 | not visible anywhere | NOT_VERIFIED |')), ['verdict_consistent'], 'PASS needs every criterion PASS');
  assert.deepEqual(bad((c) => c.replace('| AC2 | dump.json Vertical 1080x1920 fps 25 | PASS |', '| AC2 | not visible anywhere | NOT_VERIFIED |').replace('verdict: PASS', 'verdict: ISSUES')), [], 'ISSUES is the honest verdict');
  assert.deepEqual(bad((c) => c.replace('| 2 | vertical comp | 1080x1920 | PASS |\n', '')), ['plan_rows_compared']);
  assert.deepEqual(bad((c) => c.replace('| 2 | vertical comp | 1080x1920 | PASS |', '| 2 | vertical comp | 720x1280 | FAIL |')), ['verdict_consistent']);
  assert.deepEqual(bad((c) => c.replace('verdict: PASS', 'verdict: GOOD')), ['verdict']);
  assert.deepEqual(bad((c) => c.replace('- work/frames/a.png', '- work/frames/missing.png')), ['frames_exist']);
  assert.deepEqual(bad((c) => c.replace('clean', '')), ['lint_section']);
  assert.deepEqual(bad((c) => c.replace('done: all criteria confirmed', '')), ['independent_pass']);
  assert.deepEqual(bad((c) => c.replace('done: all criteria confirmed', 'not run: sub-agent unavailable')), [], 'an honest "not run" is accepted');
  assert.deepEqual(bad((c) => c.replace('task_id: 2026-10-19-resize-01', 'task_id: 2026-10-20-other-01')), ['task_id']);
  assert.deepEqual(bad((c) => `${c}\n- <Anything the designer should look at`), ['no_placeholders']);
});

test('require plan refuses an incomplete task; approve plan refuses a plan that fails the self-check and says why', () => {
  write('task.md', TASK().replace('## Acceptance criteria\n\n- AC1: The logo is 120 px wide in the top right.\n- AC2: The vertical comp is 1080x1920 at 25 fps.\n\n', ''));
  const refused = requireStep('plan', project);
  assert.deepEqual([refused.reason, refused.create_with], ['task_incomplete', '/motion-flow:intake']);
  assert.match(refused.failed.join(), /criteria/);
  write('task.md', TASK());
  write('plan.md', PLAN().replace('| 2 | Vertical | size 1080x1920 | vertical comp | Vertical, 1s | AC2 |\n', ''));
  const incomplete = approve('plan', project);
  assert.equal(incomplete.reason, 'plan_incomplete');
  assert.ok(incomplete.failed.some((f) => f.startsWith('criteria_covered')));
  assert.equal(parseArtifact(at('plan.md')).front.status, 'draft');
});

test('approve check refuses a check that fails the self-check and lists the failed items', () => {
  approvedProject();
  write('check.md', CHECK().replace('| AC2 | dump.json Vertical 1080x1920 fps 25 | PASS |\n', ''));
  const refused = approve('check', project);
  assert.equal(refused.reason, 'check_incomplete');
  assert.ok(refused.failed.some((f) => f.startsWith('criteria_traced')));
  write('check.md', CHECK());
  assert.equal(approve('check', project).ok, true);
});

test('CLI: verify prints the self-check line and exits 0 or 1', () => {
  write('task.md', TASK());
  const ok = cli('verify', 'task');
  assert.equal(ok.status, 0);
  assert.match(ok.out.line, /^self-check: \d+\/\d+ pass$/);
  write('task.md', TASK().replace('type: resize', 'type: banana'));
  const bad = cli('verify', 'task');
  assert.equal(bad.status, 1);
  assert.match(bad.out.line, /failed: type/);
  assert.equal(cli('verify', 'plan').out.reason, 'file_missing');
  assert.equal(cli('verify', 'nope').status, 2);
  assert.equal(verify('task', project).ok, false);
});

// ---------- park and restore (a task set aside, for example during a flow dry-run) ----------

test('archive --park sets a task aside even when it is unfinished, marks it, and restore puts it back unchanged', () => {
  approvedProject();
  write('check.md', CHECK());
  const before = { task: at('task.md'), plan: at('plan.md'), log: at('build.log.jsonl'), check: at('check.md') };
  const parked = archive(project, { park: true, now: new Date('2026-10-19T16:00:00Z') });
  assert.equal(parked.ok, true);
  assert.equal(parked.parked, true);
  assert.equal(existsSync(join(project, '.motion', 'archive', '2026-10-19-resize-01', 'PARKED')), true);
  assert.equal(requireStep('plan', project).reason, 'file_missing', '.motion/ is free for another task');
  assert.deepEqual(restore(project), { ok: true, step: 'restore', archived: [{ name: '2026-10-19-resize-01', parked: true }] });
  const restored = restore(project, '2026-10-19-resize-01');
  assert.equal(restored.ok, true);
  assert.deepEqual({ task: at('task.md'), plan: at('plan.md'), log: at('build.log.jsonl'), check: at('check.md') }, before, 'every file is byte for byte the same');
  assert.equal(readdirSync(join(project, '.motion', 'archive')).length, 0, 'the archive folder is gone');
  assert.equal(requireStep('build', project).ok, true, 'the approval survived the round trip');
});

test('restore never overwrites a task in progress, refuses unknown or unsafe ids, and lists what exists', () => {
  approvedProject();
  archive(project, { park: true });
  write('task.md', TASK('ready', '2026-10-20-other-01'));
  const refused = restore(project, '2026-10-19-resize-01');
  assert.equal(refused.reason, 'task_in_progress');
  assert.equal(at('task.md').includes('2026-10-20-other-01'), true, 'the new task is untouched');
  assert.equal(restore(project, 'nope').reason, 'not_found');
  assert.equal(restore(project, '../escape').reason, 'not_found');
  assert.deepEqual(restore(project, 'nope').archived, [{ name: '2026-10-19-resize-01', parked: true }]);
});

test('park keeps a task that has a deliver.md too, and plain archive still refuses an unfinished task with both hints', () => {
  approvedProject();
  const refused = archive(project);
  assert.deepEqual([refused.reason, refused.abandon_flag, refused.park_flag], ['not_delivered', '--abandon', '--park']);
});

test('archive takes the task\'s jsx/ scripts along, and restore brings them back without mixing two tasks', () => {
  approvedProject();
  mkdirSync(join(project, 'jsx'));
  writeFileSync(join(project, 'jsx', '01-logo.jsx'), 'mf.runIpc(function () { return {}; });\n');
  const parked = archive(project, { park: true });
  assert.ok(parked.moved.includes('jsx/'));
  assert.equal(existsSync(join(project, 'jsx')), false, 'the next task starts without old scripts');
  assert.equal(existsSync(join(project, '.motion', 'archive', '2026-10-19-resize-01', 'jsx', '01-logo.jsx')), true);
  mkdirSync(join(project, 'jsx'));
  writeFileSync(join(project, 'jsx', '01-other.jsx'), '');
  assert.equal(restore(project, '2026-10-19-resize-01').reason, 'task_in_progress', 'scripts of another task are never mixed in');
  rmSync(join(project, 'jsx', '01-other.jsx'));
  const restored = restore(project, '2026-10-19-resize-01');
  assert.ok(restored.moved.includes('jsx/'));
  assert.deepEqual(readdirSync(join(project, 'jsx')), ['01-logo.jsx']);
});

test('CLI: archive --park and restore', () => {
  approvedProject();
  assert.equal(cli('archive', '--park').status, 0);
  const listed = cli('restore');
  assert.equal(listed.status, 0);
  assert.equal(listed.out.archived[0].parked, true);
  assert.equal(cli('restore', '2026-10-19-resize-01').status, 0);
  assert.equal(cli('restore', '2026-10-19-resize-01').status, 1, 'nothing left to restore');
});
