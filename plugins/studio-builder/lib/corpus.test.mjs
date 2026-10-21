import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, classifySet, classifySingle, diffDumps, extractFacts, findPairs, namePattern, renderReport, splitVersion, tokenKind, typicalChanges } from './corpus.mjs';
import { validateDump } from './dump-schema.mjs';

/** A small valid dump. `comps`: [{ name, width, height, fps, layers: [{ name, type, effects, ease, expression }] }]. */
function dump({ comps = [{ name: 'Main', layers: [{ name: 'Logo' }] }], fonts = ['Montserrat-Bold'], bits = 8 } = {}) {
  return {
    ae: { version: '24.1' },
    project: { path: '/work/x.aep', bitsPerChannel: bits },
    footage: [],
    fonts,
    comps: comps.map((comp, id) => ({
      id: id + 1, name: comp.name, width: comp.width ?? 1920, height: comp.height ?? 1080, fps: comp.fps ?? 25, duration: comp.duration ?? 10,
      layers: (comp.layers ?? []).map((layer, index) => ({
        index: index + 1, name: layer.name, type: layer.type ?? 'shape', inPoint: 0, outPoint: 10, parent: null, enabled: true, locked: false,
        transform: { position: layer.position ?? [960, 540], scale: [100, 100], rotation: 0, opacity: 100 },
        effects: layer.effects ?? [], expressions: layer.expression ? { 'transform.position': layer.expression } : {},
        keyframes: layer.ease ? { 'transform.opacity': [{ t: 0, v: 0, ease: layer.ease }, { t: 0.5, v: 100, ease: layer.ease }] } : {},
      })),
    })),
  };
}
const facts = (d, meta) => extractFacts(d, { id: meta.id, file: meta.file ?? `${meta.id}.aep`, group: meta.group ?? '', folder: meta.folder, mtimeMs: meta.mtimeMs ?? 1000 });

/** n rows whose single feature "frame rate" is given by `fpsList`, with ids p1..pn. */
function fpsRows(fpsList, extra = (i) => ({})) {
  return fpsList.map((fps, i) => facts(dump({ comps: [{ name: 'Main', fps, layers: [{ name: 'Logo' }] }] }), { id: `p${i + 1}`, ...extra(i) }));
}

test('tokenKind and namePattern describe how a name is built, not what it says', () => {
  assert.deepEqual(['v07', '1920x1080', '12', '25fps', 'FINAL', 'main', 'Spring', 'sPring'].map(tokenKind), ['v#', 'WxH', '#', '#unit', 'UPPER', 'lower', 'Title', 'Mixed']);
  assert.equal(namePattern('FINAL_Spring_1920x1080'), 'UPPER_Title_WxH');
  assert.equal(namePattern('spring_v07.aep'), 'lower_v#');
  assert.equal(namePattern('Logo reveal 02'), 'Title lower #');
  assert.equal(namePattern(''), '(empty)');
  assert.equal(namePattern('Logo reveal 02'), namePattern('Hero  title  11'), 'the same build, whatever the words');
});

test('splitVersion finds the version suffix of a project file', () => {
  assert.deepEqual(splitVersion('spring_v07.aep'), { stem: 'spring', version: 7 });
  assert.deepEqual(splitVersion('Spring Title V3.aep'), { stem: 'Spring Title', version: 3 });
  assert.deepEqual(splitVersion('spring.aep'), { stem: 'spring', version: null });
});

test('extractFacts: dominant frame rate, default layer names, sets, expressions', () => {
  const d = dump({ comps: [
    { name: 'FINAL_Spring', fps: 25, layers: [{ name: 'Logo', effects: ['Gaussian Blur'], ease: 'in:BEZIER,out:BEZIER' }, { name: 'Shape Layer 1' }, { name: 'Null 3', expression: 'wiggle(1,2)' }] },
    { name: 'Sub', fps: 25, width: 1080, height: 1920, layers: [] },
    { name: 'Odd', fps: 30, layers: [] },
  ] });
  assert.deepEqual(validateDump(d), []);
  const row = facts(d, { id: 'p1', file: 'spring_v07.aep', group: 'acme' });
  assert.equal(row.single['frame rate'], '25 fps');
  assert.equal(row.single['default layer names'], 'many');
  assert.equal(row.single.expressions, 'used');
  assert.deepEqual(row.sets['comp sizes'].sort(), ['1080x1920', '1920x1080']);
  assert.deepEqual(row.sets.effects, ['Gaussian Blur']);
  assert.deepEqual(row.sets.easing, ['in:BEZIER,out:BEZIER']);
  assert.deepEqual(row.sets['layer name patterns'], ['Title'], 'default names are not counted as a pattern');
  assert.deepEqual([row.stem, row.version, row.group], ['spring', 7, 'acme']);
  assert.equal(row.numbers.keyframeGapMedian, 0.5);
});

test('consensus: a value used by 80% of the projects is the convention, and the exceptions are named', () => {
  const rows = fpsRows([25, 25, 25, 25, 25, 25, 25, 25, 25, 30], (i) => ({ mtimeMs: i === 9 ? 10 : 1000 }));
  const result = classifySingle('frame rate', rows);
  assert.deepEqual([result.kind, result.proposal, result.confidence, result.needs_human], ['consensus', '25 fps', 'high', false]);
  assert.equal(result.values[0].count, 9);
  assert.match(result.note, /30 fps in p10/);
  assert.match(result.note, /older/, 'an exception from an older project is called legacy');
});

test('majority: more than half and a runner-up clearly behind', () => {
  const result = classifySingle('frame rate', fpsRows([25, 25, 25, 25, 25, 25, 30, 30, 30, 24]));
  assert.deepEqual([result.kind, result.proposal, result.needs_human], ['majority', '25 fps', false]);
});

test('conflict: two close values that follow neither a group nor the project age need a person', () => {
  const result = classifySingle('frame rate', fpsRows([25, 25, 25, 25, 25, 30, 30, 30, 30, 30], (i) => ({ mtimeMs: 1000 + (i % 2) })));
  assert.deepEqual([result.kind, result.needs_human, result.confidence], ['conflict', true, 'low']);
  assert.ok(result.proposal, 'a default is still offered');
});

test('context split: when each group agrees inside itself and differs from the others, it is a rule per group, not a conflict', () => {
  const rows = fpsRows([25, 25, 25, 30, 30, 30], (i) => ({ group: i < 3 ? 'acme' : 'nova' }));
  const result = classifySingle('frame rate', rows);
  assert.deepEqual([result.kind, result.needs_human, result.proposal], ['context_split', false, null]);
  assert.match(result.note, /25 fps in acme/);
  assert.match(result.note, /30 fps in nova/);
});

test('legacy shift: when one value is used only by older projects, the newer value wins', () => {
  const rows = fpsRows([25, 25, 25, 25, 25, 30, 30, 30, 30, 30], (i) => ({ mtimeMs: i < 5 ? 100 + i : 9000 + i }));
  const result = classifySingle('frame rate', rows);
  assert.deepEqual([result.kind, result.proposal, result.needs_human], ['legacy_shift', '30 fps', false]);
  assert.match(result.note, /25 fps is used only by older projects/);
});

test('scattered: no value reaches half of the projects', () => {
  const result = classifySingle('frame rate', fpsRows([24, 25, 30, 60, 24, 25, 30, 60]));
  assert.deepEqual([result.kind, result.needs_human, result.proposal], ['scattered', true, null]);
});

test('too few projects give no convention', () => {
  const result = classifySingle('frame rate', fpsRows([25, 25]));
  assert.deepEqual([result.kind, result.needs_human], ['too_few', false]);
});

test('sets split values into standard, common and rare', () => {
  const rows = [1, 2, 3, 4, 5].map((i) => facts(dump({ comps: [{ name: 'Main', width: 1920, height: i <= 4 ? 1080 : 1920, layers: [{ name: 'L', effects: i <= 2 ? ['Glow'] : [] }] }], fonts: i === 5 ? ['Arial', 'Montserrat-Bold'] : ['Montserrat-Bold'] }), { id: `p${i}` }));
  const fonts = classifySet('fonts', rows);
  assert.deepEqual(fonts.standard.map((v) => v.value), ['Montserrat-Bold']);
  assert.deepEqual(fonts.rare.map((v) => [v.value, v.projects]), [['Arial', ['p5']]]);
  assert.deepEqual(classifySet('effects', rows).common.map((v) => v.value), ['Glow'], 'Glow is in 2 of 5 projects');
  assert.deepEqual(classifySet('comp sizes', rows).standard.map((v) => v.value), ['1920x1080']);
});

test('analyze collects the questions only a person can answer, with options and a default', () => {
  const rows = fpsRows([25, 25, 25, 25, 25, 30, 30, 30, 30, 30], (i) => ({ mtimeMs: 1000 + (i % 2) }));
  const analysis = analyze(rows);
  assert.equal(analysis.projects, 10);
  assert.equal(analysis.questions.length, 1);
  assert.equal(analysis.questions[0].feature, 'frame rate');
  assert.deepEqual(analysis.questions[0].options.map((o) => o.value), ['25 fps', '30 fps']);
  assert.equal(analysis.questions[0].default, '25 fps');
  assert.equal(analyze(fpsRows([25, 25, 25])).questions.length, 0);
});

test('versions of one project are paired in order, inside a group', () => {
  const rows = [
    ['a1', 'spring_v02.aep', 'acme'], ['a0', 'spring_v01.aep', 'acme'], ['a3', 'spring_v03.aep', 'acme'],
    ['n1', 'spring_v01.aep', 'nova'], ['x', 'single.aep', 'acme'], ['n2', 'spring_v02.aep', 'nova'],
  ].map(([id, file, group]) => facts(dump(), { id, file, group }));
  assert.deepEqual(findPairs(rows), [{ before: 'a0', after: 'a1' }, { before: 'a1', after: 'a3' }, { before: 'n1', after: 'n2' }]);
});

test('a folder with one before and one after project is a pair, and its projects are not paired by version again', () => {
  const rows = [
    ['b1', 'before.aep', 'acme/job1'], ['a1', 'after.aep', 'acme/job1'],
    ['b2', 'Input.aep', 'acme/job2'], ['a2', 'Output.aep', 'acme/job2'],
    ['m1', 'before.aep', 'acme/job3'], ['m2', 'before_v2.aep', 'acme/job3'], ['m3', 'after.aep', 'acme/job3'],
    ['v1', 'spring_v01.aep', 'acme/other'], ['v2', 'spring_v02.aep', 'acme/other'],
  ].map(([id, file, folder]) => facts(dump(), { id, file, folder, group: 'acme' }));
  assert.deepEqual(findPairs(rows), [{ before: 'b1', after: 'a1' }, { before: 'b2', after: 'a2' }, { before: 'v1', after: 'v2' }], 'job3 has two "before" projects: not a clear pair');
});

test('diffDumps names what changed in generic terms, and typicalChanges counts what repeats', () => {
  const before = dump({ comps: [{ name: 'Main', layers: [{ name: 'Logo', position: [960, 540] }, { name: 'Old' }] }] });
  const after = dump({ comps: [
    { name: 'Main', layers: [{ name: 'Logo', position: [100, 100], effects: ['Glow'] }, { name: 'New', type: 'text' }] },
    { name: 'Main_9x16', width: 1080, height: 1920, layers: [] },
  ] });
  const signatures = diffDumps(before, after);
  assert.deepEqual(signatures.sort(), ['comp added 1080x1920', 'effect added: Glow', 'layer added (text)', 'layer position changed', 'layer removed'].sort());
  const typical = typicalChanges([{ signatures }, { signatures: ['comp added 1080x1920'] }, { signatures: [] }]);
  assert.deepEqual(typical[0], { signature: 'comp added 1080x1920', pairs: 2, share: 0.67 });
});

test('the report lists the conventions, the questions and the typical changes in plain markdown', () => {
  const rows = fpsRows([25, 25, 25, 25, 25, 30, 30, 30, 30, 30], (i) => ({ mtimeMs: 1000 + (i % 2) }));
  const report = renderReport(analyze(rows), { pairs: 4, typical: [{ signature: 'comp added 1080x1920', pairs: 3, share: 0.75 }] });
  for (const text of ['# Corpus report', '10 project(s)', '| frame rate | conflict |', '## Questions only a person can answer', '- **frame rate** (conflict)', '25 fps: 50%', '## What designers change between versions', 'comp added 1080x1920: 3/4 pairs (75%)']) assert.ok(report.includes(text), text);
  assert.match(renderReport(analyze(fpsRows([25, 25]))), /Fewer than 3 projects/);
});
