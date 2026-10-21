import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sums } from './mf-sum.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const sha = (text) => createHash('sha256').update(text).digest('hex');

function withProject(fn) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mf-sum-'));
    const outside = mkdtempSync(join(tmpdir(), 'mf-sum-out-'));
    try {
      mkdirSync(join(dir, 'work', 'out'), { recursive: true });
      await fn(dir, outside);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  };
}

test('sums gives relative path, size and sha256', withProject(async (dir) => {
  writeFileSync(join(dir, 'work', 'out', 'a.txt'), 'hello');
  writeFileSync(join(dir, 'work', 'out', 'b.bin'), '');
  const result = await sums(['work/out/a.txt', 'work/out/b.bin'], dir);
  assert.deepEqual(result, { ok: true, files: [
    { file: 'work/out/a.txt', size: 5, sha256: sha('hello') },
    { file: 'work/out/b.bin', size: 0, sha256: sha('') },
  ] });
}));

test('files outside the project folder, links out, folders and missing files are refused', withProject(async (dir, outside) => {
  writeFileSync(join(outside, 'secret.txt'), 'x');
  symlinkSync(join(outside, 'secret.txt'), join(dir, 'work', 'link.txt'));
  for (const file of [join(outside, 'secret.txt'), '../x', 'work/link.txt', 'work', 'work/missing.txt', '.']) {
    const result = await sums([file], dir);
    assert.equal(result.ok, false, file);
  }
  assert.equal((await sums([], dir)).ok, false);
}));

test('CLI: prints JSON and exits 0 or 1', withProject(async (dir) => {
  writeFileSync(join(dir, 'f.txt'), 'abc');
  const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'mf-sum'), ...args], { cwd: dir, encoding: 'utf8' });
  const ok = run('f.txt');
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).files[0].sha256, sha('abc'));
  assert.equal(run('missing').status, 1);
}));
