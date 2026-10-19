// aep-version: computes the next version name of a project file (project_v03.aep -> project_v04.aep).
// It only computes a name: it never creates, renames or overwrites a file.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// "_v03", " v3", "-V12" right before the extension. The digits are the named group "version".
export const DEFAULT_VERSION_REGEX = '[_\\- ][vV](?<version>\\d+)(?=\\.[^.]+$)';
const MAX_PATTERN_LENGTH = 300;

/** Compiles the version pattern; it must contain a named group "version" that captures the digits. */
export function compilePattern(source = DEFAULT_VERSION_REGEX) {
  if (typeof source !== 'string' || !source || source.length > MAX_PATTERN_LENGTH) {
    throw new Error(`The version pattern must be a non-empty regex of at most ${MAX_PATTERN_LENGTH} characters.`);
  }
  let regex;
  try {
    regex = new RegExp(source, 'd');
  } catch (e) {
    throw new Error(`The version pattern is not a valid regex: ${e.message}`);
  }
  if (!/\(\?<version>/.test(source)) throw new Error('The version pattern needs a named group (?<version>\\d+) around the digits.');
  return regex;
}

/** Reads `version_regex:` from the frontmatter of a rules file (naming.md). Returns undefined when absent. */
export function patternFromNamingFile(file) {
  const text = readFileSync(file, 'utf8');
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!front) return undefined;
  const line = front[1].split(/\r?\n/).find((l) => /^version_regex\s*:/.test(l));
  if (!line) return undefined;
  return line.replace(/^version_regex\s*:\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
}

function parseVersion(digits) {
  const number = Number(digits);
  if (!Number.isSafeInteger(number)) throw new Error(`The version number is too large: ${digits}`);
  return number;
}

function formatVersion(number, width) {
  return String(number).padStart(width, '0');
}

/**
 * Next free version name for `fileName`. `exists(name)` says whether a name is taken (default: nothing is).
 * A name without a version gets "_v01" before the extension. Taken names are skipped: if v04 exists, the answer is v05.
 */
export function nextVersionName(fileName, { pattern = DEFAULT_VERSION_REGEX, exists = () => false } = {}) {
  const regex = compilePattern(pattern);
  const match = regex.exec(fileName);
  let build;
  let number;
  if (match) {
    const [start, end] = match.indices.groups.version;
    const digits = match.groups.version;
    number = parseVersion(digits);
    build = (n) => `${fileName.slice(0, start)}${formatVersion(n, digits.length)}${fileName.slice(end)}`;
  } else {
    const dot = fileName.lastIndexOf('.');
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot > 0 ? fileName.slice(dot) : '';
    number = 0;
    build = (n) => `${stem}_v${formatVersion(n, 2)}${extension}`;
  }
  let candidate = number + 1;
  while (exists(build(candidate))) {
    candidate++;
    if (candidate > number + 10000) throw new Error('Could not find a free version name.');
  }
  return { name: build(candidate), version: candidate, previous: match ? number : null };
}

/** Same for a path: checks the folder for taken names. Returns { current, next, path, version }. */
export function nextVersionPath(filePath, { pattern, dir } = {}) {
  const folder = dir ?? dirname(filePath);
  const current = basename(filePath);
  const result = nextVersionName(current, { pattern, exists: (name) => existsSync(join(folder, name)) });
  return { current, next: result.name, path: join(folder, result.name), version: result.version };
}
