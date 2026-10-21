// corpus-run: the file side of the corpus tools. Finds the example projects, dumps each one with ae-dump (one at a
// time: After Effects runs one script at a time), and turns the dumps into analysis.json, pairs.json and report.md.
// Everything stays inside work/. The counting itself is in corpus.mjs.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, diffDumps, extractFacts, findPairs, renderReport, typicalChanges } from './corpus.mjs';
import { validateDump } from './dump-schema.mjs';
import { isInside, realish } from './work-paths.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_FOLDERS = new Set(['.ipc', 'node_modules', 'Adobe After Effects Auto-Save']);

export class CorpusError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

/** The real work/ folder of the project; every path the tools read or write must be inside it. */
function workFolder(cwd) {
  return realish(resolve(cwd, 'work'));
}

function insideWork(path, cwd, what) {
  const real = realish(resolve(cwd, path));
  if (!isInside(workFolder(cwd), real) || real === workFolder(cwd)) throw new CorpusError('outside_work', `${what} must be inside work/: ${path}`, 'Copy the example projects into work/examples/ first (drive-gate fetch ... --to work/examples/).');
  return real;
}

const safeId = (text) => text.replace(/\.aep$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';

function walk(dir, base) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || SKIP_FOLDERS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, base);
    return entry.isFile() && /\.aep$/i.test(entry.name) ? [path] : [];
  });
}

/** Every .aep under the examples folder. The group is the first folder below it (a client or a campaign), or ''. */
export function discoverProjects(examples, cwd = process.cwd()) {
  const root = insideWork(examples, cwd, 'The examples folder');
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new CorpusError('no_examples', `No such folder: ${examples}`);
  const files = walk(root, root).sort();
  return files.map((file, i) => {
    const parts = relative(root, file).split(sep);
    return {
      id: `p${String(i + 1).padStart(3, '0')}-${safeId(basename(file))}`,
      file: basename(file),
      path: relative(realish(resolve(cwd)), file).split(sep).join('/'),
      group: parts.length > 1 ? parts[0] : '',
      mtimeMs: Math.round(statSync(file).mtimeMs),
    };
  });
}

/** Runs ae-dump for a project. Resolves { ok } or { ok: false, error }. */
export function runAeDump(project, outFile, { cwd = process.cwd(), timeoutMs = 600000 } = {}) {
  return new Promise((resolveRun) => {
    execFile(process.execPath, [join(PLUGIN_ROOT, 'bin', 'ae-dump'), '--project', project, '--out', outFile], { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolveRun({ ok: true });
      let detail = String(stdout || stderr || error.message).trim();
      try { const parsed = JSON.parse(detail); detail = [parsed.error, parsed.hint].filter(Boolean).join(' '); } catch { /* not JSON */ }
      resolveRun({ ok: false, error: detail.slice(0, 400) });
    });
  });
}

/**
 * Dumps every project that has no up-to-date dump yet. Failures do not stop the run: the project is listed with its error.
 * Writes <out>/index.json. `run(projectPath, outFile)` can be replaced in tests.
 */
export async function dumpAll({ examples, out, cwd = process.cwd(), run = (project, file) => runAeDump(project, file, { cwd }), onProgress = () => {} }) {
  const projects = discoverProjects(examples, cwd);
  const outDir = insideWork(out, cwd, 'The output folder');
  mkdirSync(outDir, { recursive: true });
  const index = [];
  for (const [i, project] of projects.entries()) {
    const dumpFile = `${project.id}.dump.json`;
    const target = join(outDir, dumpFile);
    const fresh = existsSync(target) && statSync(target).mtimeMs >= project.mtimeMs;
    let result = { ok: true, reused: true };
    if (!fresh) {
      onProgress({ n: i + 1, total: projects.length, project });
      result = await run(project.path, relative(realish(resolve(cwd)), target).split(sep).join('/'));
    }
    index.push({ ...project, dump: dumpFile, ok: result.ok, ...(result.error ? { error: result.error } : {}), ...(result.reused ? { reused: true } : {}) });
  }
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return { projects: index.length, dumped: index.filter((p) => p.ok && !p.reused).length, reused: index.filter((p) => p.reused).length, failed: index.filter((p) => !p.ok).map((p) => ({ id: p.id, path: p.path, error: p.error })) };
}

/** Reads index.json and the dumps. Dumps that fail validation are reported and left out. */
export function loadCorpus(dir, cwd = process.cwd()) {
  const outDir = insideWork(dir, cwd, 'The corpus folder');
  const indexFile = join(outDir, 'index.json');
  if (!existsSync(indexFile)) throw new CorpusError('no_index', `No index.json in ${dir}`, 'Run "sb-corpus dump" first.');
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const rows = [];
  const dumps = new Map();
  const skipped = [];
  for (const entry of index) {
    if (!entry.ok) { skipped.push({ id: entry.id, reason: entry.error ?? 'dump failed' }); continue; }
    let dump;
    try { dump = JSON.parse(readFileSync(join(outDir, entry.dump), 'utf8')); } catch (e) { skipped.push({ id: entry.id, reason: `unreadable dump: ${e.message}` }); continue; }
    const problems = validateDump(dump);
    if (problems.length) { skipped.push({ id: entry.id, reason: `invalid dump: ${problems[0]}` }); continue; }
    rows.push(extractFacts(dump, entry));
    dumps.set(entry.id, dump);
  }
  return { rows, dumps, skipped, outDir };
}

/** Analyzes the dumps and writes analysis.json, pairs.json and report.md next to them. */
export function analyzeCorpus({ dir, cwd = process.cwd() }) {
  const { rows, dumps, skipped, outDir } = loadCorpus(dir, cwd);
  const analysis = analyze(rows);
  const diffs = findPairs(rows).map((pair) => ({ ...pair, signatures: diffDumps(dumps.get(pair.before), dumps.get(pair.after)) }));
  const pairs = { pairs: diffs.length, typical: typicalChanges(diffs), diffs };
  writeFileSync(join(outDir, 'analysis.json'), `${JSON.stringify({ ...analysis, skipped }, null, 2)}\n`);
  writeFileSync(join(outDir, 'pairs.json'), `${JSON.stringify(pairs, null, 2)}\n`);
  writeFileSync(join(outDir, 'report.md'), renderReport(analysis, pairs));
  return { projects: rows.length, skipped, questions: analysis.questions.length, pairs: diffs.length, report: relative(realish(resolve(cwd)), join(outDir, 'report.md')).split(sep).join('/') };
}

