export interface AssetCapability {
    // Queries
    getInfo(input: AssetInfoInput): Promise<AssetDetail>;
    searchByName(input: AssetNameSearchInput): Promise<AssetSearchResult>;
    list(input?: AssetListInput): Promise<AssetListResult>;
    getDependencies(input: AssetDependencyInput): Promise<AssetDependencyResult>;
    getUnused(input?: AssetUnusedInput): Promise<AssetUnusedResult>;
    checkDbReady(): Promise<AssetDbStatus>;

    // Mutations
    create(input: AssetCreateInput): Promise<AssetCreateResult>;
    modify(input: AssetModifyInput): Promise<AssetModifyResult>;
    delete(input: AssetDeleteInput): Promise<AssetDeleteResult>;
    refresh(input: AssetRefreshInput): Promise<AssetRefreshResult>;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface AssetInfo {
    name:         string;
    uuid:         string;
    path:         string;
    type:         string;
    size?:        number;
    isDirectory:  boolean;
}

export interface AssetSubAsset {
    type:   string;
    uuid:   string;
    url:    string;
    suffix: string;
}

export interface AssetDetail extends AssetInfo {
    meta?:      { ver: string; importer: string };
    subAssets?: AssetSubAsset[];
}

export interface AssetDependencyItem {
    uuid:       string;
    name?:      string;
    path?:      string;
    type?:      string;
    truncated?: boolean;
    remaining?: number;
}

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface AssetDbStatus {
    ready:   boolean;
    message: string;
}

export interface AssetSearchResult {
    searchTerm: string;
    exactMatch: boolean;
    assetType:  string;
    folder:     string;
    totalFound: number;
    maxResults: number;
    assets:     unknown[];
    message:    string;
}

export interface AssetListResult {
    type:   string;
    folder: string;
    count:  number;
    assets: AssetInfo[];
}

export interface AssetDependencyResult {
    uuid:             string;
    name:             string;
    path:             string;
    type:             string;
    direction:        string;
    dependencies?:    AssetDependencyItem[];
    dependencyCount?: number;
    dependents?:      AssetDependencyItem[];
    dependentCount?:  number;
}

export interface AssetUnusedResult {
    directory:          string;
    excludeDirectories: string[];
    totalAssets:        number;
    referencedCount:    number;
    unusedCount:        number;
    unused:             AssetDependencyItem[];
    note:               string;
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface AssetCreateResult {
    uuid?:         string;
    url?:          string;
    path?:         string;
    message:       string;
    // batch import
    totalFiles?:   number;
    successCount?: number;
    errorCount?:   number;
    results?:      Array<{ source: string; target?: string; success: boolean; uuid?: string; error?: string }>;
}

export interface AssetModifyResult {
    uuid?:   string;
    url?:    string;
    source?: string;
    target?: string;
    message: string;
}

export interface AssetDeleteResult {
    url?:          string;
    totalAssets?:  number;
    successCount?: number;
    errorCount?:   number;
    results?:      Array<{ url: string; success: boolean; error?: string }>;
    message:       string;
}

export interface AssetRefreshResult {
    message:           string;
    // generate_url
    originalUrl?:      string;
    availableUrl?:     string;
    // export_manifest
    directory?:        string;
    format?:           string;
    assetCount?:       number;
    includeMetadata?:  boolean;
    manifest?:         string;
    // validate_refs
    totalAssets?:      number;
    validReferences?:  number;
    brokenReferences?: number;
    brokenAssets?:     unknown[];
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface AssetInfoInput {
    uuid?:             string;
    path?:             string;
    includeSubAssets?: boolean;
}

export interface AssetNameSearchInput {
    name:        string;
    exactMatch?: boolean;
    type?:       string;
    folder?:     string;
    maxResults?: number;
}

export interface AssetListInput {
    type?:   string;
    folder?: string;
}

export interface AssetDependencyInput {
    urlOrUuid: string;
    direction?: 'dependencies' | 'dependents' | 'both';
}

export interface AssetUnusedInput {
    directory?:          string;
    excludeDirectories?: string[];
}

export interface AssetCreateInput {
    action:      'create' | 'import';
    targetPath:  string;
    content?:    string;
    overwrite?:  boolean;
    sourcePath?: string;
    sources?:    { sourceDirectory?: string; fileFilter?: string[]; recursive?: boolean };
}

export type AssetModifyInput =
    | { action: 'move';       source: string; target: string; overwrite?: boolean }
    | { action: 'copy';       source: string; target: string; overwrite?: boolean }
    | { action: 'save';       url: string; content: string }
    | { action: 'reimport';   url?: string; path?: string }
    | { action: 'save_meta';  uuid?: string; url?: string; meta?: unknown; content?: string }
    | { action: 'compress';   texturePaths: string[]; format?: string };

export interface AssetDeleteInput {
    urls: string | string[];
}

export interface AssetRefreshInput {
    action?:          'refresh' | 'generate_url' | 'open_external' | 'export_manifest' | 'validate_refs';
    path?:            string;
    url?:             string;
    uuid?:            string;
    directory?:       string;
    format?:          string;
    includeMetadata?: boolean;
}
