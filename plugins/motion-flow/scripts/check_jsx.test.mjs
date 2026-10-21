import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { checkEs3, stripNonCode } from './check_jsx.mjs';

const messages = (source) => checkEs3(source).map((p) => p.message);

test('modern syntax is reported', () => {
  assert.ok(messages('let a = 1;').includes('ES6+ keyword'));
  assert.ok(messages('const a = 1;').includes('ES6+ keyword'));
  assert.ok(messages('var f = (x) => x;').includes('arrow function'));
  assert.ok(messages('var s = `a${b}`;').includes('template string'));
  assert.ok(messages('f(...args);').includes('spread/rest'));
  assert.ok(messages('var a = [1].map(f);').some((m) => m.includes('ES3')));
  assert.ok(messages('list.forEach(f);').some((m) => m.includes('ES3')));
  assert.ok(messages('var t = JSON.stringify(x);').some((m) => m.includes('JSON')));
  assert.ok(messages('Object.keys(o);').some((m) => m.includes('Object')));
  assert.ok(messages('Array.isArray(a);').some((m) => m.includes('Array')));
  assert.ok(messages('var o = { a: 1, };').includes('trailing comma'));
  assert.ok(messages('var a = [1, 2, ];').includes('trailing comma'));
  assert.ok(messages('var s = "a.trim()";').length === 0, 'text inside strings is ignored');
  assert.ok(messages('x.trim();').some((m) => m.includes('ES3')));
});

test('dialogs are reported', () => {
  assert.ok(messages('alert("hi");').some((m) => m.includes('dialog')));
  assert.ok(messages('var ok = confirm("x");').some((m) => m.includes('dialog')));
  assert.ok(messages('mf.alert(1);').length === 0, 'a method named alert is not a dialog');
});

test('ES3 code, comments, strings and regexes do not trigger anything', () => {
  const ok = [
    '// let const => `x` ...',
    '/* const a = 1; x.map(f); */',
    'var a = "let x = () => 1; `y`";',
    "var b = 'JSON.stringify';",
    'var re = /^-?\\d+(\\.\\d+)?$/; var c = a / 2 / 3;',
    'var d = " \\t".indexOf("x") + a.lastIndexOf("y");',
    'function f(a, b) { return a + b; }',
    'try { f(); } catch (e) { } finally { }',
  ].join('\n');
  assert.deepEqual(checkEs3(ok), []);
});

test('line numbers are kept when comments span lines', () => {
  const problems = checkEs3('/* a\nb\nc */\nlet x = 1;');
  assert.deepEqual(problems.map((p) => p.line), [4]);
});

test('stripNonCode keeps the code length per line', () => {
  const source = 'var a = "abc"; // c\nvar b = /x\\/y/g;';
  assert.equal(stripNonCode(source).split('\n').length, 2);
});

test('every shipped .jsx file under lib/jsx is ES3-clean', () => {
  const dir = fileURLToPath(new URL('../lib/jsx/', import.meta.url));
  const files = readdirSync(dir).filter((n) => n.endsWith('.jsx'));
  assert.ok(files.includes('helpers.jsx') && files.includes('dump.jsx'));
  for (const name of files) {
    assert.deepEqual(checkEs3(readFileSync(join(dir, name), 'utf8')), [], name);
  }
});
