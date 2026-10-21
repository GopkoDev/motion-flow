# <studio name> studio rules

The private rules and approved flows of the studio, read by the `motion-flow` plugin and exported by `studio-builder`. This is a plain folder: no plugin, no marketplace, nothing to install.

- `INDEX.md`: the index motion-flow steps read (which rule file is read by which step).
- `rules/`: naming, motion system, protected elements, delivery, Drive, the project template, and `ae-lint` checks. Every file is `status: draft` until a person has read it and confirmed it.
- `flows/`: approved flows, one folder each.
- `CHANGELOG.md`: what changed, one `## x.y.z` heading per release, flows named as flow `<name>`: ... (read by `/motion-flow:whats-new`).

Fill the rules in with `/studio-builder:learn-studio`, which interviews the designers and reads reference projects. A rule becomes `confirmed` only when a person has read it, changed `status` to `confirmed`, filled in `confirmed_by` and `confirmed_at`, and committed it.

## Using these rules

1. Keep every studio in one folder, one subfolder per studio: `~/Documents/studios/<studio>/` (this folder). `mf-studio dir` prints the folder; put `{"dir": "<path>"}` into `~/.motion-flow/studios.json` to use another one. Keep it outside Google Drive.
2. In each project of this studio, `/motion-flow:go` (first run) or `/motion-flow:init-project` asks which studio applies; it finds the studios by looking at the folder. The project remembers the name in `.motion/studio.json`.
3. Edits to the rules take effect at the next step; there is nothing to reload.

A freelancer working for several studios keeps one subfolder per studio and chooses exactly one studio per project.

To share the rules with a team, make this folder a git repository, push it to a private remote, and have everyone clone it into their studios folder; updates are a `git pull`.
