// The plugin is written in English. Ukrainian is for the chat with the designer, which the agent
// produces at run time; no Ukrainian text belongs in the plugin's files.
// The only exceptions are test lines that deliberately feed non-ASCII text to the code (marked
// "non-ASCII test data"). The Ukrainian originals of the spec and task list live in the ignored _temp/ folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['_temp', '.git', 'node_modules']);
const EXTENSIONS = /\.(md|mjs|js|jsx|json|jsonl|txt|yml|yaml|gitignore|project)$|^\.gitignore$|^LICENSE$|^NOTICE$/;
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x0400)}-${String.fromCharCode(0x04ff)}]`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

test('no Cyrillic text in the plugin files (except marked test data)', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const name = relative(ROOT, file);
    if (!EXTENSIONS.test(name.split('/').pop()) || statSync(file).size > 2_000_000) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (CYRILLIC.test(line) && !line.includes('non-ASCII test data')) offenders.push(`${name}:${index + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(offenders, [], 'Write plugin files in English. Ukrainian is only for the chat.');
});

test('the artifact templates use English section headings', () => {
  for (const name of ['task.md', 'plan.md', 'check.md', 'deliver.md', 'overrides.md', 'flow.md']) {
    const text = readFileSync(join(ROOT, 'plugins', 'motion-flow', 'templates', name), 'utf8');
    assert.ok(/^## [A-Z]/m.test(text), name);
    assert.ok(!CYRILLIC.test(text), name);
  }
});
