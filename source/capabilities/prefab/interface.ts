import { JsonValue } from '../../json';

export interface PrefabCapability {
    list(input: ListPrefabsInput): Promise<ListPrefabsResult>;
    query(input: QueryPrefabInput): Promise<PrefabDetailResult>;
    createFromNode(input: CreatePrefabFromNodeInput): Promise<PrefabOperationResult>;
    duplicate(input: DuplicatePrefabInput): Promise<PrefabOperationResult>;
    instantiate(input: InstantiatePrefabInput): Promise<PrefabOperationResult>;
    apply(input: ApplyPrefabInput): Promise<PrefabOperationResult>;
    revert(input: RevertPrefabInput): Promise<PrefabOperationResult>;
}

export interface PrefabSummary {
    name: string;
    uuid: string;
    path: string;
    folder: string;
    type?: string;
    size?: number;
}

export interface PrefabValidationResult {
    isValid: boolean;
    issues: string[];
    nodeCount: number;
    componentCount: number;
}

export interface PrefabDetailResult extends PrefabSummary {
    createTime?: string | number;
    modifyTime?: string | number;
    dependencies?: string[];
    validation?: PrefabValidationResult;
}

export interface ListPrefabsInput {
    folder?: string;
}

export interface ListPrefabsResult {
    prefabs: PrefabSummary[];
    count: number;
    folder: string;
}

export interface QueryPrefabInput {
    prefabPath: string;
}

export interface Vector3Like {
    x: number;
    y: number;
    z?: number;
}

export interface CreatePrefabFromNodeInput {
    nodeUuid: string;
    savePath: string;
    prefabName?: string;
    includeChildren?: boolean;
    includeComponents?: boolean;
}

export interface DuplicatePrefabInput {
    sourcePath: string;
    targetPath: string;
    prefabName?: string;
}

export interface InstantiatePrefabInput {
    prefabPath: string;
    parentUuid?: string;
    name?: string;
    position?: Vector3Like;
}

export interface ApplyPrefabInput {
    nodeUuid: string;
}

export interface RevertPrefabInput {
    nodeUuid: string;
    assetUuid?: string;
}

export interface PrefabOperationResult {
    data: JsonValue;
    action?: string;
    message?: string;
    warning?: string;
    instruction?: string;
}
