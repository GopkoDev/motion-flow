# Drive access

How every skill reads files that live on Google Drive. Drive is read-only for the agent, and only through `drive-gate`.

## Rules

1. **Never read or write a Drive path directly.** No Read, Write, Edit, Grep, Glob, `cat`, `ls`, `cp`, `find` on a Drive folder. The guard hook blocks it; do not look for another spelling.
2. **Use aliases, not paths.** The designer's Drive folders have short names (`assets`, `projects`). Refer to files as `<alias> <relative path>`, for example `projects Brand/Spring/spring_v07.aep`. Never print or store the machine's real Drive path.
3. **Only the Drive folders enabled for this project are reachable.** They are listed in `.motion/drive.json`. If `drive-gate` says `drive_disabled` or `no_drive`, the project does not use that folder: tell the designer, and point to `/motion-flow:init-project` (to choose Drive folders) or to copying the files into `work/` by hand.
4. **Look before you copy.** Run `drive-gate info <alias> <path>` first (size, date, whether it is downloaded). Then `drive-gate fetch <alias> <path> --to work/`. For an `.aep`, add `--with-deps --deps-from <dump.json>` so linked media comes along.
5. **`work/` is where everything happens.** Fetched copies, scripts' output, frames, exports. Nothing is written to Drive; the designer moves results to Drive by hand.
6. **On any error, stop and ask.** If `fetch` says the file is not downloaded (Drive stream mode), tell the designer to make the file available offline and retry; never continue with an empty or partial copy. If the same error comes back after one retry, stop.
7. **Do not fetch more than needed.** Fetch the files the plan names. For a listing use `drive-gate ls`, and do not walk a whole tree.
8. **A project with no Drive** (no-Drive mode): the source files are already in `work/`, put there by the designer. Work on them as copies; if a file the plan needs is missing, ask the designer to copy it into `work/`.

## Commands

```
drive-gate ls <alias> [subpath]
drive-gate info <alias> <relpath> [--checksum]
drive-gate fetch <alias> <relpath> --to work/ [--with-deps --deps-from <dump.json>] [--timeout S]
drive-gate log [--tail N]
```

Each prints JSON. `ok: false` carries a `code`, an `error` and a `hint`; show the hint to the designer in Ukrainian.
