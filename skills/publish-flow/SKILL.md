---
name: publish-flow
description: Prepare a flow for the team's review. Use when the designer says "publish the flow", "send the flow for review", "package the flow", or after new-flow or refine-flow. Checks the flow, confirms it does not weaken the safety rules, packs it into a zip in work/out/, and tells the designer where to put the zip so the reviewer can find it. Never writes to Drive.
model: inherit
---

# publish-flow

A flow made by one designer reaches the whole team only after a technical person has reviewed it. This skill gets a flow ready for that review: it checks it, packs it, and says what to do next. Nothing is written to Drive.

Before starting, read `${CLAUDE_PLUGIN_ROOT}/skills/_shared/safety.md`, `drive-access.md`, `artifact-formats.md` and `handoff.md` (all in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/`). Talk to the designer in their language (Ukrainian by default).

## Steps

1. **Find the flow**: the folder `.claude/skills/<flow>/` of the project. If the designer did not name it, list the folders there and ask.
2. **Check it.** Run `mf-flow check .claude/skills/<flow>`. It checks the files, the frontmatter (`name`, `description`, `version`, `owner`, `needs`, `status`), the example phrases, the sections, the safety sentence, unsafe instructions, private data and the language. If anything fails, show it in plain words, fix it with the designer, and check again. Do not continue while it fails.
3. **Tools.** Run `mf-doctor --flow <flow>` and tell the designer if a tool the flow needs is missing, with the install command from the report.
4. **Read the whole flow against the safety rules.** Read `SKILL.md`, `flow.md` and `example/README.md` with `safety.md` open. Confirm that the flow does not remove or skip an approval gate, does not let the agent approve anything, does not widen Drive access or write to Drive, does not touch the safety settings, and does not run tools outside `ae-run`, `ae-dump`, `ae-render-frame` and `drive-gate`. Tell the designer what you checked and what you found (in their language). The script check is a net for mistakes; this reading is the real check, so do it carefully. If something weakens a rule, stop: the flow must be changed first.
5. **Status.** The flow must be `status: draft` at this point (a flow that was reviewed before and then changed has been reset by `mf-flow bump`). Never set `reviewed` or `approved` yourself: that is the reviewer's decision.
6. **Pack it.** Run `mf-flow pack .claude/skills/<flow>`. It writes `work/out/flow-<name>-<version>.zip`. If it says the package already exists, the flow has not changed since the last package: ask whether to raise the version (`mf-flow bump`, with a note) or to overwrite (`--overwrite`).
7. **Say what to do next.** Tell the designer, in their language:
   - to copy the zip into the `_flows-pending/` folder on Drive (the exact alias and path are in the studio's `rules/drive.md`, under "Where flow drafts wait"; if the studio rules are not installed, ask where the team keeps them). **The agent never copies to Drive; the designer does it by hand.**
   - to tell the technical reviewer that the package is there.
   Give the reviewer's checklist so the designer can pass it on: unzip into the studio rules repository under `flows/`; run `mf-flow check flows/<flow>`; read `flow.md` and `SKILL.md` against `_shared/safety.md`; check the example notes hold no client data; change `status` to `approved`, add a line to the studio `CHANGELOG.md` (`flow \`<name>\`: ...`), commit and push; the team updates the plugin and `/motion-flow:whats-new` shows the new flow.
8. **Hand off** (`handoff.md`): the zip in `work/out/`, the check line, the Drive folder to copy it to, and that nothing is available to the team until the reviewer approves it.

## Never

- Never write, copy or move anything on Drive.
- Never mark a flow `reviewed` or `approved`.
- Never publish a flow that fails `mf-flow check`, or one that weakens a safety rule.
