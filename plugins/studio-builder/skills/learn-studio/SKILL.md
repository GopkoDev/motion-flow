---
name: learn-studio
description: Build a studio's design system (naming, motion system, protected items, delivery, Drive layout, checks) from many example projects. Use when a studio sets up motion-flow, or the designer says "learn the studio", "create the studio rules", "build the design system from my projects". Reads as many examples as the designer provides, counts the conventions in code, settles contradictions on its own where the examples decide, asks only the questions they cannot, and writes draft rule files. Never confirms a rule.
model: inherit
---

# learn-studio

Runs once per studio, inside the studio's own folder (`~/Documents/studios/<studio>/`, see `mf-studio dir`), and again when more examples arrive. It learns the studio's conventions from what already exists: **as many example projects as the designer can provide**, with a count of how many support each convention. It settles contradictions between examples by itself where the numbers decide, and asks the designer only what the examples cannot answer. It writes **drafts**; a person must read and confirm each rule, and this skill never does.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md`, `socratic-loop.md`, `drive-access.md`, `studio-rules.md` and `handoff.md` (all in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/`). Talk to the designer in Ukrainian. Write the rule files in **English**: they are read by every step and shared with the team and the tools. Quote names that must match exactly (layer, comp, font, template names) as they are.

## Steps

1. **Prepare the studio folder.**
   - The current folder must be the studio's folder, a direct subfolder of the studios folder (`mf-studio dir`). If it is not, tell the designer: create `<studios folder>/<studio slug>` (a short lowercase name with letters, digits and hyphens, for example `acme`), open Claude Code there and run this command again; then stop. The slug is the studio's name for every project, so it must be unique in that folder.
   - If `INDEX.md` is missing, ask the studio's display name, then copy the scaffold **without overwriting anything**: `cp -Rn "${CLAUDE_PLUGIN_ROOT}/templates/studio-rules/." .` (`-n` keeps every file that already exists, so rules moved here from an older studio are never replaced). Replace `<studio name>` only in the `INDEX.md` and `README.md` that this copy created.
   - If rule files already exist with content, ask whether to refine them with the new examples or start over. Never overwrite a file with content without the designer's explicit yes.
   - If `.motion/drive.json` is missing, run `sb-init --no-drive --no-studio` (fallback: `node "${CLAUDE_PLUGIN_ROOT}/bin/sb-init" ...`): it creates `work/`, `.motion/` and the safety settings, and asks nothing. Drive is chosen in step 2.
2. **Ask for the examples.** With `AskUserQuestion`, in plain words:
   - **Give me everything you have, the more the better.** Typical finished projects, older versions, projects of different clients and campaigns, even ugly ones. Do not pick only the best: the counts need the real mix. Fifty is fine.
   - Where they are: Drive folders (the aliases, set up with `/motion-flow:setup` if needed; `sb-init --drive <aliases>` enables them here) and/or files already in `work/examples/`.
   - Sub-folders by client or campaign help: the first folder under `work/examples/` is a *group*, and the analysis can tell "this is how client A works" from "this is how the studio works".
   - Which projects are known to be **old, wrong or experimental** (names or folders). They are still counted, but the report can label a convention that only they follow as legacy.
3. **Fetch the examples.** Browse with `drive-gate ls` and `drive-gate info` (never a Drive path directly), then `drive-gate fetch <alias> <path> --to work/examples/<group>/` for each folder, in batches. Do not bring linked footage (`--with-deps` is not needed): the analysis reads the project structure; missing media is counted, not a problem. Count what arrived (`find work/examples -name '*.aep'`) and tell the designer the number. Also list the top levels of the Drive folders (a few listings per level, not the whole tree) to learn how folders and final files are laid out.
4. **Dump every example.** Run `sb-corpus dump --examples work/examples --out work/corpus`. It opens the projects in After Effects one at a time (it switches projects by itself, but never closes one with unsaved changes), so it may take a while: tell the designer to leave After Effects alone until it ends. It reuses dumps that are up to date, so an interrupted run continues where it stopped. If projects failed, show each reason in plain words (usually: another project with unsaved changes is open; ask the designer to save and close it), then run the same command again.
5. **Count.** Run `sb-corpus analyze --out work/corpus`, then read `work/corpus/report.md`: a short report of every convention with its support ("45 of 50 projects"), the standard sets (fonts, sizes, effects, easing), and the questions only a person can answer. Do not read the dumps; open one project's dump only to check a specific outlier the report names.
6. **Settle the contradictions.** The report classifies each convention:
   - `consensus`, `majority`, `legacy_shift`: take the proposal. Say so and give the numbers ("25 fps in 45 of 50 projects; the 5 others are older").
   - `context_split`: the value depends on the group (client or campaign). Write it as a rule per group. Group names are client names: ask once whether the rules may name the clients, otherwise call the groups "group A / group B" and keep the mapping only in the chat.
   - `conflict`, `scattered`: these are the questions. Ask them together with `AskUserQuestion` (up to four per call, each with the values and their shares as options and the proposal first as the recommended one). Do not ask anything the report already decided.
   - `too_few` (under three projects): not a convention. Do not write a rule from it; say that more examples are needed.
   Then show the designer, in one table, what was **decided from the examples** (feature, value, support) and ask one question: "Is anything here wrong?". A correction overrides the count; write it down as a decision of the designer.
7. **Ask only what the examples cannot show.** One question at a time (`socratic-loop.md`), each starting from what you saw: what must never be touched and who to ask; how versions are approved and where older versions go; the delivery formats (codecs, bitrate, safe zones, audio levels, the exact names of the output module and render settings templates in their After Effects, where finals go); how assets are collected; what the motion system intends (the easing and timings the report found are what is *used*; ask what is *meant*, and what is forbidden). Skip every question the report or the Drive listing already answered.
8. **Write the drafts.** Fill `rules/naming.md`, `motion-system.md`, `protected.md`, `delivery.md`, `drive.md` and `rules/project-template/README.md` from the scaffold's sections.
   - Every file keeps `status: draft` with `confirmed_by` and `confirmed_at` empty. Never write `status: confirmed`.
   - Give the support of every statement taken from the examples ("45 of 50 projects"), and mark with `TODO: confirm` each one below `consensus` and each one only the designer said.
   - Set `version_regex` in `naming.md` from the file name pattern only if the pattern is clear; otherwise leave the default and mark it.
   - Put no machine paths, client names (unless allowed in step 6) or real project contents in the files; aliases and placeholders only.
   - Add a check to `rules/checks/` only when the designer explicitly confirmed that rule (copy from `rules/checks/_examples/` and adjust). A wrong check blocks good work, so when in doubt leave it out and list it as an open question.
   - Add a line to `CHANGELOG.md` ("Draft rules created from N example projects").
9. **List what is still open.** Save everything unclear or unconfirmed, grouped by file, as `rules/OPEN-QUESTIONS.md` (the designers delete it once answered), and keep `work/corpus/report.md` (private, not committed) as the evidence behind the numbers.
10. **Offer to clean up.** The examples may be client work: list what `work/examples/`, `work/corpus/` and `work/dumps/` hold and ask whether to delete it. Delete only what the designer agrees to, only inside `work/` (Claude Code will ask for each removal), and never an original.
11. **Hand off** (`handoff.md`): the rule files written, how many examples were counted, what was decided automatically and what was asked, and these instructions for the designers: read each rule file; fix what is wrong; for each rule they agree with, change `status` to `confirmed`, fill `confirmed_by` and `confirmed_at`, and commit. Until then, steps that read a `draft` rule will warn. Next: `/studio-builder:new-flow` for the first flow, or `/studio-builder:export-claude` for a standalone `.claude/`.

## Never

- Never set `status: confirmed`, `confirmed_by` or `confirmed_at`.
- Never write to Drive; Drive is read through `drive-gate` only, and only the aliases enabled for this folder.
- Never copy a client's project contents, names or texts into a rule file.
- Never write a rule from fewer than three projects, and never present a count you did not get from `sb-corpus`.
- Never decide a convention the counts and the designer do not support; list it as an open question.
