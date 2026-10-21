---
name: new-flow
description: Teach the studio a new repeatable kind of task (a "flow") from the examples. Use when the designer says "create a flow", "make a flow for ...", "I do this every time, can you learn it", "learn how I resize for all formats", or when motion-flow's intake finds no flow that fits a task that will come again. Takes any number of examples (before/after pairs, versions of a project, finished results), counts which changes repeat, interviews the designer only about what the examples cannot show, and writes a draft flow that is checked against the evidence.
model: inherit
---

# new-flow

A flow describes one kind of task that repeats: what starts it, what it needs, the steps in order, where a person decides, what must not be touched, and how to tell it is done. It is a folder `.claude/skills/<flow-name>/` of the current folder, marked `status: draft`. motion-flow runs it inside its five steps; `export-claude` turns it into a standalone skill. The designer knows how the work is done; this skill **learns from the designer's examples first** and interviews second.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md`, `socratic-loop.md`, `drive-access.md`, `studio-rules.md` and `handoff.md` (all in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/`).

## Languages

Talk to the designer, and write the working draft the designer will read and approve, in the language the designer uses (Ukrainian by default). The **final flow files** (`SKILL.md`, `flow.md`, `example/README.md`) are written in **English**, because they are shared with the team and with the tools. After writing them, give the designer a summary in their own language of what the English files say, and ask for confirmation.

## Steps

1. **Preflight.** `.motion/` and `.claude/settings.json` must exist; if not, run `sb-init --no-drive --no-studio` (it asks nothing and never overwrites). If the current folder is a studio folder, `mf-studio path` is not needed; the studio's rules may still be read if the designer works in a project with a studio.
2. **Capture what is already known.** If the conversation already contains the designer describing the work, extract the steps, the inputs and the corrections they made, and confirm them, instead of asking again.
3. **Ask for the examples**, all of them. For this kind of task: projects before and after the change (put each pair in a folder as `before.aep` and `after.aep`, or `input.aep` and `output.aep`), successive versions of one project (`spring_v07.aep`, `spring_v08.aep`), and finished results. Any number; two is the minimum, twenty is better. Put them under `work/examples/<flow-name>/` (a sub-folder per client or campaign if there are several), fetched with `drive-gate fetch <alias> <path> --to work/examples/<flow-name>/` or copied there by the designer. Also ask for the story, freely: how the task is done.
4. **Dump and count.** Run `sb-corpus dump --examples work/examples/<flow-name> --out work/corpus-<flow-name>`, then `sb-corpus analyze --out work/corpus-<flow-name>` (see `learn-studio` for how failures and unsaved projects are handled), and read `work/corpus-<flow-name>/report.md`. The part that matters here is "What designers change between versions": each *typical change* with the number of pairs that contain it ("comp added 1080x1920: 8 of 9 pairs"). Read `pairs.json` for the pairs whose changes differ from the rest.
5. **Name the steps from the evidence.** Turn the typical changes into proposed steps in plain words and show them with their support. Ask the designer, with `AskUserQuestion`, to sort them: **part of the flow** / **incidental to this project** / **wrong**. Changes in only some pairs are usually variants: ask what decides between them (a client, a format, a request) and make that a question the flow asks at intake. Where two pairs contradict each other (one adds a comp, one removes it), say so and ask which is right; do not average them.
6. **Interview only what the evidence leaves open**, following `socratic-loop.md`, one question at a time with options: what starts the task (the 3 phrases someone would say), the inputs, where a person must decide, what could go wrong, what must not be touched, how to tell it is done, which tools are needed (ffmpeg, whisper, ...). Skip everything the pairs already answered.
7. **Draft for approval, in the designer's language.** Write the draft to `work/flow-drafts/<flow-name>/draft.md` (private, can be deleted): the eight sections of `${CLAUDE_PLUGIN_ROOT}/templates/flow.md` in plain language, plus the **description** with 3 example phrases. Show it. Ask for corrections until the designer agrees, and ask for approval of the description **separately** ("these are the phrases that will start this flow"). Choose a short English kebab-case `<flow-name>` and confirm it.
8. **Write the final files in English** into `.claude/skills/<flow-name>/`:
   - `SKILL.md` from `${CLAUDE_PLUGIN_ROOT}/templates/flow-SKILL.md`: `name` equal to the folder, a pushy `description` that says what the flow does and when to use it, with the 3 approved phrases in quotes, `model: inherit`, how the flow changes each of the five motion-flow steps, and the safety section with the sentence "This flow does not change or weaken `_shared/safety.md`".
   - `flow.md` from `${CLAUDE_PLUGIN_ROOT}/templates/flow.md`: `name`, `version: 0.1.0`, `owner` (ask for the designer's name), `status: draft`, `needs` (tools from `deps.json`), and all eight sections.
   - `example/README.md`: **no copies and no names**. An `## Evidence` section that says how many examples and pairs were counted and which changes repeated ("18 examples in 4 groups, 9 version pairs; the 9:16 comp was added in 8 of 9 pairs"), and, for the odd cases, `## Example N` notes that describe the shape of the project with generic names (number of comps, kinds of layers, what changed). It contains no client names, texts, paths or file copies. The flow must still make sense when the original examples are gone.
   Explain to the designer, in their language, what the English files say, and ask for confirmation. A flow may add questions, steps and checks; it must never remove an approval gate, skip a check, widen access, or tell the agent to touch settings.
9. **Check the flow.** Run `mf-flow check .claude/skills/<flow-name>`. Fix what fails and run it again, at most twice; show anything still failing to the designer plainly. It checks the files, the frontmatter, the three phrases, the sections, the safety sentence, unsafe instructions, private data (machine paths, Drive paths, e-mails), the evidence and that the text is English.
10. **Check the flow against the evidence.** Compare `## Steps in order` with the typical changes: every change found in at least half of the pairs must be covered by a step (or be listed by the designer as incidental); every step must be backed by at least one pair, or be marked in `flow.md` as the designer's own rule. Show the table "step ↔ pairs that support it" to the designer and fix the gaps. This replaces a guess with a count.
11. **Try the phrases.** Propose 2-3 realistic things a designer would say to start this flow, including one that should not start it. Check by reading the description that it would be chosen for the right ones.
12. **Offer a rehearsal.** The flow is untested until it runs on real work. If motion-flow is installed, suggest the designer runs `/motion-flow:go` on a copy of one of the examples, and, if the result differs from what they made by hand, `/studio-builder:refine-flow`. Do not run the pipeline from here.
13. **Offer to clean up.** List what the work on this flow left in `work/` (`examples/<flow-name>/`, `corpus-<flow-name>/`, `flow-drafts/`) and ask whether to delete it, especially when the examples are client work. Delete only what the designer agrees to, only inside `work/` (Claude Code will ask for each removal), and never an original. The flow keeps only the evidence counts and anonymous notes.
14. **Hand off** (`handoff.md`): the flow folder `.claude/skills/<flow-name>/`, what to read (the summary and `flow.md`), the check line, the evidence line ("N examples, M pairs"), and the next command: `/studio-builder:publish-flow` to prepare it for the team's review, or `/studio-builder:export-claude` for a standalone skill. Say that the flow is still `draft`.

## Never

- Never put client names, texts, machine paths, Drive paths or copies of example files into the flow.
- Never change the designer's originals or touch any project that is not a copy in `work/`.
- Never write anything to Drive.
- Never write a step into the flow that the designer did not confirm. If something is unclear, it is a question, not a guess.
- Never make a flow that weakens `safety.md`; if the designer wants that, explain that a flow cannot, and why.
- Never claim a step is supported by examples without the count from `sb-corpus`.
