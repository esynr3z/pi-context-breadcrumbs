import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NestedContextManager, normalizeConfig, extractFilesystemPaths } from "../src/index.ts";

function filesIn(message) {
  return [...message.matchAll(/^File: (.+)$/gm)].map((m) => m[1]);
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const cwd = mkdtempSync(path.join(tmpdir(), "nested-context-"));
try {
  mkdirSync(path.join(cwd, "packages", "a", "src"), { recursive: true });
  mkdirSync(path.join(cwd, "packages", "b", "src"), { recursive: true });
  mkdirSync(path.join(cwd, "packages", "huge", "src"), { recursive: true });

  writeFileSync(path.join(cwd, "AGENTS.md"), "ROOT SHOULD NOT LOAD");
  writeFileSync(path.join(cwd, "packages", "AGENTS.md"), "PACKAGES");
  writeFileSync(path.join(cwd, "packages", "a", "AGENTS.md"), "A");
  writeFileSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"), "A SRC v1");
  writeFileSync(path.join(cwd, "packages", "b", "AGENTS.md"), "B");
  writeFileSync(path.join(cwd, "packages", "b", "src", "AGENTS.md"), "B SRC");
  writeFileSync(path.join(cwd, "packages", "a", "src", "file.ts"), "export {};\n");
  writeFileSync(path.join(cwd, "packages", "b", "src", "file.ts"), "export {};\n");
  writeFileSync(path.join(cwd, "packages", "huge", "AGENTS.md"), "x".repeat(80));

  const loadedNotifications = [];
  const manager = new NestedContextManager(cwd, normalizeConfig({}), (message, level) => {
    loadedNotifications.push({ message, level });
  });
  manager.setStartupContextFiles([{ path: path.join(cwd, "AGENTS.md") }]);

  assert.equal(manager.buildContextMessage(), undefined, "no nested files are loaded before path access");

  await manager.observePath("packages/a/src/file.ts");
  let message = manager.buildContextMessage();
  assert.deepEqual(filesIn(message), [
    "packages/AGENTS.md",
    "packages/a/AGENTS.md",
    "packages/a/src/AGENTS.md",
  ]);
  assert.equal(message.includes("ROOT SHOULD NOT LOAD"), false);
  assert.equal(count(message, "File: packages/a/src/AGENTS.md"), 1);

  await manager.observePath("packages/a/src/another.ts");
  message = manager.buildContextMessage();
  assert.equal(count(message, "File: packages/a/src/AGENTS.md"), 1, "re-accessing same subtree does not duplicate");

  await manager.observePath("packages/b/src/file.ts");
  message = manager.buildContextMessage();
  assert.deepEqual(filesIn(message), [
    "packages/AGENTS.md",
    "packages/a/AGENTS.md",
    "packages/b/AGENTS.md",
    "packages/a/src/AGENTS.md",
    "packages/b/src/AGENTS.md",
  ]);

  const clearable = new NestedContextManager(cwd, normalizeConfig({}));
  await clearable.observePath("packages/a/src/file.ts");
  clearable.clear();
  clearable.refreshLoaded();
  assert.equal(clearable.buildContextMessage(), undefined, "clear removes loaded files and observed directories");

  const nearest = new NestedContextManager(cwd, normalizeConfig({ loadMode: "nearest" }));
  nearest.setStartupContextFiles([{ path: path.join(cwd, "AGENTS.md") }]);
  await nearest.observePath("packages/a/src/file.ts");
  assert.deepEqual(filesIn(nearest.buildContextMessage()), ["packages/a/src/AGENTS.md"]);

  const oversize = new NestedContextManager(cwd, normalizeConfig({ maxFileBytes: 64 }));
  await oversize.observePath("packages/huge/src/file.ts");
  assert.equal(oversize.buildContextMessage()?.includes("File: packages/huge/AGENTS.md"), false, "oversized context files are skipped");

  const outside = new NestedContextManager(cwd, normalizeConfig({}));
  await outside.observePath("../outside/file.ts");
  assert.equal(outside.buildContextMessage(), undefined, "paths outside cwd are skipped");

  await new Promise((resolve) => setTimeout(resolve, 25));
  writeFileSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"), "A SRC v2 changed");
  manager.refreshLoaded();
  message = manager.buildContextMessage();
  assert.equal(message.includes("A SRC v2 changed"), true, "changed context files are reloaded");

  mkdirSync(path.join(cwd, "packages", "new", "src"), { recursive: true });
  const newlyCreated = new NestedContextManager(cwd, normalizeConfig({}));
  await newlyCreated.observePath("packages/new/src/AGENTS.md");
  assert.equal(newlyCreated.buildContextMessage()?.includes("packages/new/src/AGENTS.md"), false, "missing context is not loaded before creation");
  writeFileSync(path.join(cwd, "packages", "new", "src", "AGENTS.md"), "NEW SRC");
  newlyCreated.refreshLoaded();
  assert.equal(newlyCreated.buildContextMessage()?.includes("packages/new/src/AGENTS.md"), true, "newly-created observed context files are discovered before next LLM context");

  const invalidated = new NestedContextManager(cwd, normalizeConfig({}));
  await invalidated.observePath("packages/a/src/file.ts");
  assert.equal(invalidated.buildContextMessage()?.includes("packages/a/src/AGENTS.md"), true);
  unlinkSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"));
  symlinkSync(path.join(cwd, "..", "outside-AGENTS.md"), path.join(cwd, "packages", "a", "src", "AGENTS.md"));
  invalidated.refreshLoaded();
  assert.equal(invalidated.buildContextMessage()?.includes("packages/a/src/AGENTS.md"), false, "unsafe replacement invalidates stale loaded context");
  unlinkSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"));
  writeFileSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"), "A SRC v2 changed");

  const limited = new NestedContextManager(cwd, normalizeConfig({ maxLoadedFiles: 2, maxTotalBytes: 1_000_000 }));
  await limited.observePath("packages/a/src/file.ts");
  assert.equal(filesIn(limited.buildContextMessage()).length, 2, "maxLoadedFiles limits aggregate injected context");

  writeFileSync(path.join(cwd, "packages", "a", "src", "CLAUDE.md"), "CLAUDE SRC");
  const customNames = new NestedContextManager(cwd, normalizeConfig({ includeFilenames: ["AGENTS.md", "CLAUDE.md"] }));
  await customNames.observePath("packages/a/src/file.ts");
  assert.deepEqual(filesIn(customNames.buildContextMessage()), [
    "packages/AGENTS.md",
    "packages/a/AGENTS.md",
    "packages/a/src/AGENTS.md",
    "packages/a/src/CLAUDE.md",
  ]);

  assert.deepEqual(extractFilesystemPaths("bash", { command: "cat packages/a/src/file.ts" }), []);
  assert.deepEqual(extractFilesystemPaths("read", { path: "packages/a/src/file.ts" }), ["packages/a/src/file.ts"]);

  console.log("nested-context tests passed");
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
