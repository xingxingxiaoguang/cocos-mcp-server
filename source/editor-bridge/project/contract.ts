export interface ProjectRuntimeInfo {
    name: string;
    path: string;
    uuid: string;
    version: string;
    cocosVersion: string;
}

export interface ProjectConfigCandidate {
    source: string;
    config: unknown;
}

export interface ProjectBridgeDriver {
    getRuntimeInfo(): ProjectRuntimeInfo;
    readProjectConfigCandidates(): Promise<ProjectConfigCandidate[]>;
    queryProjectConfig(): Promise<unknown>;
}
