export interface SceneAssetRecord {
    uuid: string;
    path: string;
    name: string;
}

export interface SceneAssetCreateResult {
    uuid: string;
    url: string;
}

export interface SceneMethodResult {
    success: boolean;
    data?: unknown;
    message?: string;
    warning?: string;
    error?: string;
}

export interface SceneBridgeDriver {
    queryNodeTree(): Promise<unknown>;
    executeSceneMethod(method: string, args: unknown[]): Promise<SceneMethodResult>;
    listSceneAssets(): Promise<SceneAssetRecord[]>;
    querySceneReady(): Promise<boolean>;
    querySceneDirty(): Promise<boolean>;
    resolveSceneUuid(scenePath: string): Promise<string | null>;
    openScene(sceneUuid: string): Promise<void>;
    saveScene(): Promise<void>;
    saveSceneAs(): Promise<void>;
    closeScene(): Promise<void>;
    createSceneAsset(scenePath: string, content: string): Promise<SceneAssetCreateResult>;
    softReloadScene(): Promise<void>;
    createSnapshot(): Promise<void>;
    abortSnapshot(): Promise<void>;
}
