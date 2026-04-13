import { ToolResponse } from '../../mcp/interface';
import type { ComponentInfo } from '../component/interface';

export interface NodeCapability {
    query(input: NodeQueryInput): Promise<ToolResponse>;
    create(spec: NodeCreateSpec): Promise<ToolResponse>;
    batchCreate(input: NodeBatchCreateInput): Promise<ToolResponse>;
    modify(input: NodeModifyInput): Promise<ToolResponse>;
    delete(uuids: string | string[]): Promise<ToolResponse>;
    arrange(input: NodeArrangeInput): Promise<ToolResponse>;
}

// ---------------------------------------------------------------------------
// Types
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

export interface NodeQueryInput {
    uuid?:       string;
    pattern?:    string;
    assetUuid?:  string;
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
