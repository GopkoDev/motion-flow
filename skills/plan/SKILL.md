---
name: plan
description: Turn a prepared task into a plan of concrete After Effects changes for the designer to approve. Use after intake, or when the designer says "make a plan", "складай план", or wants to change an existing plan. Fetches the needed files into work/, snapshots the project, writes .motion/plan.md, and asks for approval. Nothing is changed in the project.
model: inherit
---

# plan

Second of five steps. Plan reads `.motion/task.md`, looks at the real project, and writes `.motion/plan.md`: a numbered list of small changes, each with the frame to check it by. The designer approves the plan (the first of the two human gates). Plan changes nothing in the project.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/gating.md`, `safety.md`, `artifact-formats.md`, `drive-access.md`, `ae-scripting.md` and `handoff.md`. Talk to the designer in Ukrainian.

## Steps

1. **Gate.** Run `mf-gate require plan`. If it refuses, give the refusal text from `gating.md` (usually: run `/motion-flow:intake` first) and stop.
2. **Read the inputs.** `.motion/task.md`. If `.motion/plan.md` already exists, this is a re-plan: read it and tell the designer what you will change.
3. **Check the tools.** If the task names a flow, run `mf-doctor --flow <flow-name>`. If something the flow needs is missing, show the install command from the report and stop; the designer installs it.
4. **Read the rules.** From the studio rules (`studio-rules` skill): `motion-system`, `protected`, `naming`, `delivery` if they exist, plus `.motion/overrides.md` and the chosen flow's `SKILL.md` and `flow.md`. Draft rules: A studio rule file whose frontmatter says `status: draft` has not been confirmed by a person. When you read one, tell the designer once per step, in Ukrainian, which file and that it is only a draft ("Правило <назва> ще чернетка"), then follow it carefully and ask when it matters. Never treat a draft as settled and never change its status.
5. **Get the files into `work/`.** Per `drive-access.md`:
   - Drive project: `drive-gate info`, then `drive-gate fetch <alias> <path> --to work/` for the `.aep`. Run `ae-dump --project work/<path> --out work/dumps/source.json`, then fetch the linked media: `drive-gate fetch <alias> <path> --to work/ --overwrite --with-deps --deps-from work/dumps/source.json`.
   - No-Drive project: the files should already be in `work/`. If one is missing, ask the designer to copy it there.
6. **Snapshot the project.** `ae-dump --project work/<path>.aep --out .motion/snapshots/project-map-<YYYYMMDD-HHMMSS>.json`. Read it. Everything you plan must be based on this dump, not on guesses about names, sizes or layers.
7. **Choose the working copy name.** `aep-version work/<path>.aep` prints the next free version name; this goes into `project_copy:`. The copy itself is made by `build`, not now.
8. **Write `.motion/plan.md`** from `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`, with the Write tool, `status: draft`:
   - `task_id` equals the task's `id`. `needs:` lists the tools the steps use.
   - `## Кроки`: one row per atomic change. Each row has the target (comp / layer / property, by NAME), the change (concrete values), the expected result (something that can be seen in the dump or in a frame), and the frame to check (comp and time in seconds).
   - `## Ризики`: what could go wrong and what protects against it. `## Питання до людини`: what the designer must answer first.
   - Use layer and comp names exactly as in the dump. Respect naming and motion rules; if a request conflicts with a rule, do not decide silently: ask (see `socratic-loop.md`).
9. **Protected things.** Compare every target with `protected` rules. Set `touches_protected: true` if any step touches something protected. In that case do not ask for approval yet: say which step and why, and ask the designer how to proceed (change the plan, or the rule owner must allow it).
10. **Show and ask.** Print the plan in the chat (the table, the risks, the questions). Then ask with `AskUserQuestion`: "Approve" or "Change the plan". Do not ask when `Питання до людини` still has unanswered questions: ask those first.
    - If the designer asks for changes, edit `plan.md`, show the new version, and ask again.
    - If the designer approves, run `mf-gate approve plan`. Claude Code will show one confirmation prompt for this command; tell the designer to approve it, it records their decision. Never run it without the designer's explicit "Approve".
11. **Hand off** (`handoff.md`): the plan file, "check the table row by row", next command `/motion-flow:build`.

## Rules

- Never write `status: approved`, `approved: true`, `approved_at` or `plan_sha256` yourself; only `mf-gate approve plan` does. The guard hook blocks it.
- Never run a script that changes the project in this step. `ae-dump` only reads.
- If the plan is edited after approval, the hash no longer matches and `build` will refuse until it is approved again; that is correct.
- Nothing from `work/` or the dump goes outside this project.
