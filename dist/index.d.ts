import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export type NotifyLevel = "info" | "warning" | "error";
export interface NestedContextConfig {
    enabled: boolean;
    includeFilenames: string[];
    ignoreDirs: string[];
    notifyOnLoad: boolean;
    filterSupersededFromPrompt: boolean;
}
export declare const DEFAULT_CONFIG: NestedContextConfig;
export declare const CONFIG_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly enabled: {
            readonly type: "boolean";
            readonly default: boolean;
        };
        readonly includeFilenames: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
            readonly default: string[];
        };
        readonly ignoreDirs: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
            readonly default: string[];
        };
        readonly notifyOnLoad: {
            readonly type: "boolean";
            readonly default: boolean;
        };
        readonly filterSupersededFromPrompt: {
            readonly type: "boolean";
            readonly default: boolean;
        };
    };
};
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
export declare function normalizeConfig(raw: unknown): NestedContextConfig;
export declare function loadConfig(cwd: string, notify?: NotifyFn): NestedContextConfig;
export declare function extractFilesystemPaths(toolName: string, input: unknown, isBuiltinTool?: boolean): string[];
export declare class NestedContextManager {
    readonly cwdAbs: string;
    readonly cwdReal: string;
    config: NestedContextConfig;
    private readonly gitRootAbs;
    private readonly notify?;
    private readonly ignoreDirSet;
    private readonly loaded;
    private readonly observedDirs;
    private readonly startupContextPaths;
    private readonly warned;
    constructor(cwd: string, config?: NestedContextConfig, notify?: NotifyFn);
    setStartupContextFiles(files: Array<{
        path: string;
        content?: string;
    }> | undefined): void;
    clear(): void;
    loadedCount(): number;
    private isIgnoredPath;
    listLoaded(): NestedContextListEntry[];
    orderedLoaded(): LoadedContextFile[];
    observeToolCall(toolName: string, input: unknown, isBuiltinTool?: boolean): Promise<LoadedContextFile[]>;
    observePath(rawPath: string): Promise<LoadedContextFile[]>;
    normalizeObservedTarget(rawPath: string): string | undefined;
    refreshLoaded(): void;
    private filesForDirectory;
    private resolveTargetDirectory;
    private dirsBroadToSpecific;
    private discoverForDirectory;
    private loadCandidate;
}
export default function contextBreadcrumbsExtension(pi: ExtensionAPI): void;
export {};
