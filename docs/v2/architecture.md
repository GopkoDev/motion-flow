# Architecture

## Repository layout

```text
.claude-plugin/marketplace.json   the catalog "motion": motion-flow and studio-builder
plugins/
  motion-flow/                    the pipeline
    .claude-plugin/plugin.json
    skills/  agents/  hooks/  lib/  bin/  templates/  evals/  scripts/
  studio-builder/                 the studio and flow builder
    .claude-plugin/plugin.json
    skills/  hooks/  lib/  bin/  templates/  scripts/
shared/                           source of the code both plugins need
scripts/                          repository checks (sync-shared, language, catalog)
docs/                             v1 spec, schema notes, tasks; docs/v2 describes this version
```

## Why there is a `shared/` folder

Claude Code installs each plugin by copying that plugin's folder into a cache. An installed plugin therefore cannot read a sibling folder of the repository, and the two plugins must not require each other to be installed. Code that both need is kept **once** in `shared/` and **copied** into each plugin by `scripts/sync-shared.mjs`. The copies are committed, because the catalog installs from git.

What is shared:

| Area | Files |
|---|---|
| After Effects | `lib/ae-run.mjs`, `ae-launcher.mjs`, `ae-tools.mjs`, `jsx-source.mjs`, `dump-schema.mjs`, `lib/jsx/*.jsx`, `bin/ae-run`, `ae-dump`, `ae-render-frame` |
| Drive and paths | `lib/drive-gate.mjs`, `work-paths.mjs`, `bin/drive-gate` |
| Safety | `hooks/guard.mjs`, `hooks/hooks.json` |
| Studios | `lib/studios.mjs`, `bin/mf-studio` |
| Artifacts and tools | `lib/artifact.mjs` (frontmatter, sections), `lib/deps.mjs`, `deps.json` |
| Project setup | `lib/init-project.mjs` (each plugin has its own templates, so `mf-init` and `sb-init` differ) |
| Docs read by skills | `skills/_shared/drive-access.md`, `socratic-loop.md`, `studio-rules.md` |

Rules for shared code:

1. **Edit `shared/`, never the copy.** Each plugin has a `.shared.json` listing the copied files. Run `npm run sync` after an edit.
2. **`npm test` fails when a copy differs** from its source, when a file is missing, and when a file removed from `shared/` still exists in a plugin. Files that a plugin owns itself are never touched by the sync.
3. **Tests of shared code live in `motion-flow`** and run on its copy. The copies are byte-identical, so one run covers both.
4. **Command names do not collide with different behavior.** A tool that reads plugin-specific files has a different name in each plugin (`mf-init` and `sb-init`). Tools with identical copies (`ae-run`, `ae-dump`, `drive-gate`, `mf-studio`) may be on `PATH` twice; the lock file `work/.ipc/ae.lock` lives in the project, so two copies still coordinate.

## Releases

Both plugins carry the same version and are released together (`scripts/repo.test.mjs` checks it). `doctor` reports the installed versions and warns when they differ, because the shared tools must match. Bumping a version means editing both `plugin.json` files.

## What each plugin owns

| | motion-flow | studio-builder |
|---|---|---|
| Skills | `go`, `doctor`, `setup`, `init-project`, `intake`, `plan`, `build`, `check`, `deliver`, `whats-new` | `learn-studio`, `new-flow`, `refine-flow`, `publish-flow`, `export-claude` |
| Own tools | `mf-gate`, `mf-init`, `mf-setup`, `mf-doctor`, `ae-lint`, `aep-version`, `mf-sum`, `mf-whatsnew`, `mf-sheet` | `sb-corpus`, `sb-export`, `sb-init`, `mf-flow` |
| Templates | task, plan, check, deliver, overrides, project settings | studio scaffold, flow templates, studio-folder settings |
| Agent | `check-reviewer` | none |
| State in a folder | `.motion/` with task, plan, check, deliver, build log, `auto.json` | `work/examples/`, `work/corpus*/`, flow drafts in `.claude/skills/` |

The link from the pipeline to the builder is a message, not a call: `go` and `intake` tell the designer to run `/studio-builder:learn-studio` or `/studio-builder:new-flow` when there is no studio or no fitting flow. The builder's output (the studio folder) is what the pipeline reads through `mf-studio path`.

## Permissions

A project set up by `mf-init` (or a studio folder set up by `sb-init`) gets `defaultMode: acceptEdits` and `allow` rules for its plugin's tools, so writing files and running tools does not ask. The guard hook runs before the allow rules and still asks for approvals (`mf-gate approve`), switching auto mode on (`mf-gate auto on`), changing the Drive choice (`mf-init --drive`, `sb-init --drive`), `git push` and other risky actions, and it denies direct Drive access. A project may read, but not edit, the studios folder.
