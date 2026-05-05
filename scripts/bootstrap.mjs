#!/usr/bin/env node
import { chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const hookPath = path.join(root, ".githooks", "pre-commit");

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		stdio: "inherit",
		shell: process.platform === "win32",
		...options,
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

if (process.env.SKIP_NPM_INSTALL !== "1") {
	run("npm", ["install"]);
} else {
	console.log("Skipping npm install because SKIP_NPM_INSTALL=1.");
}

try {
	chmodSync(hookPath, 0o755);
} catch (error) {
	console.warn(`Could not chmod ${path.relative(root, hookPath)}: ${String(error)}`);
}

const gitCheck = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
	cwd: root,
	stdio: "ignore",
	shell: process.platform === "win32",
});

if (gitCheck.status === 0) {
	run("git", ["config", "core.hooksPath", ".githooks"]);
	console.log("Configured git hooks path: .githooks");
} else {
	console.log("Not inside a git work tree; skipping git hooks configuration.");
}

console.log("Bootstrap complete. Run `npm run ci` before opening a PR.");
