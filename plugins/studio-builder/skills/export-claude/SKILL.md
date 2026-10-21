---
name: export-claude
description: Export a studio's design system and flows as a standalone .claude/ that a designer can use and orchestrate by hand, without the motion-flow pipeline. Use when the designer says "give me my own Claude setup", "export the studio rules", "I want to work without the pipeline", or after learn-studio and new-flow. Writes CLAUDE.md, .claude/rules/design-system/ and one skill per flow into a folder the designer chooses, and never overwrites a file the designer edited.
model: inherit
---

# export-claude

The studio's rules and flows live in the studio folder for motion-flow. This skill turns them into a folder the designer owns: a `CLAUDE.md` that points to the design system, the rule files as `.claude/rules/design-system/*.md`, and each flow as a standalone skill in `.claude/skills/<flow>/SKILL.md` (the flow's own steps, with no motion-flow pipeline in them). The designer can then edit anything and work in the order they like. The pipeline can still use the same studio folder: nothing here changes it.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md`, `studio-rules.md` and `handoff.md` (all in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/`). Talk to the designer in Ukrainian.

## Steps

1. **Pick the studio.** `mf-studio list` shows the studios in the studios folder. If there is more than one, ask which; if none, send the designer to `/studio-builder:learn-studio` and stop.
2. **Pick the target.** Ask where the designer works: a folder that is **not** the studio folder (the export refuses the studio folder itself). Offer to create it. It may already hold a `CLAUDE.md` or a `.claude/`: the export only adds its own block and its own files.
3. **Say what is in the studio.** Tell the designer how many rule files and flows there are, and which are still `draft` (an unconfirmed rule is exported with its `status: draft`, so the standalone setup warns too). Flows that are drafts in the current folder's `.claude/skills/` are included only if the designer wants them: add `--include-drafts`.
4. **Export.** Run `sb-export --to <folder> --studio <name>` (add `--include-drafts` if chosen; fallback: `node "${CLAUDE_PLUGIN_ROOT}/bin/sb-export" ...`). Read its answer: `written`, `unchanged`, and `kept`, the files the designer edited since the last export, which it left alone. Explain `kept` in plain words and offer `--force` only if the designer wants the studio's version back, after saying which edits will be lost.
5. **Explain how to work.** Tell the designer, in Ukrainian: open Claude Code in the target folder; the design system is read automatically; each flow is a command by its name; to refresh after the studio changes, run the export again (their own edits are kept); the After Effects tools (`ae-dump`, `ae-run`, `ae-render-frame`) and `drive-gate` come from the studio-builder plugin, which must stay enabled in that folder (`sb-init` can set the folder up with the safety settings: ask before running it).
6. **Hand off** (`handoff.md`): the target folder, the files written, the flows exported, anything kept, and the next step: open Claude Code in that folder.

## Never

- Never export into the studio folder, and never edit the studio's files.
- Never overwrite a file the designer edited, unless they ask with `--force` after being told what will be lost.
- Never write `.claude/settings.json` or any permission: the export carries knowledge, not access.
- Never put machine paths or client names into the export; the rule files are copied as they are, so if one holds a client name the designer allowed, say so.
