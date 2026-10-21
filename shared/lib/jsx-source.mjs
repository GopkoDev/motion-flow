// Helpers for reading ExtendScript source: comment/string stripping and the safety policy for scripts that
// an agent writes into a project's jsx/ folder. ae-run refuses scripts that break the policy.
//
// The policy is a safety net against mistakes and obvious misuse, not a sandbox: a script runs inside
// After Effects with the designer's rights. The real protection is the approved plan, the review of the script
// and the guard hook. Scripts reach files only through mf.workFile / mf.workFolder (limited to work/).

/** Replaces comments, strings and regex literals with blanks so the checks only see code. Keeps line numbers. */
export function stripNonCode(source) {
  let out = '';
  let i = 0;
  let previous = ''; // last significant character, to tell a regex "/" from a division
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      out += `${c}${' '.repeat(Math.max(0, j - i - 1))}${c}`;
      i = j + 1;
      previous = c;
    } else if (c === '/' && (previous === '' || '(,=:[!&|?{};+-*%<>~^'.includes(previous))) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n' && (source[j] !== '/' || inClass)) {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j++;
      }
      out += `/${' '.repeat(Math.max(0, j - i - 1))}/`;
      i = j + 1;
      previous = '/';
    } else {
      out += c;
      if (!/\s/.test(c)) previous = c;
      i++;
    }
  }
  return out;
}


const POLICY = [
  [/\bsystem\b\s*\.|\bcallSystem\b/, 'runs system commands (system.callSystem)'],
  [/\.\s*execute\s*\(/, 'launches files or programs (.execute)'],
  [/\beval\s*\(|\$\s*\.\s*eval|\bevalFile\b|\bnew\s+Function\b|\bFunction\s*\(/, 'runs dynamic code (eval, evalFile, Function)'],
  [/\bSocket\b|\bHTTPConnection\b|\bwebResponse\b/, 'uses the network'],
  [/\b(File|Folder)\b/, 'uses File/Folder directly (use mf.workFile / mf.workFolder, which stay inside work/)'],
  [/\$\s*\.\s*global\s*\[|\bthis\s*\[|\$\s*\[/, 'looks up globals by name (hides what the script calls)'],
  [/\bapp\s*\.\s*(quit|exitAfterLaunchAndEval|open)\b|\.\s*project\s*\.\s*close\b|\bsaveWithDialog\b|\bexecuteCommand\b/, 'opens, closes, saves-as or quits (mf.runIpc manages the project)'],
  [/\bgetenv\b|\bsetenv\b/, 'reads or sets environment variables'],
];

/** Returns [{ line, message }] for every policy violation in a script written for a project's jsx/ folder. */
export function checkPolicy(source) {
  const problems = [];
  stripNonCode(source).split('\n').forEach((text, index) => {
    for (const [pattern, message] of POLICY) if (pattern.test(text)) problems.push({ line: index + 1, message });
  });
  return problems;
}
