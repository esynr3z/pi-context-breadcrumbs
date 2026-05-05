# pi-context-breadcrumbs

Path-scoped nested context loading for Pi coding agent. The extension watches filesystem tool calls, discovers context files between the session cwd and accessed paths, and injects them into later model calls.

## Install / enable

```bash
pi install npm:pi-context-breadcrumbs
```

Configuration is loaded at session start and after `/reload`.

## Commands

- `/context-breadcrumbs` — show loaded context files, their scope, size, and load time as a notification.

State is in-memory only and is not persisted across Pi sessions.

## Configuration

Configuration is read from `.pi/settings.json` under `nestedContext`, then overridden by `.pi/nested-context.json` when present.

Defaults:

```json
{
  "enabled": true,
  "includeFilenames": ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"],
  "ignoreDirs": [".git", "node_modules", "dist", "build", "target", ".venv", "venv", "__pycache__"],
  "notifyOnLoad": true
}
```

Use `includeFilenames` to replace the context filename set, and `ignoreDirs` to skip generated, vendor, or cache directories. If cwd is inside a Git repository, `.gitignore`-ignored paths are skipped too.

## Operation

Trigger: the extension observes typed filesystem tool inputs from `read`, `write`, `edit`, `ls` / `list`, `grep` / `search` / `find`, and future typed tools with path-like fields. It intentionally does not parse `bash` commands.

Path resolution: relative paths resolve from the Pi session cwd. The cwd is the project boundary. Paths outside cwd and symlinks escaping cwd are skipped. Context files are read as UTF-8 text and never executed.

Discovery order: for `packages/foo/src/driver.ts`, cwd-level context is left to Pi startup context and nested files are loaded broad-to-specific, for example `packages/AGENTS.md`, `packages/foo/AGENTS.md`, then `packages/foo/src/AGENTS.md`. More specific files override broader instructions for matching paths.

Injection: discovered files are appended as one hidden custom context message before provider calls. The message is deterministic, deduplicated, and refreshed when loaded files change on disk.
