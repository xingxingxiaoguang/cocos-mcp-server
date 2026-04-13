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

    // 配置评分与提取（从 service 下沉）
    findBestProjectConfig(category?: string): Promise<ProjectConfigCandidate | null>;
    extractProjectSettings(projectConfig: unknown, category: string): unknown;
}
