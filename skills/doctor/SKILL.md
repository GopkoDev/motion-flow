---
name: doctor
description: Check that the machine and the project are ready for motion-flow. Use when the designer says "doctor", "check my setup", "is everything installed", after installing the plugins, or when a step fails because a tool is missing. Reports dependencies, drive-gate config, project deny rules and plugin versions. Installs nothing.
model: inherit
---

# doctor

Read-only health check. It never installs, edits or deletes anything.

## Steps

1. Run the checker from the project folder:
   - everything: `mf-doctor`
   - only what one flow needs: `mf-doctor --flow <flow-name>` (add `--flows-dir <path>` if the flow lives outside `.claude/skills/`)
   - machine-readable: add `--json`
   If `mf-doctor` is not found, run `node "${CLAUDE_PLUGIN_ROOT}/bin/mf-doctor"` instead (on Windows this form is the normal one).
2. Show the designer the table as it is, then explain it in Ukrainian in a few short lines:
   - `ok`: nothing to do.
   - `MISSING` or `OLD VERSION`: give the install command from the report for their system and ask them to run it themselves.
   - `check by hand`: the tool cannot be checked by a command yet (After Effects, whisper); say what to look at.
   - `PROBLEM` under `drive-gate config` or `project settings.json`: quote the listed detail and say which file to fix.
3. Do not run any install command, do not edit `~/.motion-flow/roots.json` or `.claude/settings.json`. A person makes those changes.
4. End with the next command to run, for example `/motion-flow:intake`, or "fix the items above and run doctor again".

## Exit codes of mf-doctor

- `0`: everything required is fine.
- `1`: something is missing, old or misconfigured.
- `2`: doctor itself could not run (for example a broken `deps.json`); report the message.
