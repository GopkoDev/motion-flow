---
name: init-rules
description: Create the first draft of a studio's rules once, from reference projects and an interview with the designers. Use when a studio sets up motion-flow, or says "init rules", "створи правила студії", "заповни правила". Reads the Drive folder structure and reference After Effects projects, interviews the designer, and writes draft rule files with open questions. Never confirms a rule.
model: inherit
---

# init-rules

Runs once per studio, inside a checkout of the studio-rules repository. It learns the studio's conventions from what already exists (folder names, finished projects) and from the designers, and writes **drafts** of the rule files. A person must read and confirm each rule; this skill never does.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md`, `socratic-loop.md`, `drive-access.md`, `artifact-formats.md` and `handoff.md` (all in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/`). Talk to the designer in Ukrainian; write the rule files in the language the designers use (Ukrainian by default), keeping file names and commands as they are.

## Steps

1. **Prepare the checkout.**
   - The current folder must be a checkout of the studio-rules repository (or an empty folder that will become one). If `skills/studio-rules/SKILL.md` is missing, ask the studio name, then copy the scaffold: `cp -R "${CLAUDE_PLUGIN_ROOT}/templates/studio-rules/." .` and replace the placeholders:
     - `<studio name>` in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/studio-rules/SKILL.md` and `README.md`;
     - the plugin name: ask for a short studio slug (lowercase letters, digits and hyphens, for example `acme`) and set the name to `<slug>-rules` in `plugin.json` (`name`), in `marketplace.json` (the marketplace `name` and the plugin entry `name`, both `<slug>-rules`). The name must be unique on this computer (a freelancer may keep rules for several studios) and must not start with `claude` or `anthropic`. The skill inside keeps the name `studio-rules`; it is namespaced by the plugin.
     - Tell the designer the install lines from the scaffold's `README.md` ("Using these rules").
   - If rule files already exist with content, ask whether to refine them or start over. Never overwrite a file with content without the designer's explicit yes.
   - The tools need a project folder: if `.motion/drive.json` is missing, run the steps of `/motion-flow:init-project` here (Drive is chosen in step 2 below). `work/` is where reference projects are copied; it is not committed.
2. **Ask which Drive folders and which projects.** With `AskUserQuestion`: which Drive folders the studio uses (the aliases, for example `assets` and `projects`; set up on this computer with `/motion-flow:setup` if needed), and which 1-2 **finished, typical** projects to learn from (alias and path of each `.aep`). Enable those aliases for this folder (`mf-init --drive <aliases>`).
3. **Read the folder structure.** With `drive-gate ls` and `drive-gate info` only (never a Drive path directly): list the top level of each alias, then sample two or three levels down. Do not walk the whole tree; a few listings per level are enough. Note how folders and files are named: client and campaign folders, version suffixes, final folders, odd names.
4. **Dump the reference projects.** For each: `drive-gate fetch <alias> <path> --to work/`, then `ae-dump --project work/<path> --out work/dumps/ref-<n>.json`. (The media is not needed; the dump lists it as missing and that is fine.) Read each dump and note: frame rates, comp sizes and durations, comp and precomp names, layer names (and how many are default names), fonts, effects used, expressions, how keyframes are eased, how precomps are organised. Keep client names and project contents out of everything you write later: use `<Client>`, `<Campaign>` and generic examples.
5. **Interview the designer** (`socratic-loop.md`, detailed depth). One question at a time, with the observations as options to confirm or correct. Cover:
   - naming: is what you saw the rule, or only habit? what is wrong?
   - what must never be touched (reference comps, brand precomps), who to ask, how a change is requested;
   - how versions are approved and where older versions go;
   - delivery: formats, codecs, sizes, frame rates, audio levels, safe zones, the exact names of the output module and render settings templates in their After Effects, where finals go;
   - how assets are collected for a project; the project template (frame rate, size, color settings, folders);
   - what the studio motion system says about easing, timings, palette and fonts, and what is forbidden.
   Do not ask what the dumps already answer; ask whether it is correct.
6. **Write the drafts.** Fill `rules/naming.md`, `motion-system.md`, `protected.md`, `delivery.md`, `drive.md` and `rules/project-template/README.md` from the scaffold's sections, in the designers' own words.
   - Every file keeps `status: draft` with `confirmed_by` and `confirmed_at` empty. Never write `status: confirmed`.
   - Mark each statement that comes from observation and is not confirmed by the designer with `TODO: підтвердити`.
   - Set `version_regex` in `naming.md` only if the version pattern is clear; otherwise leave the default and mark it.
   - Put no machine paths, client names or real project contents in the files; aliases and placeholders only.
   - Add a check to `rules/checks/` only when the designer explicitly confirmed that rule (copy from `rules/checks/_examples/` and adjust). A wrong check blocks good work, so when in doubt leave it out and list it as an open question.
   - Add a line to `CHANGELOG.md` ("Draft rules created by init-rules").
7. **List the open questions.** Print everything still unclear or unconfirmed, grouped by file. Save the same list as `rules/OPEN-QUESTIONS.md` (the designers delete it once answered).
8. **Hand off** (`handoff.md`) with these instructions for the designers: read each rule file; fix what is wrong; for each rule they agree with, change `status` to `confirmed`, fill `confirmed_by` and `confirmed_at`, and commit. Until then, steps that read a `draft` rule will warn. Next command: nothing is required; the team can start with `/motion-flow:intake`.

## Never

- Never set `status: confirmed`, `confirmed_by` or `confirmed_at`.
- Never write to Drive; Drive is read through `drive-gate` only, and only the aliases enabled for this folder.
- Never copy a client's project contents, names or texts into a rule file.
- Never decide a convention the dumps and the designer do not support; list it as an open question.
