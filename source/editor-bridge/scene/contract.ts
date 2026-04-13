import { SceneHierarchyNode, SceneInfoResult } from '../../capabilities/scene/interface';

export { SceneHierarchyNode, SceneInfoResult };

export interface SceneAssetRecord {
    uuid: string;
    path: string;
    name: string;
}

export interface SceneAssetCreateResult {
    uuid: string;
    url: string;
}

export interface SceneBridgeDriver {
    // 查询（含归一化）
    querySceneInfo(): Promise<SceneInfoResult>;
    querySceneHierarchy(includeComponents: boolean): Promise<SceneHierarchyNode>;
    listSceneAssets(): Promise<SceneAssetRecord[]>;
    querySceneReady(): Promise<boolean>;
    querySceneDirty(): Promise<boolean>;
    resolveSceneUuid(scenePath: string): Promise<string | null>;

    // 生命周期操作
    openScene(sceneUuid: string): Promise<void>;
    saveScene(): Promise<void>;
    saveSceneAs(): Promise<void>;
    closeScene(): Promise<void>;

    // 场景创建（含模板生成）
    createSceneAsset(sceneName: string, savePath: string): Promise<SceneAssetCreateResult>;

    // 场景管理
    softReloadScene(): Promise<void>;
    createSnapshot(): Promise<void>;
    abortSnapshot(): Promise<void>;
}
