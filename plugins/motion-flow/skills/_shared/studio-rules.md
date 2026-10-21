# Studio rules: where they are and how to read them

Reference for every step that reads a studio's rules (`intake`, `plan`, `build`, `check`, `deliver`, `whats-new`, `refine-flow`, `publish-flow`). The rules are plain files in a folder; there is no plugin and no marketplace.

## Where

- All studios live in one folder, by default `~/Documents/studios/`, one subfolder per studio (`mf-studio dir` prints it; `~/.motion-flow/studios.json` with `{"dir": "<path>"}` moves it).
- A project remembers its studio by name in `.motion/studio.json` (set by `mf-init --studio <name>`, shown by `mf-studio path`).
- Run `mf-studio path` (fallback: `node "${CLAUDE_PLUGIN_ROOT}/bin/mf-studio" path`). It prints one JSON object:
  - `{ "ok": true, "name": "acme", "path": "<studio folder>", "rules": "<studio folder>/rules", "changelog": "<studio folder>/CHANGELOG.md" or null }`
  - `{ "ok": false, "reason": "no_studio" }`: this project uses no studio rules. Tell the designer once that no studio rules are loaded and go on (ask more, assume less).
  - `{ "ok": false, "reason": "studio_missing", "detail": "..." }`: the project names a studio whose folder is gone. Tell the designer plainly and ask whether to continue without rules or to fix the folder first.

## What is inside a studio folder

`INDEX.md` in the studio folder lists the files and the steps that read each one: `rules/naming.md`, `rules/motion-system.md`, `rules/protected.md`, `rules/delivery.md`, `rules/drive.md`, `rules/project-template/`, `rules/checks/` (JSON checks for `ae-lint`), `flows/` (approved flows, one folder each) and `CHANGELOG.md`. Read `INDEX.md` first, then only the files the step needs.

## How to read them

- Rules are read-only for every step except `init-rules` (which writes drafts into the studio's own folder). A project's settings forbid editing the studios folder; never edit a rule from a project.
- Every rule file starts with `status: draft` or `status: confirmed`. If a file you read is `draft`, tell the designer once per step which file it is and that it is only a draft, then follow it with extra care and ask when it matters. Never turn a draft into `confirmed`; a person reads it and commits it.
- A rule is a requirement, not a hint. If the designer's request conflicts with one, say which rule and ask which is right (`socratic-loop.md`); never pick silently.
- Project exceptions live only in the project's `.motion/overrides.md`.
- Do not copy rule text into project files; refer to the rule by file name.
