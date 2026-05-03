# Design note: nested-context extension

## Hook choice

- `tool_call` observes typed tool inputs before filesystem tools execute. The handler catches all errors so discovery cannot block normal Pi tool execution.
- `context` injects one hidden synthetic custom message before every provider call. This is used instead of `before_agent_start` because nested context is discovered after model tool calls, often mid-agent-loop. Direct system prompt mutation is only available before the first LLM call for a user prompt in this API.
- `before_agent_start` is still used to detect Pi's built-in startup context files via `systemPromptOptions.contextFiles`, so those files are excluded.

## Filesystem path handling

The extension extracts clear typed path-like fields from non-shell tools. It supports current built-ins (`read`, `write`, `edit`, `ls`, `grep`, `find`) plus `list` / `search` aliases and future built-in typed tools with obvious path fields. It does not parse `bash.command` because Pi exposes no robust path metadata for shell strings.

Paths are normalized relative to `ctx.cwd`. The cwd is the project boundary. The extension checks both lexical containment and realpath containment, skipping symlinks that escape cwd.

## Discovery and precedence

For each observed target directory, discovery walks from cwd's child toward the target directory. Cwd-level context files are excluded because Pi startup context already handles cwd and ancestors. In `chain` mode all configured filenames along the chain are loaded. In `nearest` mode only configured files in the nearest applicable directory are loaded.

Injected context states that:

1. Pi startup context remains active.
2. Nested files apply only under their listed directories.
3. More specific nested files override broader/root instructions for matching paths.

Files are sorted deterministically by directory depth, relative directory, configured filename order, and relative path.

## Caching and invalidation

The extension stores discovered files in memory only. Each loaded file records size and `mtimeMs`. Before every LLM context build, loaded files are `stat`ed and re-read if size or `mtimeMs` changed; deleted or newly unsafe files are removed. Directories observed from prior tool calls are also rechecked before context injection, so a `write`/`edit` that creates a new context file can affect the next provider call without requiring another path access. Discovery checks exact candidate filenames rather than recursively walking or reading directories, avoiding expensive traversal and repeated reads. Aggregate `maxLoadedFiles` and `maxTotalBytes` limits cap long-session context growth deterministically.

## Safety limits

Only names in `includeFilenames` are read. Files larger than `maxFileBytes` are skipped. Aggregate `maxLoadedFiles` and `maxTotalBytes` limits prevent unbounded accumulation across long sessions. Ignored directory names short-circuit discovery for paths under generated/vendor/cache directories. Context files are read as UTF-8 text and never executed.

## Limitations

- Shell command path extraction is intentionally unsupported unless Pi later exposes robust typed shell path metadata.
- Configuration is read on session start / `/reload`, not watched continuously.
- The extension injects one synthetic custom context message via the `context` hook, rather than rewriting the provider-level system prompt. This avoids provider-specific payload edits and works for subsequent LLM calls after tool-triggered discovery.
