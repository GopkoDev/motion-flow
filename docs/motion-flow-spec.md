# Motion Flow: implementation specification

A document for Claude Code. Goal: build a set of plugins that give a motion team (After Effects) an agentic pipeline for repeatable tasks, with the studio rules kept separate and with flows that designers create themselves.

## 0. How to use this document

1. Read it in full, then implement by the milestones of section 12. Each milestone has acceptance criteria.
2. Marks **[verify]** mean: confirm in the current documentation or in the source code; do not rely on this text. I read the descriptions of the external repos but did not verify their code.
3. Before copying anything from an external repo, check its license and read the code. For SDD (MIT) keep the author's credit (Kyrylo Genkov) in `NOTICE`. Where possible, rewrite in your own words for our case instead of copying verbatim.
4. Development runs on a Mac Air M1 with 8 GB, where After Effects will not run (official requirements: 16 GB and an M1 Pro or newer). So test locally everything that does not need AE, and test the AE part on fixtures (JSON dumps of real projects). Integration tests with a live AE are done by a person on a designer's machine.

## 1. Context and decisions taken

Users: motion designers, After Effects, Google Drive for Desktop, often without git.

A full SDD (10+ stages) is not needed for motion: the result is judged by eye, `.aep` is binary and cannot be diffed, and the team's real pain is not yet known. We take ideas from SDD, not the whole set.

Decisions taken:

1. **A skeleton of five steps:** `intake → plan → build → check → deliver`. Gating: `build` does not start without an approved `plan.md`, `deliver` without an approved `check.md`.
2. **A human decides after `plan` and after `check`.** There are no approvals at other steps.
3. **Studio rules are separate from the skeleton** (the `studio-rules` plugin). The skeleton reads them at defined points.
4. **A designer creates a flow** through `new-flow` (a story + an example + an interview + a dry run). Before a published flow reaches the whole team, a technical person reviews it.
5. **Drive: a local backend, read-only.** The Google Drive for Desktop folder is an ordinary folder for the agent, accessible only through the `drive-gate` script with an allowlist. The commands `put`, delete, move and rename do not exist. The designer moves results to Drive by hand. An API backend is added later if a flow requires it.
6. **Three layers:** `motion-flow` (universal), `studio-rules` (private, the studio's rules and flows), the project. Plugin catalog: `motion-marketplace`.
7. **Git** is mandatory only for the plugin repos. In a project it is optional (local commits of text artifacts, no push). `.aep`, assets and renders are never in git.
8. **Dependencies** (ffmpeg, whisper, node) are declared in `deps.json` and checked by the `doctor` skill. The agent installs nothing silently.
9. **Safeguards live in tools and hooks**, not in the text of skills: working on a copy, undo groups, an allowlist, deny rules.
10. **After Effects is driven by JSX scripts through `ae-run`, without MCP servers.**
11. **All plugin scripts (`bin/`, `hooks/`, `scripts/`) are written in Node.js** (ESM, no external dependencies, tests through the built-in `node:test`), minimum Node version 24 (LTS). No Python. Files in `bin/` have the shebang `#!/usr/bin/env node`; on Windows they are called as `node bin/<name>`.

## 2. Three repositories and structure

> **Change (section 16, item 1):** there is no separate `motion-marketplace` repo: the catalog (`marketplace.json`) lives in `motion-flow` itself. The `studio-rules` scaffold lives in `motion-flow/templates/studio-rules/`, and a studio creates its own repo from it (`init-rules`). The rules plugin has a unique name `<studio>-rules`.

```
motion-marketplace/                  # public or private, the catalog
  .claude-plugin/marketplace.json
  README.md

motion-flow/                         # the universal plugin
  .claude-plugin/plugin.json
  skills/
    intake/SKILL.md
    plan/SKILL.md
    build/SKILL.md
    check/SKILL.md
    deliver/SKILL.md
    new-flow/SKILL.md
    refine-flow/SKILL.md
    publish-flow/SKILL.md
    init-rules/SKILL.md
    doctor/SKILL.md
    whats-new/SKILL.md               # optional, M5
    _shared/
      gating.md  handoff.md  socratic-loop.md  safety.md
      artifact-formats.md  ae-scripting.md  drive-access.md
  hooks/hooks.json  hooks/guard.mjs
  bin/drive-gate  bin/aep-version  bin/ae-lint
  bin/ae-run  bin/ae-dump  bin/ae-render-frame
  lib/jsx/                           # dump.jsx, helpers.jsx
  templates/                         # templates of artifacts and configs
  deps.json
  DRIVE.md
  scripts/validate_plugin.mjs
  evals/
  NOTICE  LICENSE  README.md

<studio>-rules/                      # the studio's private plugin
  .claude-plugin/plugin.json
  skills/studio-rules/SKILL.md
  rules/
    naming.md  motion-system.md  protected.md  delivery.md  drive.md
    project-template/  checks/
  flows/                             # approved flows
  CHANGELOG.md  README.md

project-x/                           # a project
  .claude/settings.json
  .claude/skills/                    # draft flows of this project
  .motion/
    task.md  plan.md  check.md  deliver.md  overrides.md
    snapshots/  build.log.jsonl  state.json
  jsx/
  work/                              # gitignored: .aep copies, frames, exports
```

## 3. Artifacts and gating

| Step | Requires | Creates | Human approval |
|---|---|---|---|
| intake | nothing | `.motion/task.md` | no |
| plan | `task.md` | `.motion/plan.md`, `snapshots/project-map-*.json` | **yes** (`approved: true` + `plan_sha256`) |
| build | `plan.md` with `approved: true`, matching hash | `jsx/NN-*.jsx`, a new .aep copy in `work/`, `build.log.jsonl` | no |
| check | `build.log.jsonl` without errors | `.motion/check.md`, frames in `work/frames/` | **yes** (`approved: true`) |
| deliver | `check.md` with `approved: true` | files in `work/out/`, `.motion/deliver.md` | no |

Gating rules (`_shared/gating.md`):
- A missing or unapproved file: the step refuses, names the step that creates the file, and stops. This is not an error but a hint.
- If `plan.md` was changed after approval, the hash does not match: `build` refuses and asks for a new approval.
- An approval is recorded only after an explicit answer from a person (use `AskUserQuestion`), never by the agent itself.

## 4. motion-flow: file by file

Description format: **Purpose**, **Contents**, **Taken from**.

### 4.1 `.claude-plugin/plugin.json`
- **Purpose:** the plugin manifest.
- **Contents:** `name: motion-flow`, `version: 0.1.0`, `description`, `author`, `license`. Increment the version with every release.
- **Taken from:** the shape of the manifest from `genkovich/sdd/.claude-plugin/plugin.json`. Codex/Cursor manifests (`.codex-plugin`, `.cursor-plugin`, `install.sh`) are not needed yet. Verify the exact schema **[verify]**: https://docs.claude.com/en/docs/claude-code/plugins-reference

### 4.2 `skills/_shared/gating.md`
- **Purpose:** the single source of the step refusal rules.
- **Contents:** the table of section 3, the refusal text template (what is missing, which step to run), the plan hash rule, the rule "approval only from a person".
- **Taken from:** the hard-refuse idea and the "When a stage refuses" table from the `genkovich/sdd` README, plus the implementation in every `SKILL.md`. Simplified to two gates.

### 4.3 `skills/_shared/handoff.md`
- **Purpose:** an identical block at the end of every step.
- **Contents:** three parts: *What was done* (the files written), *What to check* (links to files), *Next command* (in a code block, `/motion-flow:plan` etc.). `/clear` between steps is recommended but optional, because the steps read their input from disk.
- **Taken from:** `genkovich/sdd/skills/_shared/handoff.md` (the block format is in the README). Remove the mandatory `/clear`.

### 4.4 `skills/_shared/socratic-loop.md`
- **Purpose:** the interview rules for `intake`, `new-flow`, `init-rules`, `refine-flow`.
- **Contents:** one question at a time, answer options where possible, propose a sensible default, record all assumptions as a list at the end, do not ask what can be learned from files or the dump, stop on a contradiction with `studio-rules` and ask what is right.
- **Taken from:** `genkovich/sdd/skills/_shared/` (socratic-loop, ask-style, interview-depth) **[verify the exact file names]**. Keep two modes (brief/detailed) instead of easy/medium/hard.

### 4.5 `skills/_shared/safety.md`
- **Purpose:** the invariants that all skills refer to (the full list is in section 9).
- **Contents:** work only on a copy, an undo group for every change, no direct access to the Drive folder, delete nothing, install nothing without a person's command, stop and ask at any surprise.
- **Taken from:** written from scratch. A guide in spirit: `permissions` and `stop_on_red` in the SDD config (`.claude/sdd.local.md`).

### 4.6 `skills/_shared/artifact-formats.md`
- **Purpose:** the formats of `task.md`, `plan.md`, `check.md`, `deliver.md`, `overrides.md`, `state.json`.
- **Contents:** the frontmatter and required sections (see section 8). One file, referred to by all steps.
- **Taken from:** the principle "every stage writes a file that the next one reads" and the `skills/<n>/templates/` templates of SDD.

### 4.7 `skills/_shared/ae-scripting.md`
- **Purpose:** rules for writing and running JSX, for every skill that touches AE.
- **Contents:** idempotency (a script can run twice without duplicating anything); find a layer by name, not by index; every change in an undo group; the script writes its result to a file (`work/.ipc/<id>.out.json`) instead of showing it in the UI; no dialogs (`alert`, `confirm`, `prompt`); short runs (split long operations into steps); common ExtendScript pitfalls. Run only through `ae-run` (section 7).
- **Taken from:** `kumoproductions/mcp-aftereffects` and `TheLlamainator/after-effects-mcp` stay only as reference JSX (introspection, keyframes, easing). The MCP servers themselves are not used.

### 4.8 `skills/_shared/drive-access.md`
- **Purpose:** the Drive access rules for all skills.
- **Contents:** "never read or write a Drive folder path directly, only through `drive-gate`"; work with aliases, not paths; `info` before `fetch`; on an error stop and ask; results are not written to Drive, a person moves them.

### 4.9 `skills/intake/SKILL.md`

> **Change (section 16.6):** intake agrees the **acceptance criteria** (`AC1`, `AC2`...) with the designer, and after writing `task.md` runs an **independent pass** (a sub-agent without history looks for ambiguities, and every finding is closed: clarify, defer or reject) and runs `mf-gate verify task`. It asks only blocking facts and decides matters of taste itself.
- **Purpose:** accept the task and choose the flow.
- **Contents:** frontmatter (`name`, `description`, `model: inherit`). Steps: (1) load `studio-rules` (the index); (2) read the flow index (the `description` of all flows in `studio-rules/flows/` and `.claude/skills/`); (3) determine the type (new, revision, resize, export, other); (4) find a flow, or propose `/motion-flow:new-flow`, or go the generic way; (5) ask only what is missing (input files by alias, target formats, deadline); (6) write `.motion/task.md`; (7) hand off to `plan`.
- **Taken from:** `survey`/`specify` in SDD (the interview structure), `_shared/socratic-loop.md`. The quick/standard/full routes of SDD (`.route`) are not taken for now.

### 4.10 `skills/plan/SKILL.md`

> **Change (section 16.6):** every plan step has a "Criteria" column, every task criterion is covered by a step or recorded under "Not covered by the plan"; a step with no criterion (nobody asked for it) is not allowed. `mf-gate verify plan` checks this before approval.
- **Purpose:** turn the task into a list of concrete changes that a person approves.
- **Contents:** (1) refuse if there is no `task.md`; (2) `doctor --flow <name>` for the flow's dependencies; (3) `drive-gate fetch` of the needed files (a project with a structure for links) into `work/`; (4) `ae-dump` on the copy, saved to `snapshots/`; (5) read `motion-system.md`, `protected.md`, `naming.md`, `overrides.md`, the chosen flow's instructions; (6) compose `plan.md` in the format (section 8): every step is a target (comp/layer/property), a change, an expected result and a **frame time for checking**; (7) state explicitly whether anything from `protected.md` is touched (must be "no", otherwise stop and ask); (8) ask for approval and only after "yes" write `approved: true` and `plan_sha256`.
- **Taken from:** `survey` (a state dump into a map that later steps read), `design` and `tasks` in SDD (the plan as a numbered list of atomic steps), `AskUserQuestion` for approval. Knowledge about AE properties, keyframes, easing: `LobzyJay/motion-design-with-claude` (skills `motion-design`, `aftereffects-motion`).

### 4.11 `skills/build/SKILL.md`

> **Change (section 16, item 5):** the `build.log.jsonl` log is written by `ae-run --step N [--attempt M]` itself, not by the agent; `guard` blocks manual writes.
- **Purpose:** execute the approved plan on a copy of the project.
- **Contents:** (1) gating check (approval + hash); (2) for each plan step generate `jsx/NN-<description>.jsx`: idempotent (finds a layer by name and updates it rather than duplicating), wrapped in an undo group named after the step; (3) run through `ae-run` **only on the copy in `work/`**; (4) record the result in `build.log.jsonl` (step, status, time, error); (5) stop at the first error, at most N retries (2 by default), then ask the person; (6) a new file version through `aep-version`; (7) hand off to `check`.
- **Taken from:** `implement` in SDD (a loop per task, `stop_on_red`, `max_red_retries`, commit trailers as the idea of a log). For JSX: `aedev-tools/adobe-agent-skills` (skill `after-effects`, ExtendScript without UI, macOS only), `TerminalSkills/skills/skills/after-effects`. The MCP repos (`TheLlamainator/after-effects-mcp`, `kumoproductions/mcp-aftereffects`) are used only as reference JSX for keyframes, easing, presets. Typical ExtendScript mistakes worth building into the skill: blocking the UI with long scripts, using layer indexes instead of names, `setValueAtTime` versus `setValuesAtTimes`.

### 4.12 `skills/check/SKILL.md`

> **Change (section 16.6):** check traces **every task criterion** to evidence (`PASS|FAIL|NOT_VERIFIED`), not only the plan lines; a criterion without evidence cannot be PASS. An independent pass (a sub-agent without history) is added. `mf-gate verify check` checks the artifact before it is shown to a person.
- **Purpose:** prove that what the plan says was done, and show the person the frames.
- **Contents:** (1) refuse without a clean `build.log.jsonl`; (2) `ae-lint` against `rules/checks/`; (3) a new `ae-dump` compared with the plan's expectations (layer count, duration, fps, keyframes); (4) `ae-render-frame` at the timecodes from the plan plus the first frame, the last frame and the middle of each transition; (5) open the PNGs and describe whether they match the expectation; (6) write `check.md`: a table step → expectation → fact → verdict, a list of frames, lint violations; (7) ask for the person's approval, and only after "yes" set `approved: true`. The agent does not judge "beauty", it only compares with the plan and the rules and leaves taste to the person.
- **Taken from:** `review` in SDD (requirement → evidence tracing, independent verification), the diagnostic checklist of the `motion-design-critique` skill in `LobzyJay/motion-design-with-claude`. A separate review agent in a clean context can be added later (after the `agents/reviewer` of SDD).

### 4.13 `skills/deliver/SKILL.md`
- **Purpose:** prepare the final files to the studio's specification.
- **Contents:** (1) refuse without an approved `check.md`; (2) the file name through `aep-version` per `naming.md`; (3) export per `delivery.md` (format, codec, size, audio) through the render queue / `aerender`; (4) results in `work/out/` with checksums; (5) `deliver.md`: the list of files, sizes, checksums, a "what to move to Drive and where" instruction (there is no writing to Drive itself); (6) a line in `.motion/changelog.md`; (7) per the `commit_artifacts` setting in `.motion/state.json`, make a **local** commit of the text artifacts (no push, no binaries).
- **Taken from:** `ship` in SDD (verifying that the result really works, the changelog), but without a PR and merge.

### 4.14 `skills/new-flow/SKILL.md`

> **Change (section 16.8):** the dry run goes into `.motion/` of the same project, but before it the designer's task is safely parked (`mf-gate archive --park`, brought back by `mf-gate restore`) after a warning about the risk and a request to save the AE projects. Examples are stored only as anonymous notes, not as files; the draft is in the designer's language, the final flow files in English; `mf-flow check` checks the flow.
- **Purpose:** a designer creates a flow, the agent interviews and composes the skill.
- **Contents:** (1) the designer's free-form account of how they do it, and a real example (files on Drive, the project, the final result); (2) an interview, one question at a time: what starts the task, what the inputs are, the steps in order, where a person's decision is needed, what can go wrong, what must not be touched, how to tell it is done; (3) reading the example through `drive-gate` and `ae-dump`, checking it against the account ("you said 3 formats, but the project has five comps"); (4) requiring at least two different examples, or the question "what is unusual about this case"; (5) a draft `flow.md` and `SKILL.md` (template below) in plain language for approval; (6) a **dry run** of the five steps on a copy of the example, showing the result; a comparison with what they did themselves; corrections; (7) write into the project's `.claude/skills/<flow>/`; (8) offer to run `publish-flow`.
- **Rules for a generated flow:** a flow tunes the steps (what to ask in intake, what in the plan, which actions, which checks), but cannot change `_shared/safety.md`. The `description` must contain 3 example trigger phrases and is shown to the designer for approval separately.
- **Taken from:** the `skill-creator` skill (Anthropic, `anthropics/skills`) for the mechanics of creating and improving a skill and for evals; the interview from `socratic-loop`.

### 4.15 `skills/refine-flow/SKILL.md`

> **Change (section 16.9):** differences between the agent's result and the designer's corrections are found by comparing `ae-dump`s; then generalization (always, or only here?) and the fix in plain words; the version is raised by `mf-flow bump` (the status resets to `draft`, a line goes into the flow's `CHANGELOG.md`). The installed copy of a flow from the studio rules is not edited.
- **Purpose:** update a flow from the experience of running it.
- **Contents:** after `deliver` ask "what did you have to fix by hand?"; compare with `flow.md`; propose a change (a diff in plain words); after approval raise `version` in the flow's frontmatter and append a line to its changelog.
- **Taken from:** the "improve" mode of the `skill-creator` skill.

### 4.16 `skills/publish-flow/SKILL.md`

> **Change (section 16.9):** packing is done by `mf-flow pack` (our own zip writer, deterministic), checking by `mf-flow check`; the agent itself reads the flow against `safety.md`; the status `reviewed|approved` is set only by the reviewer.
- **Purpose:** prepare a flow for review.
- **Contents:** check the frontmatter (`name`, `description`, `version`, `owner`, `needs`, `status: draft`), validate `SKILL.md`, make sure the flow does not bypass `safety.md`, pack into `work/out/flow-<name>-<version>.zip` and print the instruction "put it in `_flows-pending/` on Drive" for the person. The agent writes nothing to Drive.
- **Taken from:** the frontmatter checks modelled on `scripts/validate_plugin.py` in SDD.

### 4.17 `skills/init-rules/SKILL.md`

> **Change (section 16, item 4):** the skill itself copies the scaffold from `motion-flow/templates/studio-rules/`, asks the studio name and slug and sets a unique plugin name `<slug>-rules` (in `plugin.json` and `marketplace.json`), because a freelancer may have the rules of several studios.
- **Purpose:** once per studio, generate draft rules.
- **Contents:** runs in a `studio-rules` checkout. (1) ask which Drive folders are allowed (aliases) and which 1–2 finished projects to take as the reference; (2) read the folder tree and naming samples through `drive-gate ls/info`; (3) `ae-dump` of the reference projects: comps, layers, precomps, fps, size, fonts, effects; (4) interview the designer: what must not be touched, how versions are approved, delivery formats, asset collection rules; (5) write draft `rules/*.md` with `status: draft` and `TODO: confirm` marks; (6) print the list of open questions. A file becomes a rule (`status: confirmed`) only after a person has read and committed it.
- **Taken from:** `survey` in SDD (scan once and record what all later stages read), `design-system` in SDD (a committed canon instead of per-person settings), the "Constitution file" idea from the SDD roadmap.

### 4.18 `skills/doctor/SKILL.md`
- **Purpose:** check dependencies and settings.
- **Contents:** reads `deps.json`, runs the check command for each dependency and compares the version, prints a table (ok / missing / old version) with the install command for macOS and Windows. **It installs nothing.** The `--flow <name>` flag checks only the flow's `needs`. It also checks: AE is reachable (`ae-run --ping`), the `drive-gate` config is valid, the project `settings.json` has the deny rules, the `motion-flow` and `studio-rules` versions match what is expected.
- **Taken from:** the command autodetection in the SDD scripts (`cmd_*` autodetect), `install.sh` for the OS detection logic.

### 4.19 `skills/whats-new/SKILL.md` (M5, optional)

> **Change (section 16.9):** `mf-whatsnew` reads the rules' `CHANGELOG.md` (`## x.y.z`, `- ` lines, flows as `flow <name>: ...`), compares with `last_seen_rules_version`, and `--mark-seen` changes only that key.
- **Purpose:** show the designer what changed after a plugin update.
- **Contents:** reads `studio-rules/CHANGELOG.md`, compares with `last_seen` in `.motion/state.json`, shows new or changed flows in one sentence each.

### 4.20 `hooks/hooks.json` and `hooks/guard.mjs`

> **Change (section 16, item 3):** dangerous git (`push`, `reset --hard`, `clean -f`, `checkout -f`) and `rm`/`mv` inside `work/` are not blocked but ask for confirmation (`ask`); outside `work/`, on Drive and in `~/.motion-flow/` the block is hard. The matcher is wider: also `NotebookEdit`, `Glob`, `Grep`, `PowerShell`, `Monitor`.
- **Purpose:** hard safeguards outside the prompts.
- **Contents:** a PreToolUse hook for `Read`, `Write`, `Edit`, `Bash`. It blocks: any paths inside the roots from `~/.motion-flow/roots.json` (access only through `drive-gate`); `rm`/`mv` outside `work/`; `git push`, `git reset --hard`, `git clean -fd`, `git checkout --force`; launching ExtendScript and AE (`afterfx`, `osascript` with `DoScriptFile`, `aerender`) outside `ae-run`, `ae-dump`, `ae-render-frame`. It returns a clear message about what is forbidden and what to do instead.
- **Taken from:** written from scratch. The hooks schema **[verify]** in the Claude Code docs. Duplicate the critical bans in `permissions.deny` of the project `settings.json`.

### 4.21 `bin/drive-gate`
The full specification is in section 6.

### 4.22 `bin/aep-version`
- **Purpose:** compute the next file version name by the studio's rules.
- **Contents:** input: the current name, the path to `naming.md` (or a config with a version regular expression); output: the next name (`project_v03.aep` → `project_v04.aep`), never overwriting existing files. Cover with unit tests.

### 4.22a `bin/ae-run`, `bin/ae-dump`, `bin/ae-render-frame`, `lib/jsx/`
- **Purpose:** the single way to run JSX and render in AE (the mechanism is in section 7). Thin wrappers, no business logic.
- **Contents:**
  - `ae-run --project <work/...aep> --script <path.jsx> --undo <name> [--timeout N]` and `ae-run --ping`;
  - `ae-dump --project <work/...aep> --out <path.json>` (runs `lib/jsx/dump.jsx`, the result follows the schema of section 7);
  - `ae-render-frame --project <work/...aep> --comp <name> --time <sec> --out <path.png>`;
  - `lib/jsx/dump.jsx` (the project dump to JSON) and `lib/jsx/helpers.jsx` (undo group, find a layer by name, write the result to a file, error handling).
- **Tests (mandatory, without AE):** argument parsing; rejecting any path outside `work/` (`..`, symlinks, absolute paths); timeout; lock file (a second simultaneous run refuses); building `.in.json`/`.out.json`; clear errors. Launching AE itself is tested by a person on the designer's machine.
- **Taken from:** the reference JSX from `kumoproductions/mcp-aftereffects` and `TheLlamainator/after-effects-mcp` for introspection (the dump).

### 4.23 `bin/ae-lint`
- **Purpose:** machine checks of a project against the studio's rules.
- **Contents:** input: a JSON dump and the `rules/checks/` folder; output: a JSON list of violations (`rule`, `severity`, `where`, `message`). Each check is a small declarative file (`fps == 25`, `comp.name` matches a regex, missing fonts and media, layers with default names such as "Shape Layer 1", violations of `protected.md`). The check code is simple, has no dependencies, and runs on a dump without AE.

### 4.24 `deps.json`
- **Purpose:** the declaration of dependencies.
- **Contents:** an array of objects: `name`, `check` (command), `min_version`, `version_regex`, `install` (`macos`, `windows`), `required_by` (skills or flows), `notes`. Initially: AE (minimum version), `node` (minimum 24), `ffmpeg`; `whisper` as optional, naming the specific implementation and model (pick one and pin the version).
- **Rule:** the plugin's own scripts have no external npm dependencies (only Node built-in modules), so `node_modules` is not needed. If a dependency is still needed, pin it with a lock file. Nothing global.

### 4.25 `DRIVE.md`
- **Purpose:** a readme for the agent about Drive.
- **Contents:** what aliases are; what the tree looks like (filled in by `studio-rules/rules/drive.md`); rules: never touch a Drive folder path directly; always `info` before `fetch`; work only with the copy in `work/`; write nothing to Drive; on an error stop and ask; the pitfalls of stream mode and `.gdoc/.gsheet`.

### 4.26 `templates/`
- `task.md`, `plan.md`, `check.md`, `deliver.md`, `overrides.md`, `flow.md`, `flow-SKILL.md` (the templates of section 8).
- `roots.example.json` (an example of the local `drive-gate` config).
- `settings.project.json` (marketplace, enabledPlugins, permissions.deny).
- `gitignore.project` (the line `work/`, `.motion/state.json`).

- `rules/*.md`: empty templates with sections and `status: draft`.
- **Taken from:** the `skills/<n>/templates/` structure in SDD.

### 4.27 `scripts/validate_plugin.mjs`
- **Purpose:** CI check of the plugin.
- **Contents:** the manifests are valid; every `SKILL.md` has `name`, `description`, `model`; references to `_shared/*.md` resolve; every skill that consumes an artifact contains the gating check; no skill mentions `put`/delete on Drive; `deps.json` is valid; the template frontmatter is correct.
- **Taken from:** `genkovich/sdd/scripts/validate_plugin.py` (the idea of a set of invariants), adapted to our rules.

### 4.28 `evals/`
- **Purpose:** regression checks.
- **Contents:** sanitized JSON dumps of real projects (fixtures); the expected `ae-lint` results on them; `drive-gate` tests (section 6); `aep-version` tests; description-trigger tests (a set of phrases → which skill/flow must start).
- **Taken from:** the `evals/` folder in SDD and the evals mechanics in `skill-creator`.

## 5. motion-marketplace

> **Change (section 16, item 1):** this section is outdated: there is no separate repo, the catalog is in `motion-flow/.claude-plugin/marketplace.json` (`source: "./"`). The rules scaffold is also a catalog of one plugin, so it can be installed without GitHub: `/plugin marketplace add <folder>`.

### 5.1 `.claude-plugin/marketplace.json`
- **Contents:** `name`, `owner`, a `plugins` array with two entries (`motion-flow`, `studio-rules`), each with a `source` pointing to a GitHub repo and a `description`. A private `studio-rules` needs git access for every participant.
- **Taken from:** the self-marketplace in `genkovich/sdd/.claude-plugin/marketplace.json`. The exact `source` schema **[verify]**.

### 5.2 `README.md`
- **Contents:** for the designer, step by step: how to add the marketplace, how to enable the plugins, how to run `doctor`, how to create a flow, what to do on an error. For a technical person: how to release a version, how to review a flow.

## 6. The `drive-gate` specification (local backend)

> **Change (section 16, item 2):** `roots.json` is the list of Drive folders **on the computer**; which of them a project can use is chosen in the project (`.motion/drive.json`). With no file or an empty list: no Drive. There is no environment variable that overrides the config.

Language: Node.js (ESM, `.mjs`), built-in modules only, no external dependencies. No network.

**Config.** Aliases (shared) are defined in `studio-rules/rules/drive.md` (names and purposes). The concrete paths on the user's machine are in `~/.motion-flow/roots.json`:
```json
{ "roots": { "assets": "/Users/anna/Google Drive/Studio/Assets",
             "projects": "/Users/anna/Google Drive/Studio/Projects" },
  "work_dir": "work" }
```

**Commands (all write JSON to stdout, a non-zero exit code on error):**
- `ls <alias> [subpath]`: a list of files and folders with sizes and modification dates.
- `info <alias> <relpath>`: size, date, whether the file is downloaded locally (stream mode), a checksum on request.
- `fetch <alias> <relpath> --to work/ [--with-deps]`: copies a file into `work/` keeping relative paths. For `.aep`, `--with-deps` copies the structure the project references (from the dump) so links do not break. It checks the size after copying, waits for a stream file to download (with a timeout), and compares checksums.
- `log [--tail N]`: reads the call log.

**Invariants:**
1. Every path goes through `realpath`, and the result must lie inside the alias root. Reject `..`, symlinks pointing outward, absolute paths, an unknown alias.
2. No write, delete, move or rename operations on the Drive side. The commands `put`, `rm`, `mv`, `rename`, `share` do not exist.
3. Writing is allowed only in the project's `work/`.
4. Every call goes into the log `~/.motion-flow/drive-gate.log` (time, command, alias, path, result).
5. A stream-mode error (the file did not download) returns a clear message for a person, not a silent empty file.

**Tests (mandatory):** a `../` escape, a symlink pointing outward, an unknown alias, a file without permissions, zero size (a stream placeholder), a large file, `fetch` does not change the original (compare mtime and checksum), no writes at all outside `work/`.

## 7. Running JSX in After Effects (without MCP)

**Principle.** Skills work with three commands (`ae-run`, `ae-dump`, `ae-render-frame`), not with a server. There are no MCP servers. The AE-MCP repos (`kumoproductions/mcp-aftereffects`, `TheLlamainator/after-effects-mcp`, `Dakkshin/after-effects-mcp`) are used only as reference JSX. Do not use the `anthropics/ae-mcp` repo: its origin is doubtful.

**Launch mechanism** **[verify on real AE versions]**:
- Windows: `afterfx.exe -r <script.jsx>` (or `-s` for a code string).
- macOS: `osascript` with `DoScriptFile` for the After Effects application.
- "Allow Scripts to Write Files and Access Network" is enabled in the AE settings (otherwise the script cannot write its result).
- Exports: `aerender` or the render queue.
- Fallback: a bridge panel (CEP/UXP). Not done in v0.1.

**Passing the result.** `ae-run` writes the input to `work/.ipc/<id>.in.json` (project, parameters, output path), the script reads it and writes the result to `work/.ipc/<id>.out.json`. `ae-run` waits for `.out.json` to appear until the timeout. One run at a time is enforced by a lock file (`work/.ipc/ae.lock`): a second simultaneous run refuses.

**Contracts:**

| Command | Contract |
|---|---|
| `ae-run --ping` | Returns `{ok, aeVersion, projectOpen, projectPath}`. |
| `ae-run --project <work/...aep> --script <path.jsx> --undo <name> [--timeout N]` | Runs JSX **only on a project from `work/`**, in the undo group `<name>`. Returns `{ok, result, error, durationMs}`. |
| `ae-dump --project <work/...aep> --out <path.json>` | Writes JSON following the schema below. Does not change the project. |
| `ae-render-frame --project <work/...aep> --comp <name> --time <sec> --out <path.png>` | Writes a PNG of the frame. |

**Safety.** `ae-run` is the only way to run JSX (`ae-dump` and `ae-render-frame` call it internally). It works only with copies in `work/`. `hooks/guard.mjs` blocks any other launch of AE and ExtendScript (see 4.20).

**Dump schema (abridged):**
```json
{
  "ae": {"version": "..."},
  "project": {"path": "...", "bitsPerChannel": 8},
  "footage": [{"name": "...", "path": "...", "missing": false}],
  "fonts": ["..."],
  "comps": [{
    "id": 1, "name": "...", "width": 1920, "height": 1080, "fps": 25, "duration": 12.0,
    "layers": [{
      "index": 1, "name": "...", "type": "shape|text|solid|precomp|footage|null",
      "inPoint": 0, "outPoint": 12, "parent": null, "enabled": true, "locked": false,
      "transform": {"position": [0,0], "scale": [100,100], "rotation": 0, "opacity": 100},
      "effects": ["..."], "expressions": {"transform.position": "..."},
      "keyframes": {"transform.opacity": [{"t": 0, "v": 0, "ease": "..."}]}
    }]
  }]
}
```

## 8. Artifact formats (`templates/`)

**`task.md`**
```markdown
---
id: 2026-10-19-resize-01
type: resize|new|edit|export|other
flow: resize-formats        # or null
status: draft|ready
inputs:
  - alias: projects
    path: Brand/Spring/spring_v07.aep
deadline: null
---
## Description
## Acceptance criteria        # "- AC1: <a result that can be seen or measured>"
## Known facts and assumptions
## Open questions
```

**`plan.md`**
```markdown
---
task_id: 2026-10-19-resize-01
status: draft            # draft | approved
approved_at: null
plan_sha256: null        # hash of the plan body at the moment of approval
project_copy: work/spring_v07.aep
touches_protected: false
needs: [ffmpeg]
---
## Steps
| # | Target (comp/layer/property) | Change | Expected result | Frame to check | Criteria |
|---|---|---|---|---|---|
## Not covered by the plan   # task criteria without a step, with the reason; "- none"
## Risks
## Questions for the designer
```

**`check.md`**
```markdown
---
task_id: 2026-10-19-resize-01
verdict: PASS         # PASS | ISSUES
approved: false
approved_at: null
---
## Comparison with the plan
| # | Expected | Actual | Verdict |
## Acceptance criteria
| AC | Evidence | Verdict |          # PASS | FAIL | NOT_VERIFIED
## Lint
## Frames
- work/frames/step01_t2.5s.png
## Independent review   # or "not run: <reason>"
## Open questions
```

**`flow.md` (a flow)**
```markdown
---
name: resize-formats
version: 0.1.0
owner: anna
status: draft | reviewed | approved
needs: [ffmpeg]
---
## What this flow is for
## What starts it (3 example phrases)
## Inputs
## Steps in order
## Where the designer decides
## What must not be touched
## How to tell it is done
## Examples (links to example/)
```

**`flow-SKILL.md`:** frontmatter `name`, `description` (when to run, with example phrases), `model: inherit`; body: how this flow tunes `intake`, `plan`, `build`, `check`, `deliver`, and a link to `flow.md`. Required: "does not change or weaken `_shared/safety.md`".

**`overrides.md`:** this project's exceptions to the studio rules, each with a reason and who allowed it.

**`state.json`:** `{"last_seen_rules_version": "", "commit_artifacts": false}`.

## 9. Safety invariants

1. The agent works only with copies in `work/`; originals on Drive are not changed.
2. Every project change runs in an undo group.
3. No delete, move or rename operations on Drive.
4. No direct access to a Drive folder: only `drive-gate`; this is enforced by `hooks/guard.mjs` and `permissions.deny`.
5. The agent installs nothing on the machine: it only shows commands (`doctor`).
6. A flow cannot weaken these invariants.
7. Approval comes only from a person, after an explicit answer.
8. On a surprise (a missing file, broken links, a hash mismatch) stop and ask.
9. Sensitive data: do not log the contents of client projects outside `work/`.

## 10. studio-rules: file by file

All rules have frontmatter `status: draft|confirmed`, `confirmed_by`, `confirmed_at`. Skills warn when they read a `draft`.

- **`skills/studio-rules/SKILL.md`**: the rules index. `description`: "Rules of studio <name>: naming, motion-system, delivery, Drive, protected". Body: the list of files and when to read each (naming → plan/build/check/deliver, project-template → intake/build, motion-system → plan/build, protected → plan/build/check, delivery → plan/deliver, drive → deliver/publish-flow, checks → check, flows → intake).
- **`rules/naming.md`**: templates for file, version, comp, layer and precomp names; examples of right and wrong; a regex for `ae-lint`.
- **`rules/motion-system.md`**: easing curves, standard timings (in frames and seconds), palette, fonts, the brand's motion rules, what is forbidden.
- **`rules/protected.md`**: what must not be touched (reference comps, brand precomps), whom to call if a change is needed.
- **`rules/delivery.md`**: formats, codecs, bitrate, resolutions, safe zones, audio levels, where to put finals.
- **`rules/drive.md`**: the list of aliases (without concrete machine paths), the tree structure, versioning rules, where `_flows-pending/` is.
- **`rules/project-template/`**: a template `.aep` (fps, size, color), the folder structure for a new project.
- **`rules/checks/`**: declarative checks for `ae-lint`.
- **`flows/`**: approved flows; each in its own folder in the format of section 8, with `example/`.
- **`CHANGELOG.md`**: what changed in the rules and flows (read by `whats-new`).
- **Taken from:** nothing ready-made in substance, `init-rules` fills it in with the designer. Structurally: `docs/design-system.md` and `architecture-map.md` in SDD as an example of a "committed canon that every stage reads".

## 11. The project: file by file

> **Change (section 16, items 2 and 6):** `permissions` has `deny` (Drive and config, path rules for `Read`/`Edit` only) and `ask` (dangerous git); `enabledPlugins` contains `motion-flow@motion` and **one** rules plugin of the chosen studio (`mf-init --rules <plugin>@<catalog>`) or none. The project `CLAUDE.md` is written in English with the line "reply to the designer in Ukrainian".

- **`.claude/settings.json`**: `extraKnownMarketplaces` (motion-marketplace), `enabledPlugins` (`motion-flow@motion`, `studio-rules@motion`), `permissions.deny` for direct Read/Write/Edit on the Drive folder path, for Drive tools (`trash_file`, `update_file`, `share_file`) and for dangerous git commands. The exact keys and schema **[verify]**.
- **`.gitignore`**: `work/`, `.motion/state.json`.
- **`CLAUDE.md`** (short, in Ukrainian): "Work through `/motion-flow:intake`. Do not touch Drive directly. Work only with copies in `work/`. Before changes show the plan and wait for approval."
- **`.motion/`**: the artifacts of section 8.
- **`jsx/`**: generated scripts (in git if the project is in git).
- **Plugin install scope:** `project` for both plugins (the same version for everyone), `local` for the developer's own experiments.

## 12. Implementation order

**M0. Skeleton.** Three repos, `plugin.json`, `marketplace.json`, `validate_plugin.mjs`, README. *Acceptance:* `/plugin marketplace add <local path>` and installing both plugins work, the validator is green.

**M1. Safety and Drive.** `drive-gate` + tests, `hooks/guard.mjs`, the `permissions.deny` template, `doctor` (checking `deps.json` and configs). *Acceptance:* all the tests of section 6 pass; an agent attempt to read a Drive path directly is blocked; `doctor` shows a correct table and installs nothing.

**M2. Running JSX in AE.** `ae-run`, `ae-dump`, `ae-render-frame`, `lib/jsx/`, `ae-scripting.md`, dump fixtures, `ae-lint`, `aep-version`. *Acceptance:* the unit tests without AE pass; on the designer's machine `ae-run --ping`, `ae-dump`, `ae-run` on a copy and `ae-render-frame` work on a real AE version.

**M3. Five steps.** `intake`, `plan`, `build`, `check`, `deliver`, `_shared/*`, templates, gating, handoff. *Acceptance:* one real simple task (for example a resize) goes from `intake` to `deliver` on the designer's machine; an attempt to run `build` without approval is refused; changing `plan.md` after approval blocks `build`.

**M4. Studio rules.** The `studio-rules` scaffold, `init-rules`. *Acceptance:* `init-rules` on 1–2 real projects creates drafts with `TODO: confirm`; the designer confirms them; `plan` and `check` start using them.

**M5. Flows.** `new-flow`, `refine-flow`, `publish-flow`, `whats-new`. *Acceptance:* a designer creates a flow from two examples without help; the dry run passes; the package lands in `_flows-pending/`; after review the flow appears in `studio-rules/flows/` and for others after a plugin update.

**M6. Pilot.** Evals, documentation for designers, two weeks of real use with one person. All manual corrections of the agent's results go to `refine-flow` and to the rules.

## 13. What to verify before starting

1. The schemas of `plugin.json`, `marketplace.json`, hooks and `settings.json` in the current Claude Code documentation.
2. The licenses of the repos we take reference code and knowledge from: `kumoproductions/mcp-aftereffects`, `TheLlamainator/after-effects-mcp`, `Dakkshin/after-effects-mcp` (reference JSX), `LobzyJay/motion-design-with-claude`, `aedev-tools/adobe-agent-skills`, `TerminalSkills/skills` (knowledge and skills). Before using fragments, check that the license allows it.
3. The JSX launch mechanism (`afterfx.exe -r`, `osascript` with `DoScriptFile`) on the real AE versions and OSes of the designers, and the behavior when AE is already running (another project open, modal dialogs, a second process copy).
4. The AE version and OS the designers use (Windows or macOS): the launch commands and `deps.json` depend on it.
5. The Drive for Desktop mode the designers use: stream or mirror.
6. Whether the designers have git. If not, `commit_artifacts` stays off.
7. Which whisper implementation is needed and whether it is really needed. The overlap with `aerender`/Media Encoder for ffmpeg.

## 14. What we deliberately do not do (for now)

- The brief, storyboard and animation-spec stages as separate steps.
- A separate independent review agent and gating across ten stages.
- Writing to Drive (`put`) and a backend over the Drive API.
- Codex/Cursor support.
- Two-way sync of docs ↔ Drive.

Add these only when the team itself runs into the need.

## 15. Sources to study

- `genkovich/sdd` (MIT): `skills/_shared/` (handoff, socratic-loop, ask-style, interview-depth, size-matrix, tool-adapters, agent-roster), `skills/survey`, `skills/design-system`, `skills/implement`, `skills/review`, `skills/ship`, `skills/fix`, `scripts/validate_plugin.py`, `evals/`, `.claude-plugin/`, `install.sh`.
- `anthropics/skills`: the `skill-creator` skill.
- `kumoproductions/mcp-aftereffects`, `TheLlamainator/after-effects-mcp`, `Dakkshin/after-effects-mcp`: reference JSX only (introspection, keyframes, easing, a bridge panel as a fallback); we do not use the MCP servers.
- `LobzyJay/motion-design-with-claude`: motion knowledge skills (`motion-design`, `aftereffects-motion`, `motion-design-critique`).
- `aedev-tools/adobe-agent-skills` and `TerminalSkills/skills/skills/after-effects`: ExtendScript skills for AE.
- Documentation: https://docs.claude.com/en/docs/claude-code/plugins-reference

## 16. Decisions taken during development

This section records how the implementation differs from the first edition of the spec, and why. Where it contradicts the sections above, this section wins.

### 16.1 The catalog and the studio rules
1. **Catalog.** There is no separate `motion-marketplace`. `motion-flow/.claude-plugin/marketplace.json` (name `motion`, one entry, `source: "./"`). The plugin is installed as `motion-flow@motion`.
2. **The rules scaffold** is in `motion-flow/templates/studio-rules/`: `.claude-plugin/plugin.json` and `marketplace.json`, the index skill `skills/studio-rules/SKILL.md`, `rules/*.md` (all `status: draft`), `rules/checks/` with examples in `_examples/`, `flows/`, `CHANGELOG.md`, `README.md`, `.gitignore` (the service folders `work/`, `.motion/`, `.claude/` and `CLAUDE.md` do not end up in the rules repo).
3. **A unique rules plugin name** `<slug>-rules` (for example `acme-rules`), the same in the manifest, in the catalog and in the catalog entry. The skill inside stays `studio-rules` (the plugin provides the namespace). The name does not start with `claude` or `anthropic`.
4. **Several studios on one computer (a freelancer).** Each studio has its own rules folder, which is both a plugin and a catalog: `/plugin marketplace add <folder>` installs it without GitHub. **Exactly one** rules plugin is enabled in a project (scope `project`, never `user`).
5. **Choosing the studio in a project.** `init-project` asks whose rules apply (or none) and writes `enabledPlugins["<plugin>@<catalog>"] = true` into `.claude/settings.json` (`mf-init --rules <id>` / `--no-rules`). An existing `settings.json` is changed only by this key and only with an explicit `--rules`; then `guard` asks for confirmation. Enabling in `settings.json` does not install the plugin: on each computer, once, `claude plugin install <id> --scope project` (the designer does this, not the agent).
6. **doctor** shows which rules plugins are enabled in the project (informational) and warns if there is more than one.

### 16.2 Drive
1. `~/.motion-flow/roots.json` is the list of the computer's Drive folders, created by `setup` (the skill `/motion-flow:setup`, `mf-setup`): it finds Drive (`--detect`), checks the choice (`--dry-run`), writes the file. The first write needs no questions, changing an existing config asks for confirmation. The config is not overridden by environment variables.
2. The Drive choice is made **per project** in `.motion/drive.json` (`{"aliases": [...]}`); `mf-init --drive a,b` or `--no-drive`. `drive-gate` uses only the chosen folders: `drive_disabled`, `no_drive`.
3. **No-Drive mode:** the config is not required; the designer puts files into `work/` by hand.
4. Duplicated protection: `guard` reads the computer's config, so it blocks all Drive folders in all projects, regardless of the project's choice.

### 16.3 Gating and the log
1. `mf-gate` (`require`, `hash`, `approve`, `status`, `archive`) implements section 3 in code. The plan hash is computed from the body (CRLF→LF, no trailing whitespace); `status` and `approved_at` are not part of the hash.
2. Refusal reasons: `file_missing`, `task_not_ready`, `plan_not_approved`, `plan_changed_after_approval`, `task_mismatch`, `build_log_missing`, `build_log_invalid`, `build_failed`, `check_not_approved`; `approve` also has `plan_incomplete`, `check_incomplete`.
3. `mf-gate approve` always shows the Claude Code confirmation dialog (`guard`), and writing the approval fields (`status: approved`, `approved: true`, `approved_at`, `plan_sha256`) with file tools is forbidden.
4. `build.log.jsonl` is written only by `ae-run --step`; for runs that did not reach the script (timeout, refusal) a line with `ok: false` is written too.
5. `.motion/` holds one task; a new one begins after `mf-gate archive [--abandon]` (moves the artifacts to `.motion/archive/<id>/`, deletes nothing, because `mv`/`rm` are blocked for the agent).
6. `deliver.md` (the format was not defined in the spec): `task_id`, `status: delivered`, `delivered_at`; a table of files (size, sha256); `## Where to put them`; open questions. There is a `.motion/changelog.md`.
7. Video export: `deliver` asks the designer whether to render. There is no automatic `ae-export` yet: the designer exports in AE into `work/out/` with the settings from `delivery.md`, and `deliver` checks the file (`ffprobe`, if present). Checksums: `mf-sum`.

### 16.4 After Effects
1. Launch on macOS: AppleScript `DoScript` with `$.evalFile(<wrapper>)` and `with timeout of 7200 seconds` (not `DoScriptFile`: hangs are reported on AE 2024+). Windows: `AfterFX.exe -r`. An `osascript` that hung after the timeout is stopped; AE is not closed.
2. The script wrapper: BOM, the IPC settings, `helpers.jsx`, the script text as a **string** compiled through `new Function` in `try/catch`. A syntax error, a throw outside `mf.runIpc` or a script without `mf.runIpc` come back as an error in the result, not as an AE dialog. A result that cannot be serialized is replaced by an explicit error.
3. **The agent script policy** (`ae-run` refuses): `system.callSystem`, `.execute`, `eval`/`evalFile`/`new Function`, `Socket`, direct `File`/`Folder`, access to globals by name, `app.open`/`quit`/`project.close`/`saveWithDialog`/`executeCommand`, `getenv`. Files only through `mf.workFile`/`mf.workFolder` (limited to `work/`). The plugin's own scripts are trusted. A check in advance: `node scripts/check_jsx.mjs --policy jsx/`.
4. Script parameters: `ae-run --params '<json>'` (into `input.params`); the keys `__proto__`, `constructor`, `prototype` are forbidden.
5. `ae-render-frame`: `saveFrameToPng` writes the PNG asynchronously, so the tool deletes the old file and after the run waits until the new one appears and stops growing. Frame colors may differ from the AE viewer.
6. `ae-dump --out` is allowed in `work/` and in `.motion/snapshots/`; `ae-render-frame --out` only in `work/`. The project for `ae-run`/`ae-dump`/`ae-render-frame` only inside `work/`; if another project is open in AE, it refuses (someone else's project is not closed).
7. `ae-lint`: 10 kinds of checks (`comp_fps`, `comp_size`, `comp_duration`, `comp_name`, `layer_name`, `default_names`, `footage_missing`, `fonts_allowed`, `project_bits`, `protected_unchanged`); `protected_unchanged` compares against the "before work" dump (`--baseline`).
8. `doctor --ping-ae` really runs a script in AE; without the flag it only checks that AE is installed.

### 16.5 Dependencies and other
1. `node` minimum **24**. Whisper: **whisper.cpp** (`whisper-cli`); `doctor` recommends the largest model that fits in half of the RAM and shows the download command, it downloads nothing.
2. `git` is not in `deps.json`.
3. Text in the repo is in English; everything the designer reads is written by the agent in Ukrainian. The license has not been chosen yet.
4. The instructions for designers (T6.2) live in the `README.md` of the `motion-flow` repo.
5. Manual checks: `_temp/manual-test-cases.md` (M0–M4).

### 16.6 Accepting the task and checking the result (from the comparison with the references)
1. **Acceptance criteria** in `task.md` (`## Acceptance criteria`, lines `- ACn: ...`) are the task's contract: observable, with numbers. The identifiers do not change after the plan is approved.
2. **End-to-end tracing:** request → criterion → plan step → evidence in `check`. Plan: every step serves at least one criterion (otherwise it is a step nobody asked for), every criterion has a step or an entry in `## Not covered by the plan` with a reason (the person sees this at approval). Check: a row for every criterion with evidence and a verdict; `PASS` without evidence that can be quoted is forbidden; `verdict: PASS` only when everything is `PASS`.
3. **The independent pass** (`skills/_shared/independent-review.md`): a sub-agent without the conversation history reads only the files. For `intake` it looks for where two implementers would do different things; for `check` it verifies the evidence criterion by criterion. Findings without a quote are discarded; `NO_FINDINGS` if nothing. The result goes into `## Independent review`; disagreements with its own conclusion are shown to the designer, the friendlier verdict is not silently chosen. Without a sub-agent the skill does the pass itself, but honestly writes "not run".
4. **The structural self-check:** `mf-gate verify <task|plan|check>` reads the artifact from disk and checks a fixed list of items (keys, template text, criteria and their coverage, frames that exist, sections). It prints `self-check: N/N pass` or the list of failed items; the skill fixes and repeats at most twice, and shows the remainder honestly. The self-check line is mandatory in the handoff. `mf-gate require plan` refuses with `task_incomplete`, `mf-gate approve plan|check` refuses with `plan_incomplete|check_incomplete` when the artifact does not pass the check.
5. **Origin:** ideas from SDD (`clarify`, `review`, `self-check`, acceptance criteria), `motion-design-with-claude` (only blocking questions, a reference as a direction, one diagnosis at a time) and aedev-tools (gathering context before changes, confirming destructive actions). Texts were not copied.

### 16.7 Language
1. **Everything in the repository (plugin, skills, templates, documents, code, tests, tool messages) is in English.** Ukrainian only in the chat with the designer: the agent produces it at run time (the skills say "talk to the designer in Ukrainian"). Exceptions: test strings that deliberately check non-ASCII (marked `non-ASCII test data`). The test `scripts/language.test.mjs` forbids Cyrillic in all other files. The original Ukrainian spec and task list are kept outside the repo in `_temp/uk/`.
2. **Artifact headings in English:** `## Description`, `## Acceptance criteria`, `## Known facts and assumptions`, `## Open questions` (task.md); `## Steps`, `## Not covered by the plan`, `## Risks`, `## Questions for the designer` (plan.md); `## Comparison with the plan`, `## Acceptance criteria`, `## Lint`, `## Frames`, `## Independent review`, `## Open questions` (check.md); `## Files`, `## Where to put them` (deliver.md); the tables `Target | Change | Expected result | Frame to check | Criteria` and `AC | Evidence | Verdict`. "Empty" is written as `- none`, "not run" as `not run: <reason>`. Where the sections above show Ukrainian headings, this section applies.
3. **The handoff block** is described in English (`What was done`, `What to check`, `Next command`) and printed to the designer in Ukrainian.

### 16.8 Creating a flow (`new-flow`)
1. **Before the dry run the designer's data is not lost:** the agent warns about the risk, asks to save and close unneeded AE projects, asks for explicit consent and only then runs `mf-gate archive --park` (the task files move to `.motion/archive/<id>/` marked `PARKED`, nothing is deleted). After the run the dry run is archived (`archive --abandon`), and the parked task comes back with `mf-gate restore <id>` byte for byte, with the plan approval still valid. `restore` does not overwrite a task that is already in `.motion/`.
2. **Examples are anonymous notes** (`example/README.md`: `## Example N` or `## Why only one example`), not files and not links to files: the designer can ask to delete an example after the flow is created, so the flow does not depend on the originals. At the end the agent offers to delete the working copies, dumps and drafts from `work/` (only with confirmation, only in `work/`).
3. **Language:** the agent writes the draft for approval in the language the designer speaks; after approval the final `SKILL.md`, `flow.md`, `example/README.md` are written in English, and their content is retold to the designer in their language.
4. **`mf-flow check <flow folder>`** (`lib/mf-flow.mjs`): files, frontmatter (`name` = folder name, `version` x.y.z, `owner`, `status`, `needs` from `deps.json`), at least 3 example phrases in `description`, the 8 sections of `flow.md`, the safety sentence, forbidden instructions (skipping gates and approvals, self-approval, `mf-gate approve`, writing to safety settings, `mf-setup`/`mf-init`, working with AE directly, dangerous commands, writing to Drive), no machine paths, Drive paths or e-mails, examples (no more than 200 KB, only `.md/.json/.txt`), English language.
5. **Origin:** `skill-creator` (Anthropic, Apache-2.0): first extract from the conversation what was already said, a "pushy" description for triggering, short realistic test phrases, explaining "why" instead of bare demands. Texts were not copied.

### 16.9 The flow lifecycle: update, publish, news
1. **`mf-flow bump <folder> <patch|minor|major> --note "<in English>"`:** raises `version` in `flow.md`, resets `status` to `draft` (a changed flow is reviewed again), adds an entry at the top of the flow's `CHANGELOG.md`. The note is one line, in English.
2. **`mf-flow pack <folder> [--out <path in work/>] [--overwrite]`:** only for a flow that passes `mf-flow check`; writes `work/out/flow-<name>-<version>.zip` (inside, the folder `<name>/` with SKILL.md, flow.md, example/, CHANGELOG.md; without `.DS_Store`, `node_modules`, links). It is our own zip writer with no dependencies and a fixed date, so the same flow gives the same bytes. A package of the same version is not overwritten again without `--overwrite`; writing only in `work/`.
3. **Review:** the designer copies the zip into `_flows-pending/` on Drive (the agent does not write to Drive); a technical person unpacks it into `flows/` of the rules repo, runs `mf-flow check`, reads the flow against `safety.md`, sets `status: approved`, appends to the rules `CHANGELOG.md` (flow `<name>`: ...), and commits; the team updates the plugin, and `/motion-flow:whats-new` shows the new flow.
4. **`mf-whatsnew`:** see 4.19; the first run shows only the last 3 releases.
5. **Origin:** `skill-creator` (improve mode: generalize from feedback, keep the instructions short, explain why; packaging that excludes service files) and the frontmatter checks from SDD's `validate_plugin.py`. Code was not copied.
