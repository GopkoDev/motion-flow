import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lint, loadChecks } from './ae-lint.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIX = join(REPO, 'evals', 'fixtures');
const dump = (name) => JSON.parse(readFileSync(join(FIX, `${name}.dump.json`), 'utf8'));
const checks = () => loadChecks(join(FIX, 'checks'));
const clone = (v) => JSON.parse(JSON.stringify(v));
/** [rule, where] pairs, sorted, for readable expectations. */
const pairs = (result) => result.violations.map((v) => [v.rule, v.where]).sort((a, b) => `${a}`.localeCompare(`${b}`));

// ---------- expected results on the fixtures ----------

test('normal project: no violations', () => {
  const result = lint(dump('normal'), checks());
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { errors: 0, warnings: 0, rules: 8 });
  assert.deepEqual(result.skipped.map((s) => s.rule), ['protected-brand'], 'protected check is skipped without a baseline');
});

test('missing media is reported as an error', () => {
  const result = lint(dump('missing-media'), checks());
  assert.deepEqual(pairs(result), [['no-missing-media', 'footage:hero.mov']]);
  assert.equal(result.ok, false);
  assert.match(result.violations[0].message, /hero\.mov.*missing.*\/work\/media\/hero\.mov/);
});

test('default layer and comp names are reported', () => {
  const result = lint(dump('default-names'), checks());
  const defaults = result.violations.filter((v) => v.rule === 'no-default-names').map((v) => v.where).sort();
  assert.deepEqual(defaults, [
    'comp:Comp 1', 'comp:Comp 1/layer:Null 1', 'comp:Comp 1/layer:Pre-comp 1', 'comp:Comp 1/layer:Shape Layer 1',
    'comp:Comp 1/layer:Solid 2', 'comp:Comp 1/layer:Text 1', 'comp:Pre-comp 1', 'comp:Pre-comp 1/layer:Medium Gray-Green Solid 1',
  ]);
  assert.deepEqual(result.violations.filter((v) => v.rule === 'comp-names').map((v) => v.where).sort(), ['comp:Comp 1', 'comp:Pre-comp 1']);
  assert.equal(result.violations.some((v) => v.where.endsWith('layer:Headline')), false, 'good names are not reported');
});

test('wrong fps is reported only for the comps the rule applies to', () => {
  const result = lint(dump('wrong-fps'), checks());
  assert.deepEqual(pairs(result), [['fps-25', 'comp:FINAL_Spring_1920x1080']]);
  assert.match(result.violations[0].message, /Final comps must run at 25 fps: Comp "FINAL_Spring_1920x1080" runs at 30 fps/);
});

test('protected comps: any change against the baseline is reported, field by field', () => {
  const result = lint(dump('protected-violation'), checks(), { baseline: dump('protected-baseline') });
  assert.deepEqual(result.skipped, []);
  const messages = result.violations.map((v) => `${v.where} | ${v.message}`);
  assert.deepEqual(result.violations.map((v) => v.rule), ['protected-brand', 'protected-brand', 'protected-brand', 'protected-brand']);
  assert.ok(messages.some((m) => m.startsWith('comp:BRAND_Logo_Lockup/layer:Logo_Mark | transform.position changed from [960,540] to [500,200]')));
  assert.ok(messages.some((m) => m.startsWith('comp:BRAND_Logo_Lockup/layer:Logo_Mark | transform.scale changed from [100,100] to [140,140]')));
  assert.ok(messages.some((m) => m.startsWith('comp:BRAND_Logo_Lockup/layer:Logo_Type | expressions changed')));
  assert.ok(messages.some((m) => m.startsWith('comp:BRAND_Logo_Lockup/layer:Sticker | Layer "Sticker" was added to protected comp')));
  assert.equal(result.ok, false);
});

test('protected comps: an untouched copy of the baseline passes, a removed comp or layer is reported', () => {
  assert.deepEqual(lint(dump('protected-baseline'), checks(), { baseline: dump('protected-baseline') }).violations, []);
  const noComp = clone(dump('protected-baseline'));
  noComp.comps = noComp.comps.filter((c) => c.name !== 'BRAND_Logo_Lockup');
  assert.match(lint(noComp, checks(), { baseline: dump('protected-baseline') }).violations[0].message, /was removed or renamed/);
  const noLayer = clone(dump('protected-baseline'));
  noLayer.comps.find((c) => c.name === 'BRAND_Logo_Lockup').layers.pop();
  noLayer.comps.find((c) => c.name === 'BRAND_Logo_Lockup').layers[0].name = 'Renamed';
  const result = lint(noLayer, checks(), { baseline: dump('protected-baseline') });
  assert.ok(result.violations.some((v) => /Layer "Logo_Mark" was removed or renamed/.test(v.message)));
  assert.ok(result.violations.some((v) => /Layer "Renamed" was added/.test(v.message)));
});

// ---------- individual check types ----------

const only = (check, data = dump('normal'), options) => lint(data, [{ id: 't', ...check }], options);

test('comp_fps: equals, one_of, tolerance for NTSC rates', () => {
  const data = clone(dump('normal'));
  for (const comp of data.comps) comp.fps = 23.976;
  assert.equal(only({ type: 'comp_fps', equals: 24 }, data).ok, false);
  assert.equal(only({ type: 'comp_fps', one_of: [24, 23.976] }, data).ok, true);
  for (const comp of data.comps) comp.fps = 24000 / 1001;
  assert.equal(only({ type: 'comp_fps', equals: 23.976 }, data).ok, true);
});

test('comp_size, comp_duration, project_bits, fonts_allowed, layer_name', () => {
  assert.equal(only({ type: 'comp_size', width: 1920, height: 1080, comps: '^FINAL_' }).ok, true);
  assert.equal(only({ type: 'comp_size', width: 1280 }).ok, false);
  assert.equal(only({ type: 'comp_duration', max: 10 }).violations.length, 1);
  assert.equal(only({ type: 'comp_duration', min: 5 }).violations[0].where, 'comp:PRE_CTA_Button');
  assert.equal(only({ type: 'project_bits', equals: 16 }).violations[0].where, 'project');
  assert.deepEqual(only({ type: 'fonts_allowed', allowed: ['Arial'] }).violations.map((v) => v.where), ['font:Montserrat-Bold']);
  assert.deepEqual(only({ type: 'layer_name', pattern: '^[A-Z]', types: ['null'] }).violations, []);
  assert.deepEqual(only({ type: 'layer_name', pattern: '^[a-z]', types: ['null'] }).violations.map((v) => v.where), ['comp:FINAL_Spring_1920x1080/layer:Logo_Anchor']);
  assert.equal(only({ type: 'comp_name', pattern: '^FINAL_', except: ['PRE_CTA_Button'] }).ok, true);
});

test('severity: warnings do not make the result fail', () => {
  const result = only({ type: 'fonts_allowed', allowed: ['Arial'], severity: 'warning' });
  assert.equal(result.violations.length, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { errors: 0, warnings: 1, rules: 1 });
});

test('default_names: scope and custom patterns', () => {
  const data = dump('default-names');
  assert.equal(only({ type: 'default_names', scope: 'comps' }, data).violations.length, 2);
  assert.equal(only({ type: 'default_names', scope: 'layers' }, data).violations.length, 6);
  assert.equal(only({ type: 'default_names', patterns: ['^Headline$'] }, data).violations.length, 1);
});

// ---------- bad input ----------

function checksDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'mf-lint-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}

test('invalid check files are refused with the file name and the reason', () => {
  const run = (files) => { const dir = checksDir(files); try { return loadChecks(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
  assert.throws(() => run({ 'a.json': '{ nope' }), /a\.json: not valid JSON/);
  assert.throws(() => run({ 'a.json': { type: 'comp_fps', equals: 25 } }), /a\.json: "id" is required/);
  assert.throws(() => run({ 'a.json': { id: 'x', type: 'magic' } }), /unknown type "magic"/);
  assert.throws(() => run({ 'a.json': { id: 'x', type: 'comp_fps' } }), /give one of equals, one_of/);
  assert.throws(() => run({ 'a.json': { id: 'x', type: 'comp_name' } }), /"pattern" is required/);
  assert.throws(() => run({ 'a.json': { id: 'x', type: 'comp_name', pattern: '(' } }), /invalid regex/);
  assert.throws(() => run({ 'a.json': { id: 'x', type: 'footage_missing', severity: 'fatal' } }), /severity/);
  assert.throws(() => run({ 'a.json': { id: 'x', type: 'footage_missing' }, 'b.json': { id: 'x', type: 'footage_missing' } }), /duplicate check id "x"/);
  assert.throws(() => run({ 'a.json': { id: 'x', type: 'protected_unchanged', comps: [] } }), /non-empty array/);
  assert.throws(() => loadChecks('/no/such/folder'), /not found/);
  assert.deepEqual(run({ 'readme.txt': 'ignored' }), []);
});

test('an invalid dump or baseline is refused', () => {
  assert.throws(() => lint({ nope: 1 }, []), /The dump is not valid/);
  assert.throws(() => lint(dump('normal'), [], { baseline: { nope: 1 } }), /The baseline dump is not valid/);
});

// ---------- CLI ----------

test('CLI: exit codes 0, 1 and 2, JSON on stdout', () => {
  const run = (...args) => spawnSync(process.execPath, [join(REPO, 'bin', 'ae-lint'), ...args], { encoding: 'utf8' });
  const ok = run('--dump', join(FIX, 'normal.dump.json'), '--checks', join(FIX, 'checks'));
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  const bad = run('--dump', join(FIX, 'wrong-fps.dump.json'), '--checks', join(FIX, 'checks'));
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).violations[0].rule, 'fps-25');
  const withBaseline = run('--dump', join(FIX, 'protected-violation.dump.json'), '--baseline', join(FIX, 'protected-baseline.dump.json'), '--checks', join(FIX, 'checks'));
  assert.equal(withBaseline.status, 1);
  assert.equal(JSON.parse(withBaseline.stdout).violations.length, 4);
  for (const args of [[], ['--dump', 'x'], ['--dump', '/nope.json', '--checks', join(FIX, 'checks')], ['--dump', join(FIX, 'normal.dump.json'), '--checks', '/no/such']]) {
    const result = run(...args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(JSON.parse(result.stdout).ok, false);
  }
});
