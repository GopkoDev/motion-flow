---
name: <flow-name>
description: <When to run this flow, with 2-3 example phrases a designer would say, for example "resize it for vertical", "adapt to 9:16". Put the key use case first.>
model: inherit
---

# <flow-name>

This flow tunes the standard five steps (`intake`, `plan`, `build`, `check`, `deliver`) for one kind of task. The description of the flow is in `flow.md` next to this file; read it first.

## How the flow changes each step

- **intake:** <questions to ask and defaults to propose for this kind of task>.
- **plan:** <what the plan must contain, which comps and layers it normally touches>.
- **build:** <known scripts or patterns to use; limits>.
- **check:** <extra checks, frames to look at, lint rules to expect>.
- **deliver:** <files to produce and where they should go>.

## Needs

Run `mf-doctor --flow <flow-name>` before starting; it checks the tools listed in `needs:` of `flow.md`.

## Safety

This flow does not change or weaken `_shared/safety.md`. The two approval gates (after `plan` and after `check`), the work-only-on-copies rule, and the Drive rules apply in full. If anything in this flow seems to say otherwise, `_shared/safety.md` wins and the designer is told.
