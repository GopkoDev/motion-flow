// corpus: turns many After Effects project dumps into facts, conventions and conflicts, in code.
// The agent reads the short report built here, not 20 dumps: counting is cheap and exact, judging is the agent's job.
// Pure functions only (no After Effects, no files); lib/corpus-run.mjs does the file work.

export const THRESHOLDS = {
  consensus: 0.8, // a value used by at least this share of projects is the convention
  majority: 0.5, // ... or this share, when the runner-up is clearly behind
  runnerUpGap: 0.2, // a runner-up closer than this to the leader makes it a real conflict
  rare: 0.2, // a value below this share is an outlier
  common: 0.3, // a value in a set at or above this share is "common" (below: rare)
  contextPurity: 0.9, // projects of one group agree on a value this much => the value belongs to the group
  minProjects: 3, // fewer projects give no conventions, only a listing
};

const DEFAULT_LAYER_NAME = /^(Shape Layer|Solid|Null|Text|Adjustment Layer|Medium Gray-|Light Gray-|Layer|Camera|Light|Precomp)\s*\d*(\.\w+)?$/i;

// ---------- name patterns ----------

/** The kind of one token of a name: "v07" -> "v#", "1920x1080" -> "WxH", "Spring" -> "Title". */
export function tokenKind(token) {
  if (/^v\d+$/i.test(token)) return 'v#';
  if (/^\d+x\d+$/i.test(token)) return 'WxH';
  if (/^\d+$/.test(token)) return '#';
  if (/^\d+(fps|s|px|k)$/i.test(token)) return '#unit';
  if (/^[A-Z][A-Z0-9]*$/.test(token)) return 'UPPER';
  if (/^[a-z][a-z0-9]*$/.test(token)) return 'lower';
  if (/^[A-Z][a-z0-9]+$/.test(token)) return 'Title';
  return 'Mixed';
}

/** The pattern of a name: tokens by kind, joined by the separators of the name. "FINAL_Spring_v07" -> "UPPER_Title_v#". */
export function namePattern(name) {
  const text = String(name).replace(/\.aep$/i, '').trim();
  if (!text) return '(empty)';
  const parts = text.split(/([_\-\s.]+)/);
  return parts.map((part, i) => (i % 2 === 1 ? part.replace(/\s+/g, ' ') : tokenKind(part))).join('');
}

/** Splits "spring_v07" into the stem ("spring") and the version (7); version is null when the name has none. */
export function splitVersion(filename) {
  const base = String(filename).replace(/\.aep$/i, '');
  const match = /^(.*?)[_\-\s.]?v(\d+)$/i.exec(base);
  return match ? { stem: match[1], version: Number(match[2]) } : { stem: base, version: null };
}

// ---------- facts of one project ----------

const mostCommon = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
};
const median = (numbers) => {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The facts of one project. `meta`: { id, file, group, mtimeMs }. Single-valued facts are strings, sets are arrays. */
export function extractFacts(dump, meta) {
  const comps = dump.comps ?? [];
  const layers = comps.flatMap((comp) => comp.layers.map((layer) => ({ ...layer, comp: comp.name })));
  const { stem, version } = splitVersion(meta.file);
  const effects = new Set();
  const easings = new Set();
  let expressions = 0;
  for (const layer of layers) {
    for (const effect of layer.effects ?? []) effects.add(effect);
    expressions += Object.keys(layer.expressions ?? {}).length;
    for (const frames of Object.values(layer.keyframes ?? {})) for (const frame of frames) if (frame.ease) easings.add(frame.ease);
  }
  const unnamed = layers.filter((layer) => DEFAULT_LAYER_NAME.test(layer.name)).length;
  const gaps = [];
  for (const layer of layers) {
    for (const frames of Object.values(layer.keyframes ?? {})) {
      for (let i = 1; i < frames.length; i++) gaps.push(Math.round((frames[i].t - frames[i - 1].t) * 100) / 100);
    }
  }
  return {
    id: meta.id,
    file: meta.file,
    group: meta.group ?? '',
    mtimeMs: meta.mtimeMs ?? null,
    stem,
    version,
    comps: comps.length,
    layers: layers.length,
    single: {
      'file name pattern': namePattern(meta.file),
      'frame rate': comps.length ? `${mostCommon(comps.map((comp) => comp.fps))} fps` : null,
      'bit depth': `${dump.project?.bitsPerChannel ?? '?'} bpc`,
      'default layer names': layers.length ? (unnamed === 0 ? 'none' : unnamed / layers.length < 0.1 ? 'a few' : 'many') : null,
      'expressions': expressions > 0 ? 'used' : 'not used',
    },
    sets: {
      'comp sizes': [...new Set(comps.map((comp) => `${comp.width}x${comp.height}`))],
      'comp name patterns': [...new Set(comps.map((comp) => namePattern(comp.name)))],
      'layer name patterns': [...new Set(layers.filter((layer) => !DEFAULT_LAYER_NAME.test(layer.name)).map((layer) => namePattern(layer.name)))],
      'fonts': [...(dump.fonts ?? [])],
      'effects': [...effects],
      'easing': [...easings],
      'layer types': [...new Set(layers.map((layer) => layer.type))],
    },
    numbers: { keyframeGapMedian: median(gaps), missingFootage: (dump.footage ?? []).filter((item) => item.missing).length },
  };
}

// ---------- conventions and conflicts ----------

const share = (count, total) => Math.round((count / total) * 100) / 100;

/** Counts how many projects hold each value. Returns [{ value, count, share, projects }] best first. */
function tally(rows, valuesOf, total) {
  const map = new Map();
  for (const row of rows) {
    for (const value of valuesOf(row)) {
      if (value === null || value === undefined) continue;
      if (!map.has(value)) map.set(value, []);
      map.get(value).push(row);
    }
  }
  return [...map.entries()]
    .map(([value, holders]) => ({ value, count: holders.length, share: share(holders.length, total), projects: holders.map((r) => r.id), holders }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

const strip = ({ holders, ...rest }) => rest;

/** Does the value follow a group (a client or campaign folder)? Returns the groups that explain the split, or null. */
function contextSplit(rows, entries) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.group) continue;
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  if (groups.size < 2) return null;
  const owner = new Map(); // value -> groups where it is the group's value
  for (const [group, members] of groups) {
    if (members.length < 2) return null;
    const lead = entries.find((entry) => members.filter((m) => entry.holders.includes(m)).length / members.length >= THRESHOLDS.contextPurity);
    if (!lead) return null;
    if (!owner.has(lead.value)) owner.set(lead.value, []);
    owner.get(lead.value).push(group);
  }
  return owner.size >= 2 ? [...owner.entries()].map(([value, groupsOfValue]) => ({ value, groups: groupsOfValue })) : null;
}

const mtimes = (entry) => entry.holders.map((h) => h.mtimeMs).filter((t) => typeof t === 'number');

/** Are all projects with the minority values older than the typical project with the leading value? */
function legacyTail(lead, others) {
  const leadMedian = median(mtimes(lead));
  const old = others.flatMap(mtimes);
  return leadMedian !== null && old.length > 0 && Math.max(...old) < leadMedian;
}

/** Of two close values, the one that every older project used: returns the newer entry, or null when the ages overlap. */
function newerOf(a, b) {
  const at = mtimes(a);
  const bt = mtimes(b);
  if (!at.length || !bt.length) return null;
  if (Math.max(...at) < median(bt)) return b;
  if (Math.max(...bt) < median(at)) return a;
  return null;
}

/** Classifies one single-valued feature (every project has at most one value). */
export function classifySingle(feature, rows) {
  const known = rows.filter((row) => row.single[feature] !== null && row.single[feature] !== undefined);
  const total = known.length;
  const entries = tally(known, (row) => [row.single[feature]], total);
  const values = entries.map(strip);
  const base = { feature, total, values };
  if (total < THRESHOLDS.minProjects) return { ...base, kind: 'too_few', proposal: null, confidence: 'none', needs_human: false, note: `only ${total} project(s) have this`, };
  const [lead, second] = entries;
  const others = entries.slice(1);
  if (lead.share >= THRESHOLDS.consensus) {
    const old = others.length && legacyTail(lead, others);
    return { ...base, kind: 'consensus', proposal: lead.value, confidence: 'high', needs_human: false, note: others.length ? `exceptions${old ? ' (all older than the typical project, likely legacy)' : ''}: ${others.map((e) => `${e.value} in ${e.projects.join(', ')}`).join('; ')}` : 'no exceptions' };
  }
  const split = contextSplit(known, entries);
  if (split) return { ...base, kind: 'context_split', proposal: null, confidence: 'medium', needs_human: false, note: `the value depends on the group: ${split.map((s) => `${s.value} in ${s.groups.join(', ')}`).join('; ')}. Write it as a rule per group.`, split };
  if (second && second.share >= THRESHOLDS.common && lead.share - second.share < THRESHOLDS.runnerUpGap) {
    const newer = newerOf(lead, second);
    if (newer) return { ...base, kind: 'legacy_shift', proposal: newer.value, confidence: 'medium', needs_human: false, note: `${newer === lead ? second.value : lead.value} is used only by older projects: the studio moved on to ${newer.value}. Take the newer one and say so.` };
    return { ...base, kind: 'conflict', proposal: lead.value, confidence: 'low', needs_human: true, note: `${lead.value} (${lead.count}) and ${second.value} (${second.count}) are close and do not follow a group or the project age. Ask.` };
  }
  if (lead.share >= THRESHOLDS.majority) return { ...base, kind: 'majority', proposal: lead.value, confidence: 'medium', needs_human: false, note: `exceptions: ${others.map((e) => `${e.value} in ${e.projects.join(', ')}`).join('; ')}` };
  return { ...base, kind: 'scattered', proposal: null, confidence: 'none', needs_human: true, note: 'no value is used by half of the projects. Ask what the rule should be.' };
}

/** Classifies a set-valued feature (sizes, fonts, effects...): which values are standard, common or rare. */
export function classifySet(feature, rows) {
  const total = rows.length;
  const entries = tally(rows, (row) => row.sets[feature] ?? [], total);
  const standard = entries.filter((e) => e.share >= THRESHOLDS.consensus).map(strip);
  const common = entries.filter((e) => e.share >= THRESHOLDS.common && e.share < THRESHOLDS.consensus).map(strip);
  const rare = entries.filter((e) => e.share < THRESHOLDS.common).map(strip);
  return { feature, total, standard, common, rare, needs_human: false };
}

export const SINGLE_FEATURES = ['file name pattern', 'frame rate', 'bit depth', 'default layer names', 'expressions'];
export const SET_FEATURES = ['comp sizes', 'comp name patterns', 'layer name patterns', 'fonts', 'effects', 'easing', 'layer types'];

/** The analysis of all projects: every feature classified, the conflicts that need a person collected. */
export function analyze(rows) {
  const groups = [...new Set(rows.map((row) => row.group).filter(Boolean))].sort();
  const single = SINGLE_FEATURES.map((feature) => classifySingle(feature, rows));
  const sets = SET_FEATURES.map((feature) => classifySet(feature, rows));
  const questions = single.filter((item) => item.needs_human).map((item) => ({
    feature: item.feature,
    kind: item.kind,
    options: item.values.slice(0, 4).map((v) => ({ value: v.value, share: v.share, projects: v.projects.slice(0, 5) })),
    default: item.proposal,
    why: item.note,
  }));
  return { projects: rows.length, groups, enough: rows.length >= THRESHOLDS.minProjects, single, sets, questions, projectsMissingFootage: rows.filter((r) => r.numbers.missingFootage > 0).map((r) => r.id) };
}

// ---------- versions of one project: what the designers change ----------

/** Pairs of consecutive versions of the same project (spring_v07, spring_v08), within one group. */
export function findPairs(rows) {
  const byProject = new Map();
  for (const row of rows) {
    if (row.version === null) continue;
    const key = `${row.group}\u0000${row.stem}`;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(row);
  }
  const pairs = [];
  for (const versions of byProject.values()) {
    versions.sort((a, b) => a.version - b.version);
    for (let i = 1; i < versions.length; i++) pairs.push({ before: versions[i - 1].id, after: versions[i].id });
  }
  return pairs;
}

const layerKey = (comp, layer) => `${comp}\u0000${layer}`;

/** What changed between two dumps, as a list of generic signatures ("comp added 1080x1920", "effect added: Gaussian Blur"). */
export function diffDumps(before, after) {
  const signatures = [];
  const compsBefore = new Map(before.comps.map((comp) => [comp.name, comp]));
  const compsAfter = new Map(after.comps.map((comp) => [comp.name, comp]));
  for (const [name, comp] of compsAfter) {
    const old = compsBefore.get(name);
    if (!old) { signatures.push(`comp added ${comp.width}x${comp.height}`); continue; }
    if (old.width !== comp.width || old.height !== comp.height) signatures.push(`comp size changed to ${comp.width}x${comp.height}`);
    if (old.fps !== comp.fps) signatures.push(`comp frame rate changed to ${comp.fps}`);
    if (old.duration !== comp.duration) signatures.push('comp duration changed');
  }
  for (const name of compsBefore.keys()) if (!compsAfter.has(name)) signatures.push('comp removed');
  const layersBefore = new Map();
  const layersAfter = new Map();
  for (const comp of before.comps) for (const layer of comp.layers) layersBefore.set(layerKey(comp.name, layer.name), layer);
  for (const comp of after.comps) for (const layer of comp.layers) layersAfter.set(layerKey(comp.name, layer.name), layer);
  for (const [key, layer] of layersAfter) {
    const old = layersBefore.get(key);
    if (!old) {
      if (compsBefore.has(key.split('\u0000')[0])) signatures.push(`layer added (${layer.type})`);
      continue;
    }
    for (const field of ['position', 'scale', 'rotation', 'opacity']) {
      if (JSON.stringify(old.transform?.[field]) !== JSON.stringify(layer.transform?.[field])) signatures.push(`layer ${field} changed`);
    }
    if (old.enabled !== layer.enabled) signatures.push('layer shown or hidden');
    if (old.inPoint !== layer.inPoint || old.outPoint !== layer.outPoint) signatures.push('layer timing changed');
    for (const effect of layer.effects ?? []) if (!(old.effects ?? []).includes(effect)) signatures.push(`effect added: ${effect}`);
    for (const effect of old.effects ?? []) if (!(layer.effects ?? []).includes(effect)) signatures.push(`effect removed: ${effect}`);
    for (const key2 of Object.keys(layer.expressions ?? {})) if (layer.expressions[key2] !== old.expressions?.[key2]) signatures.push(`expression changed: ${key2}`);
    const keysBefore = JSON.stringify(old.keyframes ?? {});
    if (keysBefore !== JSON.stringify(layer.keyframes ?? {})) signatures.push('keyframes changed');
  }
  for (const key of layersBefore.keys()) {
    if (!layersAfter.has(key) && compsAfter.has(key.split('\u0000')[0])) signatures.push('layer removed');
  }
  return signatures;
}

/** Which changes repeat across the version pairs. `diffs`: [{ before, after, signatures }]. */
export function typicalChanges(diffs) {
  const count = new Map();
  for (const diff of diffs) for (const signature of new Set(diff.signatures)) count.set(signature, (count.get(signature) ?? 0) + 1);
  return [...count.entries()]
    .map(([signature, pairs]) => ({ signature, pairs, share: share(pairs, diffs.length) }))
    .sort((a, b) => b.pairs - a.pairs || a.signature.localeCompare(b.signature));
}

// ---------- the report the agent reads ----------

const list = (items, max = 6) => (items.length > max ? `${items.slice(0, max).join(', ')} (+${items.length - max} more)` : items.join(', '));
const pct = (n) => `${Math.round(n * 100)}%`;

/** A short markdown report. `pairs`: { pairs: n, typical: [...] } or null. */
export function renderReport(analysis, pairs = null) {
  const out = [`# Corpus report`, '', `${analysis.projects} project(s)${analysis.groups.length ? ` in ${analysis.groups.length} group(s): ${list(analysis.groups)}` : ''}.`, ''];
  if (!analysis.enough) {
    out.push(`Fewer than ${THRESHOLDS.minProjects} projects: no convention can be counted. Treat everything below as a listing, not as rules.`, '');
  }
  out.push('## Conventions (one value per project)', '', '| Feature | Kind | Proposal | Support | Note |', '|---|---|---|---|---|');
  for (const item of analysis.single) {
    const support = item.values[0] ? `${item.values[0].count}/${item.total} (${pct(item.values[0].share)})` : '-';
    out.push(`| ${item.feature} | ${item.kind} | ${item.proposal ?? '-'} | ${support} | ${item.note ?? ''} |`);
  }
  out.push('', '## Sets (a project may use several values)', '');
  for (const item of analysis.sets) {
    out.push(`### ${item.feature}`);
    out.push(`- standard (≥${pct(THRESHOLDS.consensus)} of projects): ${item.standard.length ? list(item.standard.map((v) => `${v.value} ${pct(v.share)}`)) : 'none'}`);
    out.push(`- common: ${item.common.length ? list(item.common.map((v) => `${v.value} ${pct(v.share)}`)) : 'none'}`);
    out.push(`- rare (${item.rare.length}): ${list(item.rare.map((v) => `${v.value} (${v.projects.join(', ')})`), 4) || 'none'}`);
    out.push('');
  }
  out.push('## Questions only a person can answer', '');
  if (!analysis.questions.length) out.push('None: every convention was decided from the examples.');
  for (const q of analysis.questions) {
    out.push(`- **${q.feature}** (${q.kind}): ${q.why}`);
    for (const option of q.options) out.push(`  - ${option.value}: ${pct(option.share)} of projects (${list(option.projects, 3)})`);
  }
  if (analysis.projectsMissingFootage.length) out.push('', `Projects with missing footage (the dump still counts): ${list(analysis.projectsMissingFootage)}.`);
  if (pairs) {
    out.push('', '## What designers change between versions', '', `${pairs.pairs} pair(s) of consecutive versions.`);
    if (pairs.pairs) for (const change of pairs.typical.slice(0, 15)) out.push(`- ${change.signature}: ${change.pairs}/${pairs.pairs} pairs (${pct(change.share)})`);
  }
  return `${out.join('\n')}\n`;
}
