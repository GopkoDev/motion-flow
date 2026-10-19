# TASKS: Motion Flow implementation plan

Specification: `docs/motion-flow-spec.md`. Reference repos: `_temp/repos/`. Diagrams: `_temp/motion-flow-diagram.md`. The original Ukrainian spec and task list are kept in `_temp/uk/`. `_temp/` is local to the maintainer's machine and gitignored: it is not part of the repository.

## How to use

1. Take tasks **from top to bottom**. Do not start a task until its dependencies are marked `[x]`.
2. One task equals one Claude Code session. Run `/clear` between tasks.
3. To start: copy the task's "Prompt" block into a new session.
4. A task is closed when every "Acceptance" item is met. Mark `[x]` and commit.
5. Tasks marked **[HUMAN]** cannot be done by Claude (they need AE or a designer). They are checkpoints.
6. Tasks marked **[REVIEW]** are run through `/code-review` or `/security-review`.
7. Complex tasks (marked **plan first**) start with a plan: "show the plan first, code after my OK".

Script language: **Node.js >=24 (LTS)** (ESM, `.mjs`, built-in modules only, tests through `node:test`, run with `node --test`). No Python. See item 11 of section 1 of the spec.

Repo layout assumption: this repo (`motion-flow`) is the universal plugin. The marketplace (`.claude-plugin/marketplace.json`) lives in this same repo (a self-marketplace, `source: "./"`); there is no separate `motion-marketplace` for now; `<studio>-rules` is a separate repo, added to the catalog later.

**Mandatory before every task:** read (read-only) the reference repos named for it in the task or in the spec ("Taken from"), check their licenses, and in the task summary write exactly what was taken from them (ideas in your own words, no code copied). Write plugin files in **English**; Ukrainian only in the chat (enforced by `scripts/language.test.mjs`).

Common preamble for every prompt: "Read `docs/motion-flow-spec.md` sections 0, 1, 9 and the sections named in the task. Do not depart from the decisions already taken. Do not copy code from `_temp/repos/` verbatim, check the license."

---

## M0. Skeleton

- [x] **T0.1 Three repos and manifests**
  - Dependencies: none.
  - Prompt: "Create the skeleton of the `motion-flow` plugin in this repo per section 2 and 4.1: `.claude-plugin/plugin.json`, empty folders `skills/`, `hooks/`, `bin/`, `lib/jsx/`, `templates/`, `evals/`, `scripts/`, `NOTICE` (a mention of Kyrylo Genkov, SDD, MIT), `LICENSE`, `README.md`. Separately prepare in `../motion-marketplace` the marketplace skeleton per section 5.1 and in `../studio-rules` per section 10 (empty files with frontmatter). Do not push."
  - Acceptance: the structure matches section 2; the manifests are valid JSON.
  - Note: later the separate repos were dropped (spec section 16.1) and `LICENSE` was removed (no license chosen yet).

- [x] **T0.2 Check the schemas against the documentation**
  - Dependencies: T0.1.
  - Prompt: "Check against the current Claude Code documentation the schemas of `plugin.json`, `marketplace.json`, `hooks.json`, `settings.json` (the keys `extraKnownMarketplaces`, `enabledPlugins`, `permissions.deny`) and the frontmatter format in `SKILL.md`. Write the result into `docs/schemas-notes.md` with links and fix the manifests from T0.1 if they differ."
  - Acceptance: the note exists; every **[verify]** item in sections 4.1, 4.20, 5.1, 11 is closed or explicitly marked open.

- [x] **T0.3 `validate_plugin.mjs` (basic version)**
  - Dependencies: T0.2.
  - Prompt: "Implement `scripts/validate_plugin.mjs` per 4.27 with tests (`node:test`). At this stage it checks: manifest validity, the presence of `name`, `description`, `model` in every `SKILL.md`, and that references to `_shared/*.md` resolve. The remaining checks (gating, the ban on `put`) come later. Compare the idea of the invariants with `_temp/repos/genkovich__sdd/scripts/validate_plugin.py`, but write your own."
  - Acceptance: the tests pass; the validator is green on the skeleton; a deliberately broken manifest gives an error.

- [x] **T0.4 [HUMAN] Install the local marketplace**
  - Dependencies: T0.3.
  - Action: `/plugin marketplace add <local path to motion-flow>` and install the plugin `motion-flow@motion` (`studio-rules` comes later).
  - Acceptance: the plugins install without errors.

---

## M1. Safety and Drive

- [x] **T1.1 `drive-gate`** (plan first)
  - Dependencies: T0.1.
  - Prompt: "Implement `bin/drive-gate` per section 6 and 4.21: the commands `ls`, `info`, `fetch`, `log`, the config `~/.motion-flow/roots.json`, the log `~/.motion-flow/drive-gate.log`. Node.js (ESM) with no external dependencies, built-in modules only. There must be no write/delete/move commands. Write the tests in task T1.2, not here."
  - Acceptance: all commands work on a temporary folder; writing only in `work/`; invariants 1–5 of section 6 are enforced in code.

- [x] **T1.2 `drive-gate` tests**
  - Dependencies: T1.1.
  - Prompt: "Write `node:test` tests for `bin/drive-gate` from the list in section 6: an escape through `../`, a symlink pointing outward, an unknown alias, a file without permissions, zero size (a stream placeholder), a large file, `fetch` does not change the original (mtime and checksum), no writes outside `work/`. Write the tests from the specification and do not fit them to the code; if you find a defect in the code, fix it and describe it."
  - Acceptance: all tests pass.

- [x] **T1.3 [REVIEW] Security review of `drive-gate`**
  - Dependencies: T1.2.
  - Action: `/security-review`. Separately try to bypass the allowlist (path encoding, `~`, variables, spaces, Unicode).
  - Acceptance: the bypasses found are fixed and covered by tests.

- [x] **T1.4 `hooks/guard.mjs` and `hooks.json`** (plan first)
  - Dependencies: T0.2, T1.1.
  - Prompt: "Implement `hooks/guard.mjs` and `hooks/hooks.json` per 4.20: PreToolUse for `Read`, `Write`, `Edit`, `Bash`. It blocks paths inside the roots from `~/.motion-flow/roots.json`, `rm`/`mv` outside `work/`, `git push`, `git reset --hard`, `git clean -fd`, `git checkout --force`, and a direct launch of AE/ExtendScript (`afterfx`, `osascript` with `DoScriptFile`, `aerender`) outside `ae-run`/`ae-dump`/`ae-render-frame`. Clear refusal messages. Tests (`node:test`) for every rule, including workaround forms of the commands."
  - Acceptance: the tests pass; the hook really fires in Claude Code (check by hand with one forbidden command).

- [x] **T1.5 Project `settings.json` template**
  - Dependencies: T0.2, T1.4.
  - Prompt: "Create `templates/settings.project.json` and `templates/gitignore.project` per section 11: marketplace, enabledPlugins, `permissions.deny` (direct Read/Write/Edit on the Drive path, `trash_file`, `update_file`, `share_file`, dangerous git commands). Add `templates/roots.example.json`."
  - Acceptance: the JSON is valid, the schema matches the T0.2 note.

- [x] **T1.6 `deps.json` and the `doctor` skill**
  - Dependencies: T1.1, T1.5.
  - Prompt: "Implement `deps.json` (4.24) and `skills/doctor/SKILL.md` (4.18) with a helper check script. An ok/missing/old-version table; install commands for macOS and Windows; installs nothing; the `--flow` flag. It also checks the `drive-gate` config, the deny rules, the plugin versions. The `ae-run --ping` check is added after T2.2."
  - Acceptance: the check script has tests for parsing `deps.json` and comparing versions; `doctor` changes nothing on disk.

- [x] **T1.8 `init-project`**
  - Dependencies: T1.5, T1.6.
  - Prompt: "Implement `bin/mf-init` and `skills/init-project/SKILL.md`: from the templates it creates in the project folder `.claude/settings.json` (Drive paths from `~/.motion-flow/roots.json`), `CLAUDE.md`, `.gitignore` lines, `.motion/state.json`, `work/`. It overwrites nothing, has a `--dry-run` mode, refuses inside a Drive folder. `doctor` recommends this skill when `settings.json` is missing."
  - In addition: `bin/mf-setup` and `skills/setup/SKILL.md` (once per computer: which Drive folders are available, `~/.motion-flow/roots.json`; needed only by those who use Drive). The Drive choice is made **per project**: `.motion/drive.json` (`{"aliases": [...]}`, no file or empty = no Drive), `mf-init --drive a,b` / `--no-drive`. `drive-gate` uses only the folders enabled in the project. `guard` asks for confirmation when an existing computer config or a project's Drive choice is changed.
  - Acceptance: the tests pass; a second run changes nothing; the result passes the `doctor` check.

- [x] **T1.7 [HUMAN] M1 checkpoint**
  - Action: try to make the agent read a Drive path directly; run `doctor`.
  - Acceptance: direct reading is blocked; `doctor` shows a correct table.

---

## M2. Running JSX in AE

- [x] **T2.1 `lib/jsx/`**
  - Dependencies: T0.1.
  - Prompt: "Write `lib/jsx/helpers.jsx` (undo group, find a layer by name, read `.in.json`, write `.out.json`, error handling, no dialogs) and `lib/jsx/dump.jsx` (a dump per the schema of section 7). For reference see `_temp/repos/kumoproductions__mcp-aftereffects` and `_temp/repos/TheLlamainator__after-effects-mcp`; do not copy code verbatim. ES3-compatible ExtendScript syntax (no `let`/`const`/arrows)."
  - Acceptance: the files exist; a static review for ES3 compatibility; running in AE is moved to T2.9.

- [x] **T2.2 `ae-run`** (plan first)
  - Dependencies: T1.4.
  - Prompt: "Implement `bin/ae-run` per 4.22a and section 7: `--ping`, `--project`, `--script`, `--undo`, `--timeout`; `work/.ipc/<id>.in.json`/`.out.json`; a lock file; paths only in `work/`; launch through Windows `afterfx.exe -r` or macOS `osascript` with `DoScriptFile`. Isolate the launch mechanism in one module so tests can swap in a stub. Unit tests: arguments, rejecting paths outside `work/`, timeout, lock file, building the IPC files, clear errors."
  - Acceptance: the tests pass without AE; a second simultaneous run refuses; a path outside `work/` is rejected.

- [x] **T2.3 [REVIEW] Security review of `ae-run`**
  - Dependencies: T2.2.
  - Action: `/security-review`. Check injections in the arguments, a `work/` bypass, symlinks.
  - Acceptance: what is found is fixed and covered by tests.

- [x] **T2.4 `ae-dump` and `ae-render-frame`**
  - Dependencies: T2.1, T2.2.
  - Prompt: "Implement `bin/ae-dump` and `bin/ae-render-frame` as thin wrappers over `ae-run` (4.22a, section 7). Tests without AE on the arguments and on building the calls."
  - Acceptance: the tests pass.

- [x] **T2.5 `aep-version`**
  - Dependencies: T0.1.
  - Prompt: "Implement `bin/aep-version` per 4.22 with tests: `project_v03.aep` to `project_v04.aep`, never overwriting existing files, the version regular expression from a config."
  - Acceptance: the tests pass.

- [x] **T2.6 Dump fixtures**
  - Dependencies: T2.1 (the dump schema).
  - Prompt: "Create several synthetic JSON dumps in `evals/fixtures/` per the schema of section 7: a normal project, a project with missing media, with default layer names (\"Shape Layer 1\"), with a wrong fps, with a `protected` violation. Do not use real client data."
  - Acceptance: all fixtures are valid against the schema.

- [x] **T2.7 `ae-lint`**
  - Dependencies: T2.6.
  - Prompt: "Implement `bin/ae-lint` per 4.23: input a dump + `rules/checks/`, output a JSON list of violations. Declarative checks (fps, name regex, missing fonts/media, default names, protected). No dependencies. Tests on the T2.6 fixtures with expected results."
  - Acceptance: the tests pass without AE.

- [x] **T2.8 `_shared/ae-scripting.md`**
  - Dependencies: T2.1.
  - Prompt: "Write `skills/_shared/ae-scripting.md` per 4.7: idempotency, finding a layer by name, undo group, the result into a file, no dialogs, short runs, common ExtendScript pitfalls (UI blocking, layer indexes, `setValueAtTime` versus `setValuesAtTimes`)."
  - Acceptance: the file is written, references to it from `validate_plugin.mjs` resolve.

- [ ] **T2.9 [HUMAN] M2 checkpoint on a machine with AE**
  - Action: `ae-run --ping`, `ae-dump` on a copy of a real project, `ae-run` with a test script on the copy, `ae-render-frame`. Check the behavior when AE is already running (section 13, item 3) and the "Allow Scripts to Write Files and Access Network" setting.
  - Acceptance: everything works on a real AE version; findings are written into a note for fixes.
  - Status: deferred until a machine with After Effects is available (cases in `_temp/manual-test-cases.md`).

- [x] **T2.10 Extend `doctor` with the `ae-run --ping` check**
  - Dependencies: T1.6, T2.2.

---

## M3. Five steps

- [x] **T3.1 `_shared/*` and `templates/`**
  - Dependencies: T0.3.
  - Prompt: "Write `skills/_shared/gating.md`, `handoff.md`, `socratic-loop.md`, `safety.md`, `artifact-formats.md`, `drive-access.md` (4.2–4.8) and the templates `templates/task.md`, `plan.md`, `check.md`, `deliver.md`, `overrides.md`, `flow.md`, `flow-SKILL.md` per section 8. For reference `_temp/repos/genkovich__sdd/skills/_shared/`; write in your own words."
  - Acceptance: all templates have correct frontmatter; the validator is green.

- [x] **T3.2 Gating check script**
  - Dependencies: T3.1.
  - Prompt: "Write the helper script `bin/mf-gate` (the hash of the `plan.md` body, the `approved` check, the `check.md` check) with tests per section 3: a missing file, not approved, changed after approval. Skills will call it so that gating is code, not only text."
  - Acceptance: the tests pass.

- [x] **T3.3 The `intake` skill**
  - Dependencies: T3.1.
  - Prompt: "Implement `skills/intake/SKILL.md` per 4.9."
  - Acceptance: the validator is green; a manual run produces a correct `task.md`.

- [x] **T3.4 The `plan` skill**
  - Dependencies: T3.2, T3.3, T2.4, T2.8.
  - Prompt: "Implement `skills/plan/SKILL.md` per 4.10. Approval only through `AskUserQuestion`, `plan_sha256` is computed by `mf-gate`."
  - Acceptance: the validator is green; refuses without `task.md`.

- [x] **T3.5 The `build` skill**
  - Dependencies: T3.2, T3.4, T2.2, T2.5.
  - Prompt: "Implement `skills/build/SKILL.md` per 4.11. A `mf-gate` check before starting. The log in `build.log.jsonl`, stop at the first error, N retries."
  - Acceptance: refuses without approval; refuses when the plan changed.

- [x] **T3.6 The `check` skill**
  - Dependencies: T3.5, T2.7.
  - Prompt: "Implement `skills/check/SKILL.md` per 4.12."
  - Acceptance: the validator is green; refuses without a clean `build.log.jsonl`.

- [x] **T3.7 The `deliver` skill**
  - Dependencies: T3.6, T2.5.
  - Prompt: "Implement `skills/deliver/SKILL.md` per 4.13."
  - Acceptance: refuses without an approved `check.md`.

- [x] **T3.8 Extend `validate_plugin.mjs`**
  - Dependencies: T3.3–T3.7.
  - Prompt: "Add to the validator the checks from 4.27: every skill that consumes an artifact contains a gating call; no skill mentions `put`/delete on Drive; the validity of `deps.json` and the template frontmatter. Tests."
  - Acceptance: the validator is green on the whole plugin.

- [ ] **T3.9 [HUMAN] M3 checkpoint**
  - Action: one real simple task (a resize) from `intake` to `deliver`; an attempt at `build` without approval; a change of `plan.md` after approval.
  - Acceptance: per the M3 criteria in section 12.
  - Status: deferred until a machine with After Effects is available.

---

## M3a. Accepting the task and checking the result (from the comparison with the references)

The comparison with `motion-design-with-claude`, aedev-tools, SDD and `skill-creator` showed gaps in `intake` and `check`. Items 1–3 are done, the rest wait.

- [x] **T3.10 Acceptance criteria and end-to-end tracing**
  - Dependencies: T3.3–T3.6.
  - Done: `## Acceptance criteria` in `task.md`; a "Criteria" column and a "Not covered by the plan" section in `plan.md`; a table of criteria with evidence in `check.md`; `intake` agrees the criteria, `plan` covers every criterion and has no step without a criterion, `check` traces every criterion to evidence.
  - Acceptance: `mf-gate verify plan` refuses if a criterion has no step, a step has no criterion, or a row has no frame; `verify check` refuses `PASS` without evidence.

- [x] **T3.11 Independent pass**
  - Done: `skills/_shared/independent-review.md` (prompts for `intake` and `check`, sub-agent rules); `intake` after writing `task.md` and `check` after its own comparison run a sub-agent without history; the result goes into `## Independent review`; the validator requires this of both skills.

- [x] **T3.12 `mf-gate verify` and the self-check line**
  - Done: `mf-gate verify <task|plan|check>`, `require plan` → `task_incomplete`, `approve` checks the artifact, the line `self-check: N/N pass` is mandatory in the handoff; the validator requires `mf-gate verify` in `intake`, `plan`, `check`.

- [x] **T3.18 A clean-context reviewer agent for `check`**
  - Dependencies: T3.11.
  - Done: `agents/check-reviewer.md` (`motion-flow:check-reviewer`), read-only (Read, Grep, Glob), modelled on the `agents/reviewer` of SDD in our own words; `check` dispatches it with file paths only; `validate_plugin.mjs` checks agent frontmatter, read-only tools and the dispatch.

- [ ] **T3.13 Machine warnings about motion quality in `ae-lint`**
  - Dependencies: T2.7, T3.12.
  - Prompt: "Add to `ae-lint` check types based on motion-quality diagnostics (warnings only): linear interpolation on the first and last keys, all layers start and end on the same frames, the same duration in all animations, `wiggle` without meaningful parameters, entrance through opacity only. Examples in `templates/studio-rules/rules/checks/_examples/`. Tests on fixtures. Do not copy the reference texts, write in your own words."

- [ ] **T3.14 `matchName` in the dump**
  - Dependencies: T2.1.
  - Prompt: "In `lib/jsx/dump.jsx` replace the `expressions` and `keyframes` keys (now built from display names, which depend on the AE language) with keys built from `matchName`; update the schema, fixtures, `ae-lint` and tests. Add the display names as a separate field for a person."

- [ ] **T3.15 A pitfalls reference and a library of idempotent templates for `build`**
  - Dependencies: T2.8, T2.9.
  - Prompt: "Add to `skills/_shared/ae-scripting.md` a list of pitfalls and an error triage (writing at a split position, ES3: a chain of ternaries evaluated left to right, shape-layer `Contents`, a 3D layer, localized render templates, locked properties, disabled expressions, \"nothing changed\", duplicates on a repeat) and add to `lib/jsx/` verified templates `ensureLayer`, `ensureEffect`, `setKeyframes` (`setValuesAtTimes`), a safe `setEase`. Without deleting content. Verify on a real AE (T2.9)."

- [ ] **T3.16 Destructive steps and stale state**
  - Dependencies: T3.4, T3.5.
  - Prompt: "In `plan.md` add a \"Destructive\" column (deleting layers, removing keys, replacing footage, clearing expressions, the render queue) that is visible at approval; in `build`, before a step, compare with the previous step's dump and ask when the designer made manual changes. Update `mf-gate verify plan` and the tests."

- [ ] **T3.17 References and question quality in `intake`**
  - Dependencies: T3.3.
  - Prompt: "In `intake` accept a reference image or video (a path in `work/`, a direction, not pixel for pixel) and strengthen the wording of the questions: in each option explain what happens next and the hidden downside; ask only blocking facts (size, fps, duration, source). Evaluate the change on a real task (T3.9)."
  - Status: partly done with T3.10 (spec 16.6): `intake` takes a reference as direction and asks only blocking facts. Left: the option wording (what happens next, the hidden downside) and the evaluation on a real task.

---

## M4. Studio rules

- [x] **T4.1 The `studio-rules` scaffold**
  - Dependencies: T3.1.
  - Prompt: "In `../studio-rules` create the index skill `skills/studio-rules/SKILL.md` and empty templates `rules/*.md` with `status: draft` per section 10 and `templates/rules/`."
  - Note: later moved into `templates/studio-rules/` (spec section 16.1).

- [x] **T4.2 The `init-rules` skill**
  - Dependencies: T4.1, T1.1, T2.4.
  - Prompt: "Implement `skills/init-rules/SKILL.md` per 4.17."

- [x] **T4.3 `draft` warnings in the skills**
  - Dependencies: T4.1.
  - Prompt: "Add to `plan`, `build`, `check`, `deliver` the behavior: if a rule has `status: draft`, warn. Update `validate_plugin.mjs`."

- [ ] **T4.4 [HUMAN] M4 checkpoint**
  - Action: `init-rules` on 1–2 real projects; the designer confirms the rules.
  - Status: deferred until a machine with After Effects is available.

---

## M5. Flows

- [x] **T5.1 The `new-flow` skill** (plan first; the plan was approved with additions: safe parking of the task, examples as anonymous notes, a draft in the designer's language, the final in English, `mf-flow check`)
  - Dependencies: T4.2, T3.7.
  - Prompt: "Implement `skills/new-flow/SKILL.md` per 4.14. For reference `_temp/repos/anthropics__skills` (skill-creator)."

- [x] **T5.2 The `refine-flow` skill**
  - Dependencies: T5.1.
  - Prompt: "Implement `skills/refine-flow/SKILL.md` per 4.15."

- [x] **T5.3 The `publish-flow` skill**
  - Dependencies: T5.1.
  - Prompt: "Implement `skills/publish-flow/SKILL.md` per 4.16 and a check that the flow does not weaken `safety.md`."

- [x] **T5.4 The `whats-new` skill** (optional)
  - Dependencies: T4.1.
  - Prompt: "Implement `skills/whats-new/SKILL.md` per 4.19."

- [ ] **T5.5 [HUMAN] M5 checkpoint**
  - Action: a designer creates a flow from two examples on their own, a dry run, the package in `_flows-pending/`, review.
  - Status: deferred until a machine with After Effects is available.

---

## M6. Pilot

- [ ] **T6.1 Evals**
  - Dependencies: M3–M5.
  - Prompt: "Create `evals/` per 4.28: description-trigger tests (a phrase, which skill/flow must start), gathering all tests into one run."

- [x] **T6.2 Documentation for designers (in English) and translation of the tasks**
  - Prompt: "Write the guide for designers per 5.2 as a section of the `README.md` of the `motion-flow` repo **in English** (the README is in English) and a short `CLAUDE.md` for the project per section 11. During this work **translate `TASKS.md` into English** (the whole file, including the \"How to use\" note); the specification (`motion-flow-spec.md`) stays in Ukrainian or is translated by a separate command."
  - Done: `README.md` rewritten in English (cover image, mermaid diagrams, install, setup, command reference, folder structure); the spec and this file translated into English and moved to `docs/`; the Ukrainian originals are kept in `_temp/uk/`; the language test no longer exempts them.
  - Acceptance: `README.md` in English; `TASKS.md` in English; links between them are not broken.

- [ ] **T6.3 [HUMAN] Two-week pilot**
  - Action: use by one person; every manual correction goes to `refine-flow` and the rules.

---

## Closing the questions of section 13

- [x] Claude Code schemas verified (T0.2, `docs/schemas-notes.md`).
- [ ] Licenses of the reference repos verified (before using any fragment).
- [ ] The JSX launch mechanism verified on real AE versions (T2.9).
- [ ] Designers' AE/OS version, Drive mode (stream/mirror), presence of git, whisper: find out before M4.
