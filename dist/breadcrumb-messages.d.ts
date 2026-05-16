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
export interface BreadcrumbLatestRecord {
    hash: string;
    timestamp: number;
    order: number;
}
export interface BreadcrumbBranchState {
    latestByPath: Map<string, BreadcrumbLatestRecord>;
    latestCompactionTimestamp: number;
    latestCompactionOrder: number;
}
export declare function parseBreadcrumbMessageDetails(value: unknown): BreadcrumbMessageDetails | undefined;
export declare function buildBreadcrumbCustomMessage(observedTargets: string[], files: BreadcrumbInjectedFile[], reason: BreadcrumbAnnouncementReason): {
    content: string;
    details: BreadcrumbMessageDetails;
};
export declare function createEmptyBreadcrumbBranchState(): BreadcrumbBranchState;
export declare function recordBreadcrumbAnnouncement(files: BreadcrumbInjectedFile[], timestamp: number, order?: number): BreadcrumbBranchState;
export declare function recordBreadcrumbCompaction(timestamp: number, order?: number): BreadcrumbBranchState;
export declare function mergeBreadcrumbBranchStates(...states: BreadcrumbBranchState[]): BreadcrumbBranchState;
export declare function collectBreadcrumbBranchState(entries: unknown[]): BreadcrumbBranchState;
export declare function shouldAnnounceBreadcrumbChain(files: BreadcrumbInjectedFile[], branchState: BreadcrumbBranchState): {
    announce: boolean;
    reason?: BreadcrumbAnnouncementReason;
};
export declare function filterSupersededBreadcrumbMessages(messages: AgentMessage[]): AgentMessage[];
