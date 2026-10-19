---
name: intake
description: Start a motion task in After Effects. Use when the designer describes a job to do (a new animation, an edit, a resize, an export, "зроби...", "змінити...", "підготуй під 9:16") or says "start a task". Asks only what is missing, picks a studio flow when one fits, and writes .motion/task.md. Does not change any project or fetch any file.
model: inherit
---

# intake

First of five steps: `intake` → `plan` → `build` → `check` → `deliver`. Intake turns what the designer says into `.motion/task.md`. It changes nothing in any project and fetches no files.

Before starting, read: `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md`, `socratic-loop.md`, `artifact-formats.md`, `drive-access.md` and `handoff.md` (all in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/`). Talk to the designer in Ukrainian.

## Steps

1. **Check the project is set up.** `.motion/` and `.claude/settings.json` must exist. If not, tell the designer to run `/motion-flow:init-project` first and stop.
2. **Check for an earlier task.** Run `mf-gate status`.
   - If `.motion/task.md` exists, show its state and ask with `AskUserQuestion`: continue that task (then stop and give the next command for its state: `plan`, `build`, `check` or `deliver`) or start a new one.
   - To start a new one after a delivered task run `mf-gate archive`. If the old task is unfinished, say plainly that it will be set aside, and only if the designer agrees run `mf-gate archive --abandon`. Never delete or move the files yourself.
3. **Load the studio rules.** Use the `studio-rules` skill if the plugin is installed; it lists the rule files and where they are. If it is not installed, tell the designer that no studio rules are loaded and go on (ask more, assume less).
4. **Read the flow index.** Collect the `description` of every flow in the studio rules (`flows/`) and in the project (`.claude/skills/`, drafts). Do not read the flows' full text yet.
5. **Understand the request.** Decide the type: `new`, `edit`, `resize`, `export` or `other`. If the designer's words match a flow's description, propose that flow and confirm it in one question. If no flow fits, say so and offer two options: continue on the general path, or teach the studio a new flow first with `/motion-flow:new-flow`. Do not start `new-flow` yourself.
6. **Apply the flow, if one was chosen.** Read its `SKILL.md` and `flow.md` and follow what they say about intake (questions to ask, defaults). The flow cannot loosen `safety.md`.
7. **Ask only what is missing**, following `socratic-loop.md`: the input files, the target formats or sizes, the deadline. One question at a time, with options and a default. Do not ask what the files or the rules already tell you.
   - Input files are named by Drive alias and relative path (`projects Brand/Spring/spring_v07.aep`) if the project uses Drive, or by their path under `work/` if it does not.
   - Check that each input exists: `drive-gate info <alias> <path>` for Drive files, or look in `work/` for the others. Never read a Drive path directly. If a file is missing, ask; do not guess another one.
8. **Write `.motion/task.md`** from `${CLAUDE_PLUGIN_ROOT}/templates/task.md`:
   - `id`: `<today's date>-<type>-<NN>`. `NN` is `01`, or the next free number if `.motion/archive/` already holds the same prefix.
   - `type`, `flow`, `inputs`, `deadline` from the answers.
   - `## Опис`: the request in the designer's words. `## Що відомо / припущення`: facts learned, then every assumption, one per line.
   - `status: ready` only when the type is known and every input exists. Otherwise write `status: draft`, say what is missing, and stop without a handoff to `plan`.
9. **Confirm once.** Show a short summary (the task, the inputs, the assumptions, the open questions) and ask "Це правильно?". Apply any change to the file, then continue.
10. **Hand off** with the block from `handoff.md`: what was written (`.motion/task.md`), what to check (the assumptions list), next command `/motion-flow:plan`.

## Never

- Never open, list or read a Drive folder except through `drive-gate`.
- Never fetch files, run `ae-dump` or `ae-run`, or edit a project in this step.
- Never invent a file name, a format or a deadline the designer did not give; ask or write it as an open question.
