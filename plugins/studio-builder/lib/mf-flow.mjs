// mf-flow: checks, versions and packs a flow folder (SKILL.md, flow.md, example/).
//   mf-flow check <flow folder>
//   mf-flow bump <flow folder> <patch|minor|major> --note "<what changed, in English>"
//   mf-flow pack <flow folder> [--out <path inside work/>] [--overwrite]
// A flow tunes the five steps for one kind of task. It may add questions, steps and checks, but it must not
// weaken the safety rules. These checks catch mistakes and obvious misuse; the review by a person is the real gate.
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseArtifact, section, setFrontmatter } from './artifact.mjs';
import { loadConfig, GateError } from './drive-gate.mjs';
import { parseDeps } from './deps.mjs';
import { PathError, safeOutputPath } from './work-paths.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const STATUSES = ['draft', 'reviewed', 'approved'];
const SAFETY_SENTENCE = 'does not change or weaken `_shared/safety.md`';
const FLOW_HEADINGS = [
  'What this flow is for', 'What starts it (3 example phrases)', 'Inputs', 'Steps in order', 'Where the designer decides',
  'What must not be touched', 'How to tell it is done', 'Examples (links to example/)',
];
const MAX_SKILL_LINES = 500;
const MAX_EXAMPLE_BYTES = 200 * 1024;
const EXAMPLE_EXTENSIONS = new Set(['.md', '.json', '.txt']);
const PLACEHOLDER = /<[A-Za-z][^<>\n]{2,}>/;
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x0400)}-${String.fromCharCode(0x04ff)}]`);

// Instructions a flow must never contain: they would loosen the gates, touch the safety settings, or reach around the tools.
const UNSAFE = [
  [/\b(skip|bypass|ignore|disable|omit|avoid)\b[^.\n]{0,40}\b(approval|approvals|gate|gates|safety|guard|hook|confirmation|confirmations|verification)\b/i, 'tells the agent to skip or weaken a gate, an approval or a safety rule', true],
  [/\bwithout\b[^.\n]{0,20}\b(asking|approval|confirmation|the designer)\b/i, 'tells the agent to act without asking or approval', true],
  [/\bapprove\b[^.\n]{0,30}\b(automatically|yourself|on your own)\b/i, 'tells the agent to approve on its own', true],
  [/\bmf-gate\s+approve\b/, 'calls mf-gate approve (only the five steps do, after the designer answered)'],
  [/(\.motion\/drive\.json|roots\.json|\.claude\/settings|~\/\.motion-flow|\bplan_sha256\b|build\.log\.jsonl)/, 'touches a safety setting or a gate record'],
  [/\b(mf-setup|mf-init)\b/, 'configures Drive or the project (only the designer does that)'],
  [/\b(afterfx|aerender)\b|osascript|system\.callSystem|\bDoScript/i, 'starts After Effects or runs a command outside ae-run'],
  [/git\s+push|git\s+reset\s+--hard|git\s+clean|--force\b|rm\s+-rf/, 'a destructive or outward-facing command'],
  [/drive-gate\s+(put|rm|mv|delete|remove|rename|share|write|upload|cp)\b/, 'a drive-gate write command (drive-gate has none)'],
  [/\b(trash_file|update_file|share_file|create_file|copy_file)\b/, 'a Drive write tool'],
  [/\b(gdrive|rclone)\b/, 'a tool that writes to Drive'],
];
// Machine and client data: a flow is shared, so it must hold none.
const PRIVATE = [
  [/\/Users\/|\/home\/[a-z]|[A-Za-z]:\\\\|[A-Za-z]:\\[A-Za-z]/, 'a machine path'],
  [/CloudStorage|Google Drive\//, 'a Drive path'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, 'an e-mail address'],
];

function listFromFront(value) {
  return (value ?? '').replace(/^\[|\]$/g, '').split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function textFilesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? textFilesIn(path) : [path];
  });
}

function result(checks) {
  const failed = checks.filter((c) => !c.ok);
  return {
    ok: failed.length === 0, checks, passed: checks.length - failed.length, total: checks.length,
    failed: failed.map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ''}`),
    line: failed.length ? `flow check: ${checks.length - failed.length}/${checks.length}, failed: ${failed.map((c) => c.name).join(', ')}` : `flow check: ${checks.length}/${checks.length} pass`,
  };
}

export function checkFlow(folder, { pluginRoot = PLUGIN_ROOT } = {}) {
  const dir = resolve(folder);
  const name = basename(dir);
  const skillFile = join(dir, 'SKILL.md');
  const flowFile = join(dir, 'flow.md');
  const exampleFile = join(dir, 'example', 'README.md');
  const filesOk = existsSync(skillFile) && existsSync(flowFile) && existsSync(exampleFile);
  const checks = [{ name: 'files', ok: filesOk, detail: 'SKILL.md, flow.md and example/README.md are required' }];
  if (!filesOk) return result(checks);

  const skillText = readFileSync(skillFile, 'utf8');
  const flowText = readFileSync(flowFile, 'utf8');
  const exampleText = readFileSync(exampleFile, 'utf8');
  const skill = parseArtifact(skillText);
  const flow = parseArtifact(flowText);
  const description = skill?.front.description ?? '';
  const phrases = [...description.matchAll(/["“]([^"”]{4,})["”]/g)];
  const needs = listFromFront(flow?.front.needs);
  let known = [];
  try { known = parseDeps(readFileSync(join(pluginRoot, 'deps.json'), 'utf8')).map((d) => d.name); } catch { /* deps.json is checked elsewhere */ }
  const unknownNeeds = needs.filter((n) => !known.includes(n));
  const body = flow?.body ?? '';
  const emptySections = FLOW_HEADINGS.filter((h) => (section(body, h) ?? '').length < 3);
  const placeholders = [skillText, flowText, exampleText].filter((t) => PLACEHOLDER.test(t.replace(/`[^`]*`/g, '')));
  const all = [['SKILL.md', skillText], ['flow.md', flowText], ['example/README.md', exampleText]];
  const unsafe = [];
  const privates = [];
  for (const [file, text] of all) {
    text.split('\n').forEach((line, i) => {
      for (const [pattern, what, negatable] of UNSAFE) {
        const match = pattern.exec(line);
        if (!match) continue;
        // "never skip the approval" forbids the thing; only an instruction to do it is an error
        if (negatable && /\b(never|not|no|don't|cannot|can't|must not)\b/i.test(line.slice(Math.max(0, match.index - 40), match.index + match[0].length))) continue;
        unsafe.push(`${file}:${i + 1} ${what}`);
      }
      for (const [pattern, what] of PRIVATE) if (pattern.test(line)) privates.push(`${file}:${i + 1} ${what}`);
    });
  }
  const exampleSections = (exampleText.match(/^## Example \d+/gm) ?? []).length;
  const whyOne = (section(exampleText.replace(/\r\n?/g, '\n'), 'Why only one example') ?? '').length >= 10;
  // Many examples are summarized, not listed one by one: "## Evidence" says how many were seen ("18 examples, 9 version pairs").
  const evidenceText = section(exampleText.replace(/\r\n?/g, '\n'), 'Evidence') ?? '';
  const evidenceExamples = Math.max(0, ...[...evidenceText.matchAll(/(\d+)\s+(?:examples?|projects?)/gi)].map((m) => Number(m[1])));
  const exampleFiles = textFilesIn(join(dir, 'example'));
  const badExampleFiles = exampleFiles.filter((f) => !EXAMPLE_EXTENSIONS.has(extname(f).toLowerCase()));
  const exampleBytes = exampleFiles.reduce((sum, f) => sum + statSync(f).size, 0);

  checks.push(
    { name: 'skill_frontmatter', ok: !!skill && KEBAB.test(skill.front.name ?? '') && skill.front.name === name && !!description && !!skill.front.model, detail: `SKILL.md needs name (equal to the folder "${name}", kebab-case), description and model` },
    { name: 'description_phrases', ok: phrases.length >= 3, detail: `the description must contain at least 3 example phrases in quotes (found ${phrases.length})` },
    { name: 'flow_frontmatter', ok: !!flow && flow.front.name === name && SEMVER.test(flow.front.version ?? '') && !!flow.front.owner && !PLACEHOLDER.test(flow.front.owner) && STATUSES.includes(flow.front.status) && 'needs' in flow.front, detail: `flow.md needs name (= "${name}"), version x.y.z, owner, status (${STATUSES.join('|')}) and needs` },
    { name: 'needs_known', ok: unknownNeeds.length === 0, detail: `needs lists tools that are not in deps.json: ${unknownNeeds.join(', ')}` },
    { name: 'flow_sections', ok: !!flow && emptySections.length === 0, detail: `missing or empty sections: ${emptySections.join('; ')}` },
    { name: 'no_placeholders', ok: placeholders.length === 0, detail: 'template placeholders like <...> are still in the files' },
    { name: 'safety_sentence', ok: skillText.includes(SAFETY_SENTENCE), detail: `SKILL.md must say that the flow ${SAFETY_SENTENCE}` },
    { name: 'no_unsafe_instructions', ok: unsafe.length === 0, detail: unsafe.slice(0, 5).join('; ') },
    { name: 'no_private_data', ok: privates.length === 0, detail: privates.slice(0, 5).join('; ') },
    { name: 'examples', ok: (exampleSections >= 2 || evidenceExamples >= 2 || whyOne) && badExampleFiles.length === 0 && exampleBytes <= MAX_EXAMPLE_BYTES, detail: exampleSections < 2 && evidenceExamples < 2 && !whyOne ? 'example/README.md needs at least two "## Example N" sections, an "## Evidence" section that counts at least two examples ("18 examples, 9 version pairs"), or a "## Why only one example" section' : badExampleFiles.length ? `example/ may hold only .md, .json and .txt files: ${badExampleFiles.map((f) => basename(f)).join(', ')}` : `example/ is larger than ${MAX_EXAMPLE_BYTES / 1024} KB` },
    { name: 'size', ok: skillText.split('\n').length <= MAX_SKILL_LINES, detail: `SKILL.md is longer than ${MAX_SKILL_LINES} lines` },
    { name: 'english', ok: !all.some(([, t]) => CYRILLIC.test(t)), detail: 'the final flow files are English (the designer-language draft is kept outside the flow folder)' },
  );
  return result(checks);
}

// ---------- bump ----------

const LEVELS = ['patch', 'minor', 'major'];

export function nextVersion(version, level) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Raises the flow's version, resets its status to draft (a changed flow must be reviewed again), and adds the
 * change to the flow's CHANGELOG.md (newest first). The note is part of the final files, so it must be English.
 */
export function bumpFlow(folder, level, note, { now = new Date() } = {}) {
  const dir = resolve(folder);
  const flowFile = join(dir, 'flow.md');
  if (!existsSync(flowFile)) return { ok: false, reason: 'file_missing', error: `${flowFile} not found` };
  if (!LEVELS.includes(level)) return { ok: false, reason: 'usage', error: `The level must be one of ${LEVELS.join(', ')}.` };
  if (typeof note !== 'string' || note.trim().length < 5) return { ok: false, reason: 'usage', error: 'A note of at least 5 characters is required (--note "...").' };
  if (CYRILLIC.test(note)) return { ok: false, reason: 'usage', error: 'The note goes into the final flow files: write it in English.' };
  if (/[\r\n]/.test(note)) return { ok: false, reason: 'usage', error: 'The note must be one line.' };
  const text = readFileSync(flowFile, 'utf8');
  const flow = parseArtifact(text);
  if (!flow || !SEMVER.test(flow.front.version ?? '')) return { ok: false, reason: 'bad_flow', error: 'flow.md has no valid version (x.y.z).' };
  const version = nextVersion(flow.front.version, level);
  writeFileSync(flowFile, setFrontmatter(text, { version, status: 'draft' }));
  const changelogFile = join(dir, 'CHANGELOG.md');
  const entry = `## ${version} (${now.toISOString().slice(0, 10)})\n\n- ${note.trim()}\n`;
  const old = existsSync(changelogFile) ? readFileSync(changelogFile, 'utf8') : '# Changelog\n';
  const head = old.startsWith('# ') ? old.slice(0, old.indexOf('\n') + 1) : '# Changelog\n';
  const rest = old.startsWith('# ') ? old.slice(old.indexOf('\n') + 1).replace(/^\n+/, '') : old;
  writeFileSync(changelogFile, `${head}\n${entry}${rest ? `\n${rest}` : ''}`);
  return { ok: true, previous: flow.front.version, version, status: 'draft', changelog: 'CHANGELOG.md' };
}

// ---------- pack (a small zip writer: no dependencies) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // 1980-01-01: fixed, so packing the same flow twice gives the same bytes

/** entries: [{ name, data: Buffer }]. Returns the zip file as a Buffer. */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const deflated = data.length ? deflateRawSync(data, { level: 9 }) : Buffer.alloc(0);
    const useDeflate = data.length > 0 && deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const PACK_SKIP_NAMES = new Set(['.DS_Store', 'node_modules', '__pycache__', 'Thumbs.db']);

function packEntries(dir, name) {
  const entries = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (PACK_SKIP_NAMES.has(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue; // never follow links out of the flow folder
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) entries.push({ name: `${name}/${relative(dir, path).split(sep).join('/')}`, data: readFileSync(path) });
    }
  };
  walk(dir);
  return entries;
}

/**
 * Packs a checked flow into <out> (default work/out/flow-<name>-<version>.zip), inside the project's work folder.
 * It refuses a flow that fails mf-flow check and never overwrites an existing package without `overwrite`.
 */
export function packFlow(folder, { out, cwd = process.cwd(), home = homedir(), overwrite = false, pluginRoot } = {}) {
  const dir = resolve(folder);
  const checked = checkFlow(dir, { pluginRoot });
  if (!checked.ok) return { ok: false, reason: 'flow_check_failed', failed: checked.failed, line: checked.line };
  const flow = parseArtifact(readFileSync(join(dir, 'flow.md'), 'utf8'));
  const name = basename(dir);
  let config;
  try {
    config = loadConfig(join(home, '.motion-flow'));
  } catch (e) {
    if (e instanceof GateError) return { ok: false, reason: e.code, error: e.message, hint: e.hint };
    throw e;
  }
  let workReal;
  try {
    workReal = realpathSync.native(resolve(cwd, config.workDir));
  } catch {
    return { ok: false, reason: 'no_work_folder', error: 'The project has no work/ folder yet.', hint: 'Run /motion-flow:init-project first.' };
  }
  const outArg = out ?? join(config.workDir, 'out', `flow-${name}-${flow.front.version}.zip`);
  let target;
  try {
    target = safeOutputPath({ outArg, cwd, workReal, extension: '.zip' });
  } catch (e) {
    if (e instanceof PathError) return { ok: false, reason: e.code, error: e.message, hint: e.hint };
    throw e;
  }
  const cwdReal = realpathSync.native(cwd);
  if (existsSync(target) && !overwrite) return { ok: false, reason: 'exists', error: `${relative(cwdReal, target)} already exists.`, hint: 'Raise the flow version with mf-flow bump, or pass --overwrite.' };
  const entries = packEntries(dir, name);
  const zip = buildZip(entries);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, zip);
  renameSync(temp, target);
  return { ok: true, out: relative(cwdReal, target).split(sep).join('/'), name, version: flow.front.version, files: entries.map((e) => e.name), bytes: zip.length, check: checked.line };
}

export function main(argv, ctx = {}) {
  const out = ctx.stdout ?? process.stdout;
  const emit = (value) => out.write(`${JSON.stringify(value)}\n`);
  const option = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null; };
  const [command, folder, third] = argv;
  const usage = 'Usage: mf-flow check <folder> | bump <folder> <patch|minor|major> --note "<text>" | pack <folder> [--out <path>] [--overwrite]';
  if (!['check', 'bump', 'pack'].includes(command) || !folder) { emit({ ok: false, error: usage }); return 2; }
  if (!existsSync(folder) || !statSync(folder).isDirectory()) { emit({ ok: false, error: `Not a folder: ${folder}` }); return 2; }
  let result;
  if (command === 'check') result = checkFlow(folder, { pluginRoot: ctx.pluginRoot });
  else if (command === 'bump') {
    if (!third || third.startsWith('--')) { emit({ ok: false, error: usage }); return 2; }
    result = bumpFlow(folder, third, option('--note'), { now: ctx.now });
    if (result.reason === 'usage') { emit(result); return 2; }
  } else result = packFlow(folder, { out: option('--out') ?? undefined, cwd: ctx.cwd, home: ctx.home, overwrite: argv.includes('--overwrite'), pluginRoot: ctx.pluginRoot });
  emit(result);
  return result.ok ? 0 : 1;
}
