import type { ComponentInfo } from '../component/interface';

export interface NodeCapability {
    // Queries
    queryByUuid(uuid: string): Promise<NodeDetail>;
    searchByName(pattern: string): Promise<NodeSearchResult>;
    queryAssetUsage(assetUuid: string): Promise<NodeAssetUsageResult>;
    listAll(): Promise<NodeListResult>;

    // Mutations
    create(spec: NodeCreateSpec): Promise<NodeCreateResult>;
    batchCreate(input: NodeBatchCreateInput): Promise<NodeBatchCreateResult>;
    modify(input: NodeModifyInput): Promise<NodeModifyResult>;
    delete(uuids: string | string[]): Promise<NodeDeleteResult>;
    arrange(input: NodeArrangeInput): Promise<NodeArrangeResult>;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface NodeInfo {
    uuid:         string;
    name:         string;
    active:       boolean;
    position?:    { x: number; y: number; z: number };
    rotation?:    { x: number; y: number; z: number };
    scale?:       { x: number; y: number; z: number };
    parent?:      string | null;
    children?:    string[];
    components?:  ComponentInfo[];
    layer?:       number;
    mobility?:    number;
}

export interface NodeDetail extends NodeInfo {
    nodeType: string;
}

export interface NodeSearchEntry {
    uuid: string;
    name: string;
    path: string;
}

export interface NodeSummary {
    uuid:   string;
    name:   string;
    type:   unknown;
    active: unknown;
    path:   string;
}

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface NodeSearchResult {
    nodes: NodeSearchEntry[];
}

export interface NodeAssetUsageResult {
    assetUuid: string;
    nodeUuids: string[];
    count:     number;
}

export interface NodeListResult {
    totalNodes: number;
    nodes:      NodeSummary[];
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface NodeCreateResult {
    uuid:        string;
    name:        string;
    parentUuid?: string;
    nodeType:    string;
    fromAsset:   boolean;
    assetUuid?:  string;
    nodeInfo?:   NodeInfo;
    message:     string;
}

export interface NodeBatchCreateEntry {
    index:    number;
    name:     string;
    success:  boolean;
    uuid?:    string;
    warning?: string;
    error?:   string;
    data?:    unknown;
}

export interface NodeBatchCreateResult {
    results:  NodeBatchCreateEntry[];
    failures: NodeBatchCreateEntry[];
    message:  string;
}

export interface NodeModifyResult {
    nodeUuid:        string;
    nodeInfo?:       NodeInfo;
    property?:       string;
    newValue?:       unknown;
    nodeType?:       string;
    appliedChanges?: string[];
    message:         string;
    warning?:        string;
}

export interface NodeDeleteResult {
    deletedUuids: string[];
    message:      string;
}

export interface NodeArrangeResult {
    uuids?:  string[];
    message: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface NodeComponentSpec {
    type:         string;
    properties?:  Record<string, unknown>;
}

export interface NodeTransformSpec {
    position?: { x: number; y: number; z?: number };
    rotation?: { x: number; y: number; z: number };
    scale?:    { x: number; y: number; z: number };
}

export interface NodeCreateSpec {
    name:               string;
    parentUuid?:        string;
    nodeType?:          string;
    siblingIndex?:      number;
    assetUuid?:         string;
    assetPath?:         string;
    components?:        Array<string | NodeComponentSpec>;
    unlinkPrefab?:      boolean;
    keepWorldTransform?: boolean;
    initialTransform?:  NodeTransformSpec;
}

export interface NodeBatchCreateInput {
    parentUuid?: string;
    nodes:       NodeCreateSpec[];
}

export type NodeModifyInput =
    | { action: 'set_property';  uuid: string; property: string; value: unknown }
    | { action: 'set_transform'; uuid: string; position?: { x: number; y: number; z?: number }; rotation?: { x: number; y: number; z: number }; scale?: { x: number; y: number; z: number } }
    | { action: 'reset_property'; uuid: string; path: string }
    | { action: 'reset_transform'; uuid: string };

export type NodeArrangeInput =
    | { action: 'move';      uuid: string; parentUuid: string; siblingIndex?: number }
    | { action: 'duplicate'; uuids: string | string[] }
    | { action: 'copy';      uuids: string | string[] }
    | { action: 'paste';     parentUuid: string; uuids: string | string[]; keepWorldTransform?: boolean }
    | { action: 'cut';       uuids: string | string[] };
