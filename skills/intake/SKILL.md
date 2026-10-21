---
name: intake
description: Start a motion task in After Effects. Use when the designer describes a job to do (a new animation, an edit, a resize, an export, "make...", "change...", "prepare it for 9:16") or says "start a task". Asks only what is missing, picks a studio flow when one fits, and writes .motion/task.md. Does not change any project or fetch any file.
model: inherit
---

# intake

First of five steps: `intake` → `plan` → `build` → `check` → `deliver`. Intake turns what the designer says into `.motion/task.md`. It changes nothing in any project and fetches no files.

Before starting, read: `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md`, `socratic-loop.md`, `artifact-formats.md`, `independent-review.md`, `drive-access.md` and `handoff.md` (all in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/`). Talk to the designer in Ukrainian.

## Steps

1. **Check the project is set up.** `.motion/` and `.claude/settings.json` must exist. If not, run `mf-init --no-drive --no-rules` (it asks nothing and never overwrites) and tell the designer in one line what it created. Use `/motion-flow:init-project` only when the designer wants Drive or a studio's rules: say so and stop. If `mf-init` refuses (the folder is inside Drive), give its message and stop.
2. **Check for an earlier task.** Run `mf-gate status`.
   - If `.motion/task.md` exists, show its state and ask with `AskUserQuestion`: continue that task (then stop and give the next command for its state: `plan`, `build`, `check` or `deliver`) or start a new one.
   - To start a new one after a delivered task run `mf-gate archive`. If the old task is unfinished, say plainly that it will be set aside, and only if the designer agrees run `mf-gate archive --abandon`. Never delete or move the files yourself.
3. **Load the studio rules.** Use the `studio-rules` skill if the plugin is installed; it lists the rule files and where they are. If it is not installed, tell the designer that no studio rules are loaded and go on (ask more, assume less).
4. **Read the flow index.** Collect the `description` of every flow in the studio rules (`flows/`) and in the project (`.claude/skills/`, drafts). Do not read the flows' full text yet.
5. **Understand the request.** Decide the type: `new`, `edit`, `resize`, `export` or `other`. If the designer's words match a flow's description, propose that flow and confirm it in one question. If no flow fits, say so and offer two options: continue on the general path, or teach the studio a new flow first with `/motion-flow:new-flow`. Do not start `new-flow` yourself.
6. **Apply the flow, if one was chosen.** Read its `SKILL.md` and `flow.md` and follow what they say about intake (questions to ask, defaults). The flow cannot loosen `safety.md`.
7. **Ask only what is missing**, following `socratic-loop.md`: the input files, the target formats or sizes, the deadline. One question at a time, with options and a default. Ask only facts that block the work (sizes, frame rate, duration, source files); for matters of taste make a sensible choice, say so in the assumptions, and let the designer push back. Do not ask what the files or the rules already tell you. If the designer gives a reference image or video, take it as direction, not as a pixel-exact target, unless they say otherwise; note its path under `work/` in the description.
   - Input files are named by Drive alias and relative path (`projects Brand/Spring/spring_v07.aep`) if the project uses Drive, or by their path under `work/` if it does not.
   - Check that each input exists: `drive-gate info <alias> <path>` for Drive files, or look in `work/` for the others. Never read a Drive path directly. If a file is missing, ask; do not guess another one.
8. **Agree the acceptance criteria.** Turn the request into a short list of criteria, each a result a person can see or measure ("the 9:16 comp is 1080x1920 at 25 fps", "the logo is 120 px wide in the top right"), with numbers wherever the designer gave them or the studio rules define them. Propose the list, ask the designer to correct it, and number it `AC1`, `AC2`, .... These criteria are the contract: the plan must cover every one, and `check` must prove every one. Vague wishes ("looks good") are not criteria; ask what would be visible if it were done.
9. **Write `.motion/task.md`** from `${CLAUDE_PLUGIN_ROOT}/templates/task.md`:
   - `id`: `<today's date>-<type>-<NN>`. `NN` is `01`, or the next free number if `.motion/archive/` already holds the same prefix.
   - `type`, `flow`, `inputs`, `deadline` from the answers.
   - `## Description`: the request in the designer's words. `## Acceptance criteria`: the agreed list. `## Known facts and assumptions`: facts learned, then every assumption, one per line. `## Open questions`: what is still unknown (or `- none`).
   - `status: ready` only when the type is known, every input exists, and there is at least one criterion. Otherwise write `status: draft`, say what is missing, and stop without a handoff to `plan`.
10. **Independent pass for ambiguities** (`independent-review.md`, "Prompt for intake"). Run it on the written task. Resolve every finding with the designer: tighten the task, defer it (an open question with who and when), or drop it as not an ambiguity. Update `task.md` after each answer; none may stay unanswered.
11. **Self-check.** Run `mf-gate verify task`. If an item fails, fix the file and run it again (at most twice). If something still fails, tell the designer what and why; do not set `status: ready` while it fails.
12. **Confirm once.** Show a short summary (the task, the inputs, the criteria, the assumptions, the open questions) and ask "Is this right?" (in Ukrainian). Apply any change to the file and run `mf-gate verify task` again.
13. **Hand off** with the block from `handoff.md`: what was written (`.motion/task.md`), the self-check line, what to check (the criteria and the assumptions list), next command `/motion-flow:plan`.

## Never

- Never open, list or read a Drive folder except through `drive-gate`.
- Never fetch files, run `ae-dump` or `ae-run`, or edit a project in this step.
- Never invent a file name, a format or a deadline the designer did not give; ask or write it as an open question.
- Never write a criterion the designer did not agree to, and never drop one to make the plan easier.
