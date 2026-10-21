# Studio builder: learning a studio from many examples

`/studio-builder:learn-studio` builds the draft rule files of a studio. This document describes what happens between "here are my projects" and the drafts, and why the counting is done in code.

## The pipeline

```text
examples (any number)                 work/examples/[group/]...aep
  │  sb-corpus dump                   After Effects, one project at a time, via ae-dump
  ▼
dumps                                 work/corpus/index.json, <id>.dump.json
  │  sb-corpus analyze                counting in code, no model involved
  ▼
analysis                              work/corpus/analysis.json, pairs.json, report.md
  │  the agent reads report.md
  ▼
decisions: automatic ones + one batch of questions for the real ties
  │
  ▼
drafts                                rules/*.md (status: draft), rules/OPEN-QUESTIONS.md
```

All of it stays inside `work/`. The report, the dumps and the examples are client work: the skill offers to delete them at the end, and the rule files carry counts and patterns, not names or content.

## Examples

- Any number of `.aep` files under `work/examples/`. Fetch them from Drive with `drive-gate fetch <alias> <path> --to work/examples/<group>/` (without linked footage; the dump counts missing media, it does not need it).
- The **first folder below `work/examples/` is the group** (a client or a campaign). Groups let the analysis tell "this is how client A works" from "this is how the studio works". Files directly in `work/examples/` have no group.
- Mixed quality is wanted. The counts need the real mix, and the designer can list projects known to be old or experimental so the report can call a convention that only they follow *legacy*.

## `sb-corpus dump`

`sb-corpus dump --examples work/examples [--out work/corpus]`

1. Finds every `.aep` below the folder (skipping hidden folders and `Adobe After Effects Auto-Save`) and gives each an id, `p001-<file stem>`, in sorted order.
2. Runs `ae-dump` on each project, **one at a time**. `ensureProject` switches the open project by itself when it is saved and unchanged (see [ae-project-switching.md](ae-project-switching.md)); otherwise that project fails with the reason.
3. Reuses a dump that is newer than its project, so an interrupted run continues where it stopped. A failure never stops the run; the failed projects are listed with their reason in the answer and in `index.json`.
4. Writes `index.json`: for every project its id, file, path, group, folder, modification time, dump file and result.

The paths must be inside `work/`; anything else is refused (`outside_work`). The exit code is 1 when any project failed, 0 otherwise.

## `sb-corpus analyze`

`sb-corpus analyze [--out work/corpus]` reads `index.json` and the dumps (a dump that is unreadable or fails `validateDump` is skipped and reported, never trusted) and writes `analysis.json`, `pairs.json` and `report.md`.

### Facts per project

From each dump the tool extracts:

| Kind | Features |
|---|---|
| One value per project | file name pattern, frame rate (the most common across comps), bit depth, default layer names (`none` / `a few` / `many`), expressions (`used` / `not used`) |
| A set per project | comp sizes, comp name patterns, layer name patterns (default names excluded), fonts, effects, easing curves, layer types |
| Numbers | median gap between keyframes (seconds), number of missing footage items |

**Name patterns** describe how a name is built, not what it says. Each token is classified (`v#` for `v07`, `WxH` for `1920x1080`, `#`, `#unit` for `25fps`, `UPPER`, `lower`, `Title`, `Mixed`) and the tokens are joined by the separators of the name, so `FINAL_Spring_1920x1080` becomes `UPPER_Title_WxH` and `Logo reveal 02` becomes `Title lower #`.

### Classifying one-value features

Let *lead* be the most common value and *share* the fraction of projects holding a value. With at least three projects:

| Kind | Condition | Result | Needs a person |
|---|---|---|---|
| `consensus` | lead share ≥ 0.8 | the lead is the convention; exceptions are named, and called legacy when all of them are older than the typical lead project | no |
| `context_split` | not consensus, and inside each group (at least two projects) one value holds ≥ 0.9, with at least two different values across groups | no single value; the note lists the value per group and the rule is written per group | no |
| `legacy_shift` | the two leading values are close (≥ 0.3 each, within 0.2) and every project with one of them is older than the median project with the other | the newer value | no |
| `conflict` | the two leading values are close (≥ 0.3 each, within 0.2) and neither groups nor age explain it | the lead is offered as a default | **yes** |
| `majority` | lead share ≥ 0.5 and the runner-up clearly behind | the lead; exceptions named | no |
| `scattered` | none of the above (no value holds half) | none | **yes** |
| `too_few` | fewer than three projects have the feature | none; no rule may be written | no |

The thresholds live in `THRESHOLDS` in `plugins/studio-builder/lib/corpus.mjs` and are covered by tests. Age is the file's modification time.

### Classifying set features

For each value the share of projects that use it: **standard** (≥ 0.8), **common** (0.3 to 0.8), **rare** (< 0.3, listed with the projects that use it). Sets never produce a question; they feed the drafts (the standard fonts, the standard sizes, the easing in use).

### The report

`report.md` is short on purpose: a table of conventions with kind, proposal and support; the sets; the questions for a person (each with its options, shares and example projects); the projects with missing footage; and, when there are version pairs, "what designers change between versions" (see [flows-and-export.md](flows-and-export.md)). With fewer than three projects it says so and treats everything as a listing.

## How the skill decides

`learn-studio` follows the classification:

1. `consensus`, `majority`, `legacy_shift` are taken as proposed, with the numbers said aloud ("25 fps in 45 of 50 projects; the other 5 are older").
2. `context_split` becomes a rule per group. Group names are client names, so the skill asks once whether the rules may name them; otherwise the groups are "group A / group B" in the chat only.
3. `conflict` and `scattered` are the questions: asked together (up to four per call) with the values, their shares and the proposal first as the recommended answer.
4. `too_few` produces no rule.
5. The designer sees one table of what was decided from the examples and answers one question: "is anything here wrong?". A correction overrides the count and is written as the designer's decision.
6. Only then does the interview start, for what examples cannot show: protected items and who to ask, how versions are approved, delivery formats and render templates, how assets are collected, what the motion system *intends* and forbids.

## What is written

`rules/naming.md`, `motion-system.md`, `protected.md`, `delivery.md`, `drive.md` and `rules/project-template/README.md`, all `status: draft` with `confirmed_by` and `confirmed_at` empty. Every statement from the examples carries its support; every one below `consensus`, and every one only the designer said, carries `TODO: confirm`. A check goes into `rules/checks/` only when the designer explicitly confirmed that rule. `rules/OPEN-QUESTIONS.md` lists what is still open. The skill never sets `confirmed`; a person reads, fixes, confirms and commits.

Running the skill again with more examples refines the existing drafts instead of overwriting them, and asks before touching a file that has content.
