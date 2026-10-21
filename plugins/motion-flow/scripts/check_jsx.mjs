#!/usr/bin/env node
// Static check that ExtendScript files (lib/jsx/*.jsx) stay ES3-compatible.
// ExtendScript in After Effects is ES3: no let/const, arrow functions, template strings, ES5 array methods,
// JSON object, Object.keys, trailing commas, ... Usage: node scripts/check_jsx.mjs [--policy] [dir-or-file ...]
// --policy also applies the safety policy that ae-run enforces on scripts in a project's jsx/ folder.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPolicy, stripNonCode } from '../lib/jsx-source.mjs';

export { stripNonCode };

const RULES = [
  [/\b(let|const|class|import|export|async|await|yield|of)\b(?=\s+[\w{[(*])/, 'ES6+ keyword'],
  [/=>/, 'arrow function'],
  [/`/, 'template string'],
  [/\.\.\./, 'spread/rest'],
  [/function\s*\*/, 'generator'],
  [/\.(forEach|map|filter|reduce|reduceRight|some|every|bind|trim|trimStart|trimEnd|includes|startsWith|endsWith|repeat|padStart|padEnd|find|findIndex|flat|flatMap|fill|entries|keys|values|assign)\(/, 'method that ExtendScript (ES3) does not have'],
  [/\bJSON\./, 'JSON object (use mf.toJSON / mf.parseJSON)'],
  [/\bObject\.(keys|create|defineProperty|defineProperties|getPrototypeOf|freeze|seal|entries|values|assign)\b/, 'ES5+ Object method'],
  [/\bArray\.(isArray|from|of)\b/, 'ES5+ Array method'],
  [/\bDate\.now\b|\bNumber\.is(Finite|Integer|NaN)\b|\bMath\.(trunc|sign|log2|log10|hypot)\b/, 'ES5+ built-in'],
  [/,\s*[\]}]/, 'trailing comma'],
  [/\b(get|set)\s+\w+\s*\(\s*\w*\s*\)\s*\{/, 'getter/setter'],
  [/\bnew\s+(Map|Set|WeakMap|WeakSet|Promise|Symbol)\b|\b(Map|Set|Promise|Symbol)\s*\(/, 'ES6 built-in'],
];

/** Returns [{ line, message }] for every ES3 violation found in the source. */
export function checkEs3(source) {
  const code = stripNonCode(source);
  const problems = [];
  code.split('\n').forEach((text, index) => {
    for (const [pattern, message] of RULES) {
      if (pattern.test(text)) problems.push({ line: index + 1, message });
    }
  });
  // alert/confirm/prompt are dialogs: scripts must never show them
  code.split('\n').forEach((text, index) => {
    if (/(^|[^.\w])(alert|confirm|prompt)\s*\(/.test(text)) problems.push({ line: index + 1, message: 'dialog (alert/confirm/prompt) is not allowed' });
  });
  return problems;
}

function jsxFiles(target) {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const path = join(target, entry.name);
    if (entry.isDirectory()) return jsxFiles(path);
    return entry.name.endsWith('.jsx') ? [path] : [];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const policy = process.argv.includes('--policy');
  const rest = process.argv.slice(2).filter((a) => a !== '--policy');
  const targets = rest.length ? rest : [join(root, 'lib', 'jsx')];
  let failed = 0;
  for (const file of targets.flatMap(jsxFiles)) {
    const source = readFileSync(file, 'utf8');
    for (const { line, message } of [...checkEs3(source), ...(policy ? checkPolicy(source) : [])]) {
      console.error(`${file}:${line}: ${message}`);
      failed++;
    }
  }
  if (failed) {
    console.error(`check_jsx: ${failed} problem(s)`);
    process.exit(1);
  }
  console.log('check_jsx: ok');
}
