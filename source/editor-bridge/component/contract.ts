// ComponentBridgeDriver — 仅组件变更操作（查询由 SceneQueryDriver 提供）

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

export interface ComponentBridgeDriver {
    createComponent(input: ComponentCreateInput): Promise<ComponentCreateResult>;
    removeArrayElement(input: RemoveArrayElementInput): Promise<void>;
    resetComponent(input: ComponentResetInput): Promise<void>;
    executeComponentMethod(input: ComponentMethodInput): Promise<unknown>;
    setProperty(input: ComponentSetPropertyInput): Promise<void>;
}
