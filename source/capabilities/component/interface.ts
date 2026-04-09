import { ToolResponse } from '../../mcp/interface';

export interface ComponentInfo {
    type: string;
    enabled: boolean;
    properties?: Record<string, any>;
}

export interface ComponentCapability {
    query(args: any): Promise<ToolResponse>;
    add(args: any): Promise<ToolResponse>;
    modify(args: any): Promise<ToolResponse>;
    batchSet(args: any): Promise<ToolResponse>;
}
