export interface ComponentCapability {
    // Queries
    getComponentDetail(uuid: string, componentType: string): Promise<ComponentDetail>;
    listNodeComponents(uuid: string): Promise<ComponentListResult>;
    listAvailableTypes(category?: string): Promise<AvailableTypesResult>;
    listClasses(extendsClass?: string): Promise<ClassListResult>;
    listSceneComponents(): Promise<SceneComponentListResult>;
    hasScript(scriptPath: string): Promise<ScriptCheckResult>;

    // Mutations
    add(input: ComponentAddInput): Promise<ComponentAddResult>;
    modify(input: ComponentModifyInput): Promise<ComponentModifyResult>;
    batchSet(input: ComponentBatchSetInput): Promise<ComponentBatchSetResult>;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface ComponentInfo {
    type:        string;
    enabled:     boolean;
    properties?: Record<string, unknown>;
}

export interface ComponentDetail extends ComponentInfo {
    componentType: string;
}

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface ComponentListResult {
    nodeUuid:   string;
    components: ComponentInfo[];
}

export interface AvailableTypesResult {
    category: string;
    types:    string[];
}

export interface ClassListResult {
    classes:        string[];
    count:          number;
    extendsFilter?: string;
}

export interface SceneComponentListResult {
    components: Array<{ cid: string; name: string; [key: string]: unknown }>;
    count:      number;
}

export interface ScriptCheckResult {
    className: string;
    hasScript: boolean;
    message:   string;
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface ComponentAddResult {
    nodeUuid:      string;
    componentType: string;
    cid?:          string;
    existing:      boolean;
    message:       string;
    warning?:      string;
}

export interface ComponentModifyResult {
    message:         string;
    warning?:        string;
    // set action
    nodeUuid?:       string;
    componentType?:  string;
    property?:       string;
    actualValue?:    unknown;
    changeVerified?: boolean;
    // remove action
    removedIndex?:   number;
    // execute action
    executionResult?: unknown;
}

export interface ComponentBatchSetEntry {
    componentType: string;
    property:      string;
    propertyType?: string | null;
    success:       boolean;
    message?:      string;
    error?:        string;
    data?:         unknown;
}

export interface ComponentBatchSetResult {
    nodeUuid: string;
    results:  ComponentBatchSetEntry[];
    failures: ComponentBatchSetEntry[];
    message:  string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ComponentAddInput {
    uuid:          string;
    componentType: string;
}

export interface ComponentBatchSetInputEntry {
    componentType: string;
    properties:    Record<string, unknown>;
}

export interface ComponentBatchSetInput {
    uuid:            string;
    batch:           ComponentBatchSetInputEntry[];
    continueOnError?: boolean;
}

export type ComponentModifyInput =
    | { action: 'set';    uuid: string; componentType: string; property: string; value: unknown; propertyType?: string }
    | { action: 'remove'; uuid: string; componentType: string }
    | { action: 'remove_array_element'; uuid: string; path: string; index: number }
    | { action: 'reset';  uuid: string; componentType: string }
    | { action: 'call';   uuid: string; component: string; method: string; args?: unknown[] };
