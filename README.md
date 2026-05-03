# pi-context-breadcrumbs

Loads path-scoped nested context files after Pi tools access files in subdirectories.

Pi's built-in startup context is cwd-based: it loads global, ancestor, and current-directory `AGENTS.md` / `CLAUDE.md` files once at startup. This extension adds Claude-Code-like nested behavior without changing Pi core: when a filesystem tool call references a path below the session cwd, the extension discovers configured context files between cwd and that path and injects them into subsequent LLM calls.

## Install / enable

Install as a Pi package after publishing:

```bash
pi install npm:pi-context-breadcrumbs
```

For local development from this repository:

```bash
pi -e ./src/index.ts
```

If Pi is already open after changing the extension, run `/reload`.

## Trigger behavior

The extension observes `tool_call` events and extracts typed path fields from filesystem tools:

- `read`, `write`, `edit`
- `ls` / `list`
- `grep` / `search` / `find`
- future built-in typed tools with clear path-like fields such as `path`, `paths`, `file`, `directory`, `dir`, `cwd`, or `root`

For `bash` / shell commands, the extension intentionally does **not** parse command strings. This Pi version exposes `bash` as `{ command: string; timeout?: number }`, without robust typed path metadata, and shell parsing would be fragile.

Discovery affects subsequent LLM calls. It does not retroactively affect the already-issued tool call that triggered discovery.

## Path resolution and safety

- Relative paths resolve against the Pi session cwd.
- Existing directories are treated as directories; other paths are treated as files and use their parent directory.
- The session cwd is the project boundary.
- Paths outside cwd are skipped.
- Symlinks are checked with `realpath`; symlinks escaping cwd are skipped.
- Only configured filenames are read.
- Context files are never executed.
- Oversized files are skipped with a concise warning.
- Aggregate `maxLoadedFiles` and `maxTotalBytes` limits cap long-session context growth.
- Common generated/vendor/cache dirs are ignored by default.
- Discovery errors are caught and do not block the original tool call.

## Discovery order and precedence

For a path like:

```text
packages/foo/src/driver.ts
```

with default `loadMode: "chain"`, the extension searches upward from `packages/foo/src` toward cwd, excluding cwd itself, and injects matching files in broad-to-specific order:

```text
packages/AGENTS.md
packages/foo/AGENTS.md
packages/foo/src/AGENTS.md
```

Pi's startup context remains active. Nested context files are path-scoped; more specific nested files override broader/root instructions for matching paths when instructions conflict. This rule is stated explicitly in the injected context.

With `loadMode: "nearest"`, only the nearest directory containing an applicable configured context file is loaded for each observed path.

## Injection

Pi's extension API can alter the system prompt only at `before_agent_start`, before the first model call for a user prompt. Nested discovery happens later, from tool calls, so this extension uses the `context` hook to append one hidden synthetic custom message before each provider call.

The injected message starts with:

```text
[Nested context files loaded by extension]
```

It is deterministic, deduplicated, ordered broad-to-specific, and rebuilt from the in-memory cache on every LLM context build. Modified files are reloaded from disk when `mtime` or size changes.

## Configuration

Configuration is read at session start / `/reload` from either:

1. `.pi/settings.json` under the key `nestedContext`
2. `.pi/nested-context.json` (overrides the settings key)

Schema/defaults:

```json
{
  "enabled": true,
  "loadMode": "chain",
  "maxFileBytes": 65536,
  "includeFilenames": ["AGENTS.md"],
  "ignoreDirs": [".git", "node_modules", "dist", "build", "target", ".venv", "venv", "__pycache__"],
  "notifyOnLoad": true,
  "maxLoadedFiles": 64,
  "maxTotalBytes": 1048576
}
```

Add `CLAUDE.md` or other filenames explicitly if desired:

```json
{
  "includeFilenames": ["AGENTS.md", "CLAUDE.md"]
}
```

## Commands

- `/nested-context` — shows currently loaded nested context files, applies-to scope, byte size, and last load time as a notification. It does not leave a persistent widget below the editor.
- `/nested-context-clear` — clears the extension's in-memory discovered context.

State is not persisted across Pi sessions.

## Tests

Run the lightweight automated tests with Node 25+:

```bash
npm test
```

The tests cover chain discovery, deduplication, separate subtrees, nearest mode, oversized skips, outside-cwd skips, changed-file reloads, newly-created context files after observed writes, unsafe replacement invalidation, aggregate limits, broad-to-specific order, custom filenames, and the bash parsing limitation.

## Demo fixture

A runnable fixture lives in `demo-fixture/`.

Manual verification:

```bash
cd demo-fixture
pi -e ../src/index.ts
```

Then ask Pi to read or edit `packages/a/src/file.ts`. After the tool call, `/nested-context` should list:

```text
packages/AGENTS.md
packages/a/AGENTS.md
packages/a/src/AGENTS.md
```

Ask Pi to access `packages/b/src/file.ts`; the package-b chain should be added without duplicating `packages/AGENTS.md`.
