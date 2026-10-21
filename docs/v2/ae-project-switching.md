# After Effects project switching

Every After Effects tool (`ae-dump`, `ae-run`, `ae-render-frame`, and `sb-corpus dump` on top of them) works on one named project. `ensureProject` in `shared/lib/jsx/helpers.jsx` makes sure that project is the open one. It runs inside After Effects, in the plugin's own trusted script, never in a script written by the agent (the agent script policy rejects `app.open` and `project.close`).

| Open project | What happens |
|---|---|
| the wanted project | nothing; it is used as it is |
| none, or an empty untitled one | the wanted project is opened |
| a different project, saved to a file, `app.project.dirty === false` | it is closed with `CloseOptions.DO_NOT_SAVE_CHANGES` and the wanted project is opened |
| a different project with unsaved changes (`dirty === true`) | the run stops: "Another project is open in After Effects (path) has unsaved changes. Save and close it yourself ..." |
| a different project that was never saved (untitled, with content) | the run stops: "... (unsaved) has never been saved ..." |
| a different project whose `dirty` is not a boolean | the run stops: "... and its unsaved state cannot be read ..." |

## Why this is safe

- Nothing is closed unless After Effects itself says there is nothing to lose. A saved project that was not changed can be reopened from its file.
- Closing a project that *has* changes without `DO_NOT_SAVE_CHANGES` would raise a "Save changes?" dialog that blocks scripting entirely, so that path is never taken.
- An unknown state is treated like unsaved changes.

## Where the property comes from

`Project.dirty` and `close(CloseOptions.DO_NOT_SAVE_CHANGES)` are used the same way, and tested end to end against a real After Effects, in `kumoproductions/mcp-aftereffects` (`src/operations/instance.ts`, `tests/e2e/harness.ts`). They are not taken from Adobe's documentation, so the first run on a real machine should confirm them (open project A saved, run `ae-dump` on B; then repeat with unsaved changes in A).

## What it enables

The designer no longer opens each file by hand: `sb-corpus dump` can walk a folder of projects, and a build or a check can run on a copy while another saved project is open. A project with unsaved work is never closed; the message tells the designer to save or close it.
