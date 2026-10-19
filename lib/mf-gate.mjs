// mf-gate: gating as code. Steps ask it whether they may start; it also records the human approvals.
//   mf-gate require <plan|build|check|deliver>
//   mf-gate hash plan
//   mf-gate approve <plan|check>
//   mf-gate status
//   mf-gate archive [--abandon]
//   mf-gate verify <task|plan|check>      structural self-check of an artifact (see skills/_shared/artifact-formats.md)
// Artifacts live in <project>/.motion/ (see skills/_shared/artifact-formats.md). Output is one JSON object.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const STEPS = ['plan', 'build', 'check', 'deliver'];

const NEXT_STEP = { task: 'intake', plan: 'plan', build: 'build', check: 'check' };
// Text that only the shipped templates contain: its presence means a section was never filled in.
const PLACEHOLDERS = [
  'YYYY-MM-DD', '<What the designer wants', '<Facts learned', 'Припущення: <anything', '<criterion', '<Open questions',
  '<comp / layer / property>', '<what changes>', '<what should be true afterwards>', '<comp, time in seconds>', '<What could go wrong',
  '<from plan.md>', '<what the dump or frame shows>', '<Summary of the ae-lint', '<Anything the designer should look at', '<what the independent pass found',
];
const TASK_TYPES = ['resize', 'new', 'edit', 'export', 'other'];
const AC_ID = /\bAC\d+\b/g;

// ---------- artifacts ----------

/** Splits a Markdown artifact into { frontText, front, body }. front values are raw strings. Returns null without frontmatter. */
export function parseArtifact(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const front = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const openLength = match[0].indexOf('\n') + 1;
  return { frontText: match[1], front, body: text.slice(match[0].length), open: match[0].slice(0, openLength), close: match[0].slice(openLength + match[1].length) };
}

/** The text that is hashed: the body, line endings as \n, trailing whitespace at the end removed. */
export function normalizeBody(body) {
  return body.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

export function planBodyHash(text) {
  const artifact = parseArtifact(text);
  if (!artifact) throw new Error('plan.md has no frontmatter');
  return createHash('sha256').update(normalizeBody(artifact.body), 'utf8').digest('hex');
}

/** Sets existing frontmatter keys (or adds missing ones at the end) without touching anything else. */
export function setFrontmatter(text, values) {
  const artifact = parseArtifact(text);
  if (!artifact) throw new Error('The file has no frontmatter.');
  const newline = artifact.open.endsWith('\r\n') ? '\r\n' : '\n';
  let front = artifact.frontText;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}: ${value}`;
    const pattern = new RegExp(`^${key}:.*$`, 'm');
    front = pattern.test(front) ? front.replace(pattern, line) : `${front}${newline}${line}`;
  }
  return `${artifact.open}${front}${artifact.close}${artifact.body}`;
}

const isSet = (value) => value !== undefined && value !== '' && value !== 'null' && value !== '~';

function paths(project) {
  const dir = join(project, '.motion');
  return { dir, task: join(dir, 'task.md'), plan: join(dir, 'plan.md'), log: join(dir, 'build.log.jsonl'), check: join(dir, 'check.md'), deliver: join(dir, 'deliver.md') };
}

function load(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  return { text, artifact: parseArtifact(text) };
}

// ---------- the build log ----------

/** Reads build.log.jsonl. Returns { lines } or { error }. The final state of each step is its last attempt. */
export function readBuildLog(file) {
  if (!existsSync(file)) return { missing: true };
  const lines = [];
  const text = readFileSync(file, 'utf8');
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    try {
      const line = JSON.parse(raw);
      if (!line || typeof line.ok !== 'boolean' || line.step === undefined) throw new Error('missing ok or step');
      lines.push(line);
    } catch (e) {
      return { invalid: `line ${index + 1}: ${e.message}` };
    }
  }
  return { lines };
}

export function failedSteps(lines) {
  const last = new Map();
  for (const line of lines) last.set(line.step, line);
  return [...last.values()].filter((line) => !line.ok).map((line) => ({ step: line.step, script: line.script ?? null, error: line.error ?? null }));
}


// ---------- structural self-check (mf-gate verify) ----------

/** The text of a "## Heading" section (up to the next "## "), or null. */
export function section(body, heading) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

/** The first Markdown table in a text: { headers, rows } (rows are arrays of trimmed cells), or null. */
export function parseTable(text) {
  if (!text) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (lines.length < 2 || !/^\|[\s:|-]+\|$/.test(lines[1])) return null;
  const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  return { headers: cells(lines[0]), rows: lines.slice(2).map(cells) };
}

const columnIndex = (table, needle) => table.headers.findIndex((h) => h.toLowerCase().includes(needle.toLowerCase()));
const hasPlaceholder = (text) => PLACEHOLDERS.filter((p) => text.includes(p));
const isNone = (text) => /^[-*]?\s*(немає|none|n\/a|—|-)\s*\.?$/i.test(text.trim());

/** Acceptance criteria of a task: [{ id, text }] from "- AC1: ..." lines of "## Критерії готовності". */
export function taskCriteria(taskText) {
  const artifact = parseArtifact(taskText);
  const body = section(artifact?.body ?? '', 'Критерії готовності') ?? '';
  return body.split('\n').map((l) => /^[-*]\s*(AC\d+)\s*[:.)-]\s*(.*)$/.exec(l.trim())).filter(Boolean).map((m) => ({ id: m[1], text: m[2].trim() }));
}

function run(checks) {
  const failed = checks.filter((c) => !c.ok);
  const passed = checks.length - failed.length;
  return { ok: failed.length === 0, checks, passed, total: checks.length, failed: failed.map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ''}`), line: failed.length ? `self-check: ${passed}/${checks.length}, failed: ${failed.map((c) => c.name).join(', ')}` : `self-check: ${passed}/${checks.length} pass` };
}

export function verifyTask(text) {
  const artifact = parseArtifact(text);
  const front = artifact?.front ?? {};
  const body = artifact?.body ?? '';
  const criteria = taskCriteria(text);
  const ids = criteria.map((c) => c.id);
  const checks = [
    { name: 'frontmatter', ok: !!artifact && ['id', 'type', 'flow', 'status', 'inputs', 'deadline'].every((k) => k in front), detail: 'id, type, flow, status, inputs, deadline are required' },
    { name: 'id', ok: /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-\d{2}$/.test(front.id ?? ''), detail: `"${front.id ?? ''}" is not <date>-<type>-<NN>` },
    { name: 'type', ok: TASK_TYPES.includes(front.type), detail: `type must be one of ${TASK_TYPES.join('|')}` },
    { name: 'inputs', ok: front.type === 'new' || /^inputs:[ \t]*\n(?:[ \t]+.*\n?)*?[ \t]+-[ \t]+\S/m.test(artifact?.frontText ? `${artifact.frontText}\n` : ''), detail: 'at least one input file (alias + path) is required unless the task type is new' },
    { name: 'description', ok: (section(body, 'Опис') ?? '').length >= 10, detail: '"## Опис" is empty' },
    { name: 'criteria', ok: criteria.length >= 1 && new Set(ids).size === ids.length && criteria.every((c) => c.text.length >= 8), detail: 'at least one "- AC1: <observable result>" line with a distinct id and a real sentence' },
    { name: 'no_placeholders', ok: hasPlaceholder(text).length === 0, detail: `template text left: ${hasPlaceholder(text).join(', ')}` },
  ];
  return run(checks);
}

export function verifyPlan(text, taskText) {
  const artifact = parseArtifact(text);
  const front = artifact?.front ?? {};
  const body = artifact?.body ?? '';
  const task = taskText ? parseArtifact(taskText) : null;
  const table = parseTable(section(body, 'Кроки'));
  const frameCol = table ? columnIndex(table, 'Кадр') : -1;
  const criteriaCol = table ? columnIndex(table, 'Критері') : -1;
  const resultCol = table ? columnIndex(table, 'Очікуван') : -1;
  const rows = table?.rows ?? [];
  const taskAcs = taskText ? taskCriteria(taskText).map((c) => c.id) : [];
  const covered = new Set(rows.flatMap((r) => (criteriaCol >= 0 ? (r[criteriaCol] ?? '').match(AC_ID) ?? [] : [])));
  const uncoveredText = section(body, 'Не охоплено планом') ?? '';
  const acknowledged = new Set(uncoveredText.match(AC_ID) ?? []);
  const missing = taskAcs.filter((id) => !covered.has(id) && !acknowledged.has(id));
  const orphans = rows.map((r, i) => ({ n: r[0] ?? String(i + 1), has: criteriaCol >= 0 && (r[criteriaCol] ?? '').match(AC_ID) })).filter((r) => !r.has).map((r) => r.n);
  const unknownAcs = [...covered].filter((id) => taskAcs.length && !taskAcs.includes(id));
  const checks = [
    { name: 'frontmatter', ok: !!artifact && ['task_id', 'status', 'approved_at', 'plan_sha256', 'project_copy', 'touches_protected', 'needs'].every((k) => k in front), detail: 'required keys are missing' },
    { name: 'task_id', ok: !!front.task_id && !/YYYY/.test(front.task_id) && (!task || front.task_id === task.front.id), detail: `plan is for "${front.task_id ?? ''}"${task ? `, task is "${task.front.id}"` : ''}` },
    { name: 'project_copy', ok: /\.aep$/i.test(front.project_copy ?? '') && /^work[\\/]/.test(front.project_copy ?? ''), detail: 'project_copy must be an .aep path under work/' },
    { name: 'touches_protected', ok: ['true', 'false'].includes(front.touches_protected), detail: 'must be true or false' },
    { name: 'steps_table', ok: !!table && rows.length >= 1 && frameCol >= 0 && criteriaCol >= 0 && resultCol >= 0, detail: 'a "## Кроки" table with columns for the expected result, the frame to check and the criteria (Критерії), and at least one row' },
    { name: 'frames_and_results', ok: rows.length > 0 && frameCol >= 0 && resultCol >= 0 && rows.every((r) => (r[frameCol] ?? '').length > 0 && (r[resultCol] ?? '').length > 0), detail: 'every step needs an expected result and a frame to check' },
    { name: 'steps_trace_to_criteria', ok: rows.length > 0 && orphans.length === 0 && unknownAcs.length === 0, detail: orphans.length ? `steps without a criterion: ${orphans.join(', ')} (a step nobody asked for)` : `unknown criteria: ${unknownAcs.join(', ')}` },
    { name: 'criteria_covered', ok: missing.length === 0, detail: `criteria with no step and not listed under "## Не охоплено планом": ${missing.join(', ')}` },
    { name: 'sections', ok: ['Ризики', 'Питання до людини', 'Не охоплено планом'].every((h) => section(body, h) !== null), detail: 'needed sections: Ризики, Питання до людини, Не охоплено планом (write "- немає" if empty)' },
    { name: 'no_placeholders', ok: hasPlaceholder(text).length === 0, detail: `template text left: ${hasPlaceholder(text).join(', ')}` },
  ];
  void isNone;
  return run(checks);
}

export function verifyCheck(text, taskText, planText, project) {
  const artifact = parseArtifact(text);
  const front = artifact?.front ?? {};
  const body = artifact?.body ?? '';
  const plan = planText ? parseArtifact(planText) : null;
  const planTable = plan ? parseTable(section(plan.body, 'Кроки')) : null;
  const compare = parseTable(section(body, 'Звірка з планом'));
  const verdictCol = compare ? columnIndex(compare, 'Вердикт') : -1;
  const ac = parseTable(section(body, 'Критерії готовності'));
  const acIdCol = ac ? 0 : -1;
  const acEvidenceCol = ac ? columnIndex(ac, 'Доказ') : -1;
  const acVerdictCol = ac ? columnIndex(ac, 'Вердикт') : -1;
  const taskAcs = taskText ? taskCriteria(taskText).map((c) => c.id) : [];
  const acRows = new Map((ac?.rows ?? []).map((r) => [(r[acIdCol] ?? '').match(AC_ID)?.[0], r]));
  const missingAc = taskAcs.filter((id) => !acRows.has(id));
  const badAc = taskAcs.filter((id) => {
    const r = acRows.get(id);
    return r && (!['PASS', 'FAIL', 'NOT_VERIFIED'].includes((r[acVerdictCol] ?? '').toUpperCase()) || (r[acEvidenceCol] ?? '').length < 3);
  });
  const planRowCount = planTable?.rows.length ?? 0;
  const allPass = compare && verdictCol >= 0 && compare.rows.every((r) => (r[verdictCol] ?? '').toUpperCase() === 'PASS') && ac && taskAcs.every((id) => (acRows.get(id)?.[acVerdictCol] ?? '').toUpperCase() === 'PASS');
  const frames = (section(body, 'Кадри') ?? '').split('\n').map((l) => /^[-*]\s*(\S+)/.exec(l.trim())?.[1]).filter(Boolean);
  const missingFrames = project ? frames.filter((f) => !existsSync(join(project, f))) : [];
  const independent = section(body, 'Незалежна перевірка') ?? '';
  const checks = [
    { name: 'frontmatter', ok: !!artifact && ['task_id', 'verdict', 'approved', 'approved_at'].every((k) => k in front), detail: 'required keys are missing' },
    { name: 'task_id', ok: !!plan && front.task_id === plan.front.task_id, detail: `check is for "${front.task_id ?? ''}"${plan ? `, plan is "${plan.front.task_id}"` : ''}` },
    { name: 'verdict', ok: ['PASS', 'ISSUES'].includes(front.verdict), detail: 'verdict must be PASS or ISSUES' },
    { name: 'plan_rows_compared', ok: !!compare && verdictCol >= 0 && compare.rows.length === planRowCount && planRowCount > 0, detail: `"## Звірка з планом" must have one row per plan step (${planRowCount})` },
    { name: 'criteria_traced', ok: !!ac && taskAcs.length > 0 && missingAc.length === 0 && badAc.length === 0, detail: missingAc.length ? `criteria with no row: ${missingAc.join(', ')}` : badAc.length ? `criteria with a bad verdict (PASS|FAIL|NOT_VERIFIED) or no evidence: ${badAc.join(', ')}` : 'a "## Критерії готовності" table (AC, Доказ, Вердикт) is required' },
    { name: 'verdict_consistent', ok: front.verdict === 'ISSUES' || !!allPass, detail: 'verdict PASS needs every plan row and every criterion to be PASS' },
    { name: 'frames_exist', ok: frames.length >= 1 && missingFrames.length === 0, detail: missingFrames.length ? `listed frames not found: ${missingFrames.join(', ')}` : 'list at least one frame under "## Кадри"' },
    { name: 'lint_section', ok: (section(body, 'Lint') ?? '').length >= 3, detail: '"## Lint" is empty (write what was run, or "lint skipped: <why>")' },
    { name: 'independent_pass', ok: independent.length >= 3, detail: '"## Незалежна перевірка" must say what the independent pass found, or "не виконувалась: <причина>"' },
    { name: 'no_placeholders', ok: hasPlaceholder(text).length === 0, detail: `template text left: ${hasPlaceholder(text).join(', ')}` },
  ];
  return run(checks);
}

export function verify(what, project) {
  const p = paths(project);
  const task = load(p.task);
  if (what === 'task') return task ? verifyTask(task.text) : refuse('verify task', 'file_missing', { missing: '.motion/task.md', create_with: '/motion-flow:intake' });
  if (what === 'plan') {
    const plan = load(p.plan);
    return plan ? verifyPlan(plan.text, task?.text) : refuse('verify plan', 'file_missing', { missing: '.motion/plan.md', create_with: '/motion-flow:plan' });
  }
  if (what === 'check') {
    const check = load(p.check);
    const plan = load(p.plan);
    return check ? verifyCheck(check.text, task?.text, plan?.text, project) : refuse('verify check', 'file_missing', { missing: '.motion/check.md', create_with: '/motion-flow:check' });
  }
  throw new Error(`Cannot verify "${what}". Use task, plan or check.`);
}

// ---------- the answers ----------

const refuse = (step, reason, extra = {}) => ({ ok: false, step, reason, ...extra });

function createWith(artifactName) {
  return `/motion-flow:${NEXT_STEP[artifactName]}`;
}

function missingFile(step, name, file, createdBy) {
  return refuse(step, 'file_missing', { missing: `.motion/${file}`, create_with: createWith(createdBy) });
}

/** Checks that task.md and plan.md exist, belong together, and the approved plan is unchanged. Returns a refusal or null. */
function checkApprovedPlan(step, p) {
  const plan = load(p.plan);
  if (!plan) return missingFile(step, 'plan', 'plan.md', 'plan');
  if (!plan.artifact) return refuse(step, 'plan_not_approved', { missing: '.motion/plan.md', create_with: '/motion-flow:plan', detail: 'plan.md has no frontmatter' });
  const { front } = plan.artifact;
  if (front.status !== 'approved' || !isSet(front.approved_at) || !isSet(front.plan_sha256)) {
    return refuse(step, 'plan_not_approved', { missing: '.motion/plan.md', create_with: '/motion-flow:plan' });
  }
  if (planBodyHash(plan.text) !== front.plan_sha256) {
    return refuse(step, 'plan_changed_after_approval', { missing: '.motion/plan.md', create_with: '/motion-flow:plan', detail: 'The plan was edited after it was approved.' });
  }
  const task = load(p.task);
  if (task?.artifact && front.task_id !== task.artifact.front.id) {
    return refuse(step, 'task_mismatch', { detail: `plan.md is for task ${front.task_id}, task.md is ${task.artifact.front.id}`, create_with: '/motion-flow:plan' });
  }
  return null;
}

export function requireStep(step, project) {
  const p = paths(project);
  if (step === 'plan') {
    const task = load(p.task);
    if (!task) return missingFile(step, 'task', 'task.md', 'task');
    if (!task.artifact) return refuse(step, 'task_not_ready', { missing: '.motion/task.md', create_with: '/motion-flow:intake', detail: 'task.md has no frontmatter' });
    if (task.artifact.front.status !== 'ready') return refuse(step, 'task_not_ready', { missing: '.motion/task.md', create_with: '/motion-flow:intake', detail: 'task.md is still a draft' });
    const checked = verifyTask(task.text);
    if (!checked.ok) return refuse(step, 'task_incomplete', { missing: '.motion/task.md', create_with: '/motion-flow:intake', failed: checked.failed });
    return { ok: true, step };
  }
  if (step === 'build') return checkApprovedPlan(step, p) ?? { ok: true, step };
  if (step === 'check') {
    const log = readBuildLog(p.log);
    if (log.missing) return refuse(step, 'build_log_missing', { missing: '.motion/build.log.jsonl', create_with: '/motion-flow:build' });
    if (log.invalid) return refuse(step, 'build_log_invalid', { detail: log.invalid, create_with: '/motion-flow:build' });
    if (log.lines.length === 0) return refuse(step, 'build_log_missing', { missing: '.motion/build.log.jsonl', create_with: '/motion-flow:build', detail: 'The build log is empty.' });
    const failed = failedSteps(log.lines);
    if (failed.length) return refuse(step, 'build_failed', { failed, create_with: '/motion-flow:build' });
    return checkApprovedPlan(step, p) ?? { ok: true, step };
  }
  if (step === 'deliver') {
    const check = load(p.check);
    if (!check) return missingFile(step, 'check', 'check.md', 'check');
    const front = check.artifact?.front ?? {};
    if (front.approved !== 'true' || !isSet(front.approved_at)) return refuse(step, 'check_not_approved', { missing: '.motion/check.md', create_with: '/motion-flow:check' });
    const planProblem = checkApprovedPlan(step, p);
    if (planProblem) return planProblem;
    const plan = load(p.plan);
    if (front.task_id !== plan.artifact.front.task_id) return refuse(step, 'task_mismatch', { detail: `check.md is for task ${front.task_id}, plan.md is ${plan.artifact.front.task_id}`, create_with: '/motion-flow:check' });
    return { ok: true, step };
  }
  throw new Error(`Unknown step "${step}". Use one of: ${STEPS.join(', ')}.`);
}

// ---------- approvals ----------

function writeAtomically(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

export function approve(what, project, now = new Date()) {
  const p = paths(project);
  if (what === 'plan') {
    const ready = requireStep('plan', project);
    if (!ready.ok) return { ...ready, step: 'approve plan' };
    const plan = load(p.plan);
    if (!plan) return refuse('approve plan', 'file_missing', { missing: '.motion/plan.md', create_with: '/motion-flow:plan' });
    if (!plan.artifact) return refuse('approve plan', 'plan_incomplete', { detail: 'plan.md has no frontmatter' });
    const task = load(p.task);
    if (plan.artifact.front.task_id !== task.artifact.front.id) return refuse('approve plan', 'task_mismatch', { detail: `plan.md is for task ${plan.artifact.front.task_id}, task.md is ${task.artifact.front.id}` });
    const checked = verifyPlan(plan.text, task.text);
    if (!checked.ok) return refuse('approve plan', 'plan_incomplete', { failed: checked.failed, create_with: '/motion-flow:plan' });
    const sha = planBodyHash(plan.text);
    const stamp = now.toISOString();
    writeAtomically(p.plan, setFrontmatter(plan.text, { status: 'approved', approved_at: stamp, plan_sha256: sha }));
    return { ok: true, step: 'approve plan', plan_sha256: sha, approved_at: stamp };
  }
  if (what === 'check') {
    const build = requireStep('check', project);
    if (!build.ok) return { ...build, step: 'approve check' };
    const check = load(p.check);
    if (!check) return refuse('approve check', 'file_missing', { missing: '.motion/check.md', create_with: '/motion-flow:check' });
    const front = check.artifact?.front ?? {};
    const plan = load(p.plan);
    if (front.task_id !== plan.artifact.front.task_id) return refuse('approve check', 'task_mismatch', { detail: `check.md is for task ${front.task_id}, plan.md is ${plan.artifact.front.task_id}` });
    const task = load(p.task);
    const checked = verifyCheck(check.text, task?.text, plan.text, project);
    if (!checked.ok) return refuse('approve check', 'check_incomplete', { failed: checked.failed, create_with: '/motion-flow:check' });
    const stamp = now.toISOString();
    writeAtomically(p.check, setFrontmatter(check.text, { approved: 'true', approved_at: stamp }));
    return { ok: true, step: 'approve check', approved_at: stamp };
  }
  throw new Error(`Cannot approve "${what}". Use plan or check.`);
}

// ---------- archive ----------

/**
 * Moves the artifacts of the finished (or abandoned) task into .motion/archive/<task id>/ so a new task can start.
 * The agent cannot use mv or rm for this (the guard hook blocks them outside work/), and nothing is deleted:
 * state.json, drive.json and overrides.md stay where they are.
 */
export function archive(project, { abandon = false, now = new Date() } = {}) {
  const p = paths(project);
  const task = load(p.task);
  const plan = load(p.plan);
  const id = task?.artifact?.front.id ?? plan?.artifact?.front.task_id;
  if (!id) return refuse('archive', 'file_missing', { missing: '.motion/task.md', detail: 'There is no task to archive.' });
  if (!abandon && !existsSync(p.deliver)) {
    return refuse('archive', 'not_delivered', { detail: 'The task has no deliver.md yet. Finish it with /motion-flow:deliver, or archive it as abandoned.', abandon_flag: '--abandon' });
  }
  if (/[\\/]|\.\./.test(id)) return refuse('archive', 'bad_task_id', { detail: `The task id "${id}" is not usable as a folder name.` });
  let target = join(p.dir, 'archive', id);
  if (existsSync(target)) target = `${target}-${now.toISOString().replace(/[:.]/g, '-')}`;
  mkdirSync(target, { recursive: true });
  const moved = [];
  for (const name of ['task.md', 'plan.md', 'build.log.jsonl', 'check.md', 'deliver.md', 'snapshots']) {
    const from = join(p.dir, name);
    if (existsSync(from)) {
      renameSync(from, join(target, name));
      moved.push(name);
    }
  }
  return { ok: true, step: 'archive', task_id: id, abandoned: abandon, archived_to: `.motion/archive/${target.split(/[\\/]/).pop()}`, moved };
}

// ---------- status ----------

export function status(project) {
  const p = paths(project);
  const out = {};
  const task = load(p.task);
  out.task = task ? (task.artifact?.front.status ?? 'invalid') : 'missing';
  const plan = load(p.plan);
  if (!plan) out.plan = 'missing';
  else if (!plan.artifact) out.plan = 'invalid';
  else if (plan.artifact.front.status === 'approved') out.plan = planBodyHash(plan.text) === plan.artifact.front.plan_sha256 ? 'approved' : 'changed_after_approval';
  else out.plan = 'draft';
  const log = readBuildLog(p.log);
  if (log.missing) out.build = 'missing';
  else if (log.invalid) out.build = 'invalid';
  else out.build = log.lines.length === 0 ? 'empty' : failedSteps(log.lines).length ? 'failed' : 'ok';
  const check = load(p.check);
  out.check = !check ? 'missing' : !check.artifact ? 'invalid' : `${check.artifact.front.verdict ?? 'unknown'}${check.artifact.front.approved === 'true' ? ', approved' : ', not approved'}`;
  out.deliver = existsSync(p.deliver) ? 'delivered' : 'missing';
  return { ok: true, ...out };
}

// ---------- command line ----------

export function main(argv, ctx = {}) {
  const out = ctx.stdout ?? process.stdout;
  const project = resolve(ctx.cwd ?? process.cwd(), argv.includes('--project') ? argv[argv.indexOf('--project') + 1] ?? '.' : '.');
  const args = argv.filter((a, i) => a !== '--project' && argv[i - 1] !== '--project');
  const emit = (value) => out.write(`${JSON.stringify(value)}\n`);
  try {
    const [command, target] = args;
    let result;
    if (command === 'require') result = requireStep(target, project);
    else if (command === 'hash' && target === 'plan') {
      const plan = load(paths(project).plan);
      result = plan ? { ok: true, plan_sha256: planBodyHash(plan.text) } : refuse('hash plan', 'file_missing', { missing: '.motion/plan.md', create_with: '/motion-flow:plan' });
    } else if (command === 'approve') result = approve(target, project, ctx.now);
    else if (command === 'status') result = status(project);
    else if (command === 'verify') result = verify(target, project);
    else if (command === 'archive') result = archive(project, { abandon: args.includes('--abandon'), now: ctx.now });
    else throw new Error('Usage: mf-gate require <plan|build|check|deliver> | hash plan | approve <plan|check> | status | archive [--abandon] | verify <task|plan|check>  [--project <dir>]');
    emit(result);
    return result.ok ? 0 : 1;
  } catch (error) {
    emit({ ok: false, reason: 'usage', error: error.message });
    return 2;
  }
}
