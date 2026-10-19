# <studio name> studio rules

The private rules and approved flows of the studio, used by the `motion-flow` plugin.

- `skills/studio-rules/SKILL.md`: the index motion-flow steps read.
- `rules/`: naming, motion system, protected elements, delivery, Drive, the project template, and `ae-lint` checks. Every file is `status: draft` until a person has read it and confirmed it.
- `flows/`: approved flows, one folder each.
- `CHANGELOG.md`: what changed (read by `/motion-flow:whats-new`).

Fill the rules in with `/motion-flow:init-rules`, which interviews the designers and reads reference projects. A rule becomes `confirmed` only when a person has read it, changed `status` to `confirmed`, filled in `confirmed_by` and `confirmed_at`, and committed it.

## Using these rules

This folder is both a plugin and its own small catalog (`.claude-plugin/marketplace.json`), so no GitHub is needed. The plugin has a unique name, `<studio>-rules` (for example `acme-rules`), so rules of several studios can live side by side on one computer.

1. Add the folder once: `/plugin marketplace add <path to this folder>`.
2. In each project of this studio: `/motion-flow:init-project` and choose this studio's rules. That enables `<studio>-rules@<studio>-rules` in the project's `.claude/settings.json`; install it once on the computer with `claude plugin install <studio>-rules@<studio>-rules --scope project`.
3. Edits to the rules take effect after `/reload-plugins` or in a new session.

A freelancer working for several studios keeps one folder per studio and enables only that studio's plugin in each project, never at user scope.

To share the rules with a team, push this folder to a private git repository and add it to the team's catalog.
