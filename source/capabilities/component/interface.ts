import { ToolResponse } from '../../mcp/interface';

export type { ComponentInfo } from '../../editor-bridge/scene-query/contract';

// ---------------------------------------------------------------------------
// ComponentCapability input types
// ---------------------------------------------------------------------------

export interface ComponentQueryInput {
    uuid?:         string;
    componentType?: string;
    action?:       'available' | 'classes' | 'scene_components' | 'has_script';
    category?:     string;
    extends?:      string;
    scriptPath?:   string;
    className?:    string;
}

export interface ComponentAddInput {
    uuid:          string;
    componentType: string;
}

export interface ComponentBatchSetEntry {
    componentType: string;
    properties:    Record<string, unknown>;
}

export interface ComponentBatchSetInput {
    uuid:            string;
    batch:           ComponentBatchSetEntry[];
    continueOnError?: boolean;
}

export type ComponentModifyInput =
    | { action: 'set';    uuid: string; componentType: string; property: string; value: unknown }
    | { action: 'remove'; uuid: string; componentType: string }
    | { action: 'remove_array_element'; uuid: string; path: string; index: number }
    | { action: 'reset';  uuid: string; componentType: string }
    | { action: 'call';   uuid: string; component: string; method: string; args?: unknown[] };

// ---------------------------------------------------------------------------
// ComponentCapability interface
// ---------------------------------------------------------------------------

export interface ComponentCapability {
    query(input: ComponentQueryInput): Promise<ToolResponse>;
    add(input: ComponentAddInput): Promise<ToolResponse>;
    modify(input: ComponentModifyInput): Promise<ToolResponse>;
    batchSet(input: ComponentBatchSetInput): Promise<ToolResponse>;
}
