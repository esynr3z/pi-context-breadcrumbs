import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	buildBreadcrumbCustomMessage,
	collectBreadcrumbBranchState,
	filterSupersededBreadcrumbMessages,
	shouldAnnounceBreadcrumbChain,
} from "./breadcrumb-messages.ts";

export type NotifyLevel = "info" | "warning" | "error";

export interface NestedContextConfig {
	enabled: boolean;
	includeFilenames: string[];
	ignoreDirs: string[];
	notifyOnLoad: boolean;
	filterSupersededFromPrompt: boolean;
}

export const DEFAULT_CONFIG: NestedContextConfig = {
	enabled: true,
	includeFilenames: ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"],
	ignoreDirs: [".git", "node_modules", "dist", "build", "target", ".venv", "venv", "__pycache__"],
	notifyOnLoad: true,
	filterSupersededFromPrompt: true,
};

export const CONFIG_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		enabled: { type: "boolean", default: DEFAULT_CONFIG.enabled },
		includeFilenames: {
			type: "array",
			items: { type: "string", minLength: 1 },
			default: DEFAULT_CONFIG.includeFilenames,
		},
		ignoreDirs: {
			type: "array",
			items: { type: "string", minLength: 1 },
			default: DEFAULT_CONFIG.ignoreDirs,
		},
		notifyOnLoad: { type: "boolean", default: DEFAULT_CONFIG.notifyOnLoad },
		filterSupersededFromPrompt: {
			type: "boolean",
			default: DEFAULT_CONFIG.filterSupersededFromPrompt,
		},
	},
} as const;

export interface LoadedContextFile {
	absPath: string;
	relPath: string;
	dirAbs: string;
	dirRel: string;
	appliesTo: string;
	content: string;
	contentHash: string;
	size: number;
	mtimeMs: number;
	lastLoadTime: number;
	includeIndex: number;
}

export interface NestedContextListEntry {
	path: string;
	appliesTo: string;
	size: number;
	lastLoadTime: string;
}

type NotifyFn = (message: string, level: NotifyLevel) => void;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: unknown, fallback: string[]): string[] {
	if (!Array.isArray(values)) return [...fallback];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out.length > 0 ? out : [...fallback];
}

export function normalizeConfig(raw: unknown): NestedContextConfig {
	const input = isPlainObject(raw) ? raw : {};
	return {
		enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_CONFIG.enabled,
		includeFilenames: uniqueStrings(input.includeFilenames, DEFAULT_CONFIG.includeFilenames),
		ignoreDirs: uniqueStrings(input.ignoreDirs, DEFAULT_CONFIG.ignoreDirs),
		notifyOnLoad: typeof input.notifyOnLoad === "boolean" ? input.notifyOnLoad : DEFAULT_CONFIG.notifyOnLoad,
		filterSupersededFromPrompt:
			typeof input.filterSupersededFromPrompt === "boolean"
				? input.filterSupersededFromPrompt
				: DEFAULT_CONFIG.filterSupersededFromPrompt,
	};
}

function loadJsonIfPresent(filePath: string): unknown | undefined {
	if (!existsSync(filePath)) return undefined;
	return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadConfig(cwd: string, notify?: NotifyFn): NestedContextConfig {
	let merged: Record<string, unknown> = {};
	const settingsPath = path.join(cwd, ".pi", "settings.json");
	const extensionConfigPath = path.join(cwd, ".pi", "context-breadcrumbs.json");

	try {
		const settings = loadJsonIfPresent(settingsPath);
		if (isPlainObject(settings) && isPlainObject(settings["context-breadcrumbs"])) {
			merged = { ...merged, ...settings["context-breadcrumbs"] };
		}
	} catch (error) {
		notify?.(`Context breadcrumbs: could not read .pi/settings.json (${String(error)})`, "warning");
	}

	try {
		const extensionConfig = loadJsonIfPresent(extensionConfigPath);
		if (isPlainObject(extensionConfig)) {
			merged = { ...merged, ...extensionConfig };
		}
	} catch (error) {
		notify?.(`Context breadcrumbs: could not read .pi/context-breadcrumbs.json (${String(error)})`, "warning");
	}

	return normalizeConfig(merged);
}

function stripAtPrefix(value: string): string {
	const trimmed = value.trim();
	return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

function isPathKey(key: string): boolean {
	const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
	return [
		"path",
		"paths",
		"filepath",
		"filepaths",
		"file",
		"files",
		"dir",
		"dirs",
		"directory",
		"directories",
		"cwd",
		"root",
	].includes(normalized);
}

function collectPathValues(value: unknown, parentKey: string | undefined, out: string[]): void {
	if (typeof value === "string") {
		if (parentKey && isPathKey(parentKey)) out.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectPathValues(item, parentKey, out);
		return;
	}
	if (!isPlainObject(value)) return;
	for (const [key, child] of Object.entries(value)) {
		collectPathValues(child, key, out);
	}
}

export function extractFilesystemPaths(toolName: string, input: unknown, isBuiltinTool = true): string[] {
	if (toolName === "bash" || toolName === "shell") return [];

	const fsToolNames = new Set(["read", "write", "edit", "ls", "list", "grep", "search", "find"]);
	if (!isBuiltinTool && !fsToolNames.has(toolName)) return [];

	const out: string[] = [];
	collectPathValues(input, undefined, out);

	if ((toolName === "ls" || toolName === "list" || toolName === "grep" || toolName === "search" || toolName === "find") && out.length === 0) {
		out.push(".");
	}

	const seen = new Set<string>();
	return out.filter((candidate) => {
		const trimmed = candidate.trim();
		if (!trimmed || seen.has(trimmed)) return false;
		seen.add(trimmed);
		return true;
	});
}

function isUnderPath(target: string, root: string): boolean {
	const relative = path.relative(root, target);
	return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function hasIgnoredSegment(relativePath: string, ignoreDirs: Set<string>): boolean {
	if (!relativePath || relativePath === ".") return false;
	return relativePath.split(path.sep).some((segment) => ignoreDirs.has(segment));
}

function findGitRoot(cwd: string): string | undefined {
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		shell: process.platform === "win32",
	});
	if (result.status !== 0) return undefined;
	const stdout = result.stdout.trim();
	return stdout ? path.normalize(path.resolve(cwd, stdout)) : undefined;
}

function isGitIgnored(gitRoot: string, absPath: string): boolean {
	if (!isUnderPath(absPath, gitRoot)) return false;
	const relPath = path.relative(gitRoot, absPath).replace(/\\/g, "/");
	if (!relPath || relPath === ".") return false;
	const result = spawnSync("git", ["check-ignore", "--quiet", "--", relPath], {
		cwd: gitRoot,
		stdio: "ignore",
		shell: process.platform === "win32",
	});
	return result.status === 0;
}

function safeRealpathSync(filePath: string): string | undefined {
	try {
		return realpathSync.native(filePath);
	} catch {
		try {
			return realpathSync(filePath);
		} catch {
			return undefined;
		}
	}
}

function nearestExistingAncestor(filePath: string, stopAt: string): string | undefined {
	let current = path.normalize(filePath);
	while (isUnderPath(current, stopAt)) {
		if (existsSync(current)) return current;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return existsSync(stopAt) ? stopAt : undefined;
}

function formatAppliesTo(dirRel: string): string {
	return dirRel ? `${dirRel.replace(/\\/g, "/")}/**` : "**";
}

function fileSortKey(entry: LoadedContextFile): string {
	const depth = entry.dirRel ? entry.dirRel.split(/[\\/]/).length : 0;
	return `${String(depth).padStart(6, "0")}\u0000${entry.dirRel}\u0000${String(entry.includeIndex).padStart(6, "0")}\u0000${entry.relPath}`;
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export class NestedContextManager {
	readonly cwdAbs: string;
	readonly cwdReal: string;
	config: NestedContextConfig;
	private readonly gitRootAbs: string | undefined;
	private readonly notify?: NotifyFn;
	private readonly ignoreDirSet: Set<string>;
	private readonly loaded = new Map<string, LoadedContextFile>();
	private readonly observedDirs = new Set<string>();
	private readonly startupContextPaths = new Set<string>();
	private readonly warned = new Set<string>();

	constructor(cwd: string, config: NestedContextConfig = DEFAULT_CONFIG, notify?: NotifyFn) {
		this.cwdAbs = path.resolve(cwd);
		this.cwdReal = safeRealpathSync(this.cwdAbs) ?? this.cwdAbs;
		this.config = normalizeConfig(config);
		this.gitRootAbs = findGitRoot(this.cwdAbs);
		this.notify = notify;
		this.ignoreDirSet = new Set(this.config.ignoreDirs);
	}

	setStartupContextFiles(files: Array<{ path: string; content?: string }> | undefined): void {
		this.startupContextPaths.clear();
		for (const file of files ?? []) {
			if (!file?.path) continue;
			const absPath = path.resolve(file.path);
			this.startupContextPaths.add(path.normalize(absPath));
			const realPath = safeRealpathSync(absPath);
			if (realPath) this.startupContextPaths.add(path.normalize(realPath));
		}
		for (const filename of this.config.includeFilenames) {
			this.startupContextPaths.add(path.normalize(path.join(this.cwdAbs, filename)));
		}
	}

	clear(): void {
		this.loaded.clear();
		this.observedDirs.clear();
		this.warned.clear();
	}

	loadedCount(): number {
		return this.loaded.size;
	}

	private isIgnoredPath(absPath: string): boolean {
		const relFromCwd = path.relative(this.cwdAbs, absPath);
		return hasIgnoredSegment(relFromCwd, this.ignoreDirSet) || (this.gitRootAbs ? isGitIgnored(this.gitRootAbs, absPath) : false);
	}

	listLoaded(): NestedContextListEntry[] {
		return this.orderedLoaded().map((entry) => ({
			path: entry.relPath.replace(/\\/g, "/"),
			appliesTo: entry.appliesTo,
			size: entry.size,
			lastLoadTime: new Date(entry.lastLoadTime).toISOString(),
		}));
	}

	orderedLoaded(): LoadedContextFile[] {
		return [...this.loaded.values()].sort((a, b) => fileSortKey(a).localeCompare(fileSortKey(b)));
	}

	async observeToolCall(toolName: string, input: unknown, isBuiltinTool = true): Promise<LoadedContextFile[]> {
		if (!this.config.enabled) return [];
		const paths = extractFilesystemPaths(toolName, input, isBuiltinTool);
		const byPath = new Map<string, LoadedContextFile>();
		for (const rawPath of paths) {
			for (const file of await this.observePath(rawPath)) {
				byPath.set(file.absPath, file);
			}
		}
		return [...byPath.values()].sort((a, b) => fileSortKey(a).localeCompare(fileSortKey(b)));
	}

	async observePath(rawPath: string): Promise<LoadedContextFile[]> {
		if (!this.config.enabled) return [];
		const dir = this.resolveTargetDirectory(rawPath);
		if (!dir) return [];
		this.observedDirs.add(dir);
		this.discoverForDirectory(dir);
		return this.filesForDirectory(dir);
	}

	normalizeObservedTarget(rawPath: string): string | undefined {
		const dir = this.resolveTargetDirectory(rawPath);
		if (!dir) return undefined;
		const cleaned = stripAtPrefix(rawPath);
		if (!cleaned) return undefined;
		const resolved = path.normalize(path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(this.cwdAbs, cleaned));
		if (!isUnderPath(resolved, this.cwdAbs)) return undefined;
		const relPath = path.relative(this.cwdAbs, resolved).replace(/\\/g, "/");
		return relPath || ".";
	}

	refreshLoaded(): void {
		for (const [absPath, entry] of [...this.loaded.entries()]) {
			this.loadCandidate(absPath, entry.includeIndex, { notifyFirstLoad: false });
		}
		for (const dir of this.observedDirs) {
			this.discoverForDirectory(dir, { notifyFirstLoad: true });
		}
	}

	private filesForDirectory(targetDir: string): LoadedContextFile[] {
		const files: LoadedContextFile[] = [];
		for (const dir of this.dirsBroadToSpecific(targetDir).filter((candidate) => !this.isIgnoredPath(candidate))) {
			for (let index = 0; index < this.config.includeFilenames.length; index++) {
				const candidate = path.normalize(path.join(dir, this.config.includeFilenames[index]!));
				const loaded = this.loaded.get(candidate);
				if (loaded) files.push(loaded);
			}
		}
		return files;
	}

	private resolveTargetDirectory(rawPath: string): string | undefined {
		const cleaned = stripAtPrefix(rawPath);
		if (!cleaned) return undefined;

		const resolved = path.normalize(path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(this.cwdAbs, cleaned));
		if (!isUnderPath(resolved, this.cwdAbs)) return undefined;

		let targetExists: boolean;
		let targetIsDirectory = false;
		try {
			const lst = lstatSync(resolved);
			targetExists = true;
			const realTarget = safeRealpathSync(resolved);
			if (!realTarget || !isUnderPath(path.normalize(realTarget), this.cwdReal)) return undefined;
			if (lst.isDirectory()) {
				targetIsDirectory = true;
			} else if (lst.isSymbolicLink()) {
				try {
					targetIsDirectory = statSync(resolved).isDirectory();
				} catch {
					targetIsDirectory = false;
				}
			}
		} catch {
			targetExists = false;
		}

		const dir = targetExists && targetIsDirectory ? resolved : path.dirname(resolved);
		if (!isUnderPath(dir, this.cwdAbs)) return undefined;
		if (this.isIgnoredPath(dir)) return undefined;

		const existingAncestor = nearestExistingAncestor(dir, this.cwdAbs);
		if (!existingAncestor) return undefined;
		const realAncestor = safeRealpathSync(existingAncestor);
		if (!realAncestor || !isUnderPath(path.normalize(realAncestor), this.cwdReal)) return undefined;

		return path.normalize(dir);
	}

	private dirsBroadToSpecific(targetDir: string): string[] {
		const dirs: string[] = [];
		let current = path.normalize(targetDir);
		while (isUnderPath(current, this.cwdAbs)) {
			if (current !== this.cwdAbs) dirs.push(current);
			if (current === this.cwdAbs) break;
			const parent = path.dirname(current);
			if (parent === current) break;
			current = parent;
		}
		return dirs.reverse();
	}

	private discoverForDirectory(targetDir: string, options: { notifyFirstLoad: boolean } = { notifyFirstLoad: true }): void {
		const dirs = this.dirsBroadToSpecific(targetDir).filter((dir) => !this.isIgnoredPath(dir));

		for (const dir of dirs) {
			for (let index = 0; index < this.config.includeFilenames.length; index++) {
				this.loadCandidate(path.normalize(path.join(dir, this.config.includeFilenames[index]!)), index, {
					notifyFirstLoad: options.notifyFirstLoad,
				});
			}
		}
	}

	private loadCandidate(absPath: string, includeIndex: number, options: { notifyFirstLoad: boolean }): boolean {
		const normalizedAbs = path.normalize(absPath);
		const invalidate = (): false => {
			this.loaded.delete(normalizedAbs);
			return false;
		};

		try {
			if (!isUnderPath(normalizedAbs, this.cwdAbs)) return invalidate();
			if (this.isIgnoredPath(normalizedAbs)) return invalidate();
			if (this.startupContextPaths.has(normalizedAbs)) return invalidate();

			let lst;
			try {
				lst = lstatSync(normalizedAbs);
			} catch {
				return invalidate();
			}

			const realPath = safeRealpathSync(normalizedAbs);
			if (!realPath || !isUnderPath(path.normalize(realPath), this.cwdReal)) return invalidate();
			if (this.startupContextPaths.has(path.normalize(realPath))) return invalidate();
			const st = lst.isSymbolicLink() ? statSync(normalizedAbs) : statSync(normalizedAbs);
			if (!st.isFile()) return invalidate();

			const existing = this.loaded.get(normalizedAbs);
			if (existing && existing.mtimeMs === st.mtimeMs && existing.size === st.size) {
				return true;
			}

			const content = readFileSync(normalizedAbs, "utf8");
			const dirAbs = path.dirname(normalizedAbs);
			const dirRel = path.relative(this.cwdAbs, dirAbs).replace(/\\/g, "/");
			const relPath = path.relative(this.cwdAbs, normalizedAbs).replace(/\\/g, "/");
			this.loaded.set(normalizedAbs, {
				absPath: normalizedAbs,
				relPath,
				dirAbs,
				dirRel,
				appliesTo: formatAppliesTo(dirRel),
				content,
				contentHash: hashContent(content),
				size: st.size,
				mtimeMs: st.mtimeMs,
				lastLoadTime: Date.now(),
				includeIndex,
			});
			if (!existing && options.notifyFirstLoad && this.config.notifyOnLoad) {
				this.notify?.(`Loaded nested context file: ${relPath}`, "info");
			}
			return true;
		} catch (error) {
			invalidate();
			const warningKey = `${absPath}:error:${String(error)}`;
			if (!this.warned.has(warningKey)) {
				this.warned.add(warningKey);
				this.notify?.(`Context breadcrumbs discovery skipped ${path.basename(absPath)} (${String(error)})`, "warning");
			}
			return false;
		}
	}
}

function getBuiltinToolNames(pi: ExtensionAPI): Set<string> {
	try {
		return new Set(
			pi
				.getAllTools()
				.filter((tool) => tool.sourceInfo?.source === "builtin")
				.map((tool) => tool.name),
		);
	} catch {
		return new Set(["read", "write", "edit", "ls", "list", "grep", "search", "find", "bash"]);
	}
}

function formatList(entries: NestedContextListEntry[]): string[] {
	if (entries.length === 0) return ["Context breadcrumbs: no files loaded."];
	return [
		`Context breadcrumbs: ${entries.length} file(s) loaded`,
		...entries.map((entry) => `- ${entry.path} (applies: ${entry.appliesTo}, ${entry.size} bytes, loaded: ${entry.lastLoadTime})`),
	];
}

export default function contextBreadcrumbsExtension(pi: ExtensionAPI) {
	let manager: NestedContextManager | undefined;
	let builtinToolNames = new Set<string>();

	const safeNotify = (ctx: { hasUI?: boolean; ui?: { notify?: (message: string, level: NotifyLevel) => void } }, message: string, level: NotifyLevel) => {
		try {
			ctx.ui?.notify?.(message, level);
		} catch {
			// Notification failure must never affect tool execution.
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd, (message, level) => safeNotify(ctx, message, level));
		manager = new NestedContextManager(ctx.cwd, config, (message, level) => safeNotify(ctx, message, level));
		builtinToolNames = getBuiltinToolNames(pi);
	});

	pi.on("session_shutdown", async () => {
		manager?.clear();
		manager = undefined;
		builtinToolNames = new Set();
	});

	pi.on("before_agent_start", async (event) => {
		manager?.setStartupContextFiles(event.systemPromptOptions.contextFiles);
	});

	pi.on("tool_call", async (event, ctx) => {
		try {
			if (!manager?.config.enabled) return;
			const isBuiltin = builtinToolNames.has(event.toolName);
			const rawPaths = extractFilesystemPaths(event.toolName, event.input, isBuiltin);
			const files = await manager.observeToolCall(event.toolName, event.input, isBuiltin);
			if (files.length === 0) return;

			const observedTargets = rawPaths
				.map((rawPath) => manager?.normalizeObservedTarget(rawPath))
				.filter((target): target is string => typeof target === "string");
			if (observedTargets.length === 0) return;

			const branchState = collectBreadcrumbBranchState(ctx.sessionManager.getBranch());
			const injectedFiles = files.map((file) => ({
				path: file.relPath.replace(/\\/g, "/"),
				appliesTo: file.appliesTo,
				contentHash: file.contentHash,
				content: file.content,
			}));
			const decision = shouldAnnounceBreadcrumbChain(injectedFiles, branchState);
			if (!decision.announce || !decision.reason) return;

			const message = buildBreadcrumbCustomMessage(observedTargets, injectedFiles, decision.reason);
			pi.sendMessage(
				{
					customType: "context-breadcrumbs",
					content: message.content,
					details: message.details,
					display: true,
				},
				{ deliverAs: "steer" },
			);
		} catch (error) {
			safeNotify(ctx, `Context breadcrumbs discovery failed; continuing tool call (${String(error)})`, "warning");
		}
	});

	pi.on("context", async (event) => {
		try {
			if (!manager?.config.enabled || !manager.config.filterSupersededFromPrompt) return;
			return { messages: filterSupersededBreadcrumbMessages(event.messages) };
		} catch {
			return;
		}
	});

	pi.registerCommand("context-breadcrumbs", {
		description: "List currently loaded context breadcrumb files",
		handler: async (_args, ctx) => {
			manager?.refreshLoaded();
			const lines = formatList(manager?.listLoaded() ?? []);
			safeNotify(ctx, lines.join("\n"), "info");
		},
	});
}
