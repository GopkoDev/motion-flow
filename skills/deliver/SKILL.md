---
name: deliver
description: Prepare the final files of an approved task for handover. Use after the designer approved the check, or when the designer says "здай", "deliver", "підготуй фінал". Names files by the studio rules, gathers them in work/out/ with checksums, writes .motion/deliver.md and tells the designer what to copy to Drive and where. Never writes to Drive.
model: inherit
---

# deliver

Fifth step. Deliver turns the approved result into files ready for handover, names them by the studio rules, and records what was prepared. The designer copies the files to Drive; deliver never writes there.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/gating.md`, `safety.md`, `drive-access.md`, `artifact-formats.md` and `handoff.md`. Talk to the designer in Ukrainian.

## Steps

1. **Gate.** Run `mf-gate require deliver`. It refuses without an approved `check.md` or if the plan changed after approval. Give the refusal text from `gating.md` and stop.
2. **Read** `.motion/task.md`, `.motion/plan.md`, `.motion/check.md`, `.motion/overrides.md` and, from the studio rules, `delivery` and `naming` (and `drive`, for where files go). Note which of them are `status: draft`. If a delivery rule is missing, ask the designer instead of guessing a format.
3. **Decide what is delivered**, with `AskUserQuestion`, only about what the task and the rules do not already settle:
   - the project file (the result copy `project_copy`): usually yes;
   - still frames (the check frames or new ones): yes or no;
   - **a rendered video: ask the designer whether to render one.** If no, skip the video.
4. **Project file.** Name it by the naming rules (`aep-version work/<project_copy>` gives the next free version name). Copy the result copy into `work/out/` under that name with `cp`. Never overwrite a file that exists.
5. **Frames.** Copy the frames the designer wants into `work/out/`, named by the rules.
6. **Video, only if the designer said yes.**
   - If the command `ae-export` exists, use it with the settings from `delivery` (format, codec, size, audio) and write into `work/out/`.
   - Otherwise tell the designer, in Ukrainian, to export from After Effects themselves into `work/out/`: give the exact settings from the delivery rules, the file name to use, and the comp. Wait for them to say it is done. Then check the file: it exists, is not empty, and (if `ffprobe` is installed) its size, duration, codec and audio match the rules. Report any difference; do not change the file.
7. **Checksums.** `mf-sum work/out/<file> ...` gives size and sha256 of every delivered file.
8. **Write `.motion/deliver.md`** from `${CLAUDE_PLUGIN_ROOT}/templates/deliver.md`: `task_id`, `status: delivered`, `delivered_at` (now, ISO 8601), the file table (name, size, sha256), and `## Куди покласти`: for each file, the Drive folder from the delivery or drive rules (an alias and a relative path, never a machine path). Add open items.
9. **Changelog.** Append one line to `.motion/changelog.md` (create it if it does not exist): date, task id, what was delivered.
10. **Local commit, only if enabled.** If `.motion/state.json` has `"commit_artifacts": true` and the project is a git repository, commit the text artifacts of this task (`.motion/task.md`, `plan.md`, `check.md`, `deliver.md`, `changelog.md`) with a message naming the task id. Never add `work/`, `.aep` files, media or renders. Never push.
11. **Hand off** (`handoff.md`): the files in `work/out/`, the Drive folders to copy them to (by the designer, by hand), `.motion/deliver.md`. Next command: `/motion-flow:intake` for the next task (it archives this one first).

## Rules

- Never write, copy or move anything on Drive. Only describe where files go.
- Never deliver a file that was not checked: deliver only what the approved `check.md` covered, or tell the designer what is new.
- Never overwrite an earlier delivered file; always use a new version name.
- If a delivery rule cannot be met (a format the tools cannot produce), say so and ask; do not deliver something else silently.
