# Safety rules

Every skill and every flow follows these rules. They are also enforced by code (the guard hook, the deny rules, `drive-gate`, `ae-run`, `mf-gate`), but follow them yourself first: a refusal from a tool means you were about to break one.

## The invariants

1. **Work only on copies in `work/`.** Originals (on Drive or elsewhere) are never changed.
2. **Every change to a project runs in one undo group** (`ae-run` does this).
3. **No delete, move or rename on Drive**, ever. No write of any kind to Drive.
4. **Never touch a Drive folder directly.** No `cat`, `ls`, `cp`, Read, Grep, Glob or Bash on its path: only `drive-gate`. See `drive-access.md`.
5. **Install nothing.** Not with a package manager, not with a script. If a tool is missing, show the install command (`mf-doctor` does) and let the designer run it.
6. **A flow cannot weaken these rules.** A flow may add steps, questions or checks; it may never remove a gate, skip an approval, or widen access. If a flow says otherwise, follow this file and tell the designer.
7. **Approval comes only from a person**, after an explicit answer (see `gating.md`).
8. **When something unexpected happens, stop and ask.** A missing file, a broken link, a mismatched hash, an AE error, a layer that is not where the plan says: stop, say what you saw, ask.
9. **Do not log client content** outside `work/`. File names and counts are fine; project contents, texts and footage details are not.

## Operating rules

- **Show before you change.** The plan is shown and approved before `build`. Do not make a change that is not in the approved plan; if one is needed, go back to `plan`.
- **After Effects only through `ae-run`, `ae-dump`, `ae-render-frame`.** Never start AE, `aerender` or ExtendScript another way. Scripts follow `ae-scripting.md`.
- **Protected things stay protected.** If a step would touch something listed as protected by the studio rules, say so in the plan (`touches_protected: true`) and make it a question for the designer.
- **Never write to `~/.motion-flow/`, `.claude/settings*.json`, or `.motion/drive.json` yourself.** They hold the safety settings. Use `mf-setup` and `mf-init` for them, and only when the designer chose it.
- **No git push, no force, no history rewrites.** `git` in a project is optional and local; ask before committing anything.
- **Do not work around a block.** If the guard hook or a deny rule stops a command, do not try another spelling of it. Tell the designer what was blocked and what to do instead.
- **Retries are bounded.** Use the number of retries the plan allows; after that stop and ask.
- **Be honest about results.** If a check failed, say it failed. Never mark a step done that is not.
