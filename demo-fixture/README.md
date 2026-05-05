# pi-context-breadcrumbs demo fixture

Run:

```bash
cd /path/to/pi-context-breadcrumbs/demo-fixture
pi -e ../src/index.ts
```

Try prompts that make Pi access:

- `packages/a/src/file.ts`
- `packages/b/src/file.ts`

Expected after accessing `packages/a/src/file.ts`:

```text
packages/AGENTS.md
packages/a/AGENTS.md
packages/a/src/AGENTS.md
```

Expected after accessing `packages/b/src/file.ts` in a fresh session:

```text
packages/AGENTS.md
packages/b/AGENTS.md
packages/b/src/AGENTS.md
```

If you first accessed `packages/a/src/file.ts`, then access `packages/b/src/file.ts` in the same session, `/nested-context` lists all loaded files. The package-b access adds `packages/b/AGENTS.md` and `packages/b/src/AGENTS.md`; `packages/AGENTS.md` is not duplicated.

Use `/nested-context` to list loaded files.
