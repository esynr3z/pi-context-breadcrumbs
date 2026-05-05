import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type LoadMode = "chain" | "nearest";
export type NotifyLevel = "info" | "warning" | "error";

export interface NestedContextConfig {
	enabled: boolean;
	loadMode: LoadMode;
	maxFileBytes: number;
	includeFilenames: string[];
	ignoreDirs: string[];
	notifyOnLoad: boolean;
	maxLoadedFiles: number;
	maxTotalBytes: number;
}

export const DEFAULT_CONFIG: NestedContextConfig = {
	enabled: true,
	loadMode: "chain",
	maxFileBytes: 65_536,
	includeFilenames: ["AGENTS.md"],
	ignoreDirs: [".git", "node_modules", "dist", "build", "target", ".venv", "venv", "__pycache__"],
	notifyOnLoad: true,
	maxLoadedFiles: 64,
	maxTotalBytes: 1_048_576,
};

export const CONFIG_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		enabled: { type: "boolean", default: DEFAULT_CONFIG.enabled },
		loadMode: { enum: ["chain", "nearest"], default: DEFAULT_CONFIG.loadMode },
		maxFileBytes: { type: "number", minimum: 1, default: DEFAULT_CONFIG.maxFileBytes },
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
		maxLoadedFiles: { type: "number", minimum: 1, default: DEFAULT_CONFIG.maxLoadedFiles },
		maxTotalBytes: { type: "number", minimum: 1, default: DEFAULT_CONFIG.maxTotalBytes },
	},
} as const;

interface LoadedContextFile {
	absPath: string;
	relPath: string;
	dirAbs: string;
	dirRel: string;
	appliesTo: string;
	content: string;
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
	const loadMode = input.loadMode === "nearest" || input.loadMode === "chain" ? input.loadMode : DEFAULT_CONFIG.loadMode;
	const maxFileBytes = positiveInteger(input.maxFileBytes, DEFAULT_CONFIG.maxFileBytes);
	const maxLoadedFiles = positiveInteger(input.maxLoadedFiles, DEFAULT_CONFIG.maxLoadedFiles);
	const maxTotalBytes = positiveInteger(input.maxTotalBytes, DEFAULT_CONFIG.maxTotalBytes);

	return {
		enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_CONFIG.enabled,
		loadMode,
		maxFileBytes,
		includeFilenames: uniqueStrings(input.includeFilenames, DEFAULT_CONFIG.includeFilenames),
		ignoreDirs: uniqueStrings(input.ignoreDirs, DEFAULT_CONFIG.ignoreDirs),
		notifyOnLoad: typeof input.notifyOnLoad === "boolean" ? input.notifyOnLoad : DEFAULT_CONFIG.notifyOnLoad,
		maxLoadedFiles,
		maxTotalBytes,
	};
}

function positiveInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function loadJsonIfPresent(filePath: string): unknown | undefined {
	if (!existsSync(filePath)) return undefined;
	return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadConfig(cwd: string, notify?: NotifyFn): NestedContextConfig {
	let merged: Record<string, unknown> = {};
	const settingsPath = path.join(cwd, ".pi", "settings.json");
	const extensionConfigPath = path.join(cwd, ".pi", "nested-context.json");

	try {
		const settings = loadJsonIfPresent(settingsPath);
		if (isPlainObject(settings) && isPlainObject(settings.nestedContext)) {
			merged = { ...merged, ...settings.nestedContext };
		}
	} catch (error) {
		notify?.(`Nested context: could not read .pi/settings.json (${String(error)})`, "warning");
	}

	try {
		const extensionConfig = loadJsonIfPresent(extensionConfigPath);
		if (isPlainObject(extensionConfig)) {
			merged = { ...merged, ...extensionConfig };
		}
	} catch (error) {
		notify?.(`Nested context: could not read .pi/nested-context.json (${String(error)})`, "warning");
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

	// Current Pi built-ins with typed path fields. The generic collector below also
	// handles future built-ins named list/search or custom typed tools with clear
	// path-like field names.
	const fsToolNames = new Set(["read", "write", "edit", "ls", "list", "grep", "search", "find"]);
	if (!isBuiltinTool && !fsToolNames.has(toolName)) return [];

	const out: string[] = [];
	collectPathValues(input, undefined, out);

	if ((toolName === "ls" || toolName === "list" || toolName === "grep" || toolName === "search" || toolName === "find") && out.length === 0) {
		// These tools default to cwd when path is omitted. Observing cwd does not load
		// nested context because cwd-level startup context is intentionally excluded.
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

export class NestedContextManager {
	readonly cwdAbs: string;
	readonly cwdReal: string;
	config: NestedContextConfig;
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

	listLoaded(): NestedContextListEntry[] {
		return this.orderedLoaded().map((entry) => ({
			path: entry.relPath.replace(/\\/g, "/"),
			appliesTo: entry.appliesTo,
			size: entry.size,
			lastLoadTime: new Date(entry.lastLoadTime).toISOString(),
		}));
	}

	async observeToolCall(toolName: string, input: unknown, isBuiltinTool = true): Promise<void> {
		if (!this.config.enabled) return;
		const paths = extractFilesystemPaths(toolName, input, isBuiltinTool);
		for (const rawPath of paths) {
			await this.observePath(rawPath);
		}
	}

	async observePath(rawPath: string): Promise<void> {
		if (!this.config.enabled) return;
		const dir = this.resolveTargetDirectory(rawPath);
		if (!dir) return;
		this.observedDirs.add(dir);
		this.discoverForDirectory(dir);
	}

	refreshLoaded(): void {
		for (const [absPath, entry] of [...this.loaded.entries()]) {
			this.loadCandidate(absPath, entry.includeIndex, { notifyFirstLoad: false });
		}
		for (const dir of this.observedDirs) {
			this.discoverForDirectory(dir, { notifyFirstLoad: true });
		}
	}

	buildContextMessage(): string | undefined {
		const entries = this.orderedLoaded();
		if (entries.length === 0) return undefined;

		const parts = [
			"[Nested context files loaded by extension]",
			"",
			"The following instructions apply only to work under their listed directories.",
			"Existing Pi startup context remains active.",
			"More specific nested context files override broader/root instructions for matching paths.",
		];

		for (const entry of entries) {
			parts.push("", `File: ${entry.relPath.replace(/\\/g, "/")}`, `Applies to: ${entry.appliesTo}`, "Content:", entry.content);
		}

		return parts.join("\n");
	}

	private orderedLoaded(): LoadedContextFile[] {
		return [...this.loaded.values()].sort((a, b) => fileSortKey(a).localeCompare(fileSortKey(b)));
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

		const relDir = path.relative(this.cwdAbs, dir);
		if (hasIgnoredSegment(relDir, this.ignoreDirSet)) return undefined;

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
		const dirs = this.dirsBroadToSpecific(targetDir).filter((dir) => {
			const rel = path.relative(this.cwdAbs, dir);
			return !hasIgnoredSegment(rel, this.ignoreDirSet);
		});

		if (this.config.loadMode === "nearest") {
			for (const dir of [...dirs].reverse()) {
				let loadedAny = false;
				for (let index = 0; index < this.config.includeFilenames.length; index++) {
					const candidate = path.normalize(path.join(dir, this.config.includeFilenames[index]!));
					loadedAny = this.loadCandidate(candidate, index, { notifyFirstLoad: options.notifyFirstLoad }) || loadedAny;
				}
				if (loadedAny) return;
			}
			return;
		}

		for (const dir of dirs) {
			for (let index = 0; index < this.config.includeFilenames.length; index++) {
				this.loadCandidate(path.normalize(path.join(dir, this.config.includeFilenames[index]!)), index, {
					notifyFirstLoad: options.notifyFirstLoad,
				});
			}
		}
	}

	private enforceAggregateLimits(): void {
		let keptFiles = 0;
		let keptBytes = 0;
		for (const entry of this.orderedLoaded()) {
			const withinFileLimit = keptFiles < this.config.maxLoadedFiles;
			const withinByteLimit = keptBytes + entry.size <= this.config.maxTotalBytes;
			if (withinFileLimit && withinByteLimit) {
				keptFiles++;
				keptBytes += entry.size;
				continue;
			}

			this.loaded.delete(entry.absPath);
			const warningKey = `${entry.absPath}:aggregate-limit:${this.config.maxLoadedFiles}:${this.config.maxTotalBytes}`;
			if (!this.warned.has(warningKey)) {
				this.warned.add(warningKey);
				this.notify?.(
					`Skipped nested context file due to aggregate limits: ${entry.relPath} (maxLoadedFiles=${this.config.maxLoadedFiles}, maxTotalBytes=${this.config.maxTotalBytes})`,
					"warning",
				);
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

			if (st.size > this.config.maxFileBytes) {
				invalidate();
				const warningKey = `${normalizedAbs}:oversize:${st.mtimeMs}:${st.size}`;
				if (!this.warned.has(warningKey)) {
					this.warned.add(warningKey);
					this.notify?.(
						`Skipped nested context file over ${this.config.maxFileBytes} bytes: ${path.relative(this.cwdAbs, normalizedAbs).replace(/\\/g, "/")}`,
						"warning",
					);
				}
				return false;
			}

			const existing = this.loaded.get(normalizedAbs);
			if (existing && existing.mtimeMs === st.mtimeMs && existing.size === st.size) {
				this.enforceAggregateLimits();
				return this.loaded.has(normalizedAbs);
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
				size: st.size,
				mtimeMs: st.mtimeMs,
				lastLoadTime: Date.now(),
				includeIndex,
			});
			this.enforceAggregateLimits();

			const retained = this.loaded.has(normalizedAbs);
			if (retained && !existing && options.notifyFirstLoad && this.config.notifyOnLoad) {
				this.notify?.(`Loaded nested context file: ${relPath}`, "info");
			}
			return retained;
		} catch (error) {
			invalidate();
			const warningKey = `${absPath}:error:${String(error)}`;
			if (!this.warned.has(warningKey)) {
				this.warned.add(warningKey);
				this.notify?.(`Nested context discovery skipped ${path.basename(absPath)} (${String(error)})`, "warning");
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
	if (entries.length === 0) return ["Nested context: no files loaded."];
	return [
		`Nested context: ${entries.length} file(s) loaded`,
		...entries.map((entry) => `- ${entry.path} (applies: ${entry.appliesTo}, ${entry.size} bytes, loaded: ${entry.lastLoadTime})`),
	];
}

export default function nestedContextExtension(pi: ExtensionAPI) {
	let manager: NestedContextManager | undefined;
	let builtinToolNames = new Set<string>();

	const safeNotify = (ctx: { hasUI?: boolean; ui?: { notify?: (message: string, level: NotifyLevel) => void; setStatus?: (key: string, value: string | undefined) => void } }, message: string, level: NotifyLevel) => {
		try {
			ctx.ui?.notify?.(message, level);
		} catch {
			// Notification failure must never affect tool execution.
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd, (message, level) => safeNotify(ctx, message, level));
		manager = new NestedContextManager(ctx.cwd, config, (message, level) => {
			safeNotify(ctx, message, level);
			try {
				ctx.ui.setStatus("nested-context", manager && manager.loadedCount() > 0 ? `nested ctx: ${manager.loadedCount()}` : undefined);
			} catch {
				// Status updates are best-effort.
			}
		});
		builtinToolNames = getBuiltinToolNames(pi);
		try {
			ctx.ui.setStatus("nested-context", undefined);
			ctx.ui.setWidget("nested-context-list", undefined);
		} catch {
			// UI cleanup is best-effort.
		}
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
			await manager.observeToolCall(event.toolName, event.input, isBuiltin);
		} catch (error) {
			safeNotify(ctx, `Nested context discovery failed; continuing tool call (${String(error)})`, "warning");
		}
	});

	pi.on("context", async (event) => {
		try {
			if (!manager?.config.enabled) return;
			manager.refreshLoaded();
			const content = manager.buildContextMessage();
			if (!content) return;

			const messages = event.messages.filter(
				(message) => !(message.role === "custom" && message.customType === "nested-context"),
			);
			messages.push({
				role: "custom",
				customType: "nested-context",
				content,
				display: false,
				timestamp: 0,
			});
			return { messages };
		} catch {
			return;
		}
	});

	pi.registerCommand("nested-context", {
		description: "List currently loaded nested context files",
		handler: async (_args, ctx) => {
			const lines = formatList(manager?.listLoaded() ?? []);
			try {
				ctx.ui.setWidget("nested-context-list", undefined);
			} catch {
				// UI cleanup is best-effort.
			}
			safeNotify(ctx, lines.join("\n"), "info");
		},
	});

	pi.registerCommand("nested-context-clear", {
		description: "Clear nested context files discovered by the extension",
		handler: async (_args, ctx) => {
			manager?.clear();
			try {
				ctx.ui.setWidget("nested-context-list", undefined);
				ctx.ui.setStatus("nested-context", undefined);
			} catch {
				// UI cleanup is best-effort.
			}
			safeNotify(ctx, "Cleared nested context files.", "info");
		},
	});
}
