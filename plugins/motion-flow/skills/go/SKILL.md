---
name: go
description: Run a whole motion task from one command. Use when the designer says "go", "do it", "make it" with a job description, or wants to continue an unfinished task. On the first run in a project it asks once about Google Drive, the studio and the mode (ask or auto), remembers the answers, then runs intake, plan, build, check and deliver. In ask mode it stops at the two approvals; in auto mode it asks nothing and approves its own plan and check.
model: inherit
---

# go

One command for the whole pipeline: `intake` → `plan` → `build` → `check` → `deliver`. The designer types `/motion-flow:go <the job>` in the project folder and nothing else. `go` sets the project up the first time, remembers the choices, finds where the task stands, and runs the next steps without waiting for the designer to type the next command. The steps are the existing skills; `go` chains them and applies the mode.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/gating.md`, `safety.md` and `handoff.md`. Talk to the designer in Ukrainian.

## What is remembered in the project

| Choice | Where it lives | Set by |
|---|---|---|
| Google Drive folders this project may read | `.motion/drive.json` | `mf-init --drive` / `--no-drive` |
| Studio (rules folder) | `.motion/studio.json` | `mf-init --studio <name>` / `--no-studio` |
| Mode: ask or auto | `.motion/auto.json` (present = auto) | `mf-gate auto on` / `off` |
| Where the task stands | `.motion/*.md`, `build.log.jsonl` | the steps; read with `mf-gate status` |

## The modes

- **ask**: each step runs exactly as its own skill says. The designer answers the questions and approves the plan and the check.
- **auto**: no questions and no approvals. The agent picks sensible defaults, writes them as assumptions in `task.md`, approves its own plan and check with `mf-gate approve ... --auto`, and delivers. The designer reads the result at the end.

Auto mode is the designer's explicit choice, made once for the project: the answer to the question below, plus the Claude Code confirmation prompt that `mf-gate auto on` shows. Every safety rule stays in both modes: work only on copies in `work/`, Drive read-only through `drive-gate`, the script policy of `ae-run`, the guard hook, and the gates in `mf-gate` (`verify`, the plan hash, the build log).

## Steps

1. **Is the project set up?** It is when `.motion/` and `.claude/settings.json` exist.
   - **Not set up (first run).** Ask all three questions in one `AskUserQuestion` call, in Ukrainian, as the designer sees them together:
     1. Google Drive: no Drive (default), or which of the computer's Drive folders this project may read (`mf-setup --show`; if the computer has none, only offer "no Drive" and mention `/motion-flow:setup` for later).
     2. The studio: none (default), or one of the studios found by `mf-studio list` (folders in the studios folder). If none are found, offer only "none" and say that `/studio-builder:learn-studio` creates a studio.
     3. Mode: **ask** (default; the agent asks and waits for your approval of the plan and the result) or **auto** (no questions and no approvals; the agent approves its own plan and result).

     Then follow `${CLAUDE_PLUGIN_ROOT}/skills/init-project/SKILL.md` from its preview step with these answers (`mf-init --dry-run`, then `mf-init`), and tell the designer in a short block what was created. If `mf-init` refuses (the folder is inside Drive), give its message and stop. For auto, run `mf-gate auto on`; tell the designer first that its confirmation prompt is what switches auto mode on. If they decline, the project stays in ask mode and you say so.
   - **Already set up (continuing or a new task).** Do not ask these again. Read the choices (`mf-gate status` for the mode, `.motion/drive.json`, `.motion/studio.json`) and say them to the designer in one line in Ukrainian (mode, Drive folders, studio). To change one, the designer says so (for example "switch to ask mode", "turn Drive on"): then use `mf-gate auto off|on`, or `mf-init --drive ... / --studio ...` as `init-project` describes.
2. **Find the stage.** Run `mf-gate status` and take the first row that fits:

   | State | Do |
   |---|---|
   | no task, or the task is delivered | start a new task: `intake` with the job from the arguments (archive the old one first, as `intake` says). If the arguments are empty, ask what the job is. |
   | `task` is `draft` or `missing` | `intake` |
   | `task` is `ready`, `plan` is `missing`, `draft` or `changed_after_approval` | `plan` |
   | `plan` is `approved`, `build` is `missing`, `empty` or `failed` | `build` |
   | `build` is `ok`, `check` is `missing` or not approved | `check` |
   | `check` is approved, `deliver` is `missing` | `deliver` |

   When a task is unfinished and the arguments describe a different job, ask whether to continue the old task or set it aside (as `intake` says).
3. **Run the stage by following that skill's SKILL.md** (read it now, do not rely on memory), then move to the next row until `deliver` is done or something stops the run. Each skill starts with its own gate (`mf-gate require ...`).
4. **Auto mode changes only these points of the steps:**
   - `intake`: ask nothing. Pick defaults for formats, sizes and the like, and write each one under `## Known facts and assumptions`. The independent pass still runs; resolve every finding yourself by the most literal reading and record it as an assumption. Skip the final "Is this right?" question. Do stop and ask when a required input file does not exist, because it cannot be invented.
   - `plan`: show the plan, then run `mf-gate approve plan --auto` instead of asking. If it refuses with `auto_needs_human` (the plan touches protected items), ask the designer as in ask mode.
   - `build`: unchanged. After the allowed retries stop and report; do not improvise.
   - `check`: show the tables and frames, then run `mf-gate approve check --auto` when the verdict is `PASS`. When it is `ISSUES`, fix them by going back to `build` for the failed step (or to `plan` if the plan is wrong) at most twice; if issues remain, stop and tell the designer, since `--auto` refuses `ISSUES` with `auto_needs_human`.
   - `deliver`: do not ask what to deliver: deliver the project file and the check frames; render no video unless the task asks for one.
5. **Stop** only for what a step says must stop it: a refused gate, an error after the retries, a missing file, a protected item, an unanswered question in ask mode, or the two approvals in ask mode. Say plainly what stopped the run and the exact answer that continues it; running `/motion-flow:go` again resumes from the saved state.
6. **Finish** with the handoff block (`handoff.md`) of the last step. In auto mode also list, in one short block, what was decided on the designer's behalf: the assumptions from `task.md`, "plan approved automatically", "check approved automatically", and where to look (`.motion/plan.md`, `.motion/check.md`, `work/frames/`, `work/out/`).

## Never

- Never write `approved`, `status: approved`, `plan_sha256` or `approved_at` yourself, and never write `.motion/auto.json`; only `mf-gate` does.
- Never use `--auto` unless `mf-gate status` shows `mode: auto`. The gate refuses it otherwise.
- Never skip a step or its gate to save time; auto mode changes who approves, not what is checked.
- Never ask the first-run questions again for a project that is already set up.
