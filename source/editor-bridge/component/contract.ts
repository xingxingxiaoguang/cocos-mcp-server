export interface ComponentBridgeDriver {
    // 低层级 IPC 操作
    createComponent(input: ComponentCreateInput): Promise<ComponentCreateResult>;
    removeArrayElement(input: RemoveArrayElementInput): Promise<void>;
    resetComponent(input: ComponentResetInput): Promise<void>;
    executeComponentMethod(input: ComponentMethodInput): Promise<unknown>;
    setProperty(input: ComponentSetPropertyInput): Promise<void>;

    // 查询操作（含 Cocos 格式归一化）
    queryNodeComponents(nodeUuid: string): Promise<ComponentQueryResult>;
    queryComponentInfo(nodeUuid: string, componentType: string): Promise<ComponentDetailResult | null>;
    queryAvailableComponents(category: string): Promise<AvailableComponentsResult>;
    querySceneClasses(extendsClass?: string): Promise<SceneClassesResult>;
    querySceneComponents(): Promise<SceneComponentsResult>;
    queryComponentHasScript(className: string): Promise<ComponentHasScriptResult>;

    // 属性设置（含完整的 Cocos 类型转换与路径构造）
    applyComponentProperty(input: ApplyPropertyInput): Promise<ApplyPropertyResult>;

    // Sprite 默认状态设置
    ensureDefaultSpriteState(nodeUuid: string): Promise<SpriteStateResult>;

    // 属性变更验证
    verifyPropertyChange(
        nodeUuid: string,
        componentType: string,
        property: string,
        originalValue: unknown,
        expectedValue: unknown,
    ): Promise<PropertyVerificationResult>;

    // 组件匹配工具
    isComponentOnNode(components: NormalizedComponent[], componentType: string): NormalizedComponent | undefined;
    countComponentOnNode(components: NormalizedComponent[], componentType: string): number;
    generateComponentSuggestion(requestedType: string, availableTypes: string[], property: string): string;
}

// ---------------------------------------------------------------------------
// 低层级 IPC 输入/输出类型
// ---------------------------------------------------------------------------

export interface ComponentCreateInput {
    uuid:      string;
    component: string;
}

export interface ComponentCreateResult {
    uuid?:           string;
    componentType?:  string;
    componentName?:  string;
    type?:           string;
    [key: string]:   unknown;
}

export interface RemoveArrayElementInput {
    uuid:  string;
    path:  string;
    index: number;
}

export interface ComponentResetInput {
    uuid:           string;
    componentType?: string;
}

export interface ComponentMethodInput {
    uuid:      string;
    component: string;
    method:    string;
    args?:     unknown[];
}

export interface ComponentSetPropertyInput {
    uuid: string;
    path: string;
    dump: { value: unknown; type?: string };
}

// ---------------------------------------------------------------------------
// 归一化后的组件类型（查询结果）
// ---------------------------------------------------------------------------

export interface NormalizedComponent {
    type:        string;
    cid?:        string;
    uuid:        string | null;
    enabled:     boolean;
    properties:  Record<string, unknown>;
}

export interface ComponentQueryResult {
    nodeUuid:    string;
    components:  NormalizedComponent[];
}

export interface ComponentDetailResult extends NormalizedComponent {
    nodeUuid: string;
}

export interface AvailableComponentsResult {
    category:   string;
    components: string[];
}

export interface SceneClassesResult {
    classes: string[];
    count:   number;
    extendsFilter?: string;
}

export interface SceneComponentsResult {
    components: Array<{ cid: string; name: string; [key: string]: unknown }>;
    count:      number;
}

export interface ComponentHasScriptResult {
    className: string;
    hasScript: boolean;
    message:   string;
}

// ---------------------------------------------------------------------------
// 属性设置相关类型
// ---------------------------------------------------------------------------

export interface ApplyPropertyInput {
    nodeUuid:       string;
    componentType:  string;
    property:       string;
    value:          unknown;
    propertyType?:  string;
}

export interface ApplyPropertyResult {
    success:      boolean;
    message?:     string;
    error?:       string;
    instruction?: string;
    data?: {
        nodeUuid:       string;
        componentType:  string;
        property:       string;
        actualValue?:   unknown;
        changeVerified: boolean;
    };
}

export interface PropertyVerificationResult {
    verified:    boolean;
    actualValue: unknown;
    fullData:    unknown;
}

// ---------------------------------------------------------------------------
// Sprite 默认状态
// ---------------------------------------------------------------------------

export interface SpriteStateResult {
    warning?: string;
}
