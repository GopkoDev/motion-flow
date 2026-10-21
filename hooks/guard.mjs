#!/usr/bin/env node
// PreToolUse guard for motion-flow.
//
// Reads the hook JSON from stdin and decides:
//   deny  -> exit 2, reason on stderr (hard block)
//   ask   -> exit 0 with permissionDecision "ask" (the user confirms)
//   allow -> exit 0, no output
// Any internal problem is a deny (fail closed).
//
// What it protects (spec 4.20 and section 9):
//   - the Google Drive roots from ~/.motion-flow/roots.json (access only through drive-gate)
//   - the drive-gate config itself and the Claude Code settings/plugins
//   - rm/mv outside work/, dangerous git commands, direct After Effects / ExtendScript launches
// It cannot see inside arbitrary scripts (node -e, python -c); permissions.deny and the OS sandbox cover that.
import * as fs from 'node:fs';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_DEPTH = 6;

const RANK = { allow: 0, ask: 1, deny: 2 };

/** Collects findings; the strongest decision wins. */
class Verdict {
  constructor() {
    this.decision = 'allow';
    this.reasons = [];
  }

  add(decision, reason) {
    if (RANK[decision] > RANK[this.decision]) {
      this.decision = decision;
      this.reasons = [reason];
    } else if (decision === this.decision && decision !== 'allow' && !this.reasons.includes(reason)) {
      this.reasons.push(reason);
    }
  }
}

// ---------- paths ----------

const FOLD_CASE = process.platform === 'darwin' || process.platform === 'win32';

function normalize(path) {
  const nfc = path.normalize('NFC');
  return FOLD_CASE ? nfc.toLowerCase() : nfc;
}

function inside(base, target) {
  const b = normalize(base);
  const t = normalize(target);
  return t === b || t.startsWith(b.endsWith(sep) ? b : b + sep);
}

/** realpath of the nearest existing ancestor plus the not-yet-existing remainder. */
function realish(absolute) {
  let current = absolute;
  const rest = [];
  for (;;) {
    try {
      return join(realpathSync.native(current), ...rest.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      rest.push(basename(current));
      current = parent;
    }
  }
}

function expandHome(token, home) {
  if (token === '~') return home;
  if (token.startsWith('~/')) return join(home, token.slice(2));
  return token
    .replace(/^\$\{HOME\}(?=\/|$)/, home)
    .replace(/^\$HOME(?=\/|$)/, home);
}

/** Resolves a token to a real absolute path, or null when it cannot be known statically. */
function resolveToken(token, cwd, home) {
  if (token.includes('\0')) return null;
  const expanded = expandHome(token, home);
  if (/[$`]/.test(expanded)) return null;
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
  return realish(absolute);
}

// ---------- shell parsing ----------

/**
 * Splits a shell command into simple commands. Returns { commands, nested } where nested are the
 * texts of $(...), `...` and (...) bodies that must be analysed as well.
 * A command is { words: string[], redirects: [{ op, target }] }.
 */
export function parseShell(text) {
  const commands = [];
  const nested = [];
  let words = [];
  let redirects = [];
  let word = '';
  let hasWord = false;

  const pushWord = () => {
    if (hasWord) words.push(word);
    word = '';
    hasWord = false;
  };
  const endCommand = () => {
    pushWord();
    if (words.length || redirects.length) commands.push({ words, redirects });
    words = [];
    redirects = [];
  };
  const findClose = (start, open, close) => {
    let depth = 1;
    let i = start;
    let quote = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\' && quote === '"') i++;
        else if (c === quote) quote = null;
      } else if (c === '\\') i++;
      else if (c === "'" || c === '"') quote = c;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) return i;
    }
    return text.length;
  };
  const readSubstitution = (i) => {
    // text[i] is "$" and text[i+1] is "("
    const end = findClose(i + 2, '(', ')');
    nested.push(text.slice(i + 2, end));
    word += '$(…)';
    hasWord = true;
    return end;
  };
  const readBackticks = (i) => {
    let end = i + 1;
    while (end < text.length && text[end] !== '`') end += text[end] === '\\' ? 2 : 1;
    nested.push(text.slice(i + 1, end));
    word += '`…`';
    hasWord = true;
    return end;
  };
  const readTarget = (from) => {
    // reads the next word after a redirect operator, returns [target, nextIndex]
    let i = from;
    while (text[i] === ' ' || text[i] === '\t') i++;
    let target = '';
    let quote = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = null;
        else if (c === '\\' && quote === '"' && '$`"\\\n'.includes(text[i + 1] ?? '')) target += text[++i];
        else target += c;
      } else if (c === "'" || c === '"') quote = c;
      else if (c === '\\') target += text[++i] ?? '';
      else if (/[\s;&|()<>]/.test(c)) break;
      else if (c === '$' && text[i + 1] === '(') {
        const end = findClose(i + 2, '(', ')');
        nested.push(text.slice(i + 2, end));
        target += '$(…)';
        i = end;
      } else target += c;
    }
    return [target, i - 1];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      if (text[i + 1] === '\n') { i++; continue; }
      word += text[++i] ?? '';
      hasWord = true;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      word += text.slice(i + 1, stop);
      hasWord = true;
      i = stop;
    } else if (c === '"') {
      hasWord = true;
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '\\') {
          // inside double quotes a backslash only escapes these characters; otherwise it stays literal
          if ('$`"\\\n'.includes(text[i + 1] ?? '')) word += text[++i];
          else word += '\\';
        } else if (text[i] === '$' && text[i + 1] === '(') i = readSubstitution(i);
        else if (text[i] === '`') i = readBackticks(i);
        else word += text[i];
      }
    } else if (c === '$' && text[i + 1] === '(') {
      i = readSubstitution(i);
    } else if (c === '`') {
      i = readBackticks(i);
    } else if (c === '#' && !hasWord) {
      while (i < text.length && text[i] !== '\n') i++;
      endCommand();
    } else if (c === ' ' || c === '\t') {
      pushWord();
    } else if (c === '\n' || c === ';' || c === '(' || c === ')' || (c === '{' && !hasWord && /\s/.test(text[i + 1] ?? ' ')) || (c === '}' && !hasWord && /[\s;]/.test(text[i + 1] ?? ' '))) {
      endCommand();
    } else if (c === '&' || c === '|') {
      if (c === '&' && text[i + 1] === '>') {
        pushWord();
        const op = text[i + 2] === '>' ? '&>>' : '&>';
        const [target, next] = readTarget(i + op.length);
        redirects.push({ op, target });
        i = next;
      } else {
        if (text[i + 1] === c) i++;
        endCommand();
      }
    } else if (c === '>' || c === '<') {
      if (/^\d+$/.test(word)) { word = ''; hasWord = false; } // fd number
      else pushWord();
      if (c === '<' && text[i + 1] === '(') { // process substitution
        const end = findClose(i + 2, '(', ')');
        nested.push(text.slice(i + 2, end));
        i = end;
        continue;
      }
      if (c === '<' && text[i + 1] === '<') { // heredoc: skip the body, but scan it for substitutions
        let j = i + 2;
        if (text[j] === '-') j++;
        const [delimiterRaw, next] = readTarget(j);
        const bodyStart = text.indexOf('\n', next);
        const delimiter = delimiterRaw.replace(/^[-]/, '');
        let bodyEnd = text.length;
        let scan = bodyStart === -1 ? text.length : bodyStart + 1;
        while (scan < text.length) {
          const lineEnd = text.indexOf('\n', scan);
          const line = text.slice(scan, lineEnd === -1 ? text.length : lineEnd);
          if (line.trim() === delimiter) { bodyEnd = scan; break; }
          scan = lineEnd === -1 ? text.length : lineEnd + 1;
        }
        const body = bodyStart === -1 ? '' : text.slice(bodyStart + 1, bodyEnd);
        for (const m of body.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) nested.push(m[1] ?? m[2]);
        // resume after the heredoc terminator line
        const after = text.indexOf('\n', bodyEnd);
        i = after === -1 ? text.length : after;
        endCommand();
        continue;
      }
      let op = c;
      while (text[i + 1] === c || (c === '>' && (text[i + 1] === '|' || text[i + 1] === '&'))) op += text[++i];
      if (op.endsWith('&') && /^\s*[\d-]/.test(text.slice(i + 1, i + 3))) { // fd duplication such as 2>&1
        while (/[\d-]/.test(text[i + 1] ?? '')) i++;
        continue;
      }
      const [target, next] = readTarget(i + 1);
      redirects.push({ op, target });
      i = next;
    } else {
      word += c;
      hasWord = true;
    }
  }
  endCommand();
  return { commands, nested };
}

// ---------- command knowledge ----------

const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'ls', 'wc', 'stat', 'file', 'jq', 'sort', 'nl', 'diff', 'cmp', 'realpath', 'readlink', 'grep', 'rg', 'echo', 'printf', 'test', '[', 'pwd', 'dirname', 'basename']);
const HARMLESS_ARGS = new Set(['echo', 'printf']); // their arguments are text, not file access
const RECURSIVE = new Set(['find', 'grep', 'rg', 'ag', 'fd', 'tree', 'du', 'rsync', 'tar', 'zip', 'cp', 'scp', 'ls', 'fdfind', 'locate', 'mdfind']);
const REMOVERS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash', 'trash-put', 'mv', 'rename', 'remove-item', 'ri', 'rd', 'del', 'erase', 'move-item', 'mi', 'rni', 'rename-item']);
const WRAPPERS = new Set(['sudo', 'doas', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'ionice', 'setsid', 'stdbuf', 'unbuffer', 'caffeinate', 'timeout', 'watch', 'chronic']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'ash']);
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'perl', 'ruby', 'php', 'osascript', 'powershell', 'pwsh', 'cmd', 'wscript', 'cscript', 'lua', 'tclsh', 'swift', 'jsc']);
const AE_BINARIES = /^(afterfx|aerender|adobe after effects.*|extendscript.*|estk|afterfx\.com)$/;
const SANCTIONED = new Set(['ae-run', 'ae-dump', 'ae-render-frame', 'ae-lint', 'aep-version']);
const AE_TEXT = /DoScriptFile|DoScript\b|afterfx|aerender|Adobe After Effects|ExtendScript/i;
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);
const BUILD_LOG = /(^|\/)\.motion\/build\.log\.jsonl$/;
const AUTO_FILE = /(^|\/)\.motion\/auto\.json$/;
const GATE_FILE = /(^|\/)\.motion\/(plan|check)\.md$/;
// Approval fields: only `mf-gate approve` may write them, after the designer approved.
const APPROVAL_FIELDS = /^[ \t]*(status:[ \t]*approved|approved:[ \t]*true|plan_sha256:[ \t]*[0-9a-fA-F]{16,}|approved_at:[ \t]*\d)/m;
const PROTECTED_WRITE = /(^|\/)\.claude\/(settings(\.local)?\.json|plugins(\/|$))/;

/** True when `mf-gate auto on` was confirmed for this project. */
function autoModeOn(project) {
  try {
    return JSON.parse(readFileSync(join(project, '.motion', 'auto.json'), 'utf8')).enabled === true;
  } catch { return false; }
}

function commandName(raw) {
  return basename(raw).toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
}

function stripAssignments(words, verdict) {
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) {
    const name = words[index].split('=')[0];
    if (/^(HOME|USERPROFILE|MOTION_FLOW_HOME|XDG_CONFIG_HOME)$/i.test(name)) {
      verdict.add('deny', `Changing ${name} is not allowed: drive-gate must read its config from the real home directory.`);
    }
    index++;
  }
  return words.slice(index);
}

// ---------- the analysis ----------

class Guard {
  constructor(env) {
    this.home = env.home;
    this.roots = env.roots.map((r) => ({ lexical: resolve(r), real: realish(resolve(r)) }));
    this.configDir = realish(join(this.home, '.motion-flow'));
    this.projectDir = env.projectDir;
    this.workDir = realish(resolve(env.projectDir, env.workDir ?? 'work'));
    this.pluginBin = env.pluginRoot ? realish(join(env.pluginRoot, 'bin')) : null;
    this.verdict = new Verdict();
    this.inShell = false;
  }

  driveRoot(path) {
    return this.roots.find((r) => inside(r.real, path) || inside(r.lexical, path));
  }

  ancestorOfRoot(path) {
    return this.roots.find((r) => inside(path, r.real) && normalize(path) !== normalize(r.real));
  }

  /** Checks one resolved path. `mode` is "read", "write" or "list" (recursive read). */
  checkPath(path, mode, label) {
    const root = this.driveRoot(path);
    if (root) {
      this.verdict.add('deny', `${label} is inside the Google Drive folder. Use drive-gate (ls, info, fetch --to work/) instead of touching Drive directly.`);
      return;
    }
    if (mode === 'list' && this.ancestorOfRoot(path)) {
      this.verdict.add('deny', `${label} contains a Google Drive folder and this would read into it. Use drive-gate instead.`);
    }
    if (inside(this.configDir, path) && mode === 'write') {
      this.verdict.add('deny', `${label} is the drive-gate config directory (~/.motion-flow). The allowlist can only be edited by a person.`);
    }
    if (mode === 'write' && BUILD_LOG.test(path.split(sep).join('/')) && !this.allowBuildLog) {
      this.verdict.add('deny', `${label} is the build log. Only ae-run writes it (ae-run ... --step N), so that it records what really ran. Do not edit it by hand.`);
    }
    if (mode === 'write' && AUTO_FILE.test(path.split(sep).join('/'))) {
      this.verdict.add('deny', `${label} switches auto mode (the agent approving its own plan and check). Only \`mf-gate auto on\` writes it, and the designer confirms that command.`);
    }
    if (mode === 'write' && this.inShell && GATE_FILE.test(path.split(sep).join('/'))) {
      this.verdict.add('ask', `${label} holds a human approval (plan or check). Edit it with the file tools, never with the shell; approvals are written only by mf-gate approve.`);
    }
    if (mode === 'write' && /(^|\/)\.motion\/drive\.json$/.test(path.split(sep).join('/'))) {
      this.verdict.add('ask', `${label} sets which Google Drive folders this project may read. Use mf-init --drive, and confirm only if the designer chose exactly this.`);
    }
    if (mode === 'write' && PROTECTED_WRITE.test(path.split(sep).join('/'))) {
      this.verdict.add('ask', `${label} changes Claude Code settings or plugins, which hold the safety rules. Confirm with the user.`);
    }
  }

  checkToken(token, cwd, mode, commandLabel) {
    const label = `"${token}"`;
    if (/[*?[]/.test(token) && !/[$`]/.test(token)) {
      const prefix = token.slice(0, token.search(/[*?[]/));
      const base = resolveToken(prefix.endsWith('/') ? prefix : dirname(prefix) || '.', cwd, this.home);
      if (base) {
        this.checkPath(base, mode === 'read' ? 'list' : mode, label);
        try {
          // fs.globSync exists only on Node 22+; without it the prefix check above still applies
          for (const match of (fs.globSync?.(isAbsolute(token) ? token : join(cwd, expandHome(token, this.home))) ?? []).slice(0, 500)) {
            this.checkPath(realish(match), mode, label);
          }
        } catch { /* no glob support: the prefix check above still applies */ }
        return;
      }
    }
    const path = resolveToken(token, cwd, this.home);
    if (path === null) {
      if (/\//.test(token)) this.verdict.add('ask', `${label} in "${commandLabel}" uses a variable or substitution the guard cannot resolve. Confirm with the user.`);
      return;
    }
    this.checkPath(path, mode, label);
    if (RECURSIVE.has(commandLabel) && this.ancestorOfRoot(path)) {
      this.verdict.add('deny', `${label} contains a Google Drive folder and "${commandLabel}" would read into it. Use drive-gate instead.`);
    }
  }

  analyzeShell(text, cwd, depth = 0) {
    this.inShell = true;
    if (depth > MAX_DEPTH) {
      this.verdict.add('ask', 'The command is nested too deeply to check. Confirm with the user.');
      return;
    }
    const { commands, nested } = parseShell(text);
    let currentCwd = cwd;
    for (const inner of nested) this.analyzeShell(inner, currentCwd, depth + 1);
    for (const command of commands) currentCwd = this.analyzeCommand(command, currentCwd, depth);
  }

  /** Returns the working directory in effect after this command (tracks cd). */
  analyzeCommand(command, cwd, depth) {
    const { redirects } = command;
    for (const { op, target } of redirects) {
      if (!target) continue;
      this.checkToken(target, cwd, op.startsWith('<') ? 'read' : 'write', 'redirect');
    }
    let words = stripAssignments(command.words, this.verdict);
    // wrappers: sudo, env, nohup, timeout, ...
    for (let guardCount = 0; words.length && guardCount < 10; guardCount++) {
      const name = commandName(words[0]);
      if (name === 'env') {
        words = stripAssignments(words.slice(1).filter((w, i, all) => !(w === '-i' || w === '-' || w === '-0' || (all[i - 1] === '-u'))).filter((w) => w !== '-u'), this.verdict);
      } else if (WRAPPERS.has(name)) {
        let rest = words.slice(1);
        while (rest.length && (rest[0].startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(rest[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0]))) rest = rest.slice(1);
        words = stripAssignments(rest, this.verdict);
      } else break;
    }
    if (!words.length) return cwd;
    const name = commandName(words[0]);
    const args = words.slice(1);
    for (const word of words) {
      const match = /^(HOME|USERPROFILE|MOTION_FLOW_HOME|XDG_CONFIG_HOME)=/i.exec(word);
      if (match) this.verdict.add('deny', `Changing ${match[1]} is not allowed: drive-gate must read its config from the real home directory.`);
    }

    if (name === 'cd' || name === 'pushd') {
      const target = args.find((a) => !a.startsWith('-'));
      if (target) {
        this.checkToken(target, cwd, 'list', name);
        const resolved = resolveToken(target, cwd, this.home);
        if (resolved) return resolved;
      }
      return cwd;
    }
    if (SHELLS.has(name)) {
      const flagIndex = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
      if (flagIndex !== -1 && args[flagIndex + 1] !== undefined) {
        this.analyzeShell(args[flagIndex + 1], cwd, depth + 1);
        return cwd;
      }
    }
    if (name === 'eval') {
      this.analyzeShell(args.join(' '), cwd, depth + 1);
      return cwd;
    }
    if (name === 'xargs') {
      let rest = args;
      const withValue = new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a']);
      while (rest.length && rest[0].startsWith('-')) rest = rest.slice(withValue.has(rest[0]) ? 2 : 1);
      if (rest.length) this.analyzeCommand({ words: rest, redirects: [] }, cwd, depth + 1);
      return cwd;
    }
    if (name === 'find') this.analyzeFind(args, cwd, depth);

    this.analyzeSetup(name, args);
    this.analyzeInit(name, args);
    this.analyzeGate(name, args);
    this.analyzeGit(name, args);
    this.analyzeAe(name, words, args);

    const sanctioned = SANCTIONED.has(name) || (name === 'drive-gate' && this.isSanctionedDriveGate(words[0]));
    if (sanctioned) return cwd;

    if (REMOVERS.has(name)) this.analyzeRemover(name, args, cwd);

    if (!HARMLESS_ARGS.has(name)) {
      const mode = READERS.has(name) ? 'read' : 'write';
      for (const arg of args) {
        const candidates = [arg];
        if (arg.startsWith('-') && arg.includes('=')) candidates.push(arg.slice(arg.indexOf('=') + 1));
        else if (arg.startsWith('-')) continue;
        else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) candidates.push(arg.slice(arg.indexOf('=') + 1)); // dd of=/path
        if (mode === 'write' && arg.includes('.motion-flow')) {
          this.verdict.add('deny', 'This command mentions the drive-gate config directory (~/.motion-flow). The allowlist can only be edited by a person, through mf-setup.');
        }
        for (const candidate of candidates) {
          if (candidate) this.checkToken(candidate, cwd, RECURSIVE.has(name) && mode === 'read' ? 'list' : mode, name);
        }
      }
    }
    return cwd;
  }

  /**
   * mf-setup writes the list of Drive folders available on this computer. No confirmation is needed for its
   * read-only forms or for the very first setup (no config yet; the designer picked the folders in the skill's
   * question). Changing an existing config asks for confirmation.
   */
  analyzeSetup(name, args) {
    const viaInterpreter = INTERPRETERS.has(name) && args.some((a) => commandName(a) === 'mf-setup');
    if (name !== 'mf-setup' && !viaInterpreter) return;
    if (args.some((a) => ['--detect', '--show', '--dry-run'].includes(a))) return;
    if (!existsSync(join(this.home, '.motion-flow', 'roots.json'))) return;
    this.verdict.add('ask', 'mf-setup would change the list of folders the agent may read. Confirm only if the designer chose exactly this change.');
  }

  /** mf-gate approve records a human approval: Claude Code must show it to the designer. */
  analyzeGate(name, args) {
    const viaInterpreter = INTERPRETERS.has(name) && args.some((a) => commandName(a) === 'mf-gate');
    if (name !== 'mf-gate' && !viaInterpreter) return;
    if (args.includes('approve')) {
      const at = args.indexOf('--project');
      const project = at === -1 || args[at + 1] === undefined ? this.projectDir : resolve(this.projectDir, args[at + 1]);
      if (args.includes('--auto') && autoModeOn(project)) return; // the designer confirmed auto mode once; the gate itself still refuses protected items and known issues
      this.verdict.add('ask', 'mf-gate approve records the designer\'s approval. Confirm only if the designer has just approved this plan or check (they saw it and said yes).');
    }
    if (args.includes('auto') && args.includes('on')) {
      this.verdict.add('ask', 'mf-gate auto on lets the agent approve its own plan and check for this task, with no question to the designer. Confirm only if the designer chose auto mode.');
    }
  }

  /** mf-init --drive changes which Drive folders a project may read; asking is needed when a choice already exists. */
  analyzeInit(name, args) {
    const viaInterpreter = INTERPRETERS.has(name) && args.some((a) => commandName(a) === 'mf-init');
    if (name !== 'mf-init' && !viaInterpreter) return;
    if (args.includes('--dry-run')) return;
    const at = args.indexOf('--project');
    const project = at === -1 || args[at + 1] === undefined ? this.projectDir : resolve(this.projectDir, args[at + 1]);
    if (args.includes('--drive') && existsSync(join(project, '.motion', 'drive.json'))) {
      this.verdict.add('ask', 'mf-init --drive changes which Google Drive folders this project may read. Confirm only if the designer chose exactly this.');
    }
    if (args.includes('--rules') && existsSync(join(project, '.claude', 'settings.json'))) {
      this.verdict.add('ask', 'mf-init --rules edits the project settings.json (it enables a studio rules plugin). Confirm only if the designer chose this studio.');
    }
  }

  isSanctionedDriveGate(rawName) {
    if (!rawName.includes('/') && !rawName.includes('\\')) return true; // resolved through the plugin bin/ on PATH
    return this.pluginBin !== null && realish(resolve(rawName)) === join(this.pluginBin, 'drive-gate');
  }

  analyzeFind(args, cwd, depth) {
    const startPaths = [];
    for (const arg of args) {
      if (arg.startsWith('-') || arg === '(' || arg === '!') break;
      startPaths.push(arg);
    }
    if (args.includes('-delete')) this.analyzeRemover('find -delete', startPaths, cwd);
    for (let i = 0; i < args.length; i++) {
      if (['-exec', '-execdir', '-ok', '-okdir'].includes(args[i])) {
        const end = args.findIndex((a, j) => j > i && (a === ';' || a === '+' || a === '\\;'));
        const inner = args.slice(i + 1, end === -1 ? undefined : end).map((a) => (a === '{}' ? startPaths[0] ?? '.' : a));
        if (inner.length) this.analyzeCommand({ words: inner, redirects: [] }, cwd, depth + 1);
      }
    }
  }

  analyzeRemover(name, args, cwd) {
    const targets = args.filter((a) => !a.startsWith('-'));
    if (!targets.length) return;
    for (const target of targets) {
      const resolved = resolveToken(target, cwd, this.home);
      if (resolved === null) {
        this.verdict.add('ask', `"${name} ${target}" uses a variable or substitution the guard cannot resolve. Confirm with the user.`);
      } else if (this.driveRoot(resolved)) {
        this.verdict.add('deny', `"${name}" on "${target}": Drive files are never deleted, moved or renamed by the agent.`);
      } else if (!inside(this.workDir, resolved) || normalize(resolved) === normalize(this.workDir)) {
        this.verdict.add('deny', `"${name}" on "${target}" is outside work/. The agent may only delete or move files inside work/ (with confirmation).`);
      } else {
        this.verdict.add('ask', `"${name}" removes or moves "${target}" inside work/. Confirm with the user.`);
      }
    }
  }

  analyzeGit(name, args) {
    if (name !== 'git') return;
    let i = 0;
    while (i < args.length && args[i].startsWith('-')) {
      const option = args[i].split('=')[0];
      if (option === '-c' && /alias\./i.test(args[i + 1] ?? '')) this.verdict.add('ask', 'git alias defined on the command line can hide a dangerous command. Confirm with the user.');
      i += GIT_VALUE_OPTIONS.has(args[i]) ? 2 : 1;
    }
    const sub = args[i];
    const rest = args.slice(i + 1);
    const has = (...flags) => rest.some((a) => flags.includes(a));
    if (sub === 'push') this.verdict.add('ask', 'git push publishes work to a remote. Only run it when the user asked for it; confirm with them.');
    else if (sub === 'reset' && has('--hard')) this.verdict.add('ask', 'git reset --hard discards uncommitted work. Confirm with the user.');
    else if (sub === 'clean' && rest.some((a) => /^-[a-zA-Z]*f/.test(a) || a === '--force')) this.verdict.add('ask', 'git clean -f deletes untracked files. Confirm with the user.');
    else if ((sub === 'checkout' || sub === 'switch') && rest.some((a) => a === '--force' || a === '-f' || a === '--discard-changes')) this.verdict.add('ask', `git ${sub} --force discards local changes. Confirm with the user.`);
    else if (sub === 'branch' && rest.some((a) => a === '-D' || a === '--force')) this.verdict.add('ask', 'git branch -D deletes a branch. Confirm with the user.');
  }

  analyzeAe(name, words, args) {
    const blocked = 'After Effects and ExtendScript run only through ae-run, ae-dump or ae-render-frame (they work on copies in work/, inside an undo group).';
    if (AE_BINARIES.test(name)) {
      this.verdict.add('deny', `Direct launch of "${words[0]}" is not allowed. ${blocked}`);
    } else if (name === 'open' && args.some((a) => /after ?effects|\.aep$|\.aepx$|\.jsx$|\.jsxbin$/i.test(a))) {
      this.verdict.add('deny', `"open" on After Effects or its files is not allowed. ${blocked}`);
    } else if (INTERPRETERS.has(name) || SHELLS.has(name)) {
      if (args.some((a) => AE_TEXT.test(a))) this.verdict.add('deny', `This command references After Effects scripting directly. ${blocked}`);
    }
  }
}

// ---------- tool input ----------

function pathsOf(toolName, input) {
  const keys = ['file_path', 'notebook_path', 'path'];
  const values = keys.map((k) => input[k]).filter((v) => typeof v === 'string' && v);
  if (toolName === 'Glob' && typeof input.pattern === 'string') values.push(input.pattern);
  return values;
}

/** Decides for one hook payload. `env` = { home, roots, workDir, projectDir, pluginRoot }. */
export function evaluate(payload, env) {
  const guard = new Guard(env);
  const toolName = payload.tool_name;
  const input = payload.tool_input ?? {};
  const cwd = payload.cwd ?? env.projectDir;

  const cwdReal = realish(resolve(cwd));
  if (guard.driveRoot(cwdReal)) {
    guard.verdict.add('deny', 'The working directory is inside the Google Drive folder. Work in a project folder outside Drive; use drive-gate to fetch copies into work/.');
  }

  if (['Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep'].includes(toolName)) {
    const mode = toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit' ? 'write'
      : toolName === 'Glob' || toolName === 'Grep' ? 'list' : 'read';
    for (const value of pathsOf(toolName, input)) guard.checkToken(value, cwdReal, mode, toolName.toLowerCase());
    if (mode === 'write') {
      const target = input.file_path ?? input.notebook_path ?? '';
      const written = `${input.content ?? ''}\n${input.new_string ?? ''}`;
      const resolved = typeof target === 'string' && target ? resolveToken(target, cwdReal, env.home) : null;
      if (resolved && GATE_FILE.test(resolved.split(sep).join('/')) && APPROVAL_FIELDS.test(written)) {
        guard.verdict.add('deny', 'This would write an approval (status: approved, approved: true, plan_sha256 or approved_at) into a plan or check. Approvals are written only by `mf-gate approve`, after the designer approved. Show the plan or check to the designer and ask.');
      }
    }
    if (toolName === 'Grep' && !input.path) {
      // searching from the cwd: refuse only if the cwd contains a Drive root
      guard.checkPath(cwdReal, 'list', 'The search directory');
    }
  } else if (['Bash', 'PowerShell', 'Monitor'].includes(toolName)) {
    if (typeof input.command !== 'string') {
      guard.verdict.add('deny', `${toolName} call without a command string.`);
    } else {
      guard.analyzeShell(input.command, cwdReal);
    }
  }
  return { decision: guard.verdict.decision, reason: guard.verdict.reasons.join(' ') };
}

// ---------- config + CLI ----------

export function loadEnv(processEnv = process.env, payload = {}) {
  const home = homedir();
  const file = join(home, '.motion-flow', 'roots.json');
  let roots = [];
  let workDir = 'work';
  if (existsSync(file)) {
    let config;
    try {
      config = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`~/.motion-flow/roots.json is not valid JSON (${e.message}); fix it before continuing`);
    }
    roots = Object.values(config.roots ?? {}).filter((v) => typeof v === 'string');
    if (typeof config.work_dir === 'string') workDir = config.work_dir;
  }
  return {
    home,
    roots,
    workDir,
    projectDir: processEnv.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(),
    pluginRoot: processEnv.CLAUDE_PLUGIN_ROOT || null,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function deny(reason) {
  process.stderr.write(`motion-flow guard: blocked. ${reason}\n`);
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const payload = JSON.parse(await readStdin());
    if (!payload || typeof payload !== 'object' || typeof payload.tool_name !== 'string') throw new Error('unexpected hook input');
    const result = evaluate(payload, loadEnv(process.env, payload));
    if (result.decision === 'deny') deny(result.reason);
    if (result.decision === 'ask') {
      process.stdout.write(`${JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `motion-flow guard: ${result.reason}` },
      })}\n`);
    }
    process.exit(0);
  } catch (error) {
    deny(`the guard could not check this call (${error.message}). It refuses by default.`);
  }
}
