// mf-sum: size and SHA-256 of files inside the project folder, for deliver.md. Reads only; never writes.
//   mf-sum <file> [<file> ...]
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

function sha256(path) {
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', fail).on('end', () => done(hash.digest('hex')));
  });
}

/** Returns { ok, files: [{ file, size, sha256 }] } or { ok: false, error }. Files must be regular files inside `cwd`. */
export async function sums(files, cwd = process.cwd()) {
  if (!files.length) return { ok: false, error: 'Usage: mf-sum <file> [<file> ...]' };
  const base = realpathSync.native(cwd);
  const out = [];
  for (const file of files) {
    let real;
    try {
      real = realpathSync.native(resolve(base, file));
    } catch {
      return { ok: false, error: `File not found: ${file}` };
    }
    const inside = relative(base, real);
    if (inside.startsWith('..') || inside === '' || resolve(base, inside) !== real) return { ok: false, error: `The file is outside the project folder: ${file}` };
    const stats = statSync(real);
    if (!stats.isFile()) return { ok: false, error: `Not a file: ${file}` };
    out.push({ file: inside.split(sep).join('/'), size: stats.size, sha256: await sha256(real) });
  }
  return { ok: true, files: out };
}
