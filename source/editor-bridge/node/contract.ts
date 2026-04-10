// NodeBridgeDriver — 仅节点变更操作（查询由 SceneQueryDriver 提供）

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

export interface NodeBridgeDriver {
    createNode(input: NodeCreateInput): Promise<string>;          // 返回 uuid
    setParent(input: NodeSetParentInput): Promise<void>;
    setProperty(input: NodeSetPropertyInput): Promise<void>;
    resetProperty(input: NodeResetPropertyInput): Promise<void>;
    resetNode(uuid: string): Promise<void>;
    removeNode(uuid: string): Promise<void>;
    duplicateNode(uuid: string): Promise<string>;                 // 返回新 uuid
    copyNode(uuids: string[]): Promise<string[]>;
    pasteNode(input: NodePasteInput): Promise<string[]>;
    cutNode(uuids: string[]): Promise<string[]>;
}
