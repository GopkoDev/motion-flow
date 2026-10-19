# Gating: when a step must refuse

Reference for `intake`, `plan`, `build`, `check`, `deliver` and every flow. Gating is enforced by code (`mf-gate`), not only by these words. A step that is refused is not an error: it tells the designer which step creates the missing input and stops.

## The five steps and their gates

| Step | Needs | Creates | Human approval |
|---|---|---|---|
| intake | nothing | `.motion/task.md` | no |
| plan | `task.md` | `.motion/plan.md`, `.motion/snapshots/project-map-*.json` | **yes**: `approved: true` + `plan_sha256` |
| build | `plan.md` with `approved: true` and a matching hash | `jsx/NN-*.jsx`, a new project copy in `work/`, `.motion/build.log.jsonl` | no |
| check | `build.log.jsonl` without errors | `.motion/check.md`, frames in `work/frames/` | **yes**: `approved: true` |
| deliver | `check.md` with `approved: true` | files in `work/out/`, `.motion/deliver.md` | no |

The human decides twice: after `plan` and after `check`. Nowhere else is an approval asked for.

## The gate command

Every step starts by running the gate and obeys its answer.

```
mf-gate require <step>        # step = plan | build | check | deliver
```

It prints one JSON object and exits 0 (go on) or 1 (refuse):

```
{ "ok": true,  "step": "build" }
{ "ok": false, "step": "build", "reason": "plan_not_approved", "missing": ".motion/plan.md", "create_with": "/motion-flow:plan" }
```

Reasons: `file_missing`, `task_not_ready`, `task_incomplete`, `plan_not_approved`, `plan_changed_after_approval`, `task_mismatch`, `build_log_missing`, `build_log_invalid`, `build_failed`, `check_not_approved`. `approve` can also refuse with `plan_incomplete` or `check_incomplete`: the artifact fails `mf-gate verify` (template text left, a criterion with no step or no evidence, a plan row with no frame, ...). The answer lists the failed items.
If `mf-gate` is not found, run `node "${CLAUDE_PLUGIN_ROOT}/bin/mf-gate"` instead.

Other commands used by the steps:

```
mf-gate hash plan             # prints the sha256 of the plan body (see below)
mf-gate approve plan          # writes approved: true, approved_at and plan_sha256 into plan.md
mf-gate approve check         # writes approved: true and approved_at into check.md
mf-gate status                # one-line state of every artifact
mf-gate verify <task|plan|check>   # structural self-check of an artifact; run before showing it
mf-gate archive [--abandon]   # move the finished (or dropped) task's artifacts to .motion/archive/ (see artifact-formats.md)
```

## Refusal text

When the gate says `ok: false`, tell the designer (in Ukrainian), short, in this shape, and stop. Do not try to do the missing step yourself and do not write any file.

```
Cannot start <step>: <what exactly is missing, in one sentence>.
Run this first:

/motion-flow:<the step that creates the missing file>
```

## The plan hash

`plan_sha256` is the SHA-256 of the plan body: everything after the closing `---` line of the frontmatter, line endings turned into `\n`, trailing whitespace at the end removed, encoded as UTF-8. Only the body counts, so changing `status` or `approved_at` in the frontmatter does not change the hash, but changing a step in the table does.

If the plan was edited after approval, `mf-gate require build` answers `plan_changed_after_approval`. Do not "fix" the hash. Tell the designer the plan changed and ask for a new approval: run `plan` again (it shows what changed and asks).

## Approval belongs to a person

- Ask for an approval only with `AskUserQuestion`, showing the plan (or the check result) and clear options such as "Approve" / "Change the plan".
- Run `mf-gate approve ...` only immediately after the designer answered "Approve" in that same step. Never approve on your own, never because the task "looks simple", never because a flow says so.
- `mf-gate approve` is the only thing that writes `status: approved`, `approved: true`, `approved_at` or `plan_sha256`. The guard hook blocks writing them with the file tools and asks the designer to confirm the `mf-gate approve` command itself, so expect one confirmation prompt after the designer's answer; that prompt is part of the approval, not an obstacle to work around.
- A flow cannot remove or weaken a gate (see `safety.md`).
- If the designer asks for changes, make them in the file, show the result, and ask again. Each new approval records the new hash.

## When something unexpected happens

A missing file, a broken link, an artifact that does not match its task id, a hash that does not match: stop and ask. Do not guess, do not continue "to see what happens".
