# Checks for ae-lint

Every `*.json` file in this folder is read by `ae-lint` (one check object, or an array of them). Files in subfolders are not read: `_examples/` holds ready-made examples to copy up.

A check: `{ "id": "fps-25", "type": "comp_fps", "equals": 25, "comps": "^FINAL_", "severity": "error", "message": "..." }`.

Types: `comp_fps`, `comp_size`, `comp_duration`, `comp_name`, `layer_name`, `default_names`, `footage_missing`, `fonts_allowed`, `project_bits`, `protected_unchanged` (needs `--baseline`, the dump taken at planning time).

Only add checks the designers have confirmed; a wrong check blocks good work.
