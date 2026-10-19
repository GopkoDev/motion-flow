# Claude Code schema notes (T0.2)

Checked on 2026-10-19 against the live docs (code.claude.com) and the local CLI
(`claude` 2.1.303, `claude plugin validate`). Status per item:
**confirmed** = matches the docs, **fixed** = spec/manifest was wrong and is corrected,
**open** = cannot be settled from docs alone.

Sources:
- https://code.claude.com/docs/en/plugins-reference (plugin.json, layout, env vars)
- https://code.claude.com/docs/en/plugins/marketplace-reference (marketplace.json, sources)
- https://code.claude.com/docs/en/plugin-marketplaces
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/settings-reference (`enabledPlugins`, `extraKnownMarketplaces`, `permissions.deny`)
- https://code.claude.com/docs/en/permissions
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/tools-reference

Note: `docs.claude.com/en/docs/claude-code/...` URLs from the spec now 301-redirect to `code.claude.com/docs/en/...`.

## 1. `plugin.json` (spec 4.1) — confirmed

- Location `.claude-plugin/plugin.json`; the manifest is optional, only `name` is required.
- Used fields: `name` (kebab-case, must not look like an Anthropic name), `version`, `description`,
  `author` (object, `name` required, `email`/`url` optional), `license` (SPDX string, optional).
- Unknown top-level keys are stripped with a warning; `claude plugin validate` is the authority.
- Everything except `plugin.json` lives at the plugin root, not inside `.claude-plugin/`.
- Default locations are auto-discovered: `skills/`, `hooks/hooks.json`, `bin/`, `commands/`, `agents/`,
  `settings.json`. No need to declare them in the manifest.
- `bin/` files are put on the Bash tool's `PATH` while the plugin is enabled, so skills can call
  `drive-gate`, `ae-run`, etc. as bare commands. Keep the shebang `#!/usr/bin/env node`.
  On Windows we call `node bin/<name>` (spec decision 11).
- `${CLAUDE_PLUGIN_ROOT}` (installed plugin dir), `${CLAUDE_PLUGIN_DATA}` (persistent), `${CLAUDE_PROJECT_DIR}`
  resolve in hook `command`/`args` and in skill Markdown bodies. They are NOT set in the environment of
  commands run through the Bash tool, so a skill must write the `${CLAUDE_PLUGIN_ROOT}` reference in its
  body (substituted inline), not rely on `$CLAUDE_PLUGIN_ROOT` in a shell.
- A `CLAUDE.md` at the plugin root is not loaded (validate warns).
- Result: current `.claude-plugin/plugin.json` passes `claude plugin validate`. No change needed.
  (`license` stays unset on purpose, license is not decided yet.)

## 2. `marketplace.json` (spec 5.1) — fixed

- Required top level: `name`, `owner` (`name` required), `plugins`. `description` recommended.
- Marketplace `name`: letters, digits, `.`, `_`, `-`; not a reserved name. `motion` is fine.
- Plugin entry: `name` and `source` required. The entry `name` must equal the `name` in the plugin's
  `plugin.json` (it is the install id `motion-flow@motion`).
- `source` forms: relative path string (must start with `./`, resolves inside the marketplace repo),
  or an object: `github` (`repo`, optional `ref`, `sha`), `url` (any git URL), `git-subdir`, `npm`, `archive`, `command`.
- **Decision (2026-10-19):** no separate `motion-marketplace` repo for now. The catalog lives in this repo as
  `.claude-plugin/marketplace.json` (self-marketplace, entry `source: "./"`, like SDD). Install id: `motion-flow@motion`.
  Add with `/plugin marketplace add GopkoDev/motion-flow`. (Update, spec 16.1: the studio rules are not added
  here; each `<slug>-rules` folder is its own one-plugin catalog.)
- Private repo (`studio-rules`): cloned with the user's own git credentials (HTTPS credential helper or SSH key
  without passphrase prompt). Claude Code never prompts. Each designer needs working git access.
  Setting `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` forces HTTPS for `owner/repo` shorthand.
- Local test: `claude plugin marketplace add ./path/to/repo` (directory with `.claude-plugin/marketplace.json`).
  For a local marketplace with relative-path sources, edits take effect on next session or `/reload-plugins`.
  Our entry uses `source: "./"`, so `claude plugin marketplace add <path to this repo>` works locally in T0.4.
- Result: `claude plugin validate .` passes for both the plugin and the marketplace.

## 3. `hooks/hooks.json` and `guard.mjs` (spec 4.20) — confirmed, with additions

- File shape (plugin `hooks/hooks.json`): top-level `hooks` wrapper key, optional `description`:
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "Read|Write|Edit|Bash",
      "hooks": [ { "type": "command", "command": "...", "timeout": 10 } ] } ] } }
  ```
  A file without the `hooks` wrapper fails to load.
- Handler fields: `type` (`command`), `command`, optional `args` (exec form, no shell quoting issues),
  `timeout` in seconds (default 600), `if` (permission-rule filter).
- Command path: reference the script with `${CLAUDE_PLUGIN_ROOT}`. Prefer exec form for cross-platform paths:
  `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"]` (**to confirm on Windows in T1.4**, open).
- Matcher: only letters/digits/`_`/`-`/`|`/space/`,` means an exact-name list, so `Read|Write|Edit|Bash` is valid.
  Anything else is an unanchored JS regex.
- stdin JSON for PreToolUse: `session_id`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`,
  `tool_input`, `tool_use_id`. For `Bash`, `tool_input.command`. For file tools the path is `tool_input.file_path`
  (documented as the permission-rule field for Read/Edit/Write).
- Blocking: **exit code 2** with the reason on stderr (Claude sees it), or exit 0 with stdout JSON
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`.
  Exit 2 wins even if JSON says allow. **Any other non-zero exit is non-blocking** (the action proceeds), so guard.mjs
  must catch its own errors and decide explicitly (fail closed with exit 2 on unexpected input).
- Timeout: a timed-out PreToolUse command does not block the call by default. `"onFailure": "block"` exists
  (Claude Code 2.1.295 or newer). **Decided in T1.4:** `hooks.json` uses `"onFailure": "block"`; the README asks for
  Claude Code 2.1.295 or newer.
- Tool names: `Read`, `Write`, `Edit`, `Bash`, `NotebookEdit`, `Glob`, `Grep`, `PowerShell`, `Monitor`.
- **Spec gap (closed in T1.4):** the spec matched only `Read|Write|Edit|Bash`. Files can also be reached via
  `Glob`, `Grep`, `NotebookEdit`, `PowerShell` (Windows) and `Monitor` (runs commands), so the matcher now lists
  all of them (spec 4.20).

## 4. Project `settings.json` (spec 11) — fixed

- Locations: `.claude/settings.json` (shared), `.claude/settings.local.json`, `~/.claude/settings.json`.
- `extraKnownMarketplaces`: object `name -> { "source": {...}, "autoUpdate"?: bool }`. Source forms:
  `github` (`repo`), `git` (`url`), `url`, `file`, `directory`, `settings`. Example for us:
  ```json
  { "extraKnownMarketplaces": { "motion": { "source": { "source": "github", "repo": "GopkoDev/motion-flow" } } } }
  ```
  Entries in a repo's `.claude/settings.json` apply only after the user accepts the workspace-trust dialog.
- `enabledPlugins`: object `"plugin@marketplace" -> boolean`:
  `{"motion-flow@motion": true, "acme-rules@acme-rules": true}` (spec 16.1: the rules plugin is `<slug>-rules`
  from its own catalog, exactly one per project).
  Important: committing this enables the plugin but does **not** install it. Each designer still runs
  `claude plugin install <name>@motion --scope project` once. The README (T6.2) and `doctor` must say so.
- `permissions.deny`: array of rule strings.
  - Path rules exist only for **`Read(path)` and `Edit(path)`**. A rule like `Write(path)` is accepted but
    never consulted (warns at startup). **Fix for T1.5:** use `Edit(...)`, not `Write(...)`, for path rules.
    Also a `Read` deny rule blocks Edit/Write on the same path (2.1.208/2.1.228 or newer); `NotebookEdit` needs an `Edit` deny.
  - Path syntax (gitignore style): `//abs/path` = filesystem absolute, `~/path` = home, `/path` = relative to the
    settings file's root, `path` or `./path` = relative to cwd. A single leading `/` is NOT absolute.
    Windows paths are normalized to POSIX (`C:\x` becomes `/c/x`, use `//c/...`).
  - Deny matches the requested path or its resolved symlink target.
  - Limit: Read/Edit deny rules cover built-in file tools, recognised Bash file commands (`cat`, `head`, `sed`, `tee`,
    redirections) but **not** arbitrary subprocesses (a Node/Python script opening files). OS-level blocking needs
    the sandbox. Therefore `guard.mjs` is required in addition (as the spec already says).
  - MCP tools: `mcp__<server>__<tool>` or `mcp__<server>__*`. Rules with parentheses on `mcp__` tools are skipped.
    Tool-name globs are allowed in deny (`mcp__*`).
  - Bash: `Bash(git push *)` style, prefix/wildcard; fragile for arguments, so pair with the hook.
- **Closed in T1.5 (verify on a designer machine):** exact MCP names for Drive tools. In this environment the connector tools appear as
  `mcp__claude_ai_Google_Drive__trash_file`, `...__update_file`, `...__share_file` (also `create_file`, `copy_file`).
  Names depend on how the designer connects Drive; the template denies all five observed names, `create_file` and
  `copy_file` included, since they are writes too.

## 5. `SKILL.md` frontmatter (spec 4.27, T0.3) — confirmed

- Fields (all optional in Claude Code): `name`, `description`, `when_to_use`, `argument-hint`, `arguments`,
  `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`,
  `agent`, `hooks`, `paths`, `shell`, plus pass-through `metadata`, `license`, `compatibility`.
  Unknown fields are ignored silently.
- Our validator requires `name`, `description`, `model` by project rule (T0.3). `model` is a real field, good.
- `description` + `when_to_use` is truncated at 1,536 characters in the listing: put the key trigger first.
  Keep `SKILL.md` under 500 lines.
- Plugin skills are invoked `/plugin:skill`, e.g. `/motion-flow:plan`. A frontmatter `name` replaces the
  directory name as the last segment. Matches the handoff command in spec 4.3.
- `skills/_shared/` has no `SKILL.md`, so the loader does not treat it as a skill (a skill is a directory containing
  `SKILL.md`). Closed: `claude plugin validate` passes and `validate_plugin.mjs` skips `_shared/` (T0.3).

## 6. Other spec items checked

- Spec 4.4: SDD `_shared` file names — closed in T3.1 when we read `_temp/repos/genkovich__sdd/skills/_shared/` (not part of T0.2).
- Spec 4.18 `doctor` / spec 7 AE launch: not schema items; stay open until T2.9.

## Status of `[verify]` items

| Spec place | Item | Status |
|---|---|---|
| 4.1 | `plugin.json` schema | confirmed |
| 4.20 | hooks schema | confirmed; exit-2 semantics, wider matcher and `onFailure: block` adopted; Windows exec form open until T2.9 |
| 5.1 | marketplace `source` schema | fixed (catalog moved into this repo, self-marketplace) |
| 11 | `extraKnownMarketplaces`, `enabledPlugins`, `permissions.deny` | confirmed; fixed `Write` to `Edit`; MCP names set in T1.5, to verify on a designer machine |
| 4.7/4.27 | `SKILL.md` frontmatter | confirmed; `_shared/` handling confirmed |
| 4.4, 4.2 | SDD file names | not in T0.2 scope |
