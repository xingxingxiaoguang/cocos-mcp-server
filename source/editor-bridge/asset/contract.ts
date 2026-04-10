// AssetBridgeDriver — 完整的 asset-db 操作（替换原来的透传 relay）

export interface AssetMetadata {
    uuid:         string;
    name:         string;
    path:         string;
    type:         string;
    url?:         string;
    size?:        number;
    isDirectory?: boolean;
    imported?:    boolean;
    invalid?:     boolean;
    files?:       string[];
}

export interface AssetMutationResult {
    uuid: string;
    url:  string;
}

export interface AssetQueryInput {
    pattern?:  string;
    type?:     string;
    cc_type?:  string;
}

export interface AssetCreateInput {
    url:        string;
    content:    string;
    overwrite?: boolean;
    rename?:    boolean;
}

export interface AssetImportInput {
    source: string;
    target: string;
}

export interface AssetSaveInput {
    url:     string;
    content: string;
}

export interface AssetSaveMetaInput {
    urlOrUuid: string;
    content:   string;
}

export interface AssetMoveInput {
    source: string;
    target: string;
}

export interface AssetCopyInput {
    source: string;
    target: string;
}

export interface AssetBridgeDriver {
    // 查询
    queryReady(): Promise<boolean>;
    queryAssetInfo(assetPath: string): Promise<AssetMetadata | null>;
    queryAssetMeta(urlOrUuid: string): Promise<Record<string, unknown>>;
    queryAssets(query: AssetQueryInput): Promise<AssetMetadata[]>;
    queryAssetUrl(uuid: string): Promise<string | null>;
    readAsset(urlOrUuid: string): Promise<string | unknown>;
    generateAvailableUrl(url: string): Promise<string>;
    // 创建 / 修改
    createAsset(input: AssetCreateInput): Promise<AssetMutationResult>;
    importAsset(input: AssetImportInput): Promise<AssetMutationResult>;
    saveAsset(input: AssetSaveInput): Promise<AssetMutationResult>;
    saveAssetMeta(input: AssetSaveMetaInput): Promise<AssetMutationResult>;
    reimportAsset(url: string): Promise<void>;
    moveAsset(input: AssetMoveInput): Promise<AssetMutationResult>;
    copyAsset(input: AssetCopyInput): Promise<AssetMutationResult>;
    // 删除 / 刷新
    deleteAsset(url: string): Promise<void>;
    refreshAsset(targetPath?: string): Promise<void>;
    openAsset(urlOrUuid: string): Promise<void>;
}
