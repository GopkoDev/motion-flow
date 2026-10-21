# Motion Flow v2

Version 0.2.0 turns the repository into two plugins and a small shared core. This folder describes what changed and how the new parts work. The original single-plugin design is in [`../motion-flow-spec.md`](../motion-flow-spec.md); where the two disagree, this folder wins.

| Document | What it covers |
|---|---|
| [architecture.md](architecture.md) | The two plugins, the shared core and how it is copied, the release rule, what depends on what. |
| [studio-builder.md](studio-builder.md) | How the studio's design system and flows are learned from many examples: the pipeline, the files, the classification rules, the thresholds. |
| [flows-and-export.md](flows-and-export.md) | How a flow is learned from pairs, the evidence rule, publishing for review, and the standalone `.claude/` export. |
| [ae-project-switching.md](ae-project-switching.md) | When the tools close one After Effects project and open another, and when they refuse. |
| [migration-from-v1.md](migration-from-v1.md) | What moved, what was renamed, and what to do with an existing install or studio. |

## What v2 changes in one page

- **Two plugins, one catalog.** `motion-flow` is the gated pipeline (intake, plan, build, check, deliver). `studio-builder` builds the studio's rules and flows. They do not depend on each other.
- **Studio rules are a folder, not a plugin.** `~/Documents/studios/<studio>/` holds `rules/`, `flows/` and `CHANGELOG.md`. A project remembers its studio by name in `.motion/studio.json`.
- **Learning uses every example.** `sb-corpus` counts conventions over any number of projects in code. The agent reads a short report and asks only the questions the numbers cannot answer.
- **One command for the pipeline.** `/motion-flow:go` sets a project up on the first run, remembers Drive, studio and mode (ask or auto), and continues from where the task stopped.
- **No prompt on every file.** A project gets `defaultMode: acceptEdits` and allow rules for the plugin tools; the guard hook still asks for approvals and risky actions.
- **Projects switch by themselves** in After Effects when nothing can be lost.
