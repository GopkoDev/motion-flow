// Path helpers shared by the After Effects tools: output files may only be written inside work/.
import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

export class PathError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export function isInside(base, target) {
  const fold = (p) => (process.platform === 'linux' ? p : p.toLowerCase());
  const b = fold(base);
  const t = fold(target);
  return t === b || t.startsWith(b.endsWith(sep) ? b : b + sep);
}

/** realpath of the nearest existing ancestor plus the not-yet-existing rest, so links on the way are followed. */
export function realish(absolute) {
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

/**
 * Validates an output file path and prepares its folder. The file must have the given extension and, with every
 * link followed, lie inside the real work folder (or one of `extraRoots`, which must themselves be real folders
 * of the project). Missing folders on the way are created. Returns the path to write.
 */
export function safeOutputPath({ outArg, cwd, workReal, extension, extraRoots = [] }) {
  if (typeof outArg !== 'string' || !outArg || /[\u0000-\u001f]/.test(outArg)) throw new PathError('bad_path', 'The output path is empty or contains control characters.');
  if (extname(outArg).toLowerCase() !== extension) throw new PathError('bad_path', `The output file must end with ${extension}: ${outArg}`);
  const target = realish(resolve(realpathSync.native(cwd), outArg));
  const roots = [workReal, ...extraRoots.map((r) => realish(r))];
  const root = roots.find((r) => isInside(r, target) && target !== r);
  if (!root) {
    throw new PathError('outside_work', `The output path is outside the work folder: ${outArg}`, 'Write results only under work/.');
  }
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing && existing.isDirectory()) throw new PathError('bad_path', `The output path is a folder: ${outArg}`);
  if (root !== workReal && !lstatSync(root, { throwIfNoEntry: false })) {
    if (!lstatSync(dirname(root), { throwIfNoEntry: false })) throw new PathError('bad_path', `The folder ${dirname(root)} does not exist.`, 'Run /motion-flow:init-project first.');
    mkdirSync(root);
  }
  let current = root;
  for (const segment of relative(root, dirname(target)).split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (!lstatSync(current, { throwIfNoEntry: false })) mkdirSync(current);
  }
  return target;
}

/**
 * Waits until a file exists, is not empty, and has stopped growing for `stableMs`. Some After Effects calls
 * (saveFrameToPng) return before the file is on disk. Resolves with the size, or null when the time runs out.
 */
export async function waitForFileSettled(path, { timeoutMs = 20000, stableMs = 300, pollMs = 60 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  let lastChange = Date.now();
  for (;;) {
    let size = -1;
    try {
      size = statSync(path).size;
    } catch { /* not there yet */ }
    if (size >= 0) {
      if (size !== lastSize) {
        lastSize = size;
        lastChange = Date.now();
      } else if (size > 0 && Date.now() - lastChange >= stableMs) {
        return size;
      }
    }
    if (Date.now() > deadline) return null;
    await sleep(pollMs);
  }
}
