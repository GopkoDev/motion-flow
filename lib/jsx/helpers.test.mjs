// Runs helpers.jsx and dump.jsx in Node with a small fake of the After Effects scripting objects,
// to test the logic without After Effects. Real behaviour inside AE is checked by a person (T2.9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { validateDump } from '../dump-schema.mjs';
import { buildWrapper } from '../ae-run.mjs';

const read = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

/** Builds a sandbox with a fake in-memory File system and a fake `app`. */
function makeEnv(overrides = {}) {
  const disk = new Map();
  const calls = [];
  class File {
    constructor(path) { this.path = path; this.fsName = path; this.encoding = ''; this.buffer = ''; }
    get name() { return this.path.split('/').pop(); }
    get exists() { return disk.has(this.path); }
    get parent() { return { exists: !disk.has('__noparent__'), fsName: this.path.split('/').slice(0, -1).join('/') }; }
    open(mode) { if (disk.has('__nowrite__') && mode === 'w') return false; this.mode = mode; this.buffer = mode === 'r' ? disk.get(this.path) : ''; return true; }
    read() { return this.buffer; }
    write(text) { this.buffer += text; }
    close() { if (this.mode === 'w') disk.set(this.path, this.buffer); }
    remove() { disk.delete(this.path); return true; }
    rename(newName) { const target = `${this.path.split('/').slice(0, -1).join('/')}/${newName}`; disk.set(target, disk.get(this.path)); disk.delete(this.path); return true; }
  }
  const app = {
    version: '24.1.0',
    project: { file: null, numItems: 0, bitsPerChannel: 8, item: () => null, save() { calls.push('save'); } },
    beginUndoGroup(name) { calls.push(`begin:${name}`); },
    endUndoGroup() { calls.push('end'); },
    beginSuppressDialogs() { calls.push('quiet'); },
    endSuppressDialogs() { calls.push('unquiet'); },
    open(file) { calls.push(`open:${file.fsName}`); app.project = { ...app.project, file }; },
    ...overrides,
  };
  const lines = [];
  class Folder { constructor(path) { this.path = path; this.fsName = path; } }
  const sandbox = { File, Folder, app, $: { global: {}, writeln: (l) => lines.push(l) }, console };
  vm.createContext(sandbox);
  vm.runInContext(read('helpers.jsx'), sandbox);
  return { sandbox, disk, calls, lines, mf: vm.runInContext('mf', sandbox), run: (code) => vm.runInContext(code, sandbox) };
}

// ---------- JSON ----------

test('toJSON handles every type, escapes text and drops functions/undefined', () => {
  const { mf } = makeEnv();
  assert.equal(mf.toJSON({ a: 1, b: 'x"y\n\u0001', c: [true, null, 2.5], d: { e: undefined, f: () => 1 } }), '{"a":1,"b":"x\\"y\\n\\u0001","c":[true,null,2.5],"d":{}}');
  assert.equal(mf.toJSON(NaN), 'null');
  assert.equal(mf.toJSON(Infinity), 'null');
  assert.equal(mf.toJSON([]), '[]');
  assert.equal(mf.toJSON({}), '{}');
  assert.equal(mf.toJSON(' '), '"\\u2028"');
});

test('toJSON output round-trips through JSON.parse and mf.parseJSON', () => {
  const { mf } = makeEnv();
  const value = { name: 'Šar "1"', nums: [0, -1.5, 1e21], nested: { list: [{ a: null }, []], ok: false }, uni: '日本語\t' };
  const text = mf.toJSON(value);
  assert.deepEqual(JSON.parse(text), value);
  assert.deepEqual(JSON.parse(JSON.stringify(mf.parseJSON(text))), value);
  assert.match(mf.toJSON({ a: [1] }, '  '), /\n {2}"a": \[\n {4}1\n {2}\]\n\}/);
});

test('parseJSON reads valid JSON and rejects malformed input with a position', () => {
  const { mf } = makeEnv();
  assert.deepEqual(JSON.parse(JSON.stringify(mf.parseJSON(' {"a": [1, 2.5e1, "\\u00e9\\n"], "b": {"c": true}, "d": null} '))), { a: [1, 25, 'é\n'], b: { c: true }, d: null });
  for (const bad of ['', '{', '{"a":}', '[1,]', '{"a":1,}', "{'a':1}", '{"a":1} x', '"abc', '{"a":"\\x"}', 'tru', '01x', '[1 2]', '{"a" 1}']) {
    assert.throws(() => mf.parseJSON(bad), /JSON:/, JSON.stringify(bad));
  }
});

// ---------- files ----------

test('writeText writes through a temporary file and leaves no .tmp behind', () => {
  const { mf, disk } = makeEnv();
  mf.writeText('/w/out.json', '{"ok":true}');
  assert.equal(disk.get('/w/out.json'), '{"ok":true}');
  assert.equal(disk.has('/w/out.json.tmp'), false);
  mf.writeText('/w/out.json', 'again');
  assert.equal(disk.get('/w/out.json'), 'again');
});

test('writeText explains the AE scripting permission when the file cannot be written', () => {
  const { mf, disk } = makeEnv();
  disk.set('__nowrite__', '1');
  assert.throws(() => mf.writeText('/w/out.json', 'x'), /Allow Scripts to Write Files and Access Network/);
});

test('readText fails clearly on a missing file', () => {
  const { mf } = makeEnv();
  assert.throws(() => mf.readText('/nope.json'), /File not found: \/nope.json/);
});

// ---------- finding layers and comps ----------

function fakeComp(names) {
  const layers = names.map((name, i) => ({ name, index: i + 1 }));
  return { name: 'Main', numLayers: layers.length, layer: (i) => layers[i - 1] };
}

test('findLayer finds by name, returns null when absent, and refuses ambiguous names', () => {
  const { mf } = makeEnv();
  const comp = fakeComp(['Logo', 'BG', 'Logo2']);
  assert.equal(mf.findLayer(comp, 'BG').index, 2);
  assert.equal(mf.findLayer(comp, 'Nope'), null);
  assert.equal(mf.findLayers(fakeComp(['A', 'A']), 'A').length, 2);
  assert.throws(() => mf.findLayer(fakeComp(['A', 'A']), 'A'), /More than one layer is named "A"/);
});

test('findComp finds by name and refuses ambiguity', () => {
  const { mf, sandbox, run } = makeEnv();
  class CompItem { constructor(name) { this.name = name; } }
  sandbox.CompItem = CompItem;
  const items = [new CompItem('A'), { name: 'Footage' }, new CompItem('B')];
  sandbox.app.project.numItems = items.length;
  sandbox.app.project.item = (i) => items[i - 1];
  assert.equal(run("mf.findComp('B').name"), 'B');
  assert.equal(run("mf.findComp('Footage')"), null);
  items.push(new CompItem('A'));
  sandbox.app.project.numItems = items.length;
  assert.throws(() => mf.findComp('A'), /More than one comp is named "A"/);
});

// ---------- files inside work/ ----------

test('workFile and workFolder accept paths inside work/ and refuse everything else', () => {
  const env = makeEnv();
  env.sandbox.$.global.MF_IPC = { workDir: '/proj/work' };
  assert.equal(env.mf.workFile('/proj/work/in/a.png').fsName, '/proj/work/in/a.png');
  assert.equal(env.mf.workFile('/PROJ/WORK/b.png').fsName, '/PROJ/WORK/b.png', 'case-insensitive like macOS and Windows');
  for (const bad of ['/proj/other/a.png', '/proj/work', '/proj/workshop/a.png', '/proj/work/../secret.txt', '/etc/passwd', '/proj/work/a/../../x', '']) {
    assert.throws(() => env.mf.workFile(bad), /outside the work folder|\.\. is not allowed/, bad);
  }
  assert.equal(env.mf.workFolder('/proj/work/out').fsName, '/proj/work/out');
  assert.throws(() => env.mf.workFolder('/tmp'), /outside the work folder/);
});

test('workFile understands Windows paths and a trailing slash in the work folder', () => {
  const env = makeEnv();
  env.sandbox.$.global.MF_IPC = { workDir: 'C:\\proj\\work\\' };
  assert.equal(env.mf.workFile('C:\\proj\\work\\a.png').fsName, 'C:/proj/work/a.png');
  assert.throws(() => env.mf.workFile('C:\\proj\\other\\a.png'), /outside/);
});

test('workFile refuses to work when the work folder is not known', () => {
  const env = makeEnv();
  env.sandbox.$.global.MF_IPC = {};
  assert.throws(() => env.mf.workFile('/a'), /work folder is not known/);
});

// ---------- the project ----------

test('ensureProject keeps the open project, opens when nothing is open, and never closes another one', () => {
  const env = makeEnv();
  assert.throws(() => env.mf.ensureProject('/w/missing.aep'), /Project file not found/);
  env.disk.set('/w/x.aep', 'bin');
  env.mf.ensureProject('/w/x.aep'); // nothing open: opens it
  assert.deepEqual(env.calls, ['open:/w/x.aep']);
  env.calls.length = 0;
  env.mf.ensureProject('/w/x.aep'); // already the open project: nothing to do
  assert.deepEqual(env.calls, []);
  env.disk.set('/w/y.aep', 'bin');
  assert.throws(() => env.mf.ensureProject('/w/y.aep'), /Another project is open .*never closes a project/);
  assert.deepEqual(env.calls, [], 'nothing was opened over the other project');
});

test('ensureProject also refuses when an unsaved project with content is open', () => {
  const env = makeEnv();
  env.disk.set('/w/x.aep', 'bin');
  env.sandbox.app.project.numItems = 3; // unsaved work, no file yet
  assert.throws(() => env.mf.ensureProject('/w/x.aep'), /Another project is open in After Effects \(unsaved\)/);
});

// ---------- runIpc ----------

function ipcEnv() {
  const env = makeEnv();
  env.disk.set('/w/.ipc/1.in.json', JSON.stringify({ project: '/w/p.aep', name: 'x' }));
  env.disk.set('/w/p.aep', 'bin');
  env.sandbox.$.global.MF_IPC = { inPath: '/w/.ipc/1.in.json', outPath: '/w/.ipc/1.out.json', undoName: 'Resize', save: true };
  return env;
}
const out = (env) => JSON.parse(env.disk.get('/w/.ipc/1.out.json'));

test('runIpc: runs in one undo group, saves, and writes {ok, result, durationMs}', () => {
  const env = ipcEnv();
  env.mf.runIpc((input) => ({ got: input.name }));
  assert.deepEqual(env.calls, ['quiet', 'open:/w/p.aep', 'begin:Resize', 'end', 'save', 'unquiet']);
  const result = out(env);
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { got: 'x' });
  assert.equal(result.error, null);
  assert.equal(typeof result.durationMs, 'number');
});

test('runIpc: an error closes the undo group, does not save, and is reported', () => {
  const env = ipcEnv();
  env.mf.runIpc(() => { throw new Error('boom'); });
  assert.deepEqual(env.calls, ['quiet', 'open:/w/p.aep', 'begin:Resize', 'end', 'unquiet']);
  const result = out(env);
  assert.equal(result.ok, false);
  assert.match(result.error, /boom/);
  assert.equal(result.result, null);
});

test('runIpc: readOnly skips the undo group and the save', () => {
  const env = ipcEnv();
  env.mf.runIpc(() => 1, { readOnly: true });
  assert.deepEqual(env.calls, ['quiet', 'open:/w/p.aep', 'unquiet']);
  assert.equal(out(env).result, 1);
});

test('runIpc: a bad input file or project is reported in the result file, never thrown', () => {
  const env = ipcEnv();
  env.disk.set('/w/.ipc/1.in.json', '{ nope');
  env.mf.runIpc(() => 1);
  assert.match(out(env).error, /JSON:/);
  const env2 = ipcEnv();
  env2.disk.set('/w/.ipc/1.in.json', JSON.stringify({ project: '/w/missing.aep' }));
  env2.mf.runIpc(() => 1);
  assert.match(out(env2).error, /Project file not found/);
  assert.ok(!env2.calls.includes('save'));
});

test('runIpc: the project must not be switched when another one is open', () => {
  const env = ipcEnv();
  env.sandbox.app.project.file = { fsName: '/w/other.aep' };
  env.mf.runIpc(() => 1);
  assert.match(out(env).error, /Another project is open/);
  assert.ok(!env.calls.includes('save') && !env.calls.includes('begin:Resize'));
});

test('runIpc: when the result cannot be written the problem goes to the ExtendScript log', () => {
  const env = ipcEnv();
  env.disk.set('__nowrite__', '1');
  env.mf.runIpc(() => 1);
  assert.ok(env.lines.some((l) => /could not write/.test(l)));
});

test('runIpc: overrides win over MF_IPC and a missing outPath throws', () => {
  const env = ipcEnv();
  env.mf.runIpc(() => 7, { readOnly: true, outPath: '/w/.ipc/other.out.json' });
  assert.equal(JSON.parse(env.disk.get('/w/.ipc/other.out.json')).result, 7);
  env.sandbox.$.global.MF_IPC = {};
  assert.throws(() => env.mf.runIpc(() => 1), /no outPath/);
});

test('runIpc: no dialog function is ever called (suppressed while running)', () => {
  const env = ipcEnv();
  env.mf.runIpc(() => 1);
  assert.ok(env.calls.indexOf('quiet') < env.calls.indexOf('begin:Resize'));
  assert.ok(env.calls.indexOf('unquiet') > env.calls.indexOf('save'));
});

test('undoGroup closes the group when the function throws', () => {
  const { mf, calls } = makeEnv();
  assert.throws(() => mf.undoGroup('x', () => { throw new Error('no'); }), /no/);
  assert.deepEqual(calls, ['begin:x', 'end']);
  assert.equal(mf.undoGroup('y', () => 5), 5);
});

// ---------- dump.jsx ----------

/** Fake AE property: a leaf (value, keys, expression) or a group (children). */
function prop(name, matchName, extra = {}) {
  return { name, matchName, propertyType: 'PROPERTY', numKeys: 0, expression: '', expressionEnabled: false, canSetExpression: true, ...extra };
}
function group(name, matchName, children) {
  const node = { name, matchName, propertyType: 'GROUP', numProperties: children.length, property(arg) {
    return typeof arg === 'number' ? children[arg - 1] : children.find((c) => c.matchName === arg);
  } };
  return node;
}

function dumpEnv() {
  const env = ipcEnv();
  const s = env.sandbox;
  class Item {}
  class CompItem extends Item {}
  class FootageItem extends Item {}
  class SolidSource {}
  class FileSource {}
  class AVLayer {}
  class ShapeLayer extends AVLayer {}
  class TextLayer extends AVLayer {}
  class CameraLayer {}
  class LightLayer {}
  Object.assign(s, { CompItem, FootageItem, SolidSource, FileSource, AVLayer, ShapeLayer, TextLayer, CameraLayer, LightLayer,
    PropertyType: { PROPERTY: 'PROPERTY', INDEXED_GROUP: 'GROUP', NAMED_GROUP: 'GROUP' },
    KeyframeInterpolationType: { LINEAR: 1, BEZIER: 2, HOLD: 3 } });

  const position = prop('Position', 'ADBE Position', {
    value: [960, 540], numKeys: 2, keyTime: (j) => j - 1, keyValue: (j) => [100 * j, 50], keyInInterpolationType: () => 2, keyOutInterpolationType: () => 1,
  });
  const opacity = prop('Opacity', 'ADBE Opacity', { value: 100, expression: 'wiggle(1, 10)', expressionEnabled: true });
  const scale = prop('Scale', 'ADBE Scale', { value: [100, 100] });
  const rotation = prop('Rotation', 'ADBE Rotate Z', { value: 0 });
  const blur = group('Gaussian Blur', 'ADBE Gaussian Blur 2', [prop('Blurriness', 'ADBE Gaussian Blur 2-0001', { value: 5, numKeys: 1, keyTime: () => 0, keyValue: () => 5, keyInInterpolationType: () => 3, keyOutInterpolationType: () => 3 })]);

  const layerBase = (Cls, name, index, extra = {}) => {
    const layer = new Cls();
    Object.assign(layer, { name, index, inPoint: 0, outPoint: 12, parent: null, enabled: true, locked: false, nullLayer: false, adjustmentLayer: false, source: null }, extra);
    const transform = group('Transform', 'ADBE Transform Group', [position, scale, rotation, opacity]);
    const effects = group('Effects', 'ADBE Effect Parade', extra.hasBlur ? [blur] : []);
    const top = [transform, effects, ...(extra.extraGroups ?? [])];
    layer.numProperties = top.length;
    layer.property = (arg) => (typeof arg === 'number' ? top[arg - 1] : top.find((g) => g.matchName === arg));
    return layer;
  };
  const text = layerBase(TextLayer, 'Title', 1, { extraGroups: [group('Text', 'ADBE Text Properties', [prop('Source Text', 'ADBE Text Document', { value: { font: 'Arial-Black' } })])] });
  const shape = layerBase(ShapeLayer, 'Shape Layer 1', 2, { hasBlur: true, parent: text });
  const nul = layerBase(AVLayer, 'Controller', 3, { nullLayer: true });
  const solid = layerBase(AVLayer, 'BG', 4, { source: Object.assign(new FootageItem(), { mainSource: new SolidSource(), footageMissing: false }) });
  const clip = Object.assign(new FootageItem(), { name: 'clip.mov', mainSource: new FileSource(), file: { fsName: '/media/clip.mov' }, footageMissing: true });
  const pre = layerBase(AVLayer, 'Pre', 5, { source: new CompItem() });
  const footageLayer = layerBase(AVLayer, 'Clip', 6, { source: clip });
  const layers = [text, shape, nul, solid, pre, footageLayer];
  const comp = Object.assign(new CompItem(), { id: 7, name: 'Main', width: 1920, height: 1080, frameRate: 25, duration: 12, numLayers: layers.length, layer: (i) => layers[i - 1] });
  const items = [comp, clip, Object.assign(new FootageItem(), { name: 'Solid 1', mainSource: new SolidSource() })];
  s.app.project.numItems = items.length;
  s.app.project.item = (i) => items[i - 1];
  s.app.project.file = { fsName: '/w/p.aep' };
  env.disk.set('/w/p.aep', 'bin');
  return env;
}

test('dump.jsx writes the section 7 schema and never changes the project', () => {
  const env = dumpEnv();
  env.run(read('dump.jsx'));
  const dump = JSON.parse(env.disk.get('/w/.ipc/1.out.json'));
  assert.equal(dump.ok, true, dump.error);
  assert.deepEqual(env.calls.filter((c) => c === 'save' || c.startsWith('begin')), [], 'read-only: no undo group, no save');
  const result = dump.result;
  assert.deepEqual(validateDump(JSON.parse(JSON.stringify(result))), [], 'what dump.jsx writes passes the schema');
  assert.deepEqual(result.ae, { version: '24.1.0' });
  assert.deepEqual(result.project, { path: '/w/p.aep', bitsPerChannel: 8 });
  assert.deepEqual(result.footage, [{ name: 'clip.mov', path: '/media/clip.mov', missing: true }]);
  assert.deepEqual(result.fonts, ['Arial-Black']);
  const [comp] = result.comps;
  assert.deepEqual([comp.id, comp.name, comp.width, comp.height, comp.fps, comp.duration], [7, 'Main', 1920, 1080, 25, 12]);
  assert.deepEqual(comp.layers.map((l) => [l.index, l.name, l.type]), [
    [1, 'Title', 'text'], [2, 'Shape Layer 1', 'shape'], [3, 'Controller', 'null'], [4, 'BG', 'solid'], [5, 'Pre', 'precomp'], [6, 'Clip', 'footage'],
  ]);
});

test('dump.jsx reports parents, transforms, effects, expressions and keyframes', () => {
  const env = dumpEnv();
  env.run(read('dump.jsx'));
  const [title, shape] = JSON.parse(env.disk.get('/w/.ipc/1.out.json')).result.comps[0].layers;
  assert.equal(shape.parent, 1);
  assert.equal(title.parent, null);
  assert.deepEqual(title.transform, { position: [960, 540], scale: [100, 100], rotation: 0, opacity: 100 });
  assert.deepEqual(shape.effects, ['Gaussian Blur']);
  assert.deepEqual(title.expressions, { 'transform.opacity': 'wiggle(1, 10)' });
  assert.deepEqual(title.keyframes['transform.position'], [
    { t: 0, v: [100, 50], ease: 'in:BEZIER,out:LINEAR' },
    { t: 1, v: [200, 50], ease: 'in:BEZIER,out:LINEAR' },
  ]);
  assert.deepEqual(shape.keyframes['effects.gaussianBlur.blurriness'], [{ t: 0, v: 5, ease: 'in:HOLD,out:HOLD' }]);
  assert.equal(title.enabled, true);
  assert.equal(title.locked, false);
});

test('dump.jsx options can switch keyframes and expressions off or cap keyframes', () => {
  const env = dumpEnv();
  env.disk.set('/w/.ipc/1.in.json', JSON.stringify({ project: '/w/p.aep', params: { keyframes: false, expressions: false } }));
  env.run(read('dump.jsx'));
  const [title] = JSON.parse(env.disk.get('/w/.ipc/1.out.json')).result.comps[0].layers;
  assert.deepEqual(title.keyframes, {});
  assert.deepEqual(title.expressions, {});
  const capped = dumpEnv();
  capped.disk.set('/w/.ipc/1.in.json', JSON.stringify({ project: '/w/p.aep', params: { maxKeyframes: 1 } }));
  capped.run(read('dump.jsx'));
  assert.equal(JSON.parse(capped.disk.get('/w/.ipc/1.out.json')).result.comps[0].layers[0].keyframes['transform.position'].length, 1);
});

// ---------- the real wrapper, run end to end on the fake AE ----------

const HELPERS = read('helpers.jsx');

/** Builds the same wrapper ae-run writes, for a given script text, and runs it. Returns the parsed result file. */
function runWrapped(scriptText, { prepare } = {}) {
  const env = ipcEnv();
  prepare?.(env);
  const wrapper = buildWrapper({ inPath: '/w/.ipc/1.in.json', outPath: '/w/.ipc/1.out.json', undoName: 'Step', workDir: '/w', save: true }, HELPERS, scriptText);
  env.run(wrapper.text);
  return { env, result: env.disk.has('/w/.ipc/1.out.json') ? JSON.parse(env.disk.get('/w/.ipc/1.out.json')) : null };
}

test('wrapper: a valid script runs through new Function and returns its result', () => {
  const { result, env } = runWrapped('mf.runIpc(function (input) { return { name: input.name, sum: 1 + 2 }; });');
  assert.deepEqual([result.ok, result.result], [true, { name: 'x', sum: 3 }]);
  assert.ok(env.calls.includes('save'));
});

test('wrapper: a syntax error becomes a result file, not an error dialog', () => {
  const { result, env } = runWrapped('var broken = ;\nmf.runIpc(function () { return 1; });');
  assert.equal(result.ok, false);
  assert.match(result.error, /^Syntax error in the script: /);
  assert.ok(!env.calls.includes('save') && !env.calls.includes('begin:Step'), 'nothing ran, nothing was saved');
  assert.equal(runWrapped('function (').result.ok, false);
  assert.equal(runWrapped('mf.runIpc(function () { return 1; }').result.ok, false, 'unbalanced parenthesis');
});

test('wrapper: a throw outside mf.runIpc becomes a result file', () => {
  const { result } = runWrapped('throw new Error("early failure");');
  assert.deepEqual([result.ok, result.error], [false, 'early failure']);
  assert.match(runWrapped('undefinedFunction();').result.error, /undefinedFunction/);
});

test('wrapper: a script that never calls mf.runIpc gets an explicit error instead of a timeout', () => {
  const { result } = runWrapped('var x = 1;');
  assert.equal(result.ok, false);
  assert.match(result.error, /finished without calling mf\.runIpc/);
});

test('wrapper: a thrown error inside mf.runIpc keeps its own message and is not overwritten', () => {
  const { result } = runWrapped('mf.runIpc(function () { throw new Error("inside"); });');
  assert.deepEqual([result.ok, result.error], [false, 'inside']);
});

test('wrapper: a result that cannot be serialized (circular) is reported as a failure, not a missing file', () => {
  const { result } = runWrapped('mf.runIpc(function () { var a = {}; a.self = a; return a; });');
  assert.equal(result.ok, false);
  assert.match(result.error, /could not be turned into JSON/);
});

test('wrapper: Ukrainian and special characters in the script text survive', () => {
  const { result } = runWrapped('mf.runIpc(function () { return { name: "Заголовок \\"1\\" \\n \u2028" }; });');
  assert.equal(result.ok, true);
  assert.equal(result.result.name, 'Заголовок "1" \n \u2028');
});

test('failIpc does nothing when a result already exists', () => {
  const env = ipcEnv();
  env.disk.set('/w/.ipc/1.out.json', '{"ok":true}');
  env.mf.failIpc('late failure');
  assert.equal(env.disk.get('/w/.ipc/1.out.json'), '{"ok":true}');
});
