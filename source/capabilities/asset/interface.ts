import { ToolResponse } from '../../mcp/interface';

export interface AssetInfo {
    name: string;
    uuid: string;
    path: string;
    type: string;
    size?: number;
    isDirectory: boolean;
    meta?: {
        ver: string;
        importer: string;
    };
}

export interface AssetCapability {
    query(args: any): Promise<ToolResponse>;
    create(args: any): Promise<ToolResponse>;
    modify(args: any): Promise<ToolResponse>;
    delete(args: any): Promise<ToolResponse>;
    refresh(args: any): Promise<ToolResponse>;
}
