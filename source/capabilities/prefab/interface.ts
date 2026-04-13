export interface PrefabCapability {
    // Queries
    list(input: ListPrefabsInput): Promise<ListPrefabsResult>;
    query(input: QueryPrefabInput): Promise<PrefabDetailResult>;

    // Mutations
    createFromNode(input: CreatePrefabFromNodeInput): Promise<PrefabCreateFromNodeResult>;
    duplicate(input: DuplicatePrefabInput): Promise<PrefabDuplicateResult>;
    instantiate(input: InstantiatePrefabInput): Promise<PrefabInstantiateResult>;
    apply(input: ApplyPrefabInput): Promise<PrefabApplyResult>;
    revert(input: RevertPrefabInput): Promise<PrefabRevertResult>;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

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

export interface Vector3Like {
    x: number;
    y: number;
    z?: number;
}

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface PrefabDetailResult extends PrefabSummary {
    createTime?: string | number;
    modifyTime?: string | number;
    dependencies?: string[];
    validation?: PrefabValidationResult;
}

export interface ListPrefabsResult {
    prefabs: PrefabSummary[];
    count: number;
    folder: string;
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface PrefabCreateFromNodeResult {
    data: unknown;
    message?: string;
    warning?: string;
    instruction?: string;
}

export interface PrefabInstantiateResult {
    data: unknown;
    message?: string;
    warning?: string;
    instruction?: string;
}

export interface PrefabDuplicateResult {
    data: unknown;
    message?: string;
    warning?: string;
    instruction?: string;
}

export interface PrefabApplyResult {
    nodeUuid: string;
    message: string;
}

export interface PrefabRevertResult {
    nodeUuid: string;
    assetUuid?: string;
    message: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ListPrefabsInput {
    folder?: string;
}

export interface QueryPrefabInput {
    prefabPath: string;
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
