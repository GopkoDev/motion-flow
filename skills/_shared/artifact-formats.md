# Artifact formats

Every step writes one file that the next step reads. All of them live in the project's `.motion/` folder, except scripts (`jsx/`) and work files (`work/`). Templates are in the plugin's `templates/` folder; copy the template and fill it in, do not invent a new shape.

Frontmatter is flat `key: value` lines between two `---` lines. Lists use `[a, b]` on one line or `- item` lines. `null` means "not set yet". Dates are ISO 8601 (`2026-10-19T14:30:00Z`).

## Files

| File | Written by | Read by | Template |
|---|---|---|---|
| `.motion/task.md` | intake | plan | `templates/task.md` |
| `.motion/plan.md` | plan | build, check | `templates/plan.md` |
| `.motion/snapshots/project-map-<timestamp>.json` | plan | check | an `ae-dump` file |
| `jsx/NN-<name>.jsx` | build | build | none (see `ae-scripting.md`) |
| `.motion/build.log.jsonl` | **ae-run** (`--step N`), never by hand | check | format below |
| `.motion/check.md` | check | deliver | `templates/check.md` |
| `.motion/deliver.md` | deliver | the designer | `templates/deliver.md` |
| `.motion/changelog.md` | deliver | the designer | one line per delivered task: date, task id, what was delivered |
| `.motion/archive/<task id>/` | `mf-gate archive` | the designer | the artifacts of an earlier task |
| `.motion/overrides.md` | the designer / any step, with permission | all steps | `templates/overrides.md` |
| `.motion/state.json` | init-project, whats-new | whats-new, deliver | below |
| `.motion/drive.json` | init-project | drive-gate | `{"aliases": ["assets"]}` |

## task.md

Frontmatter: `id` (date + type + counter, for example `2026-10-19-resize-01`), `type` (`resize|new|edit|export|other`), `flow` (flow name or `null`), `status` (`draft|ready`), `inputs` (list of `alias` + `path`, or just `path` under `work/` in no-Drive projects), `deadline` (or `null`).
Body sections: `## Description`, `## Acceptance criteria`, `## Known facts and assumptions`, `## Open questions`.

**`## Acceptance criteria` is the contract of the whole task.** One line per criterion, `- AC1: <a result a person can see or measure>`, with numbers where possible ("the logo is 120 px wide in the top right", not "the logo looks good"). Ids are `AC1`, `AC2`, ... and never change once the plan is approved. The plan must cover every criterion with a step, and `check` must prove every criterion with evidence, so nothing the designer asked for can be forgotten and nothing nobody asked for gets built. The assumptions list comes from the Socratic loop. `status: ready` means the plan can start (the gate also runs `mf-gate verify task`).

## plan.md

Frontmatter: `task_id`, `status` (`draft|approved`), `approved_at`, `plan_sha256` (see `gating.md`), `project_copy` (the new copy in `work/`), `touches_protected` (`true|false`), `needs` (tools from `deps.json`, for example `[ffmpeg]`).
Body: `## Steps` (a table: `#`, target comp/layer/property, change, expected result, frame to check, `Criteria`), `## Not covered by the plan`, `## Risks`, `## Questions for the designer`.
`Criteria` lists the `AC` ids a step serves. Every step must serve at least one criterion (a step with none is a step nobody asked for), and every criterion of the task must be served by a step or be listed under `## Not covered by the plan` with the reason (write `- none` when everything is covered). The designer sees the uncovered list when approving.
`status` and `approved_at` are written only by `mf-gate approve plan`.

## build.log.jsonl

One JSON object per line, one line per script run, appended in order. **`ae-run ... --step N [--attempt M]` writes these lines itself** (also for runs that failed before reaching the script, such as a timeout), so the log records what really ran. The guard hook blocks writing the file by hand; never create or edit it.

```
{"ts": "2026-10-19T14:31:02Z", "step": 1, "script": "jsx/01-resize.jsx", "attempt": 1, "ok": true, "durationMs": 840, "result": {"changed": 3}}
{"ts": "2026-10-19T14:31:09Z", "step": 2, "script": "jsx/02-titles.jsx", "attempt": 1, "ok": false, "durationMs": 120, "error": "Layer not found: Headline"}
```

`attempt` counts retries of the same step. A line with `ok: false` that is not followed by a successful retry of the same step means the build failed; `check` refuses. Do not put client content into `result`: counts and names of what changed are enough.

## check.md

Frontmatter: `task_id`, `verdict` (`PASS|ISSUES`), `approved`, `approved_at`.
Body: `## Comparison with the plan` (table: `#`, expected, actual, verdict; one row per plan step), `## Acceptance criteria` (table: `AC`, `Evidence` = what the dump or frame shows with its file, `Verdict` = `PASS|FAIL|NOT_VERIFIED`; one row per criterion of the task), `## Lint` (the `ae-lint` result, summarised), `## Frames` (list of `work/frames/...` files that exist), `## Independent review` (what the independent pass found, or `not run: <reason>`), `## Open questions`. `verdict: PASS` only when every plan row and every criterion is `PASS`.
`approved` and `approved_at` are written only by `mf-gate approve check`, after the designer looked at the frames.

## deliver.md

Frontmatter: `task_id`, `status` (`delivered`), `delivered_at`.
Body: `## Files` (table: file in `work/out/`, size, sha256), `## Where to put them` (where the designer should put each file on Drive, from the studio's delivery rules; the agent never copies there), `## Open questions`.

## overrides.md

Exceptions to the studio rules for this project. One entry per exception: the rule, what is allowed instead, why, and who allowed it (a person, with the date). A step may use an override only if it is listed here.

## state.json

`{"last_seen_rules_version": "", "commit_artifacts": false}`. `commit_artifacts: true` lets steps commit the text artifacts in `.motion/` to the project's local git (never `.aep`, assets, renders; never push). Not committed itself.

## Snapshots

`plan` saves the project map before any change with `ae-dump --project <work copy> --out .motion/snapshots/project-map-<timestamp>.json`. `check` runs `ae-dump` again and lints the new dump against this snapshot (`ae-lint --baseline`), which is how protected comps are guarded.

## Starting a new task

`.motion/` holds one task at a time. Before a new task, run `mf-gate archive` (after `deliver`) or `mf-gate archive --abandon` (a task that is dropped, only if the designer says so). It moves `task.md`, `plan.md`, `build.log.jsonl`, `check.md`, `deliver.md` and `snapshots/` into `.motion/archive/<task id>/` and deletes nothing. `state.json`, `drive.json` and `overrides.md` stay. `mf-gate archive --park` sets an unfinished task aside (for example while a flow is rehearsed) and marks it; `mf-gate restore [<task id>]` puts it back byte for byte, refuses while another task is in `.motion/`, and without an id lists what can be restored. Do not use `mv` or `rm` for this; the guard hook blocks them.

## Structural self-check

`mf-gate verify <task|plan|check>` checks an artifact written by a step, from the file on disk, against a fixed list of structural items (required keys, no template text left, the criteria and their coverage, frames that exist, ...). It prints `self-check: N/N pass` or the failed items. Every step runs it before showing the artifact or asking for approval: fix what failed and run it again, at most twice; anything still failing is shown to the designer plainly, never hidden. `mf-gate approve` refuses an artifact that fails it.

## Rules

- An artifact belongs to the task named in its `task_id`. If a step finds an artifact with a different `task_id`, it stops and asks.
- A step never edits an artifact owned by an earlier step, except the human-approval fields through `mf-gate`. To change a plan, run `plan` again.
- Write the whole file at once; do not leave a half-written artifact.
