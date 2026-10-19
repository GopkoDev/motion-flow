# Independent pass: a second reader who did not do the work

Used by `intake` (to find ambiguities in a task) and `check` (to verify a result). A step that has just written or built something is a poor judge of it: it remembers what it meant, so it reads the intention into the evidence. The independent pass is a separate sub-agent that sees only the files, not the conversation.

## How to run it

1. Use the `Agent` tool (a general-purpose sub-agent). If the tool is not available, do the pass yourself, but say so plainly: "Незалежна перевірка не виконувалась: немає суб-агента" and write that in the artifact.
2. Give it only what it needs, as file paths for it to read itself (never pasted summaries): for `intake` the task file and the studio rule files; for `check` the task, the plan, the dumps, the frames. Do not include the conversation, your reasoning, or your conclusions.
3. Tell it to be read-only: it must not edit any file or run any tool that changes a project.
4. Ask for a fixed shape and nothing else. Every finding must **cite its evidence** (a file path and a line, a layer name, a frame file). A finding without a citation is dropped. If it finds nothing, it answers the single word `NO_FINDINGS`.
5. Do not argue with it in its own context. Read the findings, check each one against the files yourself, and keep or drop it with a reason.

## Prompt for `intake`: where would two people do different things?

> You are reading a task description for After Effects work. You were not part of the conversation. Read `.motion/task.md` (and the studio rule files you are given). Find every place where two competent motion designers, or an automated agent, would reasonably do something different from this task as written: vague words ("nice", "fast", "similar"), measurements without numbers, a missing input or format, two statements that conflict, a rule from the studio rules that the task seems to break, an acceptance criterion that cannot be seen or measured. For each, answer one line: `<section or AC id> | <what is ambiguous> | <the two readings>`. If there is nothing, answer exactly `NO_FINDINGS`. Do not edit anything.

Resolve every finding with the designer: **tighten** the task (write the answer into the criteria or the description), **defer** it (a line under `## Відкриті питання` with the owner and the date it is needed), or **drop** it as not an ambiguity. None may stay unanswered.

## Prompt for `check`: does the evidence show it?

> You are verifying finished After Effects work. You were not part of building it. Read `.motion/task.md` (the acceptance criteria), `.motion/plan.md`, the dump `work/dumps/after.json`, the snapshot in `.motion/snapshots/`, and open the frame images listed. For every acceptance criterion `AC<n>` and every plan step `#<n>`, answer one line: `<AC or #> | PASS, FAIL or NOT_VERIFIED | evidence: <file and layer, value or frame, what is visible>`. PASS only if the dump or a frame shows it; if you cannot see it, answer NOT_VERIFIED, never PASS. Then list anything in the dump or frames that looks wrong and is not covered by any criterion, as `EXTRA | <what> | <where>`. Do not judge taste, only compare with the criteria and the plan. Do not edit anything.

Put its answer under `## Незалежна перевірка` in `check.md`, and compare it with your own table. Where the two disagree, show the designer both and say which file settles it; never pick the friendlier verdict silently.

## Rules

- The independent pass supplements your own check, it does not replace it. You still read the dump and look at the frames.
- A sub-agent's `PASS` without evidence is not a `PASS`.
- It never approves anything; only the designer does.
