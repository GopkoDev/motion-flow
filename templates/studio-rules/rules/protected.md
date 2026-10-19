---
status: draft
confirmed_by:
confirmed_at:
---
# Protected elements

<!-- TODO: confirm with the designers. A step that would touch any of this must stop and ask. -->

## What must not be touched

| Name or pattern | What it is | Why it is protected |
|---|---|---|
| `BRAND_*` | brand lockups and reference comps | approved by the brand team |

## Who to ask

- <name, role, how to reach them>

## If a change is needed

- <the process for getting a protected element changed>

## For ae-lint

The `protected_unchanged` check in `rules/checks/` compares the project with the snapshot taken at planning time and reports any change to comps matching the patterns above.
