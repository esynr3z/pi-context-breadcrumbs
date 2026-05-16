# pi-context-breadcrumbs

Path-scoped nested context loading for Pi coding agent. The extension watches filesystem tool calls, discovers breadcrumb files between the session cwd and accessed paths, and announces them as visible persistent custom messages in the transcript.

## Install / enable

```bash
pi install npm:pi-context-breadcrumbs
```

Configuration is loaded at session start and after `/reload`. The package also installs the `context-breadcrumbs` skill for maintaining breadcrumb files.

## Commands

- `/context-breadcrumbs` — show the currently loaded in-memory breadcrumb files, their scope, size, and load time as a notification.
- `/skill:context-breadcrumbs` — load the bundled breadcrumb maintenance policy when skill commands are enabled.

Discovery cache is in memory for the running process. Breadcrumb announcements themselves persist in the session transcript as visible `context-breadcrumbs` custom messages, so reload, resume, and branch navigation can reconstruct what was already announced.

## Configuration

Configuration is read from `.pi/settings.json` under `context-breadcrumbs`, then overridden by `.pi/context-breadcrumbs.json` when present.

Defaults:

```json
{
  "enabled": true,
  "includeFilenames": ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"],
  "ignoreDirs": [".git", "node_modules", "dist", "build", "target", ".venv", "venv", "__pycache__"],
  "notifyOnLoad": true,
  "filterSupersededFromPrompt": true
}
```

Use `includeFilenames` to replace the breadcrumb filename set, and `ignoreDirs` to skip generated, vendor, or cache directories. If cwd is inside a Git repository, `.gitignore`-ignored paths are skipped too.

`filterSupersededFromPrompt` controls only what is sent to the model. When `true`, older superseded breadcrumb messages are removed or rewritten in the provider-bound prompt so the model sees only the newest exact breadcrumb content for each breadcrumb file path. Visible session history is left unchanged.

## Operation

Trigger: the extension observes typed filesystem tool inputs from `read`, `write`, `edit`, `ls` / `list`, `grep` / `search` / `find`, and future typed tools with path-like fields. It intentionally does not parse `bash` commands.

Path resolution: relative paths resolve from the Pi session cwd. The cwd is the project boundary. Paths outside cwd and symlinks escaping cwd are skipped. Breadcrumb files are read as UTF-8 text and never executed.

Discovery order: for `packages/foo/src/driver.ts`, cwd-level breadcrumb files are left to Pi startup context and nested files are loaded broad-to-specific, for example `packages/AGENTS.md`, `packages/foo/AGENTS.md`, then `packages/foo/src/AGENTS.md`. More specific files override broader instructions for matching paths.

Announcement behavior: when a relevant tool call first crosses into a nested breadcrumb chain, the extension emits a visible `context-breadcrumbs` custom message that names the observed path or paths and includes the full currently applicable breadcrumb chain. Repeating the same access without breadcrumb changes does not emit another message.

Persistence and re-announcement: visible breadcrumb messages are the durable source of truth. After `/reload`, session resume, or branch navigation, the extension reconstructs the latest announced hash for each breadcrumb file path from the current branch. If a breadcrumb file changes, the next relevant path access emits a new full-chain message. If a compaction happened after the last announcement for any breadcrumb file in the chain, the next relevant path access emits a full-chain restatement because earlier exact text may have been summarized.

Prompt filtering: the extension no longer injects hidden breadcrumb content in the `context` hook. The `context` hook now only applies optional prompt-time filtering of superseded visible breadcrumb messages when `filterSupersededFromPrompt` is enabled.
