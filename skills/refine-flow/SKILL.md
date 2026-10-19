---
name: refine-flow
description: Improve an existing flow from what happened in real use. Use after deliver when the designer had to fix something by hand, or says "the flow got this wrong", "update the flow", "improve the flow", "the flow should also ask about ...". Compares what the flow produced with what the designer ended up with, proposes the change in plain words, and after approval raises the flow's version and logs the change.
model: inherit
---

# refine-flow

Flows get better when real work corrects them. This skill learns from the corrections a designer made by hand, proposes a precise change to the flow, and records it as a new version. A changed flow goes back to `draft` and must be reviewed again before the team uses it.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md`, `socratic-loop.md`, `artifact-formats.md` and `handoff.md` (all in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/`). Talk to the designer in their language (Ukrainian by default). The flow files are English: when you show a proposed change, show it in the designer's language and apply it to the English files.

## Steps

1. **Find the flow.** Take it from the `flow:` field of `.motion/task.md` (or the archived task), or ask which flow. A flow lives in the project's `.claude/skills/<flow>/` (a draft) or comes from the installed studio rules (approved). **Never edit an installed studio-rules copy.** If the flow exists only there, copy it into the project (`cp -R <the installed flow folder> .claude/skills/<flow>`) and say that this project copy is a proposed update which will go through review, while the team keeps using the approved one meanwhile.
2. **Ask what had to be fixed by hand.** One question at a time, following `socratic-loop.md`: "What did you have to fix or redo after the result?" Let the designer tell it freely, then ask for details.
3. **Compare with the result.** If the designer has their corrected version of the project, ask where it is (a file under `work/`) and run `ae-dump` on it; compare with the dump of the delivered result (`work/dumps/after.json`, or dump the delivered copy). Describe every difference in plain words ("the subtitles are at 25 fps in your version, 30 in ours"). Read the last task's artifacts (`task.md`, `plan.md`, `check.md`, `deliver.md`, in `.motion/` or `.motion/archive/<id>/`) to see what the flow told the steps to do.
4. **Generalize before changing.** For each correction ask: is this always true for this kind of task, or only for this project? Change the flow only for what is always true; a one-off stays out. Also ask whether the correction is really a **studio rule** (a naming, delivery or protected rule): then it belongs in the rules, not the flow; say so and name the rule file, so the rule owner can change it.
5. **Propose the change in plain words.** For each change show: what the flow says now, what it should say, and why (the correction that proves it). Group by file and section. Classify the whole update: `patch` (clearer wording, a small value), `minor` (a new or changed question, step or check), `major` (a different purpose, inputs or outputs). Ask with `AskUserQuestion` for each change: apply / change it / leave it out.
6. **Apply only what was approved**, to the English flow files in `.claude/skills/<flow>/`. A flow may add questions, steps and checks; it must never remove an approval gate, skip a check, widen access, or touch settings. If a correction would require that, explain that a flow cannot, and why.
7. **Record the version.** Run `mf-flow bump .claude/skills/<flow> <patch|minor|major> --note "<what changed, one line, English>"`. This raises `version`, resets `status` to `draft`, and adds the entry to the flow's `CHANGELOG.md`.
8. **Check.** Run `mf-flow check .claude/skills/<flow>`. Fix what fails and run it again, at most twice; show anything still failing to the designer plainly.
9. **Hand off** (`handoff.md`): the flow folder, the old and new version, a summary of what changed in the designer's language, the check line, and the next command `/motion-flow:publish-flow` to prepare the new version for review.

## Rules

- Never put client names, texts, paths or file copies into the flow; describe the shape of the project, not its content.
- Never change a flow without the designer's approval of that change.
- Keep the flow lean: do not add a step for every small thing, and remove a step only when the designer confirms it was not needed.
- Never edit `.motion/` records of past tasks, and never change the designer's originals.
