import { NodeInfo } from '../scene-query/contract';

export { NodeInfo };

export interface NodeBridgeDriver {
    // 低层级 IPC 操作
    createNode(input: NodeCreateInput): Promise<string>;
    setParent(input: NodeSetParentInput): Promise<void>;
    setProperty(input: NodeSetPropertyInput): Promise<void>;
    resetProperty(input: NodeResetPropertyInput): Promise<void>;
    resetNode(uuid: string): Promise<void>;
    removeNode(uuid: string): Promise<void>;
    duplicateNode(uuid: string): Promise<string>;
    copyNode(uuids: string[]): Promise<string[]>;
    pasteNode(input: NodePasteInput): Promise<string[]>;
    cutNode(uuids: string[]): Promise<string[]>;

    // 查询操作（含 Cocos 格式归一化）
    queryNodeInfo(uuid: string): Promise<NodeInfo>;
    searchNodes(pattern: string): Promise<NodeSearchResult[]>;
    flattenNodes(): Promise<FlattenedNode[]>;
    queryNodesByAssetUuid(assetUuid: string): Promise<string[]>;

    // 父节点 / 资产解析
    resolveParentUuid(parentUuid?: string): Promise<string | undefined>;
    resolveAssetUuid(assetPath: string): Promise<string | null>;

    // 变换归一化
    normalizeTransformValue(value: TransformInput, type: TransformType, is2D: boolean): NormalizedTransform;

    // 内联组件属性批量构建
    buildInlineComponentPropertyBatch(input: InlineComponentPropertyBatchInput): Record<string, unknown>;

    // Sprite 默认帧解析
    resolveDefaultSpriteFrameUuid(): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// 低层级 IPC 输入类型
// ---------------------------------------------------------------------------

export interface NodeCreateInput {
    name:               string;
    parent?:            string;
    assetUuid?:         string;
    components?:        string[];
    unlinkPrefab?:      boolean;
    keepWorldTransform?: boolean;
}

export interface NodeSetPropertyInput {
    uuid: string;
    path: string;
    dump: { value: unknown };
}

export interface NodeResetPropertyInput {
    uuid:  string;
    path:  string;
    dump?: { value: unknown };
}

export interface NodeSetParentInput {
    uuids:               string[];
    parent:              string;
    keepWorldTransform:  boolean;
}

export interface NodePasteInput {
    target:              string;
    uuids:               string | string[];
    keepWorldTransform:  boolean;
}

// ---------------------------------------------------------------------------
// 查询结果类型
// ---------------------------------------------------------------------------

export interface NodeSearchResult {
    uuid: string;
    name: string;
    path: string;
}

export interface FlattenedNode {
    uuid:   string;
    name:   string;
    type:   unknown;
    active: unknown;
    path:   string;
}

// ---------------------------------------------------------------------------
// 变换归一化类型
// ---------------------------------------------------------------------------

export type TransformType = 'position' | 'rotation' | 'scale';

export interface TransformInput {
    x?: number;
    y?: number;
    z?: number;
}

export interface NormalizedTransform {
    value:    { x: number; y: number; z: number };
    warning?: string;
}

// ---------------------------------------------------------------------------
// 内联组件属性批量构建
// ---------------------------------------------------------------------------

export interface InlineComponentPropertyBatchInput {
    requestedType:          string;
    actualType:             string;
    properties:             Record<string, unknown>;
    defaultSpriteFrameUuid: string | null;
}
