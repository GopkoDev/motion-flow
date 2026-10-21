---
name: whats-new
description: Show the designer what changed in the studio rules and flows since they last looked. Use when the designer asks "what's new", "what changed in the rules", "any new flows", or after the studio's rules folder was updated. Reads the studio rules changelog, compares with what was already seen in this project, and summarizes each change in one sentence.
model: inherit
---

# whats-new

After the studio rules are updated, the designer wants to know what is different: new or changed flows, new rules. This skill reads the studio rules changelog and tells them, once.

Read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md` first. Talk to the designer in their language (Ukrainian by default).

## Steps

1. **Find the changelog.** Run `mf-studio path`; its `changelog` is the studio's `CHANGELOG.md`. If the project uses no studio rules, or the studio has no changelog, say so and stop.
2. **Read the state.** `.motion/state.json` keeps `last_seen_rules_version`. If `.motion/` does not exist, tell the designer to run `/motion-flow:init-project` and stop.
3. **List the changes.** Run `mf-whatsnew --changelog <path to CHANGELOG.md>`. It returns the releases newer than the last seen one (when nothing was seen yet, only the latest few), and the names of the flows that changed. If `up_to_date` is true, say that nothing is new and stop.
4. **Summarize.** For each release, one short sentence per item, in the designer's language, newest first. Call out new or changed flows by name and say what they are for in one sentence (read the flow's `flow.md` under `flows/<name>/` in the studio rules if the changelog line is not enough). Say which changes affect how they work today (a naming rule, a delivery format) and which are only additions.
5. **Mark as seen.** Ask whether to mark these changes as seen. If yes, run `mf-whatsnew --mark-seen <latest version>`; it changes only `last_seen_rules_version` in `.motion/state.json`.

## Rules

- Read only: never edit the studio rules or the changelog.
- Do not repeat changes the designer has already marked as seen.
- If a rule changed that affects a task in progress, say so and suggest checking the plan.
