#!/usr/bin/env node
// Plugins are installed one by one, so a plugin cannot read files that live next to it in the repository.
// Code that both plugins need lives once in shared/ and is copied into every plugin (the copies are committed).
//   node scripts/sync-shared.mjs           copy shared/ into each plugin
//   node scripts/sync-shared.mjs --check   exit 1 when a copy differs from its source (used by npm test)
// Each plugin gets a .shared.json that lists the copied files: do not edit those files in the plugin.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGINS = ['motion-flow', 'studio-builder'];
const MARKER = '.shared.json';

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** The shared files, as paths relative to shared/ with "/" separators, sorted. */
export function sharedFiles(root) {
  const base = join(root, 'shared');
  return walk(base).map((path) => relative(base, path).split(sep).join('/')).sort();
}

const sameBytes = (a, b) => existsSync(b) && readFileSync(a).equals(readFileSync(b));

/**
 * Copies (or, with check, only compares) shared/ into each plugin. Returns { problems, changed }.
 * problems: copies that are missing or differ, stale copies of files no longer shared, a missing marker.
 */
export function syncShared({ root, check = false, plugins = PLUGINS }) {
  const files = sharedFiles(root);
  const problems = [];
  const changed = [];
  for (const plugin of plugins) {
    const target = join(root, 'plugins', plugin);
    if (!existsSync(target)) { problems.push(`plugins/${plugin} does not exist`); continue; }
    const markerPath = join(target, MARKER);
    let previous = [];
    try { previous = JSON.parse(readFileSync(markerPath, 'utf8')).files ?? []; } catch { /* first sync */ }
    for (const rel of files) {
      const from = join(root, 'shared', rel);
      const to = join(target, rel);
      if (sameBytes(from, to)) continue;
      if (check) { problems.push(`plugins/${plugin}/${rel} ${existsSync(to) ? 'differs from shared/' : 'is missing'}`); continue; }
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      chmodSync(to, statSync(from).mode);
      changed.push(`plugins/${plugin}/${rel}`);
    }
    for (const rel of previous.filter((file) => !files.includes(file))) {
      const stale = join(target, rel);
      if (!existsSync(stale)) continue;
      if (check) problems.push(`plugins/${plugin}/${rel} is a stale copy (no longer in shared/)`);
      else { rmSync(stale); changed.push(`plugins/${plugin}/${rel} (removed)`); }
    }
    const marker = `${JSON.stringify({ note: 'Copied from shared/ by scripts/sync-shared.mjs. Edit the file in shared/ and run npm run sync; do not edit it here.', files }, null, 2)}\n`;
    if (!existsSync(markerPath) || readFileSync(markerPath, 'utf8') !== marker) {
      if (check) problems.push(`plugins/${plugin}/${MARKER} is out of date`);
      else { writeFileSync(markerPath, marker); changed.push(`plugins/${plugin}/${MARKER}`); }
    }
  }
  return { problems, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.includes('--check');
  const { problems, changed } = syncShared({ root, check });
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\nRun: npm run sync\n`);
    process.exit(1);
  }
  process.stdout.write(check ? 'sync-shared: ok, every copy matches shared/\n' : `sync-shared: ${changed.length ? `${changed.length} file(s) updated` : 'nothing to do'}\n`);
}
