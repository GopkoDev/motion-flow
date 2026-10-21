# Studio rules: <studio name>

The index of this studio's rules, read by the motion-flow steps (found with `mf-studio path`). Read only the files a step needs (table below). Every rule file starts with `status: draft` or `status: confirmed`. If a file you read is `draft`, tell the designer once (in Ukrainian) which rule file it is and that it is only a draft, not confirmed, and follow it with extra care (ask when it matters). Never turn a draft into `confirmed` yourself; a person reads it and commits it.

Rule files are in the `rules/` folder next to this file.

| File | What it holds | Read it in |
|---|---|---|
| `rules/naming.md` | file, version, comp, layer and precomp names, with right and wrong examples and the version pattern | plan, build, check, deliver |
| `rules/project-template/` | the template project (fps, size, color, folder structure) | intake, build |
| `rules/motion-system.md` | easing curves, standard timings, palette, fonts, brand motion rules, what is forbidden | plan, build |
| `rules/protected.md` | what must not be touched and who to ask | plan, build, check |
| `rules/delivery.md` | formats, codecs, bitrate, sizes, safe zones, audio levels, where finals go | plan, deliver |
| `rules/drive.md` | Drive folder aliases (no machine paths), tree structure, version rules, where flow drafts wait for review | deliver, publish-flow |
| `rules/checks/` | declarative checks for `ae-lint` (JSON files) | check |
| `flows/` | approved flows, one folder each | intake |

`CHANGELOG.md` lists what changed in the rules and flows.

## How to use a rule

- A rule is a requirement, not a hint. If the designer's request conflicts with one, say which rule and ask which is right (see the shared `socratic-loop.md`); never pick silently.
- Project exceptions live in the project's `.motion/overrides.md`. An override applies only if it is written there.
- Do not copy rule text into project files; refer to the rule by file name.
