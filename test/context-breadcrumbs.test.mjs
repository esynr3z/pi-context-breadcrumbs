import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildBreadcrumbCustomMessage,
  collectBreadcrumbBranchState,
  createEmptyBreadcrumbBranchState,
  filterSupersededBreadcrumbMessages,
  mergeBreadcrumbBranchStates,
  recordBreadcrumbAnnouncement,
  recordBreadcrumbCompaction,
  shouldAnnounceBreadcrumbChain,
} from "../src/breadcrumb-messages.ts";
import { NestedContextManager, normalizeConfig, extractFilesystemPaths, loadConfig } from "../src/index.ts";

function relPaths(files) {
  return files.map((file) => file.relPath);
}

function filesInContent(content) {
  return [...content.matchAll(/^File: (.+)$/gm)].map((m) => m[1]);
}

function toInjected(files) {
  return files.map((file) => ({
    path: file.relPath,
    appliesTo: file.appliesTo,
    contentHash: file.contentHash,
    content: file.content,
  }));
}

function makeBranchMessage(details, timestamp) {
  return {
    type: "custom_message",
    customType: "context-breadcrumbs",
    details,
    timestamp,
  };
}

function makePromptMessage(details, timestamp, content) {
  return {
    role: "custom",
    customType: "context-breadcrumbs",
    content,
    details,
    display: true,
    timestamp,
  };
}

function requireFile(files, targetPath) {
  const file = files.find((entry) => entry.path === targetPath || entry.relPath === targetPath);
  assert.ok(file, `expected file ${targetPath}`);
  return file;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

const cwd = mkdtempSync(path.join(tmpdir(), "nested-context-"));
try {
  mkdirSync(path.join(cwd, "packages", "a", "src"), { recursive: true });
  mkdirSync(path.join(cwd, "packages", "b", "src"), { recursive: true });
  mkdirSync(path.join(cwd, "packages", "huge", "src"), { recursive: true });

  writeFileSync(path.join(cwd, "AGENTS.md"), "ROOT SHOULD NOT LOAD");
  writeFileSync(path.join(cwd, "packages", "AGENTS.md"), "PACKAGES");
  writeFileSync(path.join(cwd, "packages", "a", "AGENTS.md"), "A");
  writeFileSync(path.join(cwd, "packages", "a", "AGENTS.override.md"), "A OVERRIDE");
  writeFileSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"), "A SRC v1");
  writeFileSync(path.join(cwd, "packages", "a", "src", "CLAUDE.md"), "A SRC CLAUDE");
  writeFileSync(path.join(cwd, "packages", "b", "AGENTS.md"), "B");
  writeFileSync(path.join(cwd, "packages", "b", "src", "AGENTS.md"), "B SRC");
  writeFileSync(path.join(cwd, "packages", "a", "src", "file.ts"), "export {};\n");
  writeFileSync(path.join(cwd, "packages", "b", "src", "file.ts"), "export {};\n");
  writeFileSync(path.join(cwd, "packages", "huge", "AGENTS.md"), "x".repeat(100_000));

  const loadedNotifications = [];
  const manager = new NestedContextManager(cwd, normalizeConfig({}), (message, level) => {
    loadedNotifications.push({ message, level });
  });
  manager.setStartupContextFiles([{ path: path.join(cwd, "AGENTS.md") }]);

  assert.deepEqual(normalizeConfig({}).includeFilenames, ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"]);
  assert.equal(normalizeConfig({}).filterSupersededFromPrompt, true);

  mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ "context-breadcrumbs": { notifyOnLoad: false } }));
  assert.equal(loadConfig(cwd).notifyOnLoad, false, "settings use the context-breadcrumbs key");
  writeFileSync(
    path.join(cwd, ".pi", "context-breadcrumbs.json"),
    JSON.stringify({ notifyOnLoad: true, filterSupersededFromPrompt: false }),
  );
  assert.equal(loadConfig(cwd).notifyOnLoad, true, "context-breadcrumbs.json overrides settings");
  assert.equal(loadConfig(cwd).filterSupersededFromPrompt, false, "new config flag is loaded");

  const chainA = await manager.observePath("packages/a/src/file.ts");
  assert.deepEqual(relPaths(chainA), [
    "packages/AGENTS.md",
    "packages/a/AGENTS.md",
    "packages/a/AGENTS.override.md",
    "packages/a/src/AGENTS.md",
    "packages/a/src/CLAUDE.md",
  ]);
  assert.equal(chainA.some((file) => file.relPath === "AGENTS.md"), false, "cwd-level startup breadcrumb is excluded");
  assert.equal(manager.normalizeObservedTarget("packages/a/src/file.ts"), "packages/a/src/file.ts");

  const initialMessage = buildBreadcrumbCustomMessage(["packages/a/src/file.ts"], toInjected(chainA), "new-chain");
  assert.deepEqual(filesInContent(initialMessage.content), relPaths(chainA));
  assert.equal(initialMessage.content.includes("ROOT SHOULD NOT LOAD"), false);
  assert.equal(initialMessage.content.includes("This is extension-provided context, not a read-tool result."), true);

  const repeatedChainA = await manager.observePath("packages/a/src/another.ts");
  assert.deepEqual(relPaths(repeatedChainA), relPaths(chainA));
  const repeatedState = collectBreadcrumbBranchState([
    makeBranchMessage(initialMessage.details, "2026-05-15T00:00:00.000Z"),
  ]);
  assert.deepEqual(shouldAnnounceBreadcrumbChain(toInjected(repeatedChainA), repeatedState), { announce: false });

  const chainB = await manager.observePath("packages/b/src/file.ts");
  assert.deepEqual(relPaths(chainB), ["packages/AGENTS.md", "packages/b/AGENTS.md", "packages/b/src/AGENTS.md"]);
  assert.deepEqual(
    manager.listLoaded().map((entry) => entry.path),
    [
      "packages/AGENTS.md",
      "packages/a/AGENTS.md",
      "packages/a/AGENTS.override.md",
      "packages/b/AGENTS.md",
      "packages/a/src/AGENTS.md",
      "packages/a/src/CLAUDE.md",
      "packages/b/src/AGENTS.md",
    ],
  );
  assert.equal(loadedNotifications.some((entry) => entry.message.includes("packages/a/src/AGENTS.md")), true);

  const clearable = new NestedContextManager(cwd, normalizeConfig({}));
  await clearable.observePath("packages/a/src/file.ts");
  clearable.clear();
  clearable.refreshLoaded();
  assert.deepEqual(clearable.listLoaded(), [], "clear removes loaded files and observed directories");

  const huge = new NestedContextManager(cwd, normalizeConfig({}));
  const hugeChain = await huge.observePath("packages/huge/src/file.ts");
  assert.deepEqual(
    relPaths(hugeChain),
    ["packages/AGENTS.md", "packages/huge/AGENTS.md"],
    "large context files are loaded without size limits",
  );

  const outside = new NestedContextManager(cwd, normalizeConfig({}));
  assert.deepEqual(await outside.observePath("../outside/file.ts"), [], "paths outside cwd are skipped");

  await new Promise((resolve) => setTimeout(resolve, 30));
  writeFileSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"), "A SRC v2 changed");
  const changedChainA = await manager.observePath("packages/a/src/file.ts");
  const changedDecision = shouldAnnounceBreadcrumbChain(toInjected(changedChainA), repeatedState);
  assert.deepEqual(changedDecision, { announce: true, reason: "content-changed" });
  assert.equal(changedChainA.find((file) => file.relPath === "packages/a/src/AGENTS.md")?.content, "A SRC v2 changed");

  const changedMessage = buildBreadcrumbCustomMessage(["packages/a/src/file.ts"], toInjected(changedChainA), "content-changed");
  const compactedState = collectBreadcrumbBranchState([
    makeBranchMessage(changedMessage.details, "2026-05-15T00:01:00.000Z"),
    { type: "compaction", timestamp: "2026-05-15T00:02:00.000Z" },
  ]);
  assert.deepEqual(shouldAnnounceBreadcrumbChain(toInjected(changedChainA), compactedState), {
    announce: true,
    reason: "restated-after-compaction",
  });

  mkdirSync(path.join(cwd, "packages", "new", "src"), { recursive: true });
  const newlyCreated = new NestedContextManager(cwd, normalizeConfig({}));
  assert.deepEqual(
    relPaths(await newlyCreated.observePath("packages/new/src/file.ts")),
    ["packages/AGENTS.md"],
    "missing leaf breadcrumb is not loaded before creation",
  );
  writeFileSync(path.join(cwd, "packages", "new", "src", "AGENTS.md"), "NEW SRC");
  newlyCreated.refreshLoaded();
  assert.deepEqual(
    newlyCreated.listLoaded().map((entry) => entry.path),
    ["packages/AGENTS.md", "packages/new/src/AGENTS.md"],
    "newly-created observed breadcrumb files are discovered on refresh",
  );

  const invalidated = new NestedContextManager(cwd, normalizeConfig({}));
  await invalidated.observePath("packages/a/src/file.ts");
  assert.equal(invalidated.listLoaded().some((entry) => entry.path === "packages/a/src/AGENTS.md"), true);
  unlinkSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"));
  symlinkSync(path.join(cwd, "..", "outside-AGENTS.md"), path.join(cwd, "packages", "a", "src", "AGENTS.md"));
  invalidated.refreshLoaded();
  assert.equal(
    invalidated.listLoaded().some((entry) => entry.path === "packages/a/src/AGENTS.md"),
    false,
    "unsafe replacement invalidates stale loaded context",
  );
  unlinkSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"));
  writeFileSync(path.join(cwd, "packages", "a", "src", "AGENTS.md"), "A SRC v2 changed");

  const customNames = new NestedContextManager(cwd, normalizeConfig({ includeFilenames: ["CLAUDE.md"] }));
  const customChain = await customNames.observePath("packages/a/src/file.ts");
  assert.deepEqual(relPaths(customChain), ["packages/a/src/CLAUDE.md"]);

  const gitCwd = mkdtempSync(path.join(tmpdir(), "nested-context-git-"));
  try {
    run("git", ["init", "-q"], gitCwd);
    writeFileSync(path.join(gitCwd, ".gitignore"), "ignored/\n");
    mkdirSync(path.join(gitCwd, "ignored", "src"), { recursive: true });
    mkdirSync(path.join(gitCwd, "tracked", "src"), { recursive: true });
    writeFileSync(path.join(gitCwd, "ignored", "AGENTS.md"), "IGNORED");
    writeFileSync(path.join(gitCwd, "ignored", "src", "file.ts"), "export {};\n");
    writeFileSync(path.join(gitCwd, "tracked", "AGENTS.md"), "TRACKED");
    writeFileSync(path.join(gitCwd, "tracked", "src", "file.ts"), "export {};\n");

    const gitIgnored = new NestedContextManager(gitCwd, normalizeConfig({}));
    assert.deepEqual(await gitIgnored.observePath("ignored/src/file.ts"), [], "gitignored directories are skipped");
    const trackedChain = await gitIgnored.observePath("tracked/src/file.ts");
    assert.deepEqual(relPaths(trackedChain), ["tracked/AGENTS.md"]);
  } finally {
    rmSync(gitCwd, { recursive: true, force: true });
  }

  const reconstruction = collectBreadcrumbBranchState([
    makeBranchMessage(initialMessage.details, "2026-05-15T00:00:00.000Z"),
    makeBranchMessage(changedMessage.details, "2026-05-15T00:03:00.000Z"),
  ]);
  assert.equal(reconstruction.latestByPath.get("packages/a/src/AGENTS.md")?.order, 1, "newer equal-path records keep later entry order");
  assert.equal(
    reconstruction.latestByPath.get("packages/a/src/AGENTS.md")?.hash,
    changedMessage.details.files.find((file) => file.path === "packages/a/src/AGENTS.md")?.contentHash,
    "resume-style reconstruction keeps the newest hash per breadcrumb file path",
  );

  const olderA = buildBreadcrumbCustomMessage(
    ["packages/a/src/file.ts"],
    [
      requireFile(changedMessage.details.files, "packages/AGENTS.md"),
      requireFile(changedMessage.details.files, "packages/a/AGENTS.md"),
    ],
    "new-chain",
  );
  const newerB = buildBreadcrumbCustomMessage(
    ["packages/b/src/file.ts"],
    [
      requireFile(changedMessage.details.files, "packages/AGENTS.md"),
      {
        path: "packages/b/AGENTS.md",
        appliesTo: "packages/b/**",
        contentHash: requireFile(chainB, "packages/b/AGENTS.md").contentHash,
        content: "B",
      },
    ],
    "new-chain",
  );
  const filteredMessages = filterSupersededBreadcrumbMessages([
    makePromptMessage(olderA.details, 100, olderA.content),
    makePromptMessage(newerB.details, 200, newerB.content),
    { role: "user", content: "leave me alone", timestamp: 300 },
  ]);
  assert.equal(filteredMessages.length, 3, "provider-bound list keeps unrelated messages and rewritten breadcrumb messages");
  assert.deepEqual(filesInContent(filteredMessages[0].content), ["packages/a/AGENTS.md"]);
  assert.deepEqual(filesInContent(filteredMessages[1].content), ["packages/AGENTS.md", "packages/b/AGENTS.md"]);

  const sameTimestampOld = buildBreadcrumbCustomMessage(["packages/a/src/file.ts"], [requireFile(changedMessage.details.files, "packages/AGENTS.md")], "new-chain");
  const sameTimestampNew = buildBreadcrumbCustomMessage(
    ["packages/a/src/file.ts"],
    [{ ...requireFile(changedMessage.details.files, "packages/AGENTS.md"), contentHash: "later-hash", content: "later" }],
    "content-changed",
  );
  const sameTimestampFiltered = filterSupersededBreadcrumbMessages([
    makePromptMessage(sameTimestampOld.details, 500, sameTimestampOld.content),
    makePromptMessage(sameTimestampNew.details, 500, sameTimestampNew.content),
  ]);
  assert.equal(sameTimestampFiltered.length, 1, "same-timestamp supersession prefers the later message in prompt order");
  assert.equal(sameTimestampFiltered[0].details.files[0].contentHash, "later-hash");

  const overlayState = mergeBreadcrumbBranchStates(
    createEmptyBreadcrumbBranchState(),
    repeatedState,
    recordBreadcrumbAnnouncement(toInjected(changedChainA), 2_000_000_000_000, 1),
    recordBreadcrumbCompaction(500, 0),
  );
  assert.deepEqual(shouldAnnounceBreadcrumbChain(toInjected(changedChainA), overlayState), { announce: false }, "in-memory overlay suppresses same-turn duplicate announcements");

  const equalTimestampOverlay = mergeBreadcrumbBranchStates(
    collectBreadcrumbBranchState([makeBranchMessage(initialMessage.details, "2026-05-15T00:00:00.000Z")]),
    recordBreadcrumbAnnouncement(toInjected(changedChainA), Date.parse("2026-05-15T00:00:00.000Z"), 1),
  );
  assert.deepEqual(
    shouldAnnounceBreadcrumbChain(toInjected(changedChainA), equalTimestampOverlay),
    { announce: false },
    "equal-timestamp overlay records still override older branch state",
  );

  assert.deepEqual(extractFilesystemPaths("bash", { command: "cat packages/a/src/file.ts" }), []);
  assert.deepEqual(extractFilesystemPaths("read", { path: "packages/a/src/file.ts" }), ["packages/a/src/file.ts"]);

  console.log("nested-context tests passed");
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
