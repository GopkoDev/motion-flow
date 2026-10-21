import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateDump } from './dump-schema.mjs';

const FIXTURES = fileURLToPath(new URL('../evals/fixtures/', import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

test('every dump fixture is valid against the schema', () => {
  const files = readdirSync(FIXTURES).filter((n) => n.endsWith('.dump.json'));
  assert.deepEqual(files.sort(), ['default-names.dump.json', 'missing-media.dump.json', 'normal.dump.json', 'protected-baseline.dump.json', 'protected-violation.dump.json', 'wrong-fps.dump.json']);
  for (const name of files) assert.deepEqual(validateDump(load(name)), [], name);
});

test('the fixtures contain no real client data', () => {
  for (const name of readdirSync(FIXTURES).filter((n) => n.endsWith('.json'))) {
    const text = readFileSync(join(FIXTURES, name), 'utf8');
    assert.ok(!/\/Users\/|[A-Z]:\\\\|@\w+\.\w+/.test(text), `${name} has a personal path or e-mail`);
  }
});

test('the schema reports broken dumps with the place of the problem', () => {
  const problems = (mutate) => { const d = clone(load('normal.dump.json')); mutate(d); return validateDump(d); };
  assert.match(validateDump(null)[0], /dump: must be an object/);
  assert.ok(problems((d) => { delete d.ae; }).some((p) => p.startsWith('ae:')));
  assert.ok(problems((d) => { d.project.bitsPerChannel = '8'; }).some((p) => p.startsWith('project.bitsPerChannel')));
  assert.ok(problems((d) => { d.footage[0].missing = 'no'; }).some((p) => p.startsWith('footage[0].missing')));
  assert.ok(problems((d) => { d.fonts = [1]; }).some((p) => p.startsWith('fonts[0]')));
  assert.ok(problems((d) => { d.comps[0].fps = 0; }).some((p) => p.startsWith('comps[0].fps')));
  assert.ok(problems((d) => { d.comps[1].id = d.comps[0].id; }).some((p) => /duplicate id/.test(p)));
  assert.ok(problems((d) => { d.comps[0].layers[0].type = 'blob'; }).some((p) => p.includes('layers[0].type')));
  assert.ok(problems((d) => { d.comps[0].layers[1].index = 7; }).some((p) => p.includes('layers[1].index')));
  assert.ok(problems((d) => { d.comps[0].layers[0].parent = 1; }).some((p) => p.includes('layers[0].parent')));
  assert.ok(problems((d) => { d.comps[0].layers[0].parent = 99; }).some((p) => p.includes('layers[0].parent')));
  assert.ok(problems((d) => { d.comps[0].layers[0].transform.position = ['x']; }).some((p) => p.includes('transform.position')));
  assert.ok(problems((d) => { d.comps[0].layers[0].keyframes['transform.opacity'][0] = { t: 'a' }; }).some((p) => p.includes('keyframes.transform.opacity[0].t')));
  assert.ok(problems((d) => { d.comps[0].layers[0].expressions.x = 3; }).some((p) => p.includes('expressions.x')));
  assert.ok(problems((d) => { d.comps = {}; }).some((p) => p.startsWith('comps')));
});

test('extra keys are allowed', () => {
  const dump = clone(load('normal.dump.json'));
  dump.extra = 1;
  dump.comps[0].layers[0].adjustment = false;
  assert.deepEqual(validateDump(dump), []);
});
