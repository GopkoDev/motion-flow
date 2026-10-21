// export-claude: turns a studio folder (rules + flows) into a standalone .claude/ for a designer who orchestrates by hand,
// without the motion-flow pipeline. Deterministic and re-runnable: it records what it wrote with a hash and never
// overwrites a file the designer edited since.
//   <target>/CLAUDE.md                          a managed block with the design system index and the flows
//   <target>/.claude/rules/design-system/*.md   the studio's rule files
//   <target>/.claude/skills/<flow>/SKILL.md     one standalone skill per flow, built from flow.md
//   <target>/.claude/studio-export.json         what was written (path -> sha256), for the next export
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseArtifact, section } from './artifact.mjs';

export const MANIFEST = '.claude/studio-export.json';
const BLOCK_START = '<!-- studio-builder:start -->';
const BLOCK_END = '<!-- studio-builder:end -->';
const FLOW_SECTIONS = ['Inputs', 'Steps in order', 'Where the designer decides', 'What must not be touched', 'How to tell it is done'];

const sha = (text) => createHash('sha256').update(text).digest('hex');
const isDir = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };

/** The flows of a folder: every sub-folder that holds a flow.md and a SKILL.md. */
export function readFlows(dir) {
  if (!isDir(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'flow.md')) && existsSync(join(dir, entry.name, 'SKILL.md')))
    .map((entry) => {
      const flow = parseArtifact(readFileSync(join(dir, entry.name, 'flow.md'), 'utf8'));
      const skill = parseArtifact(readFileSync(join(dir, entry.name, 'SKILL.md'), 'utf8'));
      return { name: entry.name, version: flow?.front.version ?? '0.0.0', status: flow?.front.status ?? 'draft', description: skill?.front.description ?? '', purpose: section(flow?.body ?? '', 'What this flow is for') ?? '', sections: Object.fromEntries(FLOW_SECTIONS.map((heading) => [heading, section(flow?.body ?? '', heading) ?? ''])) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The standalone skill of a flow: the flow's own steps, with no motion-flow pipeline in it. */
export function standaloneSkill(flow) {
  const body = FLOW_SECTIONS.map((heading) => `## ${heading}\n\n${flow.sections[heading] || '_Not described._'}\n`).join('\n');
  return `---
name: ${flow.name}
description: ${flow.description}
model: inherit
---

# ${flow.name}

${flow.purpose}

Read the studio's design system first (\`.claude/rules/design-system/\`): naming, motion system, protected items and delivery. Follow it; it is the studio's requirement, not a hint.

${body}
## Working rules

- Work on a copy of the project, never on the original.
- Read a project with \`ae-dump\`; change it with \`ae-run\` on the copy (tools of the studio-builder plugin). Show the change before you make it.
- A rule file with \`status: draft\` is not confirmed by a person: follow it with care and ask when it matters.
- If something unexpected happens (a missing file, a layer that is not where the flow says, an error), stop and ask.
`;
}

/** The managed block of CLAUDE.md: the studio, the design system files and the flows. */
export function claudeBlock({ studio, rules, flows }) {
  const lines = [
    BLOCK_START,
    `## Studio: ${studio}`,
    '',
    'This folder uses the studio\'s design system and flows (exported by the studio-builder plugin). Reply to the designer in Ukrainian.',
    '',
    '### Design system',
    '',
    ...rules.map((file) => `- \`.claude/rules/design-system/${file}\``),
    '',
    '### Flows',
    '',
    ...(flows.length ? flows.map((flow) => `- \`/${flow.name}\` (${flow.status}, v${flow.version}): ${flow.description.replace(/\s+/g, ' ').slice(0, 160)}`) : ['- none yet']),
    '',
    'Work on copies, never on originals. Ask before anything is hard to undo.',
    BLOCK_END,
  ];
  return `${lines.join('\n')}\n`;
}

function replaceBlock(existing, block) {
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start !== -1 && end > start) return `${existing.slice(0, start)}${block.trimEnd()}${existing.slice(end + BLOCK_END.length)}`;
  return `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}`;
}

/**
 * Writes the export. `studioDir`: the studio folder (rules/ and flows/). `extraFlows`: more flow folders (drafts).
 * Returns { written, unchanged, kept (edited by hand, left alone), flows }.
 */
export function exportClaude({ studioDir, studioName, target, extraFlows = [], force = false }) {
  const studio = resolve(studioDir);
  const out = resolve(target);
  if (!isDir(join(studio, 'rules'))) throw new Error(`${studioDir} has no rules/ folder: it is not a studio folder.`);
  if (!isDir(out)) throw new Error(`The target folder does not exist: ${target}`);
  if (out === studio) throw new Error('The target must be another folder than the studio folder: the export would overwrite the studio\'s own flow drafts. Create a folder for the designer and run the export there.');
  const flows = [...readFlows(join(studio, 'flows')), ...extraFlows.flatMap((dir) => readFlows(resolve(dir)))];
  const seen = new Set();
  for (const flow of flows) {
    if (seen.has(flow.name)) throw new Error(`Two flows are named "${flow.name}". Rename one before the export.`);
    seen.add(flow.name);
  }
  const rules = readdirSync(join(studio, 'rules')).filter((name) => name.endsWith('.md') && name !== 'OPEN-QUESTIONS.md').sort();

  const files = new Map(); // relative path -> text
  for (const file of rules) files.set(`.claude/rules/design-system/${file}`, readFileSync(join(studio, 'rules', file), 'utf8'));
  for (const flow of flows) files.set(`.claude/skills/${flow.name}/SKILL.md`, standaloneSkill(flow));

  let previous = {};
  try { previous = JSON.parse(readFileSync(join(out, MANIFEST), 'utf8')).files ?? {}; } catch { /* first export */ }
  const result = { written: [], unchanged: [], kept: [], flows: flows.map((flow) => flow.name) };
  const hashes = {};
  for (const [rel, text] of [...files.entries()].sort()) {
    const path = join(out, rel);
    const wanted = sha(text);
    if (existsSync(path)) {
      const current = sha(readFileSync(path, 'utf8'));
      if (current === wanted) { result.unchanged.push(rel); hashes[rel] = wanted; continue; }
      if (!force && !(rel in previous && previous[rel] === current)) { result.kept.push(rel); if (rel in previous) hashes[rel] = previous[rel]; continue; }
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    result.written.push(rel);
    hashes[rel] = wanted;
  }
  const claudeMd = join(out, 'CLAUDE.md');
  const block = claudeBlock({ studio: studioName ?? studio.split(sep).pop(), rules, flows });
  const before = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : '';
  const after = replaceBlock(before, block);
  if (after !== before) { writeFileSync(claudeMd, after); result.written.push('CLAUDE.md'); } else result.unchanged.push('CLAUDE.md');
  mkdirSync(join(out, '.claude'), { recursive: true });
  writeFileSync(join(out, MANIFEST), `${JSON.stringify({ note: 'Written by studio-builder export-claude. Files listed here are replaced on the next export unless you edited them.', studio: studioName ?? studio.split(sep).pop(), files: hashes }, null, 2)}\n`);
  return result;
}

export function relativeTo(base, path) {
  return relative(base, path).split(sep).join('/');
}
