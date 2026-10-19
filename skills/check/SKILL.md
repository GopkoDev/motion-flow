---
name: check
description: Verify that what was built matches the plan and show the designer the result frames. Use after build, or when the designer says "check it", "verify", "show me the frames". Runs lint and a fresh dump, renders the frames named in the plan, writes .motion/check.md, and asks for approval. Does not judge taste, only compares with the plan and the rules.
model: inherit
---

# check

Fourth of five steps. Check proves that what was built is what was asked for and what the plan said, and shows the designer the frames. It traces every acceptance criterion of the task to evidence, so something the plan forgot cannot slip through. The designer approves the result (the second human gate). Check judges facts, not beauty: taste stays with the designer.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/gating.md`, `safety.md`, `artifact-formats.md` and `handoff.md`. Talk to the designer in Ukrainian.

## Steps

1. **Gate.** Run `mf-gate require check`. It refuses without a clean `build.log.jsonl` (missing, broken, or a failed step) or if the plan changed after approval. Give the refusal text from `gating.md` and stop.
2. **Read** `.motion/plan.md`, `.motion/task.md`, and `project_copy:` from the plan (the result of `build`), and the studio rules `naming`, `protected` and `checks/`. **Draft rules.** A studio rule file whose frontmatter says `status: draft` has not been confirmed by a person. When you read one, tell the designer once per step (in Ukrainian) which rule file it is and that it is only a draft, then follow it carefully and ask when it matters. Never treat a draft as settled and never change its status.
3. **Fresh dump.** `ae-dump --project <project_copy> --out work/dumps/after.json`.
4. **Lint.** If the studio rules have a `checks/` folder (the `studio-rules` skill tells where), run `ae-lint --dump work/dumps/after.json --checks <that folder> --baseline <the newest project-map in .motion/snapshots/>` (the one `plan` took for the approved plan). The baseline is what lets lint notice changes to protected comps. If there is no checks folder, write "lint skipped: no studio checks" in `check.md`; never write a clean lint you did not run.
5. **Compare with the plan.** For every row of the plan, find the evidence in the fresh dump (a layer count, a duration, fps, a transform value, a keyframe) and write what is actually there. A row passes only when the dump shows what the row expected.
6. **Trace the criteria.** For every acceptance criterion of `task.md` (`AC1`, `AC2`, ...) write one row: the evidence (what the dump or a frame shows, with the file), and `PASS`, `FAIL` or `NOT_VERIFIED`. A criterion that cannot be seen in the dump or in a frame is `NOT_VERIFIED`, never `PASS`. Include criteria the plan listed as not covered.
7. **Render frames.** With `ae-render-frame --project <project_copy> --comp "<comp>" --time <seconds> --out work/frames/step<NN>_t<seconds>s.png` for the frame named in each row, plus the first frame, the last frame, and the middle of each transition mentioned in the plan.
8. **Look at the frames.** Open each PNG (Read tool) and say whether it shows what the row or criterion expected: what is visible, what is missing. State facts ("the logo is in the top right, 120 px wide"); do not give opinions on style. After Effects PNG colors can differ slightly from the viewer, so do not report small color shifts as defects.
9. **Independent pass** (`independent-review.md`, "Prompt for check"). A sub-agent that did not take part reads the task, the plan, the dumps and the frames and answers criterion by criterion. Compare its answer with yours. Where it says `NOT_VERIFIED` or `FAIL` and you said `PASS`, look again at the cited evidence and settle it; never keep the friendlier verdict silently. Put its findings under `## Independent review` (or `not run: <reason>` if no sub-agent could run).
10. **Write `.motion/check.md`** from `${CLAUDE_PLUGIN_ROOT}/templates/check.md`: `task_id` equals the plan's; `## Comparison with the plan` (one row per plan step), `## Acceptance criteria` (one row per criterion), `## Lint`, `## Frames` (frame files that exist), `## Independent review`, `## Open questions`. `verdict: PASS` only if every row and every criterion is `PASS` and lint has no errors; otherwise `ISSUES`.
11. **Self-check.** Run `mf-gate verify check`. Fix what fails and run it again (at most twice). If something still fails, show it to the designer plainly.
12. **Show and ask.** Show both tables (the plan rows and the criteria), the independent pass result and the frame paths. Tell the designer to open the frames and look at them. Ask with `AskUserQuestion`: "Approve the result", "Fix issues", "Change the plan".
   - Approve: run `mf-gate approve check` (one Claude Code confirmation prompt will appear; tell the designer it records their decision). Allowed also when the verdict is `ISSUES`, if the designer decides to accept the issues; say so in the question.
   - Fix issues or change the plan: do not approve. Tell the designer the next command: `/motion-flow:build` for a repeat of a failed step, `/motion-flow:plan` when the plan must change.
13. **Hand off** (`handoff.md`): `.motion/check.md`, the self-check line, the frames, next command `/motion-flow:deliver` after an approval. If several things are wrong, name the highest-impact one first: fix one problem at a time.

## Rules

- Never write `approved: true` or `approved_at` yourself; only `mf-gate approve check` does, after the designer's explicit answer.
- Never change the project in this step. `ae-dump` and `ae-render-frame` do not change it.
- Never report a check you did not run. Say "not run" and why.
- Never mark a criterion `PASS` without evidence you can cite.
