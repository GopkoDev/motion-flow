---
name: init-project
description: Set up a motion project folder for motion-flow and choose whether this project uses Google Drive. Use when the designer starts a new project, says "init the project", "set up this folder", wants to turn Drive on or off for a project, or when doctor reports that the project settings.json is missing. Creates .claude/settings.json (safety rules), CLAUDE.md, .gitignore lines, .motion/ and work/. Never overwrites existing files except the project's Drive choice, which the designer sets explicitly.
model: inherit
---

# init-project

Prepares the current project folder. It only writes inside the project folder, never on Google Drive, and never overwrites a file that already exists (the exceptions are `.motion/drive.json` and `.motion/studio.json`, the project's Drive and studio choices, which are changed only when the designer picks a new one).

## Steps

1. Look at the computer's Drive folders: `mf-setup --show` (fallback: `node "${CLAUDE_PLUGIN_ROOT}/bin/mf-setup" --show`), and at the project's current choice if `.motion/drive.json` exists.
2. Ask the designer (in Ukrainian) with `AskUserQuestion` whether this project uses Google Drive:
   - **No Drive:** the designer copies the source files into `work/` by hand.
   - **Drive:** if the computer has no Drive folders yet, run the `/motion-flow:setup` steps first, then continue. If it has some, let the designer pick which of them this project may use (several can be chosen).
   Skip the question only when the designer already said it, or when re-running only to repair files and the project already has a choice.
3. **Studio rules.** Ask (with `AskUserQuestion`) which studio's rules apply to this project, or none. Offer the studios that `mf-studio list` finds (the subfolders of the studios folder that hold a `rules/` folder; it needs no install), plus "no studio rules". If there are none yet, say that `/motion-flow:init-rules` creates one in `mf-studio dir`. A freelancer may work for several studios: exactly one studio is chosen per project.
4. Preview: `mf-init --dry-run` with the Drive choice (`--no-drive` or `--drive <alias>[,<alias>]`) and the studio choice (`--studio <name>` or `--no-studio`) (fallback: `node "${CLAUDE_PLUGIN_ROOT}/bin/mf-init" ...`). Show the list of files that will be created, updated or skipped. If `.claude/settings.json` already exists (a project made before v0.1.1), add `--update-permissions` so the plugin tools stop asking for confirmation at every step; it only adds missing allow rules and keeps the project's own.
5. If every line says "will create" or "skipped", go on without asking: nothing existing is changed. Only if a line says "will append to" (an existing `.gitignore` gets lines added) or "will update" (the Drive choice changes, or the studio access is added to an existing `settings.json`), confirm with the designer using `AskUserQuestion` (options: go ahead, cancel) and continue only on an explicit "go ahead".
6. Run the same command without `--dry-run`. Show the result. If changing an existing Drive choice with `--drive`, Claude Code shows a permission prompt: tell the designer to read the folders in it and approve only if they are right.
7. Run `mf-doctor` and show the table. If something is still wrong, explain it briefly in Ukrainian.
8. Finish with a short handoff in Ukrainian: what was created; if the project does not use Drive, a clear reminder to copy the source files into `work/` by hand; what to review (`.claude/settings.json`); if a studio was chosen, which studio and that its rules are read from the studios folder; and the next command `/motion-flow:intake`.

## Changing the choice later

Run this skill again in the same project and choose differently. Use `--drive` to enable folders, `--no-drive` to turn Drive off. `.claude/settings.json` does not depend on the choice, so it does not need to be touched.

## Rules

- Never edit `~/.motion-flow/roots.json` or an existing `.claude/settings.json`; if they already exist, point the designer to the differences and let them decide.
- Never write `.motion/drive.json` with Write, Edit or shell redirects: only through `mf-init`.
- Do not run `git init` or any other command not listed above.
