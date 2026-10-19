# After Effects scripting rules

Every skill that changes or reads an After Effects project follows these rules. After Effects is driven only by JSX scripts started through `ae-run` (or its wrappers `ae-dump` and `ae-render-frame`). Never start After Effects, `aerender` or ExtendScript any other way; the guard hook blocks it.

## The script skeleton

Generated scripts live in the project's `jsx/` folder, one file per plan step (`jsx/01-resize.jsx`, `jsx/02-titles.jsx`). `ae-run` includes the helpers before your script, so a script is only the body:

```js
// jsx/01-resize.jsx
mf.runIpc(function (input) {
    var comp = mf.findComp(input.params.comp);
    if (!comp) { throw new Error("Comp not found: " + input.params.comp); }
    var layer = mf.findLayer(comp, "Headline");
    if (!layer) { throw new Error("Layer not found: Headline"); }
    layer.property("ADBE Transform Group").property("ADBE Opacity").setValue(100);
    return { changed: 1 };
});
```

`mf.runIpc` reads the input file, makes sure the right project copy is open, runs your function in one undo group, saves the copy, and always writes the result file `work/.ipc/<id>.out.json` as `{ ok, result, error, durationMs }`. Whatever the function returns becomes `result`; a thrown error becomes `error`. Parameters arrive in `input.params` (passed with `ae-run --params '{"comp":"Main"}'`), never pasted into the script text, so one script can be reused and run again.

Helpers available on `mf`: `findComp(name)`, `findLayer(comp, name)`, `findLayers(comp, name)`, `workFile(path)`, `workFolder(path)`, `undoGroup(name, fn)`, `toJSON`, `parseJSON`, `ensureProject(path)`.

## Rules

1. **Idempotent.** Running a script twice must not duplicate anything. Look for the thing first (a layer by name, an effect already applied, a keyframe at that time) and update it instead of adding another.
2. **Find by name, not by index.** Layer indexes shift when layers are added, moved or deleted. Use `mf.findLayer(comp, "Name")`. It throws when the name is ambiguous, which is what you want: stop and ask instead of editing the wrong layer.
3. **One undo group per step.** `mf.runIpc` already wraps your function. Do not start your own group inside it, and do not call `app.endUndoGroup()` yourself.
4. **Result goes to a file, not the screen.** Never rely on `$.writeln` or the UI. Return a plain object (numbers, strings, booleans, arrays, plain objects); `mf.toJSON` serializes it.
5. **No dialogs.** Never use `alert`, `confirm` or `prompt`, never open a file chooser. A dialog freezes the run until the timeout. `mf.runIpc` also suppresses dialogs while it runs.
6. **Keep a run short.** After Effects is blocked while a script runs. Split long work into several steps (several scripts, one plan step each). A run that takes more than about a minute should be split.
7. **Work only on the project copy in `work/`.** The script never opens, saves or touches any other file. Never close a project: `mf.runIpc` refuses to switch if a different project is open (it could hold unsaved work).
8. **Do not delete the designer's content** unless the approved plan says so explicitly, and then only the named items.
9. **Check the script** before running: `node "${CLAUDE_PLUGIN_ROOT}/scripts/check_jsx.mjs" --policy jsx/` must pass (ES3 syntax and the safety policy below). `ae-run` refuses a script that breaks the policy.

## What a script may not do

Scripts in the project's `jsx/` folder may not: run system commands (`system.callSystem`), launch files (`.execute`), run dynamic code (`eval`, `$.evalFile`, `new Function`), use the network (`Socket`), use `File` or `Folder` directly, look up globals by name (`$.global[...]`, `this[...]`), open, close, save-as or quit (`app.open`, `app.quit`, `app.project.close`, `saveWithDialog`, `app.executeCommand`), or read environment variables. To reach a file (importing footage, saving a frame), call `mf.workFile(path)` or `mf.workFolder(path)`: they accept only paths inside the project's `work/` folder and throw for anything else. This policy catches mistakes and obvious misuse; it is not a sandbox, so the approved plan and a read of the script still matter.

## ExtendScript is ES3

- Only `var`, `function`, classic loops. No `let`, `const`, arrow functions, template strings, classes, spread.
- No `Array.forEach/map/filter/indexOf`, no `JSON`, no `Object.keys`, no `String.trim`, no `Date.now()`. Use `for` loops, `mf.toJSON`, `mf.parseJSON`.
- No trailing commas in object or array literals.
- Strings have `indexOf`; arrays do not.

## Common traps

- **Collections are 1-based.** `comp.layer(1)` is the top layer, `app.project.item(1)` the first item. Loops run `for (i = 1; i <= n; i++)`.
- **Times are seconds, not frames.** Convert with `frames / comp.frameRate`. Use `comp.frameDuration` for one frame.
- **Property values are arrays for multi-dimensional properties** (position `[x, y]`, scale `[100, 100]`). Setting a number where an array is expected fails.
- **Use matchNames for properties** (`"ADBE Transform Group"`, `"ADBE Position"`, `"ADBE Opacity"`): display names change with the interface language, matchNames do not.
- **`setValueAtTime` vs `setValuesAtTimes`.** Setting many keyframes one by one is slow. Prefer `property.setValuesAtTimes(times, values)` when you add more than a few.
- **Setting a value on a keyframed property** changes only the current time unless there are no keyframes. Remove or add keyframes explicitly.
- **Expressions are strings** assigned to `property.expression`; check `property.canSetExpression` first, and read errors from `property.expressionError`.
- **Locked layers** cannot be edited. Do not unlock a layer to work around it; report it instead (it may be protected).
- **Deleting or moving a layer while looping** changes the indexes. Collect first, then act, or loop from the end.
- **Missing footage and fonts** do not raise errors when read; check `footageMissing` and report.
- **Text:** edit the `TextDocument` through `property.value`, change the object, then assign it back with `setValue`.
- **Avoid `app.executeCommand(id)`.** Command ids differ between versions and open dialogs. Use it only when nothing else works, and say so in the plan.
- **Writing the result needs "Allow Scripts to Write Files and Access Network"** (Preferences > Scripting & Expressions). If the result file never appears, that setting is the first thing to check.

## Checking the result

A syntax error in your script, or a script that never calls `mf.runIpc`, comes back as an error in the result (`Syntax error in the script: ...`, `The script finished without calling mf.runIpc ...`) instead of freezing After Effects with a dialog. Line numbers in errors refer to your script file.

After a step, read `work/.ipc/<id>.out.json` (`ae-run` returns the same object). If `ok` is false, stop: do not run the next step, report the `error` text, and ask. Never retry blindly more than the number of retries the plan allows.
