export interface SceneCapability {
    queryInfo(): Promise<SceneInfoResult>;
    queryHierarchy(input?: QuerySceneHierarchyInput): Promise<SceneHierarchyNode>;
    listScenes(): Promise<ListScenesResult>;
    queryStatus(): Promise<SceneStatusResult>;
    openScene(input: OpenSceneInput): Promise<SceneMutationResult>;
    saveScene(): Promise<SceneMutationResult>;
    saveSceneAs(input: SaveSceneAsInput): Promise<SceneMutationResult>;
    closeScene(): Promise<SceneMutationResult>;
    createScene(input: CreateSceneInput): Promise<CreateSceneResult>;
    reloadScene(): Promise<SceneMutationResult>;
    createSnapshot(): Promise<SceneMutationResult>;
    abortSnapshot(): Promise<SceneMutationResult>;
}

export interface QuerySceneHierarchyInput {
    includeComponents?: boolean;
}

export interface SceneComponentSummary {
    type: string;
    enabled: boolean;
}

export interface SceneHierarchyNode {
    uuid: string;
    name: string;
    type: string;
    active: boolean;
    children: SceneHierarchyNode[];
    components?: SceneComponentSummary[];
}

export interface SceneInfoResult {
    name: string;
    uuid: string;
    type: string;
    active: boolean;
    nodeCount: number;
}

export interface SceneAssetSummary {
    name: string;
    path: string;
    uuid: string;
}

export interface ListScenesResult {
    scenes: SceneAssetSummary[];
    count: number;
}

export interface SceneStatusResult {
    ready: boolean;
    dirty: boolean;
    message: string;
}

export interface OpenSceneInput {
    scenePath: string;
}

export interface SaveSceneAsInput {
    path: string;
}

export interface CreateSceneInput {
    sceneName: string;
    savePath: string;
}

export interface SceneMutationResult {
    message: string;
    data?: Record<string, unknown>;
}

export interface CreateSceneResult extends SceneMutationResult {
    data: {
        uuid: string;
        url: string;
        name: string;
        sceneVerified: boolean;
    };
    verificationData?: SceneAssetSummary;
}
