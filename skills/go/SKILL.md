---
name: go
description: Run a whole motion task from one command. Use when the designer says "go", "do it", "make it" with a job description, or wants to continue an unfinished task. Sets up the project if needed, then runs intake, plan, build, check and deliver one after another. In ask mode (the default) it interviews the designer and stops at the two approvals; with "auto" it asks nothing and approves its own plan and check.
model: inherit
---

# go

One command for the whole pipeline: `intake` → `plan` → `build` → `check` → `deliver`. `go` decides where the task stands, does the next step, and goes on to the following one without waiting for the designer to type the next command. The steps are the existing skills; `go` only chains them and sets the mode.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/gating.md`, `safety.md` and `handoff.md`. Talk to the designer in Ukrainian.

## Modes

- **ask** (default, `/motion-flow:go <job>`): each step runs exactly as its own skill says. The designer answers the questions and approves the plan and the check. Between the approvals nothing stops the run.
- **auto** (`/motion-flow:go auto <job>`): no questions and no approvals. The agent decides sensible defaults, writes them as assumptions in `task.md`, approves its own plan and check with `mf-gate approve ... --auto`, and delivers. The designer reads the result at the end.

Auto mode is the designer's explicit choice, made once per task: `mf-gate auto on` shows a Claude Code confirmation prompt that says so. It is switched off when the task is archived. Every safety rule stays: work only on copies in `work/`, Drive read-only through `drive-gate`, the script policy of `ae-run`, the guard hook. The gates in `mf-gate` still run (`verify`, the plan hash, the build log).

## Steps

1. **Read the mode** from the arguments: the word `auto` means auto mode, anything else is ask mode. The rest of the arguments is the job description (it may be empty).
2. **Set up the project if needed.** If `.motion/` or `.claude/settings.json` is missing, run `mf-init --no-drive --no-rules` (fallback: `node "${CLAUDE_PLUGIN_ROOT}/bin/mf-init" ...`). It asks nothing and never overwrites. Tell the designer in one line what was created. Drive and studio rules are not needed for a first run; if the job names Drive files or a studio, say that `/motion-flow:init-project` connects them and stop. If `mf-init` refuses (the folder is inside Drive), give its message and stop.
3. **Switch auto mode on or off.**
   - Auto: run `mf-gate auto on`. Tell the designer (before the prompt appears) that this confirmation lets the agent approve its own plan and check for this task. If they decline, continue in ask mode and say so.
   - Ask mode on a task that is in auto mode (`mf-gate status` shows `mode: auto`): keep the mode only if the designer wrote `auto`; otherwise run `mf-gate auto off`.
4. **Find the stage.** Run `mf-gate status` and take the first row that fits:

   | State | Do |
   |---|---|
   | no task, or the task is delivered | start a new task: `intake` (archive the old one first, as `intake` says) |
   | `task` is `draft` or `missing` | `intake` |
   | `task` is `ready`, `plan` is `missing`, `draft` or `changed_after_approval` | `plan` |
   | `plan` is `approved`, `build` is `missing`, `empty` or `failed` | `build` |
   | `build` is `ok`, `check` is `missing` or not approved | `check` |
   | `check` is approved, `deliver` is `missing` | `deliver` |

5. **Run the stage by following that skill's SKILL.md** (read it now, do not rely on memory), then move to the next row until `deliver` is done or something stops the run. Start each skill's own gate (`mf-gate require ...`) as it says.
6. **Auto mode changes only these points of the steps:**
   - `intake`: ask nothing. Pick defaults for formats, sizes and the like, and write each one under `## Known facts and assumptions`. The independent pass still runs; resolve every finding yourself by the most literal reading and record it as an assumption. Skip the final "Is this right?" question. Do stop and ask when a required input file does not exist, because it cannot be invented.
   - `plan`: show the plan, then run `mf-gate approve plan --auto` instead of asking. If it refuses with `auto_needs_human` (the plan touches protected items) ask the designer as in ask mode.
   - `build`: unchanged. After the allowed retries stop and report; do not improvise.
   - `check`: show the tables and frames, then run `mf-gate approve check --auto` when the verdict is `PASS`. When it is `ISSUES`, fix them by going back to `build` for the failed step (or to `plan` if the plan is wrong) at most twice; if issues remain, stop and tell the designer, since `--auto` refuses `ISSUES` with `auto_needs_human`.
   - `deliver`: do not ask what to deliver: deliver the project file and the check frames; render no video unless the task asks for one.
7. **Stop** only for what a step says must stop it: a refused gate, an error after the retries, a missing file, a protected item, an unanswered question in ask mode, or the two approvals in ask mode. Say plainly what stopped the run and the exact answer or command that continues it; running `/motion-flow:go` again resumes from the saved state.
8. **Finish** with the handoff block (`handoff.md`) of the last step. In auto mode also list, in one short block, what was decided on the designer's behalf: the assumptions from `task.md`, "plan approved automatically", "check approved automatically", and where to look (`.motion/plan.md`, `.motion/check.md`, `work/frames/`, `work/out/`).

## Never

- Never write `approved`, `status: approved`, `plan_sha256` or `approved_at` yourself, and never write `.motion/auto.json`; only `mf-gate` does.
- Never use `--auto` unless the designer chose auto mode in this task. The gate refuses it otherwise.
- Never skip a step or its gate to save time; auto mode changes who approves, not what is checked.
