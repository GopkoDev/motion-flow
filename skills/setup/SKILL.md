---
name: setup
description: Connect motion-flow to the Google Drive folders on this computer. Use when the designer wants to use Google Drive with the agent for the first time, when doctor or drive-gate says no Drive folders are set up, or when they want to add or change the Drive folders available on this computer. Finds Drive, lets the designer choose folders, and writes ~/.motion-flow/roots.json. Not needed by designers who do not use Drive.
model: inherit
---

# setup

Creates or updates `~/.motion-flow/roots.json`: the list of Google Drive folders available on this computer. Which of them a project may use is chosen separately, per project, by `/motion-flow:init-project`. The designer never edits the file by hand. If the designer does not use Drive, this skill is not needed.

## Steps

1. Look at the current state: `mf-setup --show` (fallback: `node "${CLAUDE_PLUGIN_ROOT}/bin/mf-setup" --show`). If a config already exists, tell the designer (in Ukrainian) which aliases are set and ask whether to keep or change them.
2. Find Drive: `mf-setup --detect`. It prints the Google Drive folders found on this computer and their first-level subfolders. If nothing is found, ask the designer to open Google Drive for Desktop and tell you the path of the Drive folder, then continue with that path.
3. Let the designer choose with `AskUserQuestion`: which folders the agent may read (for example the assets folder and the projects folder) and a short alias for each (`assets`, `projects`; if `studio-rules` already names aliases in `rules/drive.md`, use those names). Read access only: the agent can never write to Drive.
4. Check the choice without writing: `mf-setup --dry-run --root assets=<path> --root projects=<path>`. Fix any error it reports with the designer.
5. Write it: `mf-setup --root assets=<path> --root projects=<path>` (add `--replace` only when changing an existing config). On a first setup this just runs. If a config already exists, Claude Code shows a permission prompt with the exact command: tell the designer to read the folders in it and approve only if they are right. Never try to avoid or work around that prompt, and never write `roots.json` with any other tool.
6. Run `mf-doctor` and show the result. Finish with a short handoff in Ukrainian and the next command: `/motion-flow:init-project` inside the project folder (there the designer chooses which of these folders that project uses).

## Rules

- Do not guess paths; use only what `--detect` printed or the designer typed.
- Never choose a folder that is not Google Drive without asking the designer to confirm it explicitly.
- Do not use Read, Write, Edit or shell redirects on anything inside `~/.motion-flow/` except `mf-setup`.
