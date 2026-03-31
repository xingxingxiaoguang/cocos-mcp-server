export interface MCPServerSettings {
    port: number;
    autoStart: boolean;
    enableDebugLog: boolean;
    allowedOrigins: string[];
    maxConnections: number;
}

export interface ToolConfig {
    category: string;
    name: string;
    enabled: boolean;
    description: string;
}

export interface ToolConfiguration {
    id: string;
    name: string;
    description?: string;
    tools: ToolConfig[];
    createdAt: string;
    updatedAt: string;
}

export interface ToolManagerSettings {
    configurations: ToolConfiguration[];
    currentConfigId: string;
    maxConfigSlots: number;
}

export interface ToolManagerState {
    availableTools: ToolConfig[];
    currentConfiguration: ToolConfiguration | null;
    configurations: ToolConfiguration[];
}
