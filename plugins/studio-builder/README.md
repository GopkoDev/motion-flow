# studio-builder

Builds a studio's design system and flows from many example After Effects projects. Part of the [motion-flow repository](../../README.md#studio-builder); the full description is there.

- `/studio-builder:learn-studio`: the design system (naming, motion system, protected items, delivery, Drive layout) from as many examples as you give it, counted in code (`sb-corpus`).
- `/studio-builder:new-flow`: a repeatable job from before/after pairs and successive versions.
- `/studio-builder:refine-flow`, `/studio-builder:publish-flow`: improve a flow from what was fixed by hand; pack it for review.
- `/studio-builder:export-claude`: a standalone `.claude/` (design system + one skill per flow) to orchestrate without the motion-flow pipeline.

The plugin is self-contained. The After Effects and Drive tools it uses (`ae-dump`, `ae-run`, `drive-gate`, the guard hook) are copies of the ones in `shared/` at the repository root (listed in `.shared.json`): edit them there and run `npm run sync`, never here.
