import { ToolResponse } from '../../mcp/interface';

// ---------------------------------------------------------------------------
// Asset domain types
// ---------------------------------------------------------------------------

export interface AssetInfo {
    name:         string;
    uuid:         string;
    path:         string;
    type:         string;
    size?:        number;
    isDirectory:  boolean;
    meta?:        {
        ver:       string;
        importer:  string;
    };
}

// ---------------------------------------------------------------------------
// AssetCapability input types
// ---------------------------------------------------------------------------

export interface AssetQueryInput {
    uuid?:              string;
    path?:              string;
    name?:              string;
    action?:            'info' | 'list' | 'db_ready' | 'dependencies' | 'unused';
    type?:              string;
    folder?:            string;
    includeSubAssets?:  boolean;
    direction?:         'dependencies' | 'dependents' | 'both';
    exactMatch?:        boolean;
    maxResults?:        number;
    excludeDirectories?: string[];
    directory?:         string;
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

// ---------------------------------------------------------------------------
// AssetCapability interface
// ---------------------------------------------------------------------------

export interface AssetCapability {
    query(input: AssetQueryInput): Promise<ToolResponse>;
    create(input: AssetCreateInput): Promise<ToolResponse>;
    modify(input: AssetModifyInput): Promise<ToolResponse>;
    delete(input: AssetDeleteInput): Promise<ToolResponse>;
    refresh(input: AssetRefreshInput): Promise<ToolResponse>;
}
