# Replace hidden per-request breadcrumb injection with visible persistent breadcrumb messages

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Note that this document must be maintained in accordance with `exec-plan` skill.

## Purpose / Big Picture

After this change, `pi-context-breadcrumbs` will stop whispering hidden breadcrumb context into every model request and will instead emit visible session messages the first time a nested breadcrumb chain becomes relevant, again when any breadcrumb file in that chain changes, and again after a compaction if that exact breadcrumb text may have been summarized away. A user will be able to see exactly which breadcrumb files were loaded, why they were loaded, and what content was injected, directly in the transcript.

The user-visible proof is simple. Start Pi with `pi -e ./src/index.ts`, ask Pi to access `demo-fixture/packages/a/src/file.ts`, and observe a visible custom message from `pi-context-breadcrumbs` that names the observed path and shows the applicable breadcrumb file contents. Ask Pi to access the same path again without changing any breadcrumb file and observe that no new breadcrumb message is emitted. Edit `demo-fixture/packages/a/src/AGENTS.md`, access the same file again, and observe a new visible message that explicitly supersedes the older breadcrumb content for that path. After a manual `/compact`, access the same path again and observe a restated visible breadcrumb message.

## Non-Goals

This change does not attempt to fake a built-in `read` tool call or generate `toolResult` entries. The visible breadcrumb messages will remain extension-generated custom messages.

This change does not add a mode switch between hidden and visible behavior. Visible persistent breadcrumb messages become the only behavior. The only new behavior toggle is the prompt-filtering chicken-bit described below.

This change does not add truncation, summarization, or byte limits for large breadcrumb files. The current package already loads very large breadcrumb files without size limits, and this plan preserves that behavior unless an implementation bug forces a defensive fix.

This change does not delete or rewrite old session history. Old breadcrumb messages remain in the append-only session file. Prompt filtering will decide what the model sees; the historical log remains intact.

## Progress

- [x] (2026-05-15 00:00Z) Reviewed the current extension implementation in `src/index.ts`, the package docs in `README.md`, the manual workflow in `CONTRIBUTING.md`, and the current test suite in `test/context-breadcrumbs.test.mjs`. Wrote this ExecPlan.
- [x] (2026-05-16 12:11Z) Validated in `demo-fixture/` that `pi.sendMessage(..., { deliverAs: "steer" })` from the breadcrumb discovery path persists a visible `context-breadcrumbs` custom message before the next assistant response, even when the assistant immediately ends the turn with a short final answer.
- [x] (2026-05-16 12:40Z) Refactored discovery so `NestedContextManager.observePath()` and `observeToolCall()` return the currently applicable breadcrumb chain for the observed path set, with per-file content hashes and without `buildContextMessage()`.
- [x] (2026-05-16 12:55Z) Added `src/breadcrumb-messages.ts`, replaced hidden prompt injection with visible persistent breadcrumb custom messages from the `tool_call` hook, and embedded structured `details` payloads for branch-state reconstruction.
- [x] (2026-05-16 13:05Z) Added branch-state reconstruction from current-branch `custom_message` and `compaction` entries so reload, resume, and branch navigation suppress unchanged re-announcements.
- [x] (2026-05-16 13:15Z) Added re-announcement decisions for content changes and post-compaction restatement of the full applicable chain.
- [x] (2026-05-16 13:25Z) Added prompt-time filtering of superseded breadcrumb messages behind `filterSupersededFromPrompt: true`.
- [x] (2026-05-16 13:45Z) Rewrote `test/context-breadcrumbs.test.mjs`, updated `README.md`, `config.schema.json`, `CONTRIBUTING.md`, and `demo-fixture/README.md`, and documented the visible persistent behavior.
- [x] (2026-05-16 15:16Z) Ran `npm run lint`, `npm run check`, `npm test`, and `npm run build`. Manually verified first-announcement, no-duplicate-on-repeat, content-change re-announcement, and compaction restatement behavior in `demo-fixture/` by inspecting the persisted session transcript.

## Surprises & Discoveries

- Observation: the current extension persists no breadcrumb state across sessions; the README explicitly says state is in-memory only.
  Evidence: `README.md` currently says “State is in-memory only and is not persisted across Pi sessions.”

- Observation: the current extension’s hidden message is rebuilt on every `context` event and is deduplicated only by dropping prior `customType === "context-breadcrumbs"` messages from the outgoing provider message list.
  Evidence: `src/index.ts` currently contains a `pi.on("context", ...)` handler that filters `event.messages` and pushes one hidden custom message with `display: false`.

- Observation: the current tests hard-code the old “build one hidden message from all loaded files” contract, so they must be rewritten rather than lightly patched.
  Evidence: `test/context-breadcrumbs.test.mjs` repeatedly calls `manager.buildContextMessage()` and asserts on `File:` lines inside that synthetic hidden prompt payload.

- Observation: the current package intentionally loads huge breadcrumb files without any size cap.
  Evidence: `test/context-breadcrumbs.test.mjs` writes a 100,000-byte `packages/huge/AGENTS.md` and asserts that it is fully loaded.

- Observation: `pi.sendMessage(..., { deliverAs: "steer" })` is reliable enough for this feature in the demo fixture. The visible `context-breadcrumbs` entry is appended between the triggering tool result and the next assistant response, even when the assistant immediately ends the turn with a short final answer.
  Evidence: a non-interactive `pi -p --session-dir <tmp> -e ../src/index.ts "Read packages/a/src/file.ts and reply with ok."` run in `demo-fixture/` produced a session branch with `toolResult`, then `custom_message` of type `context-breadcrumbs`, then the assistant `ok` response.

- Observation: print mode does not execute `/compact` as a slash command; it sends the text to the model. For transcript-level validation without an interactive TUI, a synthetic `compaction` entry appended to the session file was sufficient to prove the restatement logic on the next path access.
  Evidence: `pi -p --session <session> "/compact"` produced a normal assistant reply instead of a `compaction` entry, while appending one `compaction` JSONL line caused the subsequent access to emit a `reason: "restated-after-compaction"` breadcrumb message.

## Decision Log

- Decision: remove the hidden per-provider-call breadcrumb injection entirely and replace it with visible persistent custom messages.
  Rationale: this is the user’s stated preference, and it makes breadcrumb behavior inspectable in the session transcript instead of silently re-sending the same context forever.
  Date/Author: 2026-05-15 / Grin

- Decision: do not add a behavior mode flag. The package will have one breadcrumb delivery mode only: visible persistent custom messages.
  Rationale: the user explicitly rejected a mode switch. Carrying both paths would complicate the code and docs for no current benefit.
  Date/Author: 2026-05-15 / Grin

- Decision: add exactly one new config toggle, `filterSupersededFromPrompt`, defaulting to `true`.
  Rationale: visible persistent messages create useful history but can leave stale breadcrumb versions in the provider context. A prompt-time filter fixes that while preserving the historical transcript, and the user asked for a chicken-bit to disable it.
  Date/Author: 2026-05-15 / Grin

- Decision: use the visible breadcrumb custom messages themselves as the persistent source of truth for reload and resume, instead of storing parallel breadcrumb state in separate `custom` entries.
  Rationale: the message transcript is already persisted by Pi, it naturally survives reload and resume, and it avoids state divergence between “announced” bookkeeping and what actually appeared in the session.
  Date/Author: 2026-05-15 / Grin

- Decision: re-announce breadcrumb chains on the first relevant path access after any compaction whose timestamp is newer than the last breadcrumb announcement for any file in that chain.
  Rationale: compaction may replace earlier visible breadcrumb text with a summary. The extension should not rewrite history, but it should restore exact breadcrumb text when the path becomes relevant again.
  Date/Author: 2026-05-15 / Grin

- Decision: when a breadcrumb announcement is needed, inject the full currently applicable breadcrumb chain for the observed path, not only the changed leaf file.
  Rationale: the user asked for “the contents of the AGENTS.md files on the path to that file.” Sending the full chain keeps each visible breadcrumb message self-contained and easier to understand, and it simplifies supersession logic.
  Date/Author: 2026-05-15 / Grin

- Decision: send breadcrumb messages per observed tool call, not via a delayed turn-end batch.
  Rationale: this is simpler, aligns each breadcrumb message with the file access that caused it, and avoids turn-end queue timing ambiguity. The transcript may contain more than one breadcrumb message in a multi-tool turn, which is acceptable.
  Date/Author: 2026-05-15 / Grin

- Decision: do not add the `agent_end` breadcrumb flush fallback.
  Rationale: the early delivery validation showed that `deliverAs: "steer"` already persists the visible breadcrumb message before the next assistant response in the demo fixture, including short “read and stop” turns, so the fallback would add dead complexity for no demonstrated benefit.
  Date/Author: 2026-05-16 / Grin

## Outcomes & Retrospective

Completed. The package now emits visible persistent `context-breadcrumbs` custom messages from the `tool_call` hook instead of hidden prompt injections, stores the full breadcrumb chain and reason in structured `details`, reconstructs latest announced hashes from the current session branch after reload or resume, restates exact breadcrumb text after later path access when a compaction postdates the last announcement, and optionally filters superseded breadcrumb messages out of the provider-bound prompt while leaving transcript history untouched.

The biggest nuisance was not the extension logic but the validation harness: non-interactive print mode happily treats `/compact` as user text instead of executing the slash command. That was annoying in the usual way. The actual compaction-sensitive logic was still validated end to end by appending a real `compaction` entry to the session transcript and proving that the next relevant path access emitted a `restated-after-compaction` breadcrumb message.

The old hidden prompt blob the extension used to emit is gone. The transcript now shows exactly which breadcrumb files were loaded, why they were announced, and which versions supersede older ones.

## Context and Orientation

This repository is a small Pi package. The extension entrypoint lives in `src/index.ts`. That file currently does three jobs at once: configuration loading, breadcrumb discovery, and extension event wiring. The core runtime object is `NestedContextManager`, which discovers nested breadcrumb files such as `AGENTS.md`, `AGENTS.override.md`, and `CLAUDE.md` after the agent touches a path beneath them.

A “breadcrumb file” in this repository means a local context file such as `packages/a/AGENTS.md` that tells the agent how to work in that subtree. A “chain” means the ordered list of breadcrumb files between the session working directory and the accessed target path, excluding the cwd-level breadcrumb files already loaded by Pi startup context. For `packages/a/src/file.ts`, the chain might be `packages/AGENTS.md`, then `packages/a/AGENTS.md`, then `packages/a/src/AGENTS.md`.

Pi stores session history as a branch of append-only entries. Visible extension-generated messages are persisted as `custom_message` entries. A “compaction” is Pi’s process for replacing older exact history with a summary when context gets large. Compaction does not delete old session file lines, but it does change what exact message text reaches the model. That is why this plan treats old visible breadcrumb messages as durable history while still re-announcing exact breadcrumb text on later path access if a compaction has happened since the last announcement.

The files that matter for this work are as follows.

`src/index.ts` currently defines the config type, the manager, the hidden context builder, and the extension hooks.

`README.md` documents current behavior and currently promises hidden prompt injection plus in-memory-only state.

`config.schema.json` mirrors the public config fields and must be updated whenever config changes.

`test/context-breadcrumbs.test.mjs` is the only automated test file. It currently exercises discovery, ordering, cwd exclusion, `.gitignore` handling, symlink safety, and the hidden context-message builder.

`CONTRIBUTING.md` and `demo-fixture/README.md` describe the current manual verification flow. They must be updated so a human tester knows to expect visible breadcrumb custom messages in the transcript rather than only `/context-breadcrumbs` output.

`package.json` defines the local quality gate. `npm run ci` means lint, typecheck, tests, and build.

Because `dist/` is committed in this repository, any source changes in `src/` must be followed by `npm run build`, and the updated `dist/index.js`, `dist/index.d.ts`, and `dist/index.js.map` must be reviewed as generated artifacts.

## Open Questions

There is one implementation detail that must be validated early rather than guessed from vibes. Does `pi.sendMessage(..., { deliverAs: "steer" })` from the breadcrumb discovery path always produce a visible persisted message soon enough for the next provider call, even when the current assistant turn ends immediately after the tool call? The plan below assumes yes. If the demo fixture proves otherwise, add a narrow fallback in `agent_end` that flushes any breadcrumb batch that was marked for announcement but never materialized in the session branch.

No other design question is intentionally left open. The rest of the work should proceed once that delivery timing is validated.

## Plan of Work

### Milestone 1: make breadcrumb discovery return path-specific file chains and define the persistent breadcrumb message format

At the end of this milestone, the codebase will still discover breadcrumb files exactly as before, but it will no longer be structured around synthesizing one hidden prompt payload for the whole session. Instead, the discovery path will be able to return “the currently applicable breadcrumb chain for this observed tool call” as structured data, and the repository will have one canonical custom-message format for visible breadcrumb injections.

Begin in `src/index.ts`. Extend `NestedContextConfig`, `DEFAULT_CONFIG`, `normalizeConfig`, and `CONFIG_SCHEMA` with a single new field named `filterSupersededFromPrompt`, defaulting to `true`. Do not add any mode field. Update `config.schema.json` in the same commit so the public schema matches the runtime config exactly.

Still in `src/index.ts`, add a content hash to `LoadedContextFile`. Use `node:crypto` and a stable algorithm such as SHA-256, encoded as lowercase hex. The hash is an internal identity key for “this exact breadcrumb content”; it does not need to be shown in the visible transcript.

Refactor `NestedContextManager` so it can return the breadcrumb chain for one observed raw path or one observed tool call. The simplest acceptable shape is to change `observePath(rawPath)` and `observeToolCall(toolName, input, isBuiltinTool)` from “mutate internal loaded state and return nothing” into “mutate internal loaded state and return the ordered `LoadedContextFile[]` that currently apply to the observed path or paths for this observation.” Preserve all current safety behavior: cwd boundary enforcement, symlink escape rejection, startup-context exclusion, ignored directories, and `.gitignore` skipping.

Remove `buildContextMessage()` from `NestedContextManager`. That method exists only to feed the old hidden-injection model. Replace it with smaller helpers that expose structured state, such as “ordered loaded files” and “files applicable to this observation.” Keep `listLoaded()` so `/context-breadcrumbs` can still show the in-memory cache.

Create a new helper module at `src/breadcrumb-messages.ts`. This file should hold the persistent message format and the state reconstruction logic so `src/index.ts` stops being one large junk drawer. Define at least the following exported types and helpers.

Define `BreadcrumbInjectedFile` with the breadcrumb file path relative to cwd, the applies-to glob string, the content hash, and the full UTF-8 content.

Define `BreadcrumbMessageDetails` with a `version: 1`, an array of normalized observed target paths, a `reason` string whose allowed values are `new-chain`, `content-changed`, or `restated-after-compaction`, and a `files` array of `BreadcrumbInjectedFile`. Storing the full file content again inside `details.files` is intentional. The prose content shown to the model is not a stable parse target; the details object is the machine-readable source of truth for prompt filtering and session reconstruction.

Define `buildBreadcrumbCustomMessage(...)`, which takes the observed targets, the ordered files to show, and the announcement reason, and returns a visible custom-message payload: human-readable `content` plus typed `details`. The visible message text must contain a short disclaimer in plain language. It should say that `pi-context-breadcrumbs` loaded local breadcrumb files to better scope work under the observed paths, that this is extension-provided context and not a read-tool result, that newer breadcrumb injections for the same breadcrumb file path supersede older ones, and that `/skill:context-breadcrumbs` can be used for breadcrumb maintenance policy when available.

Keep the visible text dry and repetitive on purpose. This is an instrumentation feature, not a poet’s recital. The message should name the observed path or paths, then list each breadcrumb file in broad-to-specific order with `File:`, `Applies to:`, and `Content:` sections.

### Milestone 2: replace hidden context injection with visible persistent breadcrumb announcements and branch-state reconstruction

At the end of this milestone, the extension will emit visible breadcrumb messages when a path first crosses into a nested breadcrumb chain, when any breadcrumb file in that chain changes, and when a compaction has happened since the last exact breadcrumb announcement for any file in that chain. Reload, resume, and branch navigation will continue to avoid duplicate announcements by reconstructing state from the current session branch.

In `src/breadcrumb-messages.ts`, define `collectBreadcrumbBranchState(entries)`. This helper will scan the current session branch, not the whole session file. It must inspect two entry families.

First, it must inspect `custom_message` entries generated by this extension. For each such message, parse `details` as `BreadcrumbMessageDetails`. For each `files[i].path`, keep the newest known `(hash, timestamp)` pair for that breadcrumb file path. This becomes the “latest announced state” map.

Second, it must inspect `compaction` entries and retain the newest compaction timestamp in the current branch. This becomes the “latest possible exact-text loss boundary.” You do not need to know which specific earlier breadcrumb messages were summarized away. The accepted approximation is simpler: if a compaction happened after the last announcement timestamp for any breadcrumb file in the currently applicable chain, then the chain must be restated verbatim on the next relevant path access.

Still in `src/breadcrumb-messages.ts`, define `shouldAnnounceBreadcrumbChain(files, branchState)`. This helper decides whether the current chain needs a visible announcement and why. It should return `announce: false` only when every breadcrumb file in the chain has the same hash as the newest announced hash for that breadcrumb file path and every such announcement timestamp is newer than or equal to the latest compaction timestamp on the current branch. If there is no prior state for any file in the chain, return `announce: true` with reason `new-chain`. If any hash differs, return `announce: true` with reason `content-changed`. If hashes match but any breadcrumb file in the chain was last announced before the latest compaction, return `announce: true` with reason `restated-after-compaction`. When an announcement is needed, always announce the full currently applicable chain for the observed path set, not a partial delta.

Now return to `src/index.ts` and rework the extension wiring. Keep `session_start`, `session_shutdown`, `before_agent_start`, and `/context-breadcrumbs`, but delete the current `pi.on("context", ...)` handler that creates the hidden `display: false` message. The old hidden path is gone.

In the `tool_call` handler, do the following in order.

Call `manager.observeToolCall(...)` so the manager updates its in-memory loaded set and returns the current ordered breadcrumb chain for the observation.

If the returned file set is empty, do nothing.

Normalize the observed target path strings that came from the current tool call so they can be shown in the visible message and stored in message details.

Call `collectBreadcrumbBranchState(ctx.sessionManager.getBranch())` to reconstruct latest announced hashes and latest compaction timestamp for the current branch.

Convert the returned `LoadedContextFile[]` into `BreadcrumbInjectedFile[]`, preserving broad-to-specific order.

Call `shouldAnnounceBreadcrumbChain(...)`. If it returns false, do nothing. If it returns true, build a visible custom message with `buildBreadcrumbCustomMessage(...)` and send it with `pi.sendMessage({ customType: "context-breadcrumbs", content, details, display: true }, { deliverAs: "steer" })`.

Do not append parallel custom state entries. The visible breadcrumb custom messages already persist in the session and already contain the structured details needed for reconstruction.

As part of this milestone, make the `tool_call` handler resilient to the one open question from above. After the manual spike, if `deliverAs: "steer"` is proven reliable, document that and stop there. If it is not reliable when the assistant turn ends immediately, add a minimal fallback: track the most recent breadcrumb batch in memory during the turn and, in `agent_end`, emit it with `triggerTurn: false` only if it never materialized in `ctx.sessionManager.getBranch()` as a matching `context-breadcrumbs` custom message. Keep that fallback narrow and well-commented; do not invent a second message path unless the spike forces it.

### Milestone 3: add optional prompt filtering for superseded breadcrumb messages and update tests and docs

At the end of this milestone, the transcript will preserve all visible breadcrumb messages, but the model will see only the newest exact breadcrumb content for each breadcrumb file path unless the user disables prompt filtering.

In `src/breadcrumb-messages.ts`, define `filterSupersededBreadcrumbMessages(messages)`. This helper will run on the provider-bound message list from Pi’s `context` hook. It must inspect role-`custom` messages whose `customType` is `context-breadcrumbs` and whose `details` parse as `BreadcrumbMessageDetails`. Ignore everything else.

The filter must compute the newest `(hash, timestamp)` pair for each breadcrumb file path represented in the current outgoing message list. Then it must rewrite breadcrumb custom messages so each one retains only the breadcrumb files whose `(path, hash, timestamp)` still match the newest known state for that path. If rewriting leaves a breadcrumb message with zero remaining files, drop that message from the outgoing provider message list. If rewriting leaves some files, rebuild the human-readable content with the same disclaimer and only the surviving files, and update `details.files` to match. This allows one older batch message to survive for still-current parent breadcrumbs even if some child breadcrumb paths were superseded by a newer batch. It also avoids relying on brittle prose parsing.

Back in `src/index.ts`, add a new `pi.on("context", ...)` handler, but only for prompt-time filtering. This new hook must not add or inject any breadcrumb content. Its only job is to optionally call `filterSupersededBreadcrumbMessages(...)` when `manager.config.filterSupersededFromPrompt` is true and return the filtered `messages`. When the config is false, return nothing and leave the provider-bound history untouched.

Now rewrite the tests in `test/context-breadcrumbs.test.mjs`. Keep all current discovery safety coverage, but stop asserting on `manager.buildContextMessage()` because that old API is being removed. Instead, add or update tests to cover the new pure helpers and the new observe-return values. The test file should prove at least the following behaviors.

Observing `packages/a/src/file.ts` returns the breadcrumb chain in broad-to-specific order and excludes the cwd-level `AGENTS.md`.

Re-observing the same path without file changes returns the same chain but `shouldAnnounceBreadcrumbChain(...)` returns false when fed branch state reconstructed from a prior visible breadcrumb message with matching hashes.

Changing one breadcrumb file content changes its hash and causes `shouldAnnounceBreadcrumbChain(...)` to request a new announcement for the full chain with reason `content-changed`.

A compaction timestamp newer than the last breadcrumb announcement timestamp for any file in the chain causes `shouldAnnounceBreadcrumbChain(...)` to request `restated-after-compaction` even when hashes are unchanged.

`filterSupersededBreadcrumbMessages(...)` drops or rewrites stale breadcrumb custom messages so only the newest hash per breadcrumb file path remains in the provider-bound message list.

Resume-style reconstruction works by feeding synthetic `custom_message` entries with stored breadcrumb details into `collectBreadcrumbBranchState(...)` and asserting that the newest hash per breadcrumb file path is recovered correctly.

Keep the current `.gitignore`, symlink-escape, outside-cwd, custom filename, and large-file tests. They are still relevant.

Finally, update the docs.

In `README.md`, rewrite the package description and operation section. It must now say that nested breadcrumb files are announced as visible persistent custom messages after relevant filesystem tool calls, that unchanged breadcrumb chains are not re-announced, that breadcrumb changes are re-announced, that compaction can trigger restatement on later path access, and that the extension reconstructs its breadcrumb announcement state from the current session branch after reload and resume. Replace the old “state is in-memory only” claim with the correct mixed model: discovery cache is in memory, but breadcrumb announcements persist in the session transcript.

In `README.md` and `config.schema.json`, document `filterSupersededFromPrompt` with default `true` and explain that it only affects what is sent to the model, not what remains visible in the session transcript.

In `CONTRIBUTING.md` and `demo-fixture/README.md`, update manual verification. The instructions must tell a tester to look for visible breadcrumb custom messages in the session after path access, then verify that repeated unchanged access does not emit duplicates, then modify a breadcrumb file and verify a new visible superseding message.

After source changes are complete, run `npm run build` so `dist/index.js`, `dist/index.d.ts`, and `dist/index.js.map` reflect the new implementation, and review those generated files before committing.

## Concrete Steps

Work from the repository root unless a step explicitly says otherwise.

1. Validate message delivery timing in the demo fixture before rewriting too much code.

    cd /home/esynr3z/projects/pi-context-breadcrumbs/demo-fixture
    pi -e ../src/index.ts

In Pi, ask it to access `packages/a/src/file.ts` after the new breadcrumb-send path has been wired. Record whether the visible breadcrumb message appears before the next model reasoning step and whether it still appears when the assistant decides it is done immediately after the tool call. If there is any ambiguity, add the narrow `agent_end` fallback described above.

2. Edit `src/index.ts` to extend config, add content hashing to `LoadedContextFile`, remove `buildContextMessage()`, and make `observePath` / `observeToolCall` return structured applicable breadcrumb chains.

3. Create `src/breadcrumb-messages.ts` and implement the breadcrumb message details format, the human-readable message builder, the branch-state reconstruction helper, the announcement decision helper, and the superseded-message prompt filter.

4. Rewire the extension in `src/index.ts` so `tool_call` emits visible breadcrumb custom messages and `context` only filters existing breadcrumb custom messages when `filterSupersededFromPrompt` is enabled.

5. Update `test/context-breadcrumbs.test.mjs` to cover the new helpers and remove the old hidden-message assertions.

6. Update `README.md`, `config.schema.json`, `CONTRIBUTING.md`, and `demo-fixture/README.md`.

7. Rebuild and run the quality gate.

    cd /home/esynr3z/projects/pi-context-breadcrumbs
    npm run lint
    npm run check
    npm test
    npm run build

Expected success transcript:

    > pi-context-breadcrumbs@1.0.0 lint
    > eslint .

    > pi-context-breadcrumbs@1.0.0 check
    > tsc --noEmit

    > pi-context-breadcrumbs@1.0.0 test
    > node --experimental-transform-types test/context-breadcrumbs.test.mjs

    nested-context tests passed

    > pi-context-breadcrumbs@1.0.0 build
    > tsc

8. Perform manual acceptance in the demo fixture.

    cd /home/esynr3z/projects/pi-context-breadcrumbs/demo-fixture
    pi -e ../src/index.ts

Then drive the following scenarios.

Ask Pi to read `packages/a/src/file.ts`. Observe a visible `context-breadcrumbs` custom message that names `packages/a/src/file.ts` and includes the applicable breadcrumb chain, for example `packages/AGENTS.md`, `packages/a/AGENTS.md`, and `packages/a/src/AGENTS.md`, in broad-to-specific order.

Ask Pi to read the same file again without modifying any breadcrumb file. Observe that no new breadcrumb message is emitted.

Edit `packages/a/src/AGENTS.md` and ask Pi to read `packages/a/src/file.ts` again. Observe a new visible breadcrumb message that says it supersedes earlier breadcrumb content for that path.

Run `/compact`, then ask Pi again to access `packages/a/src/file.ts`. Observe a new visible breadcrumb message that restates the full current chain because compaction may have summarized the earlier exact breadcrumb text.

Optionally set `.pi/context-breadcrumbs.json` in the demo fixture to:

    {
      "filterSupersededFromPrompt": false
    }

Reload Pi and verify that the extension still functions and emits visible breadcrumb messages. The exact provider-side difference of disabling prompt filtering is covered primarily by automated tests; the manual check here is simply that the config flag is accepted and does not break runtime behavior.

## Validation and Acceptance

Acceptance is behavior, not just green TypeScript.

Automated acceptance is satisfied only if all of the following are true.

`npm test` passes and includes coverage for content-hash change detection, compaction-triggered restatement decisions, branch-state reconstruction from prior breadcrumb custom messages, and prompt filtering of superseded breadcrumb custom messages.

`npm run check` passes with no TypeScript errors after the new helper module and updated exports are added.

`npm run lint` passes with no style or unused-code regressions introduced by the refactor.

`npm run build` passes and updates committed `dist/` artifacts.

Manual acceptance is satisfied only if all of the following are true in `demo-fixture/`.

The first relevant path access emits a visible breadcrumb custom message.

A repeated unchanged access does not emit another breadcrumb message.

A breadcrumb file content change emits a visible superseding breadcrumb message on the next relevant path access.

A manual compaction followed by a relevant path access emits a visible restatement breadcrumb message.

`/context-breadcrumbs` still lists the currently loaded in-memory breadcrumb files for the active process.

If the implementation changes the visible message shape from the examples in this plan, update the examples in this plan and in the docs so the next contributor is not debugging a ghost of an old format.

## Idempotence and Recovery

All file edits in this plan are additive or local refactors and are safe to retry. If the helper-module split becomes messy, revert only the affected files and reapply the split more carefully; there is no migration or irreversible data step here.

The test commands are safe to rerun. `npm run build` is safe to rerun. If the manual demo session becomes cluttered with old breadcrumb messages from earlier iterations, start a fresh Pi session rather than trying to infer correctness from a polluted history.

Do not hand-edit files under `dist/`. Always regenerate them with `npm run build`. If generated files drift from source, discard the manual drift and rebuild.

If the early message-delivery spike shows that `deliverAs: "steer"` from the discovery path is unreliable, do not paper over it with more hidden context logic. Implement only the narrow `agent_end` fallback described in Milestone 2 and document the observation in `Surprises & Discoveries`.

## Artifacts and Notes

The target visible breadcrumb message should look roughly like this in the transcript. Keep the exact wording short and mechanical.

    [context-breadcrumbs]

    pi-context-breadcrumbs loaded local breadcrumb files while working with:
    - packages/a/src/file.ts

    This is extension-provided context, not a read-tool result.
    Newer breadcrumb injections for the same breadcrumb file path supersede older ones.
    For breadcrumb maintenance policy, use /skill:context-breadcrumbs when available.

    File: packages/AGENTS.md
    Applies to: packages/**
    Content:
    ...

    File: packages/a/AGENTS.md
    Applies to: packages/a/**
    Content:
    ...

    File: packages/a/src/AGENTS.md
    Applies to: packages/a/src/**
    Content:
    ...

The target branch-state reconstruction logic should conceptually derive records like this from prior `custom_message.details`. This is an internal example, not a required visible format.

    {
      "packages/AGENTS.md": { "hash": "<sha256>", "timestamp": 1760000000000 },
      "packages/a/AGENTS.md": { "hash": "<sha256>", "timestamp": 1760000000000 },
      "packages/a/src/AGENTS.md": { "hash": "<sha256>", "timestamp": 1760000000000 }
    }

The target docs language for the new config field should be close to this.

    filterSupersededFromPrompt: when true, the extension removes older superseded breadcrumb messages from the provider-bound prompt while leaving the visible session history unchanged. Default: true.

## Interfaces and Dependencies

Use Node’s built-in `crypto` module for content hashing. Do not add third-party hashing dependencies.

In `src/index.ts`, the public config shape at the end of this work must be:

    export interface NestedContextConfig {
      enabled: boolean;
      includeFilenames: string[];
      ignoreDirs: string[];
      notifyOnLoad: boolean;
      filterSupersededFromPrompt: boolean;
    }

`LoadedContextFile` in `src/index.ts` must include the full breadcrumb file content and a stable content hash. The exact field name should be `contentHash`.

Create `src/breadcrumb-messages.ts` with exported helpers whose names remain stable enough for tests and future maintenance. At minimum, this module must export:

    export interface BreadcrumbInjectedFile { ... }
    export interface BreadcrumbMessageDetails { ... }
    export function buildBreadcrumbCustomMessage(...): { content: string; details: BreadcrumbMessageDetails }
    export function collectBreadcrumbBranchState(...): { latestByPath: Map<string, { hash: string; timestamp: number }>; latestCompactionTimestamp: number }
    export function shouldAnnounceBreadcrumbChain(...): { announce: boolean; reason?: "new-chain" | "content-changed" | "restated-after-compaction" }
    export function filterSupersededBreadcrumbMessages(...): AgentMessage[]

The extension custom message type string must remain `context-breadcrumbs`. That preserves continuity with existing exports and keeps transcript filtering simple.

The `context` hook in `src/index.ts` must remain non-destructive beyond filtering or rewriting existing `context-breadcrumbs` custom messages when `filterSupersededFromPrompt` is enabled. It must never synthesize new breadcrumb content.

The `tool_call` hook in `src/index.ts` becomes the only breadcrumb announcement producer. It must continue to respect the existing built-in-tool detection from `getBuiltinToolNames(pi)` and the existing path extraction logic from `extractFilesystemPaths(...)`.

At the end of the work, `README.md`, `config.schema.json`, `CONTRIBUTING.md`, `demo-fixture/README.md`, `src/index.ts`, `src/breadcrumb-messages.ts`, `test/context-breadcrumbs.test.mjs`, and regenerated `dist/` artifacts must all agree about the new visible persistent breadcrumb behavior.

Revision note: 2026-05-15 / Grin — initial ExecPlan created from the current repository state and the user’s requested behavior: visible persistent breadcrumb messages, branch-state reconstruction across reload and resume, compaction-triggered restatement on later access, no behavior mode flag, and one prompt-filtering chicken-bit.
