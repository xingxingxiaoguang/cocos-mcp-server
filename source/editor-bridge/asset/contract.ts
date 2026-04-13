export interface AssetBridgeDriver {
    // 查询
    queryReady(): Promise<boolean>;
    queryAssetInfo(assetPath: string): Promise<AssetMetadata | null>;
    queryAssetMeta(urlOrUuid: string): Promise<Record<string, unknown>>;
    queryAssets(query: AssetQueryInput): Promise<AssetMetadata[]>;
    queryAssetUrl(uuid: string): Promise<string | null>;
    readAsset(urlOrUuid: string): Promise<string | unknown>;
    generateAvailableUrl(url: string): Promise<string>;

    // 资产信息解析（含多源查找 + URL 归一化）
    resolveAssetInfo(urlOrUUID: string): Promise<AssetMetadata | null>;

    // 依赖分析（含文件系统读取）
    collectAssetDependencies(assetInfo: AssetMetadata): Promise<AssetDependencyItem[]>;
    findAssetDependents(targetUuid: string, targetUrl: string, allAssets: AssetMetadata[]): Promise<AssetDependencyItem[]>;
    collectReferencedUuids(assets: AssetMetadata[]): Promise<Set<string>>;

    // 文件系统操作
    readAssetMeta(uuid: string, assetUrl: string): Promise<Record<string, unknown> | null>;
    readAssetContent(assetUrl: string): Promise<string | null>;
    getFilesFromDirectory(dirPath: string, fileFilter: string[], recursive: boolean): string[];
    fileExists(filePath: string): boolean;

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

// ---------------------------------------------------------------------------
// 查询 / 变更类型
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 依赖分析类型
// ---------------------------------------------------------------------------

export interface AssetDependencyItem {
    uuid:  string;
    name?: string;
    path?: string;
    type?: string;
    truncated?: boolean;
    remaining?: number;
}

export interface UnusedAssetsResult {
    directory: string;
    excludeDirectories: string[];
    totalAssets: number;
    referencedCount: number;
    unusedCount: number;
    unused: AssetDependencyItem[];
    note: string;
}
