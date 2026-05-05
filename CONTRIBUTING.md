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

Then ask Pi to read or edit `packages/a/src/file.ts`. After the tool call, `/context-breadcrumbs` should list:

```text
packages/AGENTS.md
packages/a/AGENTS.md
packages/a/src/AGENTS.md
```

Ask Pi to access `packages/b/src/file.ts`; the package-b chain should be added without duplicating `packages/AGENTS.md`.

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
