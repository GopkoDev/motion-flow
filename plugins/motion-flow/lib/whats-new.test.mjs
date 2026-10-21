import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compareVersions, main, markSeen, parseChangelog, whatsNew } from './whats-new.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CHANGELOG = `# Changelog

## 0.3.0 (2026-10-20)

- flow \`resize-formats\` 0.2.0: asks for the safe-zone margins
- naming rule: versions use two digits

## 0.2.1

- flow \`subtitles\`: added
- fix a typo in the delivery rules

## 0.2.0 (2026-09-01)

- Draft rules created by init-rules

## 0.1.0

- Scaffold.
`;

test('compareVersions orders x.y.z numerically', () => {
  assert.equal(compareVersions('0.2.1', '0.2.1'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1);
});

test('parseChangelog reads versions, dates, bullets and flow mentions', () => {
  const releases = parseChangelog(CHANGELOG);
  assert.deepEqual(releases.map((r) => [r.version, r.date, r.items.length]), [['0.3.0', '2026-10-20', 2], ['0.2.1', null, 2], ['0.2.0', '2026-09-01', 1], ['0.1.0', null, 1]]);
  assert.deepEqual(releases[0].items.map((i) => i.flow), ['resize-formats', null]);
  assert.equal(releases[1].items[0].flow, 'subtitles');
  assert.deepEqual(parseChangelog('no headings\n- orphan bullet'), []);
  assert.deepEqual(parseChangelog('## v1.2.3\r\n- a\r\n').map((r) => r.version), ['1.2.3']);
});

test('whatsNew lists only releases newer than the last seen one, with the flows that changed', () => {
  const result = whatsNew(CHANGELOG, { last_seen_rules_version: '0.2.0' });
  assert.deepEqual(result.releases.map((r) => r.version), ['0.3.0', '0.2.1']);
  assert.deepEqual(result.flows.sort(), ['resize-formats', 'subtitles']);
  assert.equal(result.latest, '0.3.0');
  assert.equal(result.up_to_date, false);
  assert.equal(result.last_seen, '0.2.0');
});

test('whatsNew: up to date, never seen (latest few only), and an unreadable version', () => {
  assert.equal(whatsNew(CHANGELOG, { last_seen_rules_version: '0.3.0' }).up_to_date, true);
  assert.equal(whatsNew(CHANGELOG, { last_seen_rules_version: '9.0.0' }).up_to_date, true);
  assert.deepEqual(whatsNew(CHANGELOG, { last_seen_rules_version: '' }).releases.map((r) => r.version), ['0.3.0', '0.2.1', '0.2.0']);
  assert.deepEqual(whatsNew(CHANGELOG, {}, { limit: 1 }).releases.map((r) => r.version), ['0.3.0']);
  assert.deepEqual(whatsNew(CHANGELOG, { last_seen_rules_version: 'soon' }).releases.length, 3);
  assert.deepEqual(whatsNew('', {}), { ok: true, last_seen: null, latest: null, up_to_date: true, releases: [], flows: [] });
});

function withState(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mf-whatsnew-'));
  mkdirSync(join(dir, '.motion'));
  const file = join(dir, '.motion', 'state.json');
  if (content !== null) writeFileSync(file, content);
  try { return fn(dir, file); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('markSeen writes only last_seen_rules_version and keeps the other keys', () => {
  withState('{"last_seen_rules_version":"0.1.0","commit_artifacts":true}', (dir, file) => {
    assert.deepEqual(markSeen(file, '0.3.0'), { ok: true, last_seen_rules_version: '0.3.0' });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { last_seen_rules_version: '0.3.0', commit_artifacts: true });
    assert.deepEqual(readdirSync(join(dir, '.motion')), ['state.json'], 'no temp file is left');
  });
});

test('markSeen creates the file when it is missing, refuses a bad version, and never overwrites an unreadable file', () => {
  withState(null, (dir, file) => {
    assert.equal(markSeen(file, '0.2.0').ok, true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { last_seen_rules_version: '0.2.0' });
  });
  withState('{}', (dir, file) => {
    for (const bad of ['', 'v1', '1.2', '1.2.3-beta', 'latest']) assert.equal(markSeen(file, bad).ok, false, bad);
    assert.equal(readFileSync(file, 'utf8'), '{}');
  });
  withState('{ nope', (dir, file) => {
    assert.equal(markSeen(file, '0.2.0').ok, false);
    assert.equal(readFileSync(file, 'utf8'), '{ nope');
  });
});

test('CLI: lists what is new, marks it seen, and fails clearly', () => {
  withState('{"last_seen_rules_version":"0.2.0","commit_artifacts":false}', (dir, file) => {
    writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG);
    const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'mf-whatsnew'), ...args], { cwd: dir, encoding: 'utf8' });
    const listed = run('--changelog', 'CHANGELOG.md');
    assert.equal(listed.status, 0);
    assert.deepEqual(JSON.parse(listed.stdout).releases.map((r) => r.version), ['0.3.0', '0.2.1']);
    assert.equal(readFileSync(file, 'utf8').includes('0.2.0'), true, 'listing does not change the state');
    assert.equal(run('--mark-seen', '0.3.0').status, 0);
    assert.equal(JSON.parse(run('--changelog', 'CHANGELOG.md').stdout).up_to_date, true);
    assert.equal(run('--changelog', 'missing.md').status, 1);
    assert.equal(run().status, 2);
    assert.equal(run('--changelog', 'CHANGELOG.md', '--limit', '0').status, 2);
    assert.equal(run('--mark-seen', 'soon').status, 1);
    assert.equal(main(['--changelog', join(dir, 'CHANGELOG.md'), '--state', file], { stdout: { write() {} } }), 0);
  });
});

test('the scaffold changelog of the studio rules is readable by whats-new', () => {
  const text = readFileSync(join(REPO, 'templates', 'studio-rules', 'CHANGELOG.md'), 'utf8');
  assert.deepEqual(parseChangelog(text).map((r) => r.version), ['0.1.0']);
});
