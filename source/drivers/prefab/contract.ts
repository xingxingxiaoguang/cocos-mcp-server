export interface PrefabBridgeDriver {
    listPrefabAssets(folder: string): Promise<PrefabAssetRecord[]>;
    queryPrefabAsset(prefabPath: string): Promise<PrefabAssetRecord | null>;
    queryPrefabMeta(prefabUuid: string): Promise<PrefabMetaRecord | null>;
    readPrefab(prefabPath: string): Promise<string>;
    createFromNode(input: PrefabCreateFromNodeRequest): Promise<PrefabMutationResponse>;
    instantiate(input: PrefabInstantiateRequest): Promise<PrefabMutationResponse>;
    duplicate(input: PrefabDuplicateRequest): Promise<PrefabMutationResponse>;
    apply(nodeUuid: string): Promise<void>;
    restore(nodeUuid: string, assetUuid: string): Promise<void>;
    revert(nodeUuid: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Vector3Like {
    x: number;
    y: number;
    z?: number;
}

export interface PrefabAssetRecord {
    uuid: string;
    path: string;
    name: string;
    folder: string;
    type?: string;
    size?: number;
}

export interface PrefabMetaRecord {
    uuid?: string;
    createTime?: string | number;
    modifyTime?: string | number;
    depends?: string[];
    name?: string;
}

export interface PrefabMutationResponse {
    data: unknown;
    message?: string;
    warning?: string;
    instruction?: string;
}

export interface PrefabCreateFromNodeRequest {
    nodeUuid: string;
    savePath: string;
    prefabName?: string;
}

export interface PrefabInstantiateRequest {
    prefabPath: string;
    parentUuid?: string;
    name?: string;
    position?: Vector3Like;
}

export interface PrefabDuplicateRequest {
    sourcePath: string;
    targetPath: string;
    prefabName?: string;
}

export interface PrefabCreateNodeInput {
    assetUuid: string;
    parentUuid?: string;
    name?: string;
    position?: Vector3Like;
    keepWorldTransform?: boolean;
    dump?: Record<string, unknown>;
}

export interface PrefabLinkInput {
    nodeUuid: string;
    prefabUuid: string;
    prefabPath: string;
}

export interface PrefabLinkResult {
    success: boolean;
    strategy?: string;
}
