---
status: draft
confirmed_by:
confirmed_at:
version_regex: '[_\- ][vV](?<version>\d+)(?=\.[^.]+$)'
---
# Naming

<!-- TODO: confirm with the designers. Replace every example with the studio's real ones. -->

## Project files

- Pattern: `<project>_v<NN>.aep` (example: `spring_v07.aep`)
- Versions: two digits, increase by one, never overwrite an older version.
- `version_regex` in the frontmatter is what `aep-version` uses to find the version number (a named group `version`).

## Comps

- Final comps: `FINAL_<name>_<width>x<height>`
- Precomps: `PRE_<name>`
- Protected brand comps: `BRAND_<name>`

## Layers

- Name every layer by what it is (`Logo`, `Headline`, `BG_Gradient`). Default names (`Shape Layer 1`, `Solid 2`, `Null 1`) are not allowed.

## Right and wrong

| Right | Wrong | Why |
|---|---|---|
| `FINAL_Spring_1920x1080` | `Comp 1` | default name |
| `spring_v08.aep` | `spring_final2.aep` | no version number |

## Patterns for ae-lint

- Comp names: `^(FINAL|PRE|BRAND)_[A-Za-z0-9_]+$`
