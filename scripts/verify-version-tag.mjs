#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function currentTag() {
	if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
	const result = spawnSync("git", ["describe", "--tags", "--exact-match"], {
		cwd: root,
		encoding: "utf8",
		shell: process.platform === "win32",
	});
	return result.status === 0 ? result.stdout.trim() : "";
}

const tag = currentTag();
if (!tag) {
	console.error("No release tag found. Run this check from a tag such as v1.2.3.");
	process.exit(1);
}

const expected = `v${packageJson.version}`;
if (tag !== expected) {
	console.error(`Release tag ${tag} does not match package version ${packageJson.version}. Expected ${expected}.`);
	process.exit(1);
}

console.log(`Release tag ${tag} matches package version ${packageJson.version}.`);
