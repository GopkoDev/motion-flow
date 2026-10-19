---
name: build
description: Carry out an approved plan in After Effects on a copy of the project. Use after the designer approved the plan, or when the designer says "run the plan", "build". Writes one script per plan step, runs each through ae-run, stops at the first error, and logs every run. Never works on originals.
model: inherit
---

# build

Third of five steps. Build executes the approved plan on a **copy** of the project, one script per plan step. It does exactly what the plan says, nothing more.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/gating.md`, `safety.md`, `ae-scripting.md`, `artifact-formats.md` and `handoff.md`. Talk to the designer in Ukrainian.

## Steps

1. **Gate.** Run `mf-gate require build`. If it refuses (plan missing, not approved, or changed after approval), give the refusal text from `gating.md` and stop. Do not "repair" the plan or its hash.
2. **Read the rules the steps need** (`naming`, `motion-system`, `protected` from the studio rules, and `.motion/overrides.md`). **Draft rules.** A studio rule file whose frontmatter says `status: draft` has not been confirmed by a person. When you read one, tell the designer once per step (in Ukrainian) which rule file it is and that it is only a draft, then follow it carefully and ask when it matters. Never treat a draft as settled and never change its status.
3. **Read `.motion/plan.md`** and `.motion/task.md`. Find the source project in `work/` (the input of the task; Drive files were fetched by `plan`) and `project_copy:` from the plan.
4. **Make the working copy.** `cp <source .aep> <project_copy>` inside `work/`. If `project_copy` already exists, never overwrite it: run `aep-version` on the source again to get a free name, tell the designer, and use it. Every script runs on this copy, never on the source.
5. **Run the steps in order.** For plan step N, with title T:
   1. Write `jsx/NN-<short-name>.jsx` following `ae-scripting.md`: finds layers and comps by name, is safe to run twice, takes its values from `input.params`, returns a small result (counts, names), uses only the `mf` helpers for files. Do exactly what row N says.
   2. Check it: `node "${CLAUDE_PLUGIN_ROOT}/scripts/check_jsx.mjs" --policy jsx/NN-<short-name>.jsx`. Fix any report before running.
   3. Run it: `ae-run --project <project_copy> --script jsx/NN-<short-name>.jsx --undo "<T>" --params '<json>' --step N --attempt A` (`A` starts at 1). `ae-run` appends the line to `.motion/build.log.jsonl` itself; never write that file.
   4. Read the JSON answer. `ok: true`: go to the next step.
6. **On an error, stop.** Do not run later steps.
   - If the error is in your script (layer not found, wrong value, syntax error), fix the script and run again with the next `--attempt`. At most 2 retries per step.
   - If the cause is not the script (`timeout`, `launch_failed`, `busy`, After Effects not found, another project open, no permission), do not retry on your own: tell the designer exactly what `ae-run` said and its hint, and ask.
   - After the allowed retries, or when the plan itself is wrong (the layer does not exist, the change is impossible), stop and ask. If the plan has to change, that means going back to `/motion-flow:plan`; never improvise a different change.
7. **Finish.** When every step is `ok`, run `mf-gate require check` to confirm the log is clean. Then hand off (`handoff.md`): what ran (steps and scripts), what to look at (the result copy `project_copy`, `.motion/build.log.jsonl`), next command `/motion-flow:check`.

## Rules

- Never run `ae-run` on anything outside `work/`; it refuses, and so should you.
- Never skip a step, reorder steps, or add changes that are not in the plan.
- Never delete the designer's content unless the approved plan names it.
- Never edit `.motion/plan.md`. A different change means a new plan and a new approval.
- Never write `.motion/build.log.jsonl`; it is written by `ae-run --step`.
- If After Effects shows a dialog or hangs, tell the designer to look at the After Effects window; do not start another run on top.
