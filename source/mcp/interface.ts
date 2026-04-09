export interface MCPServerSettings {
    port: number;
    autoStart: boolean;
    enableDebugLog: boolean;
    allowedOrigins: string[];
    maxConnections: number;
}

export interface ServerStatus {
    running: boolean;
    port: number;
    clients: number;
}

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: any;
}

export interface ToolResponse {
    success: boolean;
    data?: any;
    message?: string;
    error?: string;
    errorCode?: string;
    instruction?: string;
    warning?: string;
    verificationData?: any;
    updatedProperties?: string[];
}

export interface MCPClient {
    id: string;
    lastActivity: Date;
    userAgent?: string;
}

export interface ToolExecutor {
    getTools(): ToolDefinition[];
    execute(toolName: string, args: any): Promise<ToolResponse>;
}
