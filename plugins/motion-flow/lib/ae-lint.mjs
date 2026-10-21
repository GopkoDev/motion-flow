// ae-lint: declarative checks on a project dump (see lib/jsx/dump.jsx). Needs no After Effects.
// A check is a small JSON object in the rules folder (rules/checks/*.json): { id, type, severity?, message?, comps?, ...params }.
// Output: { ok, violations: [{ rule, severity, where, message }], skipped, summary }. ok is false when any error-level violation exists.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateDump } from './dump-schema.mjs';

const FPS_TOLERANCE = 0.001;
const DEFAULT_NAME_PATTERNS = ['^(Shape Layer|Null|Text|Adjustment Layer|Camera|Light|Pre-comp|Comp)\\s*\\d+$', '\\bSolid\\s*\\d+$'];
const PROTECTED_LAYER_FIELDS = ['type', 'inPoint', 'outPoint', 'parent', 'enabled', 'locked', 'transform', 'effects', 'expressions', 'keyframes'];

// ---------- check definitions ----------

const TYPES = {
  comp_fps: { required: [], oneOf: ['equals', 'one_of'] },
  comp_size: { required: [], oneOf: ['width', 'height', 'one_of'] },
  comp_duration: { required: [], oneOf: ['min', 'max'] },
  comp_name: { required: ['pattern'] },
  layer_name: { required: ['pattern'] },
  default_names: { required: [] },
  footage_missing: { required: [] },
  fonts_allowed: { required: ['allowed'] },
  project_bits: { required: ['equals'] },
  protected_unchanged: { required: ['comps'] },
};

function regexOf(source, flags, where) {
  try {
    return new RegExp(source, flags ?? '');
  } catch (e) {
    throw new Error(`${where}: invalid regex "${source}": ${e.message}`);
  }
}

function globToRegex(glob) {
  return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

/** Validates one check object. Throws an Error naming the file and the problem. */
function validateCheck(check, where) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) throw new Error(`${where}: a check must be an object`);
  if (typeof check.id !== 'string' || !check.id) throw new Error(`${where}: "id" is required`);
  const spec = TYPES[check.type];
  if (!spec) throw new Error(`${where} (${check.id}): unknown type "${check.type}". Known types: ${Object.keys(TYPES).join(', ')}`);
  if (check.severity !== undefined && !['error', 'warning'].includes(check.severity)) throw new Error(`${where} (${check.id}): severity must be "error" or "warning"`);
  for (const key of spec.required) if (check[key] === undefined) throw new Error(`${where} (${check.id}): "${key}" is required for ${check.type}`);
  if (spec.oneOf && !spec.oneOf.some((key) => check[key] !== undefined)) throw new Error(`${where} (${check.id}): give one of ${spec.oneOf.join(', ')}`);
  if (check.type === 'fonts_allowed' && !Array.isArray(check.allowed)) throw new Error(`${where} (${check.id}): "allowed" must be an array`);
  if (check.type === 'protected_unchanged' && (!Array.isArray(check.comps) || check.comps.length === 0)) throw new Error(`${where} (${check.id}): "comps" must be a non-empty array of names or globs`);
  for (const key of ['pattern', 'comps']) if (typeof check[key] === 'string') regexOf(check[key], check.flags, `${where} (${check.id})`);
  for (const pattern of check.patterns ?? []) regexOf(pattern, check.flags, `${where} (${check.id})`);
  return { severity: 'error', ...check };
}

/** Reads every *.json file in a folder (a file holds one check or an array). Missing folder = no checks. */
export function loadChecks(dir) {
  if (!existsSync(dir)) throw new Error(`Checks folder not found: ${dir}`);
  const checks = [];
  const seen = new Set();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (e) {
      throw new Error(`${name}: not valid JSON: ${e.message}`);
    }
    for (const raw of Array.isArray(data) ? data : [data]) {
      const check = validateCheck(raw, name);
      if (seen.has(check.id)) throw new Error(`${name}: duplicate check id "${check.id}"`);
      seen.add(check.id);
      checks.push(check);
    }
  }
  return checks;
}

// ---------- running ----------

const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  return value;
}

function compsFor(check, dump) {
  if (!check.comps || typeof check.comps !== 'string') return dump.comps;
  const scope = regexOf(check.comps, check.flags);
  return dump.comps.filter((comp) => scope.test(comp.name));
}

function flatten(violations, check, where, message) {
  violations.push({ rule: check.id, severity: check.severity ?? 'error', where, message: check.message ? `${check.message}: ${message}` : message });
}

function fmt(value) {
  return JSON.stringify(value);
}

const RUNNERS = {
  comp_fps(check, dump, add) {
    const allowed = check.equals !== undefined ? [check.equals] : check.one_of;
    for (const comp of compsFor(check, dump)) {
      if (!allowed.some((fps) => Math.abs(comp.fps - fps) <= FPS_TOLERANCE)) add(`comp:${comp.name}`, `Comp "${comp.name}" runs at ${comp.fps} fps, expected ${allowed.join(' or ')}`);
    }
  },
  comp_size(check, dump, add) {
    for (const comp of compsFor(check, dump)) {
      const ok = check.one_of
        ? check.one_of.some(([w, h]) => comp.width === w && comp.height === h)
        : (check.width === undefined || comp.width === check.width) && (check.height === undefined || comp.height === check.height);
      if (!ok) add(`comp:${comp.name}`, `Comp "${comp.name}" is ${comp.width}x${comp.height}, expected ${check.one_of ? check.one_of.map(([w, h]) => `${w}x${h}`).join(' or ') : `${check.width ?? '*'}x${check.height ?? '*'}`}`);
    }
  },
  comp_duration(check, dump, add) {
    for (const comp of compsFor(check, dump)) {
      if (check.min !== undefined && comp.duration < check.min) add(`comp:${comp.name}`, `Comp "${comp.name}" lasts ${comp.duration}s, minimum is ${check.min}s`);
      if (check.max !== undefined && comp.duration > check.max) add(`comp:${comp.name}`, `Comp "${comp.name}" lasts ${comp.duration}s, maximum is ${check.max}s`);
    }
  },
  comp_name(check, dump, add) {
    const pattern = regexOf(check.pattern, check.flags);
    for (const comp of compsFor(check, dump)) {
      if (!(check.except ?? []).includes(comp.name) && !pattern.test(comp.name)) add(`comp:${comp.name}`, `Comp name "${comp.name}" does not match ${check.pattern}`);
    }
  },
  layer_name(check, dump, add) {
    const pattern = regexOf(check.pattern, check.flags);
    for (const comp of compsFor(check, dump)) {
      for (const layer of comp.layers) {
        if (check.types && !check.types.includes(layer.type)) continue;
        if (!pattern.test(layer.name)) add(`comp:${comp.name}/layer:${layer.name}`, `Layer name "${layer.name}" in "${comp.name}" does not match ${check.pattern}`);
      }
    }
  },
  default_names(check, dump, add) {
    const patterns = (check.patterns ?? DEFAULT_NAME_PATTERNS).map((p) => regexOf(p, check.flags));
    const isDefault = (name) => patterns.some((p) => p.test(name));
    const scope = check.scope ?? 'both';
    for (const comp of compsFor(check, dump)) {
      if (scope !== 'layers' && isDefault(comp.name)) add(`comp:${comp.name}`, `Comp "${comp.name}" still has a default name`);
      if (scope === 'comps') continue;
      for (const layer of comp.layers) {
        if (isDefault(layer.name)) add(`comp:${comp.name}/layer:${layer.name}`, `Layer "${layer.name}" in "${comp.name}" still has a default name`);
      }
    }
  },
  footage_missing(check, dump, add) {
    for (const item of dump.footage) if (item.missing) add(`footage:${item.name}`, `Media "${item.name}" is missing${item.path ? ` (${item.path})` : ''}`);
  },
  fonts_allowed(check, dump, add) {
    for (const font of dump.fonts) if (!check.allowed.includes(font)) add(`font:${font}`, `Font "${font}" is not in the allowed list`);
  },
  project_bits(check, dump, add) {
    if (dump.project.bitsPerChannel !== check.equals) add('project', `Project depth is ${dump.project.bitsPerChannel} bpc, expected ${check.equals}`);
  },
};

/** protected_unchanged needs the dump taken before the work (the plan snapshot) to compare with. */
function runProtected(check, dump, baseline, add) {
  const matchers = check.comps.map(globToRegex);
  const isProtected = (name) => matchers.some((m) => m.test(name));
  for (const before of baseline.comps.filter((c) => isProtected(c.name))) {
    const after = dump.comps.find((c) => c.name === before.name);
    const where = `comp:${before.name}`;
    if (!after) { add(where, `Protected comp "${before.name}" was removed or renamed`); continue; }
    for (const key of ['width', 'height', 'fps', 'duration']) {
      if (!same(before[key], after[key])) add(where, `Protected comp "${before.name}": ${key} changed from ${fmt(before[key])} to ${fmt(after[key])}`);
    }
    const afterByName = new Map(after.layers.map((l) => [l.name, l]));
    const beforeNames = new Set(before.layers.map((l) => l.name));
    for (const layer of before.layers) {
      const now = afterByName.get(layer.name);
      const layerWhere = `${where}/layer:${layer.name}`;
      if (!now) { add(layerWhere, `Layer "${layer.name}" was removed or renamed in protected comp "${before.name}"`); continue; }
      for (const field of PROTECTED_LAYER_FIELDS) {
        if (field === 'transform') {
          for (const sub of Object.keys({ ...layer.transform, ...now.transform })) {
            if (!same(layer.transform?.[sub], now.transform?.[sub])) add(layerWhere, `transform.${sub} changed from ${fmt(layer.transform?.[sub])} to ${fmt(now.transform?.[sub])} in protected comp "${before.name}"`);
          }
        } else if (!same(layer[field], now[field])) {
          add(layerWhere, `${field} changed in protected comp "${before.name}" (layer "${layer.name}")`);
        }
      }
    }
    for (const layer of after.layers) if (!beforeNames.has(layer.name)) add(`${where}/layer:${layer.name}`, `Layer "${layer.name}" was added to protected comp "${before.name}"`);
  }
}

/** Runs the checks. `baseline` is an optional earlier dump (needed only by protected_unchanged). */
export function lint(dump, checks, { baseline = null } = {}) {
  const problems = validateDump(dump);
  if (problems.length) throw new Error(`The dump is not valid: ${problems.slice(0, 5).join('; ')}`);
  if (baseline) {
    const baselineProblems = validateDump(baseline);
    if (baselineProblems.length) throw new Error(`The baseline dump is not valid: ${baselineProblems.slice(0, 5).join('; ')}`);
  }
  const violations = [];
  const skipped = [];
  for (const check of checks) {
    const add = (where, message) => flatten(violations, check, where, message);
    if (check.type === 'protected_unchanged') {
      if (!baseline) skipped.push({ rule: check.id, reason: 'needs --baseline (the dump taken before the work)' });
      else runProtected(check, dump, baseline, add);
    } else {
      RUNNERS[check.type](check, dump, add);
    }
  }
  const errors = violations.filter((v) => v.severity === 'error').length;
  return { ok: errors === 0, violations, skipped, summary: { errors, warnings: violations.length - errors, rules: checks.length } };
}
