import { ToolResponse } from '../../mcp/interface';
import { ComponentInfo } from '../component/interface';

export interface NodeInfo {
    uuid: string;
    name: string;
    active: boolean;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
    parent?: string;
    children?: string[];
    components?: ComponentInfo[];
    layer?: number;
    mobility?: number;
}

export interface NodeCapability {
    query(args: any): Promise<ToolResponse>;
    create(args: any): Promise<ToolResponse>;
    batchCreate(args: any): Promise<ToolResponse>;
    modify(args: any): Promise<ToolResponse>;
    delete(args: any): Promise<ToolResponse>;
    arrange(args: any): Promise<ToolResponse>;
}
