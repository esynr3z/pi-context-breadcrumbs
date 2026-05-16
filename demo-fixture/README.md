# pi-context-breadcrumbs demo fixture

Run:

```bash
cd /path/to/pi-context-breadcrumbs/demo-fixture
pi -e ../src/index.ts
```

Suggested manual checks:

1. Ask Pi to access `packages/a/src/file.ts`.
   - Expect a visible `context-breadcrumbs` custom message that names `packages/a/src/file.ts`.
   - It should include `packages/AGENTS.md`, `packages/a/AGENTS.md`, and `packages/a/src/AGENTS.md` in broad-to-specific order.
2. Ask Pi to access `packages/a/src/file.ts` again without changing any breadcrumb file.
   - Expect no new breadcrumb message.
3. Edit `packages/a/src/AGENTS.md`, then ask Pi to access `packages/a/src/file.ts` again.
   - Expect a new visible breadcrumb message with reason `content-changed`.
4. Run `/compact`, then ask Pi to access `packages/a/src/file.ts` again.
   - Expect a new visible breadcrumb message with reason `restated-after-compaction`.
5. Ask Pi to access `packages/b/src/file.ts`.
   - Expect a visible breadcrumb message for the package-b chain.
6. Run `/context-breadcrumbs`.
   - Expect a notification listing the currently loaded in-memory breadcrumb files.

Optional config check:

Create `.pi/context-breadcrumbs.json` in this fixture with:

```json
{
  "filterSupersededFromPrompt": false
}
```

Reload Pi. The extension should still emit visible breadcrumb messages; the flag only disables prompt-time filtering of superseded breadcrumb messages.
