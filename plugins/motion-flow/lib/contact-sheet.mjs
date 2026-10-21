// mf-sheet: puts the check frames side by side in one image, so one picture is read instead of 12-20.
// ffmpeg scales every frame into a same-size cell and tiles the cells; a numbered legend maps cell -> file.
// Reads and writes only inside work/. No shell: ffmpeg is started with an argument list.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { PathError, isInside, realish } from './work-paths.mjs';

export const DEFAULTS = { cols: 4, perSheet: 12, cellWidth: 480, padding: 4, maxCellHeight: 640, fallbackCellHeight: 270 };

/** Width and height of a PNG from its header, or null (not a PNG, unreadable). */
export function pngSize(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const head = Buffer.alloc(24);
    if (readSync(fd, head, 0, 24, 0) < 24) return null;
    if (head.toString('latin1', 1, 4) !== 'PNG') return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Cell height: as tall as the tallest frame needs at the cell width (a 9:16 comp gets a tall cell), capped. */
export function cellHeight(sizes, { cellWidth, maxCellHeight, fallbackCellHeight }) {
  const known = sizes.filter(Boolean);
  if (!known.length) return fallbackCellHeight;
  const tallest = Math.max(...known.map((s) => s.height / s.width));
  const height = Math.min(maxCellHeight, Math.round(cellWidth * tallest));
  return height + (height % 2); // keep it even for the encoder
}

/** Splits the frames into sheets of at most `perSheet`, keeping the order. */
export function splitIntoSheets(files, perSheet) {
  const sheets = [];
  for (let i = 0; i < files.length; i += perSheet) sheets.push(files.slice(i, i + perSheet));
  return sheets;
}

/** The ffmpeg arguments for one sheet. */
export function ffmpegArgs({ files, out, cols, cellWidth, cellHeight: height, padding }) {
  const rows = Math.ceil(files.length / cols);
  const columns = Math.min(cols, files.length);
  const cells = files.map((_, i) => `[${i}:v]scale=${cellWidth}:${height}:force_original_aspect_ratio=decrease,pad=${cellWidth}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=rgb24[c${i}]`);
  const joined = files.map((_, i) => `[c${i}]`).join('');
  const filter = `${cells.join(';')};${joined}concat=n=${files.length}:v=1:a=0,tile=${columns}x${rows}:padding=${padding}:margin=${padding}:color=white`;
  return ['-y', '-v', 'error', ...files.flatMap((file) => ['-i', file]), '-filter_complex', filter, '-frames:v', '1', out];
}

/** Names the sheets: the output as given for one sheet, `name-1.png`, `name-2.png`, ... for several. */
export function sheetNames(out, count) {
  if (count === 1) return [out];
  const ext = extname(out);
  return Array.from({ length: count }, (_, i) => `${out.slice(0, -ext.length)}-${i + 1}${ext}`);
}

function runFfmpeg(args) {
  return new Promise((resolveRun) => {
    execFile('ffmpeg', args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (!error) return resolveRun({ ok: true });
      if (error.code === 'ENOENT') return resolveRun({ ok: false, reason: 'ffmpeg_missing', detail: 'ffmpeg is not installed or not on PATH.', hint: 'Run /motion-flow:doctor for the install command. Without ffmpeg, open the frames one by one.' });
      return resolveRun({ ok: false, reason: 'ffmpeg_failed', detail: String(stderr || error.message).trim().slice(0, 500) });
    });
  });
}

/**
 * Makes the sheets. `files` are PNG frames and `out` a .png path, all inside the project's work/ folder.
 * Returns { ok: true, sheets: [{ path, cells: [{ n, file }] }] } or { ok: false, reason, detail }.
 */
export async function makeSheets({ files, out, cwd = process.cwd(), options = {}, run = runFfmpeg }) {
  const opts = { ...DEFAULTS, ...options };
  const workReal = realish(resolve(cwd, 'work'));
  const refuse = (reason, detail, hint = '') => ({ ok: false, reason, detail, ...(hint ? { hint } : {}) });
  if (!files.length) return refuse('no_frames', 'Give at least one frame.');
  if (extname(out).toLowerCase() !== '.png') return refuse('bad_path', `The output must end with .png: ${out}`);
  const absolute = [];
  for (const file of files) {
    const path = realish(resolve(cwd, file));
    if (!isInside(workReal, path)) return refuse('outside_work', `The frame is outside work/: ${file}`, 'Frames come from work/frames/.');
    if (!existsSync(path) || !statSync(path).isFile()) return refuse('file_missing', `No such frame: ${file}`);
    absolute.push({ path, shown: file });
  }
  const outPath = realish(resolve(cwd, out));
  if (!isInside(workReal, outPath) || outPath === workReal) return refuse('outside_work', `The output is outside work/: ${out}`, 'Write the sheet under work/.');
  mkdirSync(dirname(outPath), { recursive: true });
  const height = cellHeight(absolute.map((f) => pngSize(f.path)), opts);
  const groups = splitIntoSheets(absolute, opts.perSheet);
  const names = sheetNames(outPath, groups.length);
  const sheets = [];
  for (const [i, group] of groups.entries()) {
    const result = await run(ffmpegArgs({ files: group.map((f) => f.path), out: names[i], cols: opts.cols, cellWidth: opts.cellWidth, cellHeight: height, padding: opts.padding }));
    if (!result.ok) return result;
    const shown = sheetNames(out, groups.length)[i];
    sheets.push({ path: shown, columns: Math.min(opts.cols, group.length), cells: group.map((f, n) => ({ n: n + 1, file: f.shown })) });
  }
  return { ok: true, sheets, cell: `${opts.cellWidth}x${height}`, note: 'Cells are numbered 1, 2, 3... left to right, top to bottom. Open the original frame when small text must be read.' };
}

export function parseArgs(argv) {
  const files = [];
  const options = {};
  let out = null;
  const numbers = { '--cols': 'cols', '--per-sheet': 'perSheet', '--cell-width': 'cellWidth' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') out = argv[++i] ?? null;
    else if (arg in numbers) {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1 || value > 4000) throw new PathError('usage', `${arg} needs a whole number from 1 to 4000.`);
      options[numbers[arg]] = value;
    } else if (arg.startsWith('--')) throw new PathError('usage', `Unknown option ${arg}.`);
    else files.push(arg);
  }
  if (!out) throw new PathError('usage', 'Usage: mf-sheet --out work/frames/sheet.png [--cols 4] [--per-sheet 12] [--cell-width 480] <frame.png> ...');
  return { out, files, options };
}

export async function main(argv, ctx = {}) {
  const stdout = ctx.stdout ?? process.stdout;
  const emit = (value) => stdout.write(`${JSON.stringify(value)}\n`);
  try {
    const { out, files, options } = parseArgs(argv);
    const result = await makeSheets({ files, out, cwd: ctx.cwd ?? process.cwd(), options, run: ctx.run });
    emit(result);
    return result.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof PathError) { emit({ ok: false, reason: error.code, detail: error.message }); return 2; }
    throw error;
  }
}

