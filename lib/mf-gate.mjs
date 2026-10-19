// mf-gate: gating as code. Steps ask it whether they may start; it also records the human approvals.
//   mf-gate require <plan|build|check|deliver>
//   mf-gate hash plan
//   mf-gate approve <plan|check>
//   mf-gate status
//   mf-gate archive [--abandon]
// Artifacts live in <project>/.motion/ (see skills/_shared/artifact-formats.md). Output is one JSON object.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const STEPS = ['plan', 'build', 'check', 'deliver'];

const NEXT_STEP = { task: 'intake', plan: 'plan', build: 'build', check: 'check' };
const PLAN_PLACEHOLDERS = ['<comp / layer / property>', '<what changes>', '<what should be true afterwards>'];
const CHECK_PLACEHOLDERS = ['<from plan.md>', "<what the dump or frame shows>"];

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
    const leftover = PLAN_PLACEHOLDERS.filter((text) => plan.text.includes(text));
    if (/YYYY/.test(plan.artifact.front.task_id ?? 'YYYY') || leftover.length) {
      return refuse('approve plan', 'plan_incomplete', { detail: leftover.length ? `Unfilled template text: ${leftover.join(', ')}` : 'task_id is not filled in', create_with: '/motion-flow:plan' });
    }
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
    if (!['PASS', 'ISSUES'].includes(front.verdict)) return refuse('approve check', 'check_incomplete', { detail: 'verdict must be PASS or ISSUES', create_with: '/motion-flow:check' });
    const leftover = CHECK_PLACEHOLDERS.filter((text) => check.text.includes(text));
    if (leftover.length) return refuse('approve check', 'check_incomplete', { detail: `Unfilled template text: ${leftover.join(', ')}`, create_with: '/motion-flow:check' });
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
    else if (command === 'archive') result = archive(project, { abandon: args.includes('--abandon'), now: ctx.now });
    else throw new Error('Usage: mf-gate require <plan|build|check|deliver> | hash plan | approve <plan|check> | status | archive [--abandon]  [--project <dir>]');
    emit(result);
    return result.ok ? 0 : 1;
  } catch (error) {
    emit({ ok: false, reason: 'usage', error: error.message });
    return 2;
  }
}
