import type { AgentMessage } from "@mariozechner/pi-agent-core";

export type BreadcrumbAnnouncementReason = "new-chain" | "content-changed" | "restated-after-compaction";

export interface BreadcrumbInjectedFile {
	path: string;
	appliesTo: string;
	contentHash: string;
	content: string;
}

export interface BreadcrumbMessageDetails {
	version: 1;
	observedTargets: string[];
	reason: BreadcrumbAnnouncementReason;
	files: BreadcrumbInjectedFile[];
}

export interface BreadcrumbBranchState {
	latestByPath: Map<string, { hash: string; timestamp: number }>;
	latestCompactionTimestamp: number;
}

type BreadcrumbCustomMessage = AgentMessage & {
	role: "custom";
	customType: "context-breadcrumbs";
	content: string;
	details: BreadcrumbMessageDetails;
	timestamp: number;
	display: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") return undefined;
		out.push(item);
	}
	return out;
}

function parseInjectedFile(value: unknown): BreadcrumbInjectedFile | undefined {
	if (!isPlainObject(value)) return undefined;
	if (typeof value.path !== "string") return undefined;
	if (typeof value.appliesTo !== "string") return undefined;
	if (typeof value.contentHash !== "string") return undefined;
	if (typeof value.content !== "string") return undefined;
	return {
		path: value.path,
		appliesTo: value.appliesTo,
		contentHash: value.contentHash,
		content: value.content,
	};
}

export function parseBreadcrumbMessageDetails(value: unknown): BreadcrumbMessageDetails | undefined {
	if (!isPlainObject(value)) return undefined;
	if (value.version !== 1) return undefined;
	const observedTargets = normalizeStringArray(value.observedTargets);
	if (!observedTargets) return undefined;
	if (
		value.reason !== "new-chain" &&
		value.reason !== "content-changed" &&
		value.reason !== "restated-after-compaction"
	) {
		return undefined;
	}
	if (!Array.isArray(value.files)) return undefined;
	const files: BreadcrumbInjectedFile[] = [];
	for (const item of value.files) {
		const parsed = parseInjectedFile(item);
		if (!parsed) return undefined;
		files.push(parsed);
	}
	return {
		version: 1,
		observedTargets,
		reason: value.reason,
		files,
	};
}

function reasonLine(reason: BreadcrumbAnnouncementReason): string {
	switch (reason) {
		case "content-changed":
			return "Reason: breadcrumb content changed; this supersedes earlier breadcrumb content for these files.";
		case "restated-after-compaction":
			return "Reason: restated after compaction because earlier exact breadcrumb text may have been summarized.";
		default:
			return "Reason: first relevant breadcrumb chain for these paths.";
	}
}

function buildBreadcrumbContent(observedTargets: string[], files: BreadcrumbInjectedFile[], reason: BreadcrumbAnnouncementReason): string {
	const lines = [
		"[context-breadcrumbs]",
		"",
		"pi-context-breadcrumbs loaded local breadcrumb files while working with:",
		...(observedTargets.length > 0 ? observedTargets.map((target) => `- ${target}`) : ["- (unknown path)"]),
		"",
		"This is extension-provided context, not a read-tool result.",
		"Newer breadcrumb injections for the same breadcrumb file path supersede older ones.",
		"For breadcrumb maintenance policy, use /skill:context-breadcrumbs when available.",
		reasonLine(reason),
	];

	for (const file of files) {
		lines.push("", `File: ${file.path}`, `Applies to: ${file.appliesTo}`, "Content:", file.content);
	}

	return lines.join("\n");
}

export function buildBreadcrumbCustomMessage(
	observedTargets: string[],
	files: BreadcrumbInjectedFile[],
	reason: BreadcrumbAnnouncementReason,
): { content: string; details: BreadcrumbMessageDetails } {
	const details: BreadcrumbMessageDetails = {
		version: 1,
		observedTargets: [...observedTargets],
		reason,
		files: files.map((file) => ({ ...file })),
	};
	return {
		content: buildBreadcrumbContent(details.observedTargets, details.files, details.reason),
		details,
	};
}

function parseEntryTimestamp(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

export function collectBreadcrumbBranchState(entries: unknown[]): BreadcrumbBranchState {
	const latestByPath = new Map<string, { hash: string; timestamp: number }>();
	let latestCompactionTimestamp = 0;

	for (const entry of entries) {
		if (!isPlainObject(entry)) continue;
		const timestamp = parseEntryTimestamp(entry.timestamp);

		if (entry.type === "compaction") {
			latestCompactionTimestamp = Math.max(latestCompactionTimestamp, timestamp);
			continue;
		}

		if (entry.type !== "custom_message" || entry.customType !== "context-breadcrumbs") continue;
		const details = parseBreadcrumbMessageDetails(entry.details);
		if (!details) continue;
		for (const file of details.files) {
			const previous = latestByPath.get(file.path);
			if (!previous || timestamp >= previous.timestamp) {
				latestByPath.set(file.path, { hash: file.contentHash, timestamp });
			}
		}
	}

	return { latestByPath, latestCompactionTimestamp };
}

export function shouldAnnounceBreadcrumbChain(
	files: BreadcrumbInjectedFile[],
	branchState: BreadcrumbBranchState,
): { announce: boolean; reason?: BreadcrumbAnnouncementReason } {
	if (files.length === 0) return { announce: false };

	for (const file of files) {
		const previous = branchState.latestByPath.get(file.path);
		if (!previous) return { announce: true, reason: "new-chain" };
		if (previous.hash !== file.contentHash) return { announce: true, reason: "content-changed" };
	}

	for (const file of files) {
		const previous = branchState.latestByPath.get(file.path);
		if (previous && previous.timestamp < branchState.latestCompactionTimestamp) {
			return { announce: true, reason: "restated-after-compaction" };
		}
	}

	return { announce: false };
}

function isBreadcrumbCustomMessage(message: AgentMessage): message is BreadcrumbCustomMessage {
	if (message.role !== "custom") return false;
	if (message.customType !== "context-breadcrumbs") return false;
	if (typeof message.content !== "string") return false;
	const details = parseBreadcrumbMessageDetails(message.details);
	if (!details) return false;
	return typeof message.timestamp === "number";
}

export function filterSupersededBreadcrumbMessages(messages: AgentMessage[]): AgentMessage[] {
	const latestByPath = new Map<string, { hash: string; timestamp: number }>();

	for (const message of messages) {
		if (!isBreadcrumbCustomMessage(message)) continue;
		for (const file of message.details.files) {
			const previous = latestByPath.get(file.path);
			if (!previous || message.timestamp >= previous.timestamp) {
				latestByPath.set(file.path, { hash: file.contentHash, timestamp: message.timestamp });
			}
		}
	}

	const filtered: AgentMessage[] = [];
	for (const message of messages) {
		if (!isBreadcrumbCustomMessage(message)) {
			filtered.push(message);
			continue;
		}

		const files = message.details.files.filter((file) => {
			const latest = latestByPath.get(file.path);
			return latest?.hash === file.contentHash && latest.timestamp === message.timestamp;
		});
		if (files.length === 0) continue;
		if (files.length === message.details.files.length) {
			filtered.push(message);
			continue;
		}

		const rebuilt = buildBreadcrumbCustomMessage(message.details.observedTargets, files, message.details.reason);
		filtered.push({
			...message,
			content: rebuilt.content,
			details: rebuilt.details,
		});
	}

	return filtered;
}
