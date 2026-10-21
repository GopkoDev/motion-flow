# Flows from pairs, and the standalone export

## What a flow is

A flow describes one kind of task that repeats: what starts it, the inputs, the steps in order, where a person decides, what must not be touched, and how to tell it is done. On disk it is a folder:

```text
<flow-name>/
  SKILL.md        description with three example phrases, how the flow shapes the five motion-flow steps, the safety sentence
  flow.md         name, version, owner, status, needs, and the eight sections
  example/README.md   an Evidence section (counts) and anonymous notes; no names, no file copies
  CHANGELOG.md    written by mf-flow bump
```

A new flow is a draft in the current folder's `.claude/skills/<flow-name>/`. After review it lives in the studio folder under `flows/<flow-name>/`, where `motion-flow` finds it.

## Learning a flow from pairs

`/studio-builder:new-flow` asks for examples of the task and runs `sb-corpus dump` and `sb-corpus analyze` on them. `pairs.json` is the new part.

### Which projects form a pair

1. **A folder with one "before" and one "after" project.** File names `before`, `input`, `source`, `original`, `orig`, `start` are the before side; `after`, `output`, `result`, `final`, `done`, `end` the after side. A folder with exactly one of each is a pair. A folder with two "before" files is not a clear pair and is left out.
2. **Consecutive versions of one project** in the same group: `spring_v01`, `spring_v02`, `spring_v03` give the pairs (v01, v02) and (v02, v03). The version is the `_v<number>` suffix. Projects already used in a before/after pair are not paired again by version.

### What a pair says

`diffDumps` compares the two dumps and writes **generic signatures**, with no names in them:

| Signature | Meaning |
|---|---|
| `comp added 1080x1920` | a comp of that size exists after and not before |
| `comp size changed to WxH`, `comp frame rate changed to N`, `comp duration changed` | a comp with the same name changed |
| `comp removed` | a comp is gone |
| `layer added (text)`, `layer removed` | a layer appeared or disappeared in a comp that existed before |
| `layer position changed` (also `scale`, `rotation`, `opacity`), `layer shown or hidden`, `layer timing changed` | a layer with the same name in the same comp changed |
| `effect added: Glow`, `effect removed: Glow` | an effect on a layer |
| `expression changed: transform.position`, `keyframes changed` | animation changed |

Comps and layers are matched by name. `typicalChanges` counts in how many pairs each signature occurs; the report lists the most frequent ("comp added 1080x1920: 8 of 9 pairs").

### From signatures to steps

1. The agent proposes steps in plain words with their support and asks the designer to sort each one: **part of the flow**, **incidental to this project**, or **wrong**. A change seen in only some pairs is usually a variant; the agent asks what decides between the variants and makes that a question the flow asks at intake. Pairs that contradict each other are not averaged; the designer chooses.
2. The agent interviews only about what the evidence leaves open: the three phrases that start the task, the inputs, where a person decides, what could go wrong, what must not be touched, how to tell it is done, the tools needed.
3. The draft is written in the designer's language and approved, then written as English files.

### The evidence rule

`example/README.md` must show how many examples were seen. `mf-flow check` accepts any of:

- at least two `## Example N` sections;
- an `## Evidence` section that counts at least two examples or projects ("18 examples in 4 groups, 9 version pairs");
- a `## Why only one example` section.

The agent then **checks the flow against the evidence**: every change found in at least half of the pairs is covered by a step (or listed by the designer as incidental), and every step is backed by at least one pair or marked in `flow.md` as the designer's own rule. The table "step ↔ pairs that support it" is shown to the designer. A flow never claims support without a count from `sb-corpus`.

The flow still goes through `mf-flow check` (files, frontmatter, three phrases, sections, safety sentence, unsafe instructions, private data, English) and through `publish-flow` and a human reviewer before the team uses it. A flow cannot weaken `safety.md`.

## The standalone export

`/studio-builder:export-claude` (`sb-export --to <folder> --studio <name> [--include-drafts] [--force]`) turns a studio folder into something a designer can own and orchestrate without the five-step pipeline.

| Written | From |
|---|---|
| `<folder>/.claude/rules/design-system/*.md` | the studio's `rules/*.md` (not `OPEN-QUESTIONS.md`); `status: draft` is kept, so the standalone setup warns too |
| `<folder>/.claude/skills/<flow>/SKILL.md` | one skill per flow, built from `flow.md`: purpose, inputs, steps, where a person decides, what must not be touched, how to tell it is done, plus short working rules. Nothing of the five motion-flow steps |
| `<folder>/CLAUDE.md` | a managed block between `<!-- studio-builder:start -->` and `<!-- studio-builder:end -->`: the studio, the design-system files, the flows. Text outside the block is kept |
| `<folder>/.claude/studio-export.json` | a manifest: the file path and its hash for every file written |

Re-running the export is safe:

- A file whose content already matches is left alone.
- A file that exists and **differs** is replaced only if it is listed in the manifest and still has the hash the export wrote. A file the designer edited since, or one that existed before the first export, is **kept** and reported. `--force` brings the studio's version back.
- The export never writes `.claude/settings.json` or any permission. It refuses the studio folder as the target, a missing folder, and two flows with the same name. `--include-drafts` also exports drafts from the current folder's `.claude/skills/`.

The After Effects tools the exported skills mention (`ae-dump`, `ae-run`) and `drive-gate` come from the studio-builder plugin; keep it enabled in that folder (`sb-init` sets a folder up with the safety settings).
