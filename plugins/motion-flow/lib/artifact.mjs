// Markdown artifacts: frontmatter and "## Heading" sections. Used by mf-gate (pipeline artifacts) and mf-flow (flows).

/** Splits a Markdown artifact into { frontText, front, body }. front values are raw strings. Returns null without frontmatter. */
export function parseArtifact(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const front = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const openLength = match[0].indexOf('\n') + 1;
  return { frontText: match[1], front, body: text.slice(match[0].length), open: match[0].slice(0, openLength), close: match[0].slice(openLength + match[1].length) };
}

/** The text that is hashed: the body, line endings as \n, trailing whitespace at the end removed. */
export function normalizeBody(body) {
  return body.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

/** Sets existing frontmatter keys (or adds missing ones at the end) without touching anything else. */
export function setFrontmatter(text, values) {
  const artifact = parseArtifact(text);
  if (!artifact) throw new Error('The file has no frontmatter.');
  const newline = artifact.open.endsWith('\r\n') ? '\r\n' : '\n';
  let front = artifact.frontText;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}: ${value}`;
    const pattern = new RegExp(`^${key}:.*$`, 'm');
    front = pattern.test(front) ? front.replace(pattern, line) : `${front}${newline}${line}`;
  }
  return `${artifact.open}${front}${artifact.close}${artifact.body}`;
}

/** The text of a "## Heading" section (up to the next "## "), or null. */
export function section(body, heading) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}
