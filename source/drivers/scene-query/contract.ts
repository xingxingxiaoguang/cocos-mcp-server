// ---------------------------------------------------------------------------
// SceneQueryDriver — 只读，供 NodeService / ComponentService 共用
// ---------------------------------------------------------------------------

export interface SceneQueryDriver {
    // scene channel — 只读查询
    queryNode(uuid: string): Promise<CocosNodeDump>;
    queryNodeTree(): Promise<NodeTreeItem | NodeTreeItem[]>;
    queryCurrentScene(): Promise<NodeTreeItem>;
    queryNodesByAssetUuid(assetUuid: string): Promise<string[]>;
    queryComponents(): Promise<ComponentTypeRecord[]>;
    queryComponentFunctionsOfNode(nodeUuid: string): Promise<ComponentFunctionRecord[]>;
    executeSceneScript<T = unknown>(method: string, args: unknown[]): Promise<T>;

    // asset-db channel — 只读，node/component 用到的资产查询
    queryAssetInfo(assetPath: string): Promise<SceneAssetInfo | null>;
    queryAssets(query: SceneAssetQueryInput): Promise<SceneAssetInfo[]>;
    queryAssetUrl(uuid: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// 归一化后的领域类型（定义在 capabilities 层，此处 re-export 供 bridge 内部使用）
// ---------------------------------------------------------------------------

export type { ComponentInfo } from '../../capabilities/component/interface';
export type { NodeInfo } from '../../capabilities/node/interface';

// ---------------------------------------------------------------------------
// Cocos 编辑器原始属性包装格式
// ---------------------------------------------------------------------------

export interface CocosPropertyDump<T> {
    value: T;
    type?: string;
    readonly?: boolean;
}

export interface CocosVec3 {
    x: number;
    y: number;
    z: number;
}

// ---------------------------------------------------------------------------
// query-node 返回的原始节点 dump（带属性包装）
// ---------------------------------------------------------------------------

export interface CocosComponentRef {
    __type__?: string;
    cid?:      string;
    type?:     string;
    enabled:   CocosPropertyDump<boolean>;
    [key: string]: unknown;
}

export interface CocosNodeDump {
    uuid:      CocosPropertyDump<string>;
    name:      CocosPropertyDump<string>;
    active:    CocosPropertyDump<boolean>;
    position:  CocosPropertyDump<CocosVec3>;
    rotation:  CocosPropertyDump<CocosVec3>;
    scale:     CocosPropertyDump<CocosVec3>;
    parent:    CocosPropertyDump<{ uuid: CocosPropertyDump<string> } | null>;
    children:  Array<{ uuid: CocosPropertyDump<string>; name: CocosPropertyDump<string> }>;
    __comps__: CocosComponentRef[];
    layer?:    CocosPropertyDump<number>;
    mobility?: CocosPropertyDump<number>;
}

// ---------------------------------------------------------------------------
// query-node-tree 返回的轻量节点树结构
// ---------------------------------------------------------------------------

export interface NodeTreeItem {
    uuid:        string;
    name:        string;
    active:      boolean;
    children:    NodeTreeItem[];
    components?: Array<{ cid?: string; type?: string }>;
}

// ---------------------------------------------------------------------------
// Asset 查询（asset-db channel，node/component 均共用）
// ---------------------------------------------------------------------------

export interface SceneAssetInfo {
    uuid: string;
    name: string;
    path: string;
    type: string;
    url?: string;
}

export interface SceneAssetQueryInput {
    pattern?: string;
    type?:    string;
    cc_type?: string;
}

// ---------------------------------------------------------------------------
// Component 元数据
// ---------------------------------------------------------------------------

export interface ComponentTypeRecord {
    cid:  string;
    name: string;
    [key: string]: unknown;
}

export interface ComponentFunctionRecord {
    cid:  string;
    name: string;
    [key: string]: unknown;
}
