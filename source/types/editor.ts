export interface EditorAssetInfo {
    uuid: string;
    name?: string;
    url?: string;
    path?: string;
    type?: string;
    fileSize?: number;
    size?: number;
    isDirectory?: boolean;
}

export interface EditorAssetMeta {
    ver?: string;
    importer?: string;
    createTime?: string;
    modifyTime?: string;
    depends?: string[];
    userData?: Record<string, unknown>;
}

export interface EditorPreferenceItem {
    name: string;
    path?: string;
    type?: string;
    value?: unknown;
}

export interface EditorSceneNodeLike {
    uuid?: string;
    name?: string;
    active?: boolean;
    children?: EditorSceneNodeLike[];
    components?: unknown[];
    [key: string]: unknown;
}
