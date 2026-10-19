// whats-new: what changed in the studio rules since the designer last looked.
//   mf-whatsnew --changelog <CHANGELOG.md> [--state .motion/state.json] [--limit N]
//   mf-whatsnew --mark-seen <version> [--state .motion/state.json]
// The changelog uses "## <version>" headings with "- " bullet lines (newest first). A bullet that names a flow
// ("flow `resize-formats`: ...") is reported under that flow. Only last_seen_rules_version in state.json is written,
// and only by --mark-seen.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION = /^\d+\.\d+\.\d+$/;
const FLOW_MENTION = /\bflow\s+[`'"]?([a-z0-9]+(?:-[a-z0-9]+)*)[`'"]?/i;

export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

/** Parses the changelog into [{ version, date, items: [{ text, flow }] }], in file order. */
export function parseChangelog(text) {
  const releases = [];
  let current = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^##\s+v?(\d+\.\d+\.\d+)\b\s*(?:\(([^)]*)\))?\s*$/.exec(raw.trim());
    if (heading) {
      current = { version: heading[1], date: heading[2] ?? null, items: [] };
      releases.push(current);
      continue;
    }
    const bullet = /^[-*]\s+(.*\S)\s*$/.exec(raw.trim());
    if (bullet && current) current.items.push({ text: bullet[1], flow: FLOW_MENTION.exec(bullet[1])?.[1] ?? null });
  }
  return releases;
}

export function readState(stateFile) {
  if (!existsSync(stateFile)) return {};
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  } catch {
    return null; // unreadable: never overwrite it
  }
}

/**
 * Releases newer than last_seen_rules_version. With nothing seen yet only the latest `limit` releases are listed
 * (a designer who has never looked does not need the whole history).
 */
export function whatsNew(changelogText, state, { limit = 3 } = {}) {
  const releases = parseChangelog(changelogText);
  const seen = typeof state.last_seen_rules_version === 'string' ? state.last_seen_rules_version : '';
  const newer = VERSION.test(seen) ? releases.filter((r) => compareVersions(r.version, seen) > 0) : releases.slice(0, limit);
  const latest = releases.reduce((best, r) => (!best || compareVersions(r.version, best) > 0 ? r.version : best), null);
  const flows = [...new Set(newer.flatMap((r) => r.items.map((i) => i.flow).filter(Boolean)))];
  return { ok: true, last_seen: seen || null, latest, up_to_date: newer.length === 0, releases: newer, flows };
}

/** Sets last_seen_rules_version, leaving every other key of state.json as it is. */
export function markSeen(stateFile, version) {
  if (!VERSION.test(version)) return { ok: false, error: `"${version}" is not a version (x.y.z).` };
  const state = readState(stateFile);
  if (state === null) return { ok: false, error: `${stateFile} is not valid JSON; not touching it.` };
  const next = { ...state, last_seen_rules_version: version };
  const temp = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temp, stateFile);
  return { ok: true, last_seen_rules_version: version };
}

export function main(argv, ctx = {}) {
  const out = ctx.stdout ?? process.stdout;
  const emit = (value) => out.write(`${JSON.stringify(value)}\n`);
  const option = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null; };
  const stateFile = resolve(ctx.cwd ?? process.cwd(), option('--state') ?? '.motion/state.json');
  try {
    const mark = option('--mark-seen');
    if (mark !== null) {
      const result = markSeen(stateFile, mark);
      emit(result);
      return result.ok ? 0 : 1;
    }
    const changelog = option('--changelog');
    if (!changelog) { emit({ ok: false, error: 'Usage: mf-whatsnew --changelog <CHANGELOG.md> [--state <state.json>] [--limit N] | --mark-seen <version>' }); return 2; }
    const file = resolve(ctx.cwd ?? process.cwd(), changelog);
    if (!existsSync(file)) { emit({ ok: false, error: `Changelog not found: ${changelog}` }); return 1; }
    const state = readState(stateFile);
    if (state === null) { emit({ ok: false, error: `${stateFile} is not valid JSON.` }); return 1; }
    const limit = option('--limit') === null ? 3 : Number(option('--limit'));
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) { emit({ ok: false, error: '--limit must be a whole number from 1 to 50.' }); return 2; }
    emit(whatsNew(readFileSync(file, 'utf8'), state, { limit }));
    return 0;
  } catch (error) {
    emit({ ok: false, error: error.message });
    return 1;
  }
}
