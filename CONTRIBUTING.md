# Contributing

## Prerequisites

- Node.js 25 or newer.
- npm, bundled with Node.js.
- Git.

## Bootstrap a fresh checkout

From the repository root, run:

```bash
npm run bootstrap
```

The bootstrap script installs npm dependencies, makes the managed hook executable, and configures Git to use `.githooks/` for this repository. Set `SKIP_NPM_INSTALL=1` if dependencies are already installed and you only want to configure hooks.

## Daily development workflow

Use either npm scripts or the Makefile wrappers:

```bash
npm run lint      # or: make lint
npm run check     # or: make check
npm test          # or: make test
npm run build     # or: make build
npm run ci        # or: make ci
```

`npm run ci` is the local equivalent of the GitHub pre-merge quality gate: lint, TypeScript typecheck, tests, and build.

For local extension testing, start Pi with:

```bash
pi -e ./src/index.ts
```

If Pi is already running after a change, run `/reload` in Pi.

## Demo fixture

A runnable fixture lives in `demo-fixture/`.

Manual verification:

```bash
cd demo-fixture
pi -e ../src/index.ts
```

Then drive these scenarios:

1. Ask Pi to read or edit `packages/a/src/file.ts`.
   - Expect a visible `context-breadcrumbs` custom message in the transcript.
   - It should name `packages/a/src/file.ts` and include the chain `packages/AGENTS.md`, `packages/a/AGENTS.md`, and `packages/a/src/AGENTS.md` in broad-to-specific order.
2. Ask Pi to access `packages/a/src/file.ts` again without changing any breadcrumb file.
   - Expect no new breadcrumb message.
3. Edit `packages/a/src/AGENTS.md`, then ask Pi to access `packages/a/src/file.ts` again.
   - Expect a new visible breadcrumb message whose rendered reason line says breadcrumb content changed and that it supersedes earlier breadcrumb content.
   - If you inspect the persisted custom message details, `details.reason` should be `content-changed`.
4. Run `/compact`, then ask Pi to access `packages/a/src/file.ts` again.
   - Expect a new visible breadcrumb message whose rendered reason line says it is being restated after compaction.
   - If you inspect the persisted custom message details, `details.reason` should be `restated-after-compaction`.
5. Run `/context-breadcrumbs`.
   - Expect a notification listing the currently loaded in-memory breadcrumb files for the active process.

You can also set `.pi/context-breadcrumbs.json` in the fixture to:

```json
{
  "filterSupersededFromPrompt": false
}
```

Reload Pi and confirm the extension still emits visible breadcrumb messages. This flag changes provider-bound prompt filtering only; it does not remove visible history.

## Pre-commit hook

The repository-managed pre-commit hook runs:

1. `npm run lint`
2. `npm run check`
3. `npm test`

If the hook is not firing, rerun `npm run bootstrap` and verify:

```bash
git config core.hooksPath
```

The output should be `.githooks`.

## Commit style

Use Conventional Commits and keep commits atomic:

```text
<type>(<scope>): <imperative summary>
```

Common types are `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, and `build`.

## Pull requests and CI

Open pull requests against the repository default branch. GitHub CI runs on pull requests and on pushes to the default branch. A PR is ready to merge when CI is green and `npm run ci` passes locally.

## Release workflow

Releases are tag-driven. To release version `x.y.z`:

1. Update `package.json` to version `x.y.z`.
2. Run `npm run ci`.
3. Commit the version change.
4. Create and push tag `vx.y.z`.

The release workflow verifies that the tag matches `package.json`, reruns the full quality gate, performs `npm pack --dry-run`, publishes to npm with provenance, and creates a GitHub release. The repository must have an `NPM_TOKEN` secret configured for npm publishing.
