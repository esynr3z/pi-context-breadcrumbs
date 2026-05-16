function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    const out = [];
    for (const item of value) {
        if (typeof item !== "string")
            return undefined;
        out.push(item);
    }
    return out;
}
function parseInjectedFile(value) {
    if (!isPlainObject(value))
        return undefined;
    if (typeof value.path !== "string")
        return undefined;
    if (typeof value.appliesTo !== "string")
        return undefined;
    if (typeof value.contentHash !== "string")
        return undefined;
    if (typeof value.content !== "string")
        return undefined;
    return {
        path: value.path,
        appliesTo: value.appliesTo,
        contentHash: value.contentHash,
        content: value.content,
    };
}
export function parseBreadcrumbMessageDetails(value) {
    if (!isPlainObject(value))
        return undefined;
    if (value.version !== 1)
        return undefined;
    const observedTargets = normalizeStringArray(value.observedTargets);
    if (!observedTargets)
        return undefined;
    if (value.reason !== "new-chain" &&
        value.reason !== "content-changed" &&
        value.reason !== "restated-after-compaction") {
        return undefined;
    }
    if (!Array.isArray(value.files))
        return undefined;
    const files = [];
    for (const item of value.files) {
        const parsed = parseInjectedFile(item);
        if (!parsed)
            return undefined;
        files.push(parsed);
    }
    return {
        version: 1,
        observedTargets,
        reason: value.reason,
        files,
    };
}
function reasonLine(reason) {
    switch (reason) {
        case "content-changed":
            return "Reason: breadcrumb content changed; this supersedes earlier breadcrumb content for these files.";
        case "restated-after-compaction":
            return "Reason: restated after compaction because earlier exact breadcrumb text may have been summarized.";
        default:
            return "Reason: first relevant breadcrumb chain for these paths.";
    }
}
function buildBreadcrumbContent(observedTargets, files, reason) {
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
export function buildBreadcrumbCustomMessage(observedTargets, files, reason) {
    const details = {
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
function parseEntryTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}
function isNewerPosition(timestamp, order, previousTimestamp, previousOrder) {
    return timestamp > previousTimestamp || (timestamp === previousTimestamp && order > previousOrder);
}
function maybeSetLatestRecord(latestByPath, path, hash, timestamp, order) {
    const previous = latestByPath.get(path);
    if (!previous || isNewerPosition(timestamp, order, previous.timestamp, previous.order)) {
        latestByPath.set(path, { hash, timestamp, order });
    }
}
function maybeSetCompactionTimestamp(state, timestamp, order) {
    if (isNewerPosition(timestamp, order, state.latestCompactionTimestamp, state.latestCompactionOrder)) {
        state.latestCompactionTimestamp = timestamp;
        state.latestCompactionOrder = order;
    }
}
export function createEmptyBreadcrumbBranchState() {
    return {
        latestByPath: new Map(),
        latestCompactionTimestamp: 0,
        latestCompactionOrder: -1,
    };
}
export function recordBreadcrumbAnnouncement(files, timestamp, order = 0) {
    const state = createEmptyBreadcrumbBranchState();
    for (const file of files) {
        maybeSetLatestRecord(state.latestByPath, file.path, file.contentHash, timestamp, order);
    }
    return state;
}
export function recordBreadcrumbCompaction(timestamp, order = 0) {
    const state = createEmptyBreadcrumbBranchState();
    maybeSetCompactionTimestamp(state, timestamp, order);
    return state;
}
export function mergeBreadcrumbBranchStates(...states) {
    const merged = createEmptyBreadcrumbBranchState();
    const latestSourceByPath = new Map();
    let latestCompactionSource = -1;
    for (const [stateIndex, state] of states.entries()) {
        if (state.latestCompactionTimestamp > merged.latestCompactionTimestamp ||
            (state.latestCompactionTimestamp === merged.latestCompactionTimestamp &&
                (stateIndex > latestCompactionSource ||
                    (stateIndex === latestCompactionSource && state.latestCompactionOrder > merged.latestCompactionOrder)))) {
            merged.latestCompactionTimestamp = state.latestCompactionTimestamp;
            merged.latestCompactionOrder = state.latestCompactionOrder;
            latestCompactionSource = stateIndex;
        }
        for (const [filePath, record] of state.latestByPath) {
            const previous = merged.latestByPath.get(filePath);
            const previousSource = latestSourceByPath.get(filePath) ?? -1;
            if (!previous ||
                record.timestamp > previous.timestamp ||
                (record.timestamp === previous.timestamp &&
                    (stateIndex > previousSource || (stateIndex === previousSource && record.order > previous.order)))) {
                merged.latestByPath.set(filePath, record);
                latestSourceByPath.set(filePath, stateIndex);
            }
        }
    }
    return merged;
}
export function collectBreadcrumbBranchState(entries) {
    const state = createEmptyBreadcrumbBranchState();
    for (const [index, entry] of entries.entries()) {
        if (!isPlainObject(entry))
            continue;
        const timestamp = parseEntryTimestamp(entry.timestamp);
        if (entry.type === "compaction") {
            maybeSetCompactionTimestamp(state, timestamp, index);
            continue;
        }
        if (entry.type !== "custom_message" || entry.customType !== "context-breadcrumbs")
            continue;
        const details = parseBreadcrumbMessageDetails(entry.details);
        if (!details)
            continue;
        for (const file of details.files) {
            maybeSetLatestRecord(state.latestByPath, file.path, file.contentHash, timestamp, index);
        }
    }
    return state;
}
export function shouldAnnounceBreadcrumbChain(files, branchState) {
    if (files.length === 0)
        return { announce: false };
    for (const file of files) {
        const previous = branchState.latestByPath.get(file.path);
        if (!previous)
            return { announce: true, reason: "new-chain" };
        if (previous.hash !== file.contentHash)
            return { announce: true, reason: "content-changed" };
    }
    for (const file of files) {
        const previous = branchState.latestByPath.get(file.path);
        if (previous && previous.timestamp < branchState.latestCompactionTimestamp) {
            return { announce: true, reason: "restated-after-compaction" };
        }
    }
    return { announce: false };
}
function isBreadcrumbCustomMessage(message) {
    if (message.role !== "custom")
        return false;
    if (message.customType !== "context-breadcrumbs")
        return false;
    if (typeof message.content !== "string")
        return false;
    const details = parseBreadcrumbMessageDetails(message.details);
    if (!details)
        return false;
    return typeof message.timestamp === "number";
}
export function filterSupersededBreadcrumbMessages(messages) {
    const latestByPath = new Map();
    for (const [index, message] of messages.entries()) {
        if (!isBreadcrumbCustomMessage(message))
            continue;
        for (const file of message.details.files) {
            maybeSetLatestRecord(latestByPath, file.path, file.contentHash, message.timestamp, index);
        }
    }
    const filtered = [];
    for (const [index, message] of messages.entries()) {
        if (!isBreadcrumbCustomMessage(message)) {
            filtered.push(message);
            continue;
        }
        const files = message.details.files.filter((file) => {
            const latest = latestByPath.get(file.path);
            return latest?.hash === file.contentHash && latest.timestamp === message.timestamp && latest.order === index;
        });
        if (files.length === 0)
            continue;
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
//# sourceMappingURL=breadcrumb-messages.js.map