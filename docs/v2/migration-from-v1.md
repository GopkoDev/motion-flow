# Migrating from v1

## What moved

| v1 | v2 |
|---|---|
| repository root is the `motion-flow` plugin | `plugins/motion-flow/` |
| `/motion-flow:init-rules` | `/studio-builder:learn-studio` |
| `/motion-flow:new-flow` | `/studio-builder:new-flow` |
| `/motion-flow:refine-flow` | `/studio-builder:refine-flow` |
| `/motion-flow:publish-flow` | `/studio-builder:publish-flow` |
| (none) | `/studio-builder:export-claude` |
| `mf-flow` (in motion-flow) | `mf-flow` (in studio-builder) |
| `templates/studio-rules/`, `flow.md`, `flow-SKILL.md` | `plugins/studio-builder/templates/` |
| a studio is a plugin with a marketplace and an index skill | a studio is a folder `~/Documents/studios/<studio>/` with `INDEX.md` |
| `mf-init --rules <plugin>@<marketplace>` | `mf-init --studio <name>` (and `--no-studio`) |
| the studio is enabled in `.claude/settings.json` (`enabledPlugins`) | the studio is named in `.motion/studio.json` |

## Reinstalling

The plugin path in the catalog changed, so an installed copy has to be refreshed:

```text
/plugin marketplace update motion
/plugin install motion-flow@motion
/plugin install studio-builder@motion
```

If your version of Claude Code has no update command for a catalog, remove the catalog and add it again (`/plugin marketplace add GopkoDev/motion-flow`).

Check with `/motion-flow:doctor`: it lists both plugins and warns if their versions differ.

## Existing projects

- A project made before v0.1.1 has no allow rules for the plugin tools. Run `mf-init --update-permissions` in it (doctor says when it is needed).
- A project that enabled a studio plugin keeps working for the pipeline's own files, but the pipeline now looks for the studio in `.motion/studio.json`. Run `/motion-flow:init-project` (or the first-run questions of `/motion-flow:go`) and choose the studio by name.

## Existing studios

A studio that was a plugin (with `.claude-plugin/` and `skills/studio-rules/SKILL.md`) becomes a folder:

1. Create `~/Documents/studios/<studio>/` (a short lowercase name).
2. Copy `rules/`, `flows/` and `CHANGELOG.md` into it. `INDEX.md` replaces the old index skill: copy `plugins/studio-builder/templates/studio-rules/INDEX.md` and fill the studio name.
3. The old `.claude-plugin/` and `skills/` can be deleted. Nothing is installed any more.
4. Keep it in git if the team shares it; teammates clone it into their own studios folder, and updates are `git pull`.
5. Keep the studios folder outside Google Drive (a studios folder inside Drive is refused).

## What did not change

The five steps, the two approvals, `mf-gate` and its refusals, `drive-gate`, `ae-run` and its script policy, the guard hook, the `.motion/` artifacts and their formats, auto mode, and the rule that originals are never touched.
