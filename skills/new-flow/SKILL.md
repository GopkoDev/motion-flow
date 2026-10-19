---
name: new-flow
description: Teach the studio a new repeatable kind of task (a "flow") together with a designer. Use when the designer says "create a flow", "make a flow for ...", "I do this every time, can you learn it", "teach the system how I resize for all formats", or when intake finds no flow that fits a task that will come again. Interviews the designer, learns from real examples, writes the flow, and rehearses it on a copy before anything is saved for the team.
model: inherit
---

# new-flow

A flow tunes the five steps (`intake`, `plan`, `build`, `check`, `deliver`) for one kind of task that repeats. The designer knows how the work is done; this skill interviews the designer, looks at real examples, writes the flow, and rehearses it on a copy. The result is a folder in the project's `.claude/skills/<flow>/`, marked `status: draft`, ready to be reviewed with `/motion-flow:publish-flow`.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md`, `socratic-loop.md`, `drive-access.md`, `gating.md`, `artifact-formats.md` and `handoff.md` (all in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/`).

## Languages

Talk to the designer, and write the working draft the designer will read and approve, in the language the designer uses (Ukrainian by default). The **final flow files** (`SKILL.md`, `flow.md`, `example/README.md`) are written in **English**, because they are shared with the team and with the tools. After writing them, give the designer a summary in their own language of what the English files say, and ask for confirmation.

## Steps

1. **Preflight and data safety.** Look at the project before anything else.
   - `.motion/` and `.claude/settings.json` must exist; if not, send the designer to `/motion-flow:init-project` and stop.
   - Run `mf-gate status`. The rehearsal (step 11) runs the five steps in this project's `.motion/` folder, so a task that is in progress there must be set aside first. If one exists, **warn the designer clearly, in plain words, before doing anything**:
     - which task it is, and that it will be set aside, not deleted: its files move to `.motion/archive/<task id>/` and come back with one command (`mf-gate restore <task id>`);
     - that originals in Drive and in After Effects are never changed (the rehearsal works on copies in `work/`);
     - the risk: if something goes wrong during the rehearsal, the task's files are still safe in the archive, but anything not saved in After Effects could be lost if After Effects is closed or crashes. Ask the designer to **save every open After Effects project now** (Cmd/Ctrl+S) and to close projects that are not needed, because `ae-run` refuses to work while another project is open.
     - Ask with `AskUserQuestion`: "I saved my work and want to continue" / "Not now". Only after the first answer, run `mf-gate archive --park`, and remember the task id for step 13.
   - If a delivered task is still in `.motion/`, run `mf-gate archive` (nothing is lost).
2. **Capture what is already known.** If the conversation already contains the designer describing the work, extract the steps, the inputs and the corrections they made, and confirm them, instead of asking again.
3. **Story and a real example.** Ask the designer to tell, freely, how the task is done, and to point to one real example: the input files (a Drive alias and path, or a file under `work/`), the project, and the finished result they made by hand. The examples are used for learning only (see step 6).
4. **Interview**, following `socratic-loop.md` at the detailed depth, one question at a time with options where possible. Cover: what starts the task (the 3 phrases someone would say), the inputs, the steps in order, where a person must decide, what could go wrong, what must not be touched, how to tell it is done, which tools are needed (ffmpeg, whisper, ...).
5. **Look at the real example** and compare it with the story. Fetch the files into `work/flow-examples/<n>/` with `drive-gate fetch` (or use the files already in `work/`), run `ae-dump` on the project, and read the dump. Point out differences in plain words ("you said three formats, the project has five comps"), and ask which is right.
6. **At least two different examples**, or a clear answer to "what makes this case unusual?" (written down as `## Why only one example`). **Examples are kept as anonymous notes, never as files.** The designer may have the example deleted after the flow is made, so nothing in the flow may depend on the original files. `example/README.md` describes, for each example, what shape of project it was (number of comps, kinds of layers, what changed) with generic names; it contains no client names, texts, paths or file copies. The flow must still make sense when the original example is gone.
7. **Draft for approval, in the designer's language.** Write the draft to `work/flow-drafts/<flow-name>/draft.md` (this folder is private and can be deleted): the eight sections of `${CLAUDE_PLUGIN_ROOT}/templates/flow.md` in plain language, plus the **description** with 3 example phrases. Show it. Ask for corrections until the designer agrees, and ask for approval of the description **separately** ("these are the phrases that will start this flow"). Choose a short English kebab-case `<flow-name>` and confirm it.
8. **Write the final files in English** into `.claude/skills/<flow-name>/`:
   - `SKILL.md` from `${CLAUDE_PLUGIN_ROOT}/templates/flow-SKILL.md`: `name` equal to the folder, a pushy `description` that says what the flow does and when to use it, with the 3 approved phrases in quotes, `model: inherit`, how the flow changes each of the five steps, and the safety section with the sentence "This flow does not change or weaken `_shared/safety.md`".
   - `flow.md` from `${CLAUDE_PLUGIN_ROOT}/templates/flow.md`: `name`, `version: 0.1.0`, `owner` (ask for the designer's name), `status: draft`, `needs` (tools from `deps.json`), and all eight sections.
   - `example/README.md`: the anonymous notes from step 6 (`## Example 1`, `## Example 2`, or `## Why only one example`).
   Explain to the designer, in their language, what the English files say, and ask for confirmation. A flow may add questions, steps and checks; it must never remove an approval gate, skip a check, widen access, or tell the agent to touch settings.
9. **Check the flow.** Run `mf-flow check .claude/skills/<flow-name>`. Fix what fails and run it again, at most twice; show anything still failing to the designer plainly. It checks the files, the frontmatter, the three phrases, the sections, the safety sentence, unsafe instructions, private data (machine paths, Drive paths, e-mails), the examples and that the text is English.
10. **Try the phrases.** Propose 2-3 realistic things a designer would say to start this flow, including one that should not start it. Check by reading the description that it would be chosen for the right ones. (A real trigger test is part of the later evals.)
11. **Rehearse (dry run).** Copy the example project into `work/dryrun/` (a copy, never the original) and run the five steps on it with this flow: `/motion-flow:intake` with the flow chosen, then `plan`, `build`, `check`, and `deliver` without rendering a video. The normal gates apply: the designer approves the plan and the check. At each step tell the designer how the flow shaped it. Then ask for the result the designer made by hand for the same example, run `ae-dump` on it, and compare it with the rehearsal result; describe every difference in plain words ("you moved the logo 20 px lower", "you left the subtitles at 25 fps") and ask which is right. Change the flow files accordingly, tell the designer what changed in their language, run `mf-flow check` again, and repeat. After three rounds without agreement, stop and ask how to proceed.
12. **Finish the rehearsal.** The rehearsal is not a real delivery: run `mf-gate archive --abandon` so the rehearsal's files are kept in `.motion/archive/` and `.motion/` is free again.
13. **Give the designer their work back.** If a task was set aside in step 1, restore it with `mf-gate restore <task id>` and tell the designer it is back exactly as it was (the plan approval is still valid). If restoring fails, say so and give the exact command to run.
14. **Offer to clean up.** List what the work on this flow left in `work/` (`flow-examples/`, `dryrun/`, `flow-drafts/`, dumps) and ask whether to delete it, especially when the examples are client work. Delete only what the designer agrees to, only inside `work/` (Claude Code will ask for each removal), and never an original. The flow keeps only the anonymous notes.
15. **Hand off** (`handoff.md`): the flow folder `.claude/skills/<flow-name>/`, what to read (the summary and `flow.md`), the check result, and the next command `/motion-flow:publish-flow` to prepare it for the team's review. Say that the flow is still `draft`.

## Never

- Never put client names, texts, machine paths, Drive paths or copies of example files into the flow.
- Never change the designer's originals or touch any project that is not a copy in `work/`.
- Never write anything to Drive.
- Never approve a plan or a check yourself; the designer approves, through the normal gates.
- Never write a step into the flow that the designer did not confirm. If something is unclear, it is a question, not a guess.
- Never make a flow that weakens `safety.md`; if the designer wants that, explain that a flow cannot, and why.
