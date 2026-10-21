# Safety rules

Every skill of studio-builder follows these rules. They are also enforced by code (the guard hook, the deny rules, `drive-gate`, `ae-run`), but follow them yourself first: a refusal from a tool means you were about to break one.

## The invariants

1. **Work only on copies in `work/`.** Example projects and originals (on Drive or elsewhere) are never changed. Examples are read with `ae-dump`, which never changes a project.
2. **No delete, move or rename on Drive**, ever. No write of any kind to Drive.
3. **Never touch a Drive folder directly.** No `cat`, `ls`, `cp`, Read, Grep, Glob or Bash on its path: only `drive-gate`. See `drive-access.md`.
4. **Install nothing.** Not with a package manager, not with a script. If a tool is missing, show the install command and let the designer run it.
5. **A rule or a flow is a draft until a person confirms it.** Never write `status: confirmed`, `confirmed_by`, `confirmed_at`, `reviewed` or `approved` yourself. A flow may add steps, questions and checks; it may never remove an approval gate, skip a check, widen access, or touch settings.
6. **Examples are client work.** Keep them as counts, patterns and anonymous notes. No client names, project texts, footage details, machine paths or Drive paths in a rule, a flow or a report that leaves `work/`. A client or campaign folder name is a client name: name it in a rule only if the designer agrees the studio rules may.
7. **When something unexpected happens, stop and ask.** A missing file, an AE error, a project with unsaved changes open in After Effects: stop, say what you saw, ask.
8. **Be honest about evidence.** Say how many projects support a convention ("18 of 20"). A convention seen in fewer than three projects is not a convention. A guess is a question.

## Operating rules

- **After Effects only through `ae-run`, `ae-dump`, `ae-render-frame` and `sb-corpus`.** Never start AE, `aerender` or ExtendScript another way. `ae-dump` switches the open project by itself only when the open one is saved and unchanged; otherwise it stops and asks the designer to save or close it.
- **Count in code, judge in the conversation.** Use `sb-corpus` to count conventions over all the examples; read its short report, not the dumps. Open a single dump only to check a specific outlier.
- **Never write to `~/.motion-flow/`, `.claude/settings*.json`, or `.motion/drive.json` yourself.** They hold the safety settings. Use `sb-init` for them, and only when the designer chose it.
- **No git push, no force, no history rewrites.** `git` in a studio folder is optional and local; ask before committing anything.
- **Do not work around a block.** If the guard hook or a deny rule stops a command, do not try another spelling of it. Tell the designer what was blocked and what to do instead.
