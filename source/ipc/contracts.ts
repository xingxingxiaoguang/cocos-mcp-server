import { MCPServerSettings, ServerStatus } from '../mcp/interface';
import { ToolConfig, ToolConfiguration } from '../tools/interface';

export const IPC_CHANNEL = 'cocos-mcp-server';

export const IPC_MESSAGES = {
    OPEN_PANEL: 'open-panel',
    START_SERVER: 'start-server',
    STOP_SERVER: 'stop-server',
    GET_SERVER_STATUS: 'get-server-status',
    UPDATE_SETTINGS: 'update-settings',
    GET_TOOLS_LIST: 'getToolsList',
    GET_SERVER_SETTINGS: 'get-server-settings',
    GET_TOOL_MANAGER_STATE: 'getToolManagerState',
    CREATE_TOOL_CONFIGURATION: 'createToolConfiguration',
    UPDATE_TOOL_CONFIGURATION: 'updateToolConfiguration',
    DELETE_TOOL_CONFIGURATION: 'deleteToolConfiguration',
    SET_CURRENT_TOOL_CONFIGURATION: 'setCurrentToolConfiguration',
    UPDATE_TOOL_STATUS: 'updateToolStatus',
    UPDATE_TOOL_STATUS_BATCH: 'updateToolStatusBatch',
    EXPORT_TOOL_CONFIGURATION: 'exportToolConfiguration',
    IMPORT_TOOL_CONFIGURATION: 'importToolConfiguration',
    GET_ENABLED_TOOLS: 'getEnabledTools',
} as const;

export const IPC_MESSAGE_METHODS = {
    [IPC_MESSAGES.OPEN_PANEL]: 'openPanel',
    [IPC_MESSAGES.START_SERVER]: 'startServer',
    [IPC_MESSAGES.STOP_SERVER]: 'stopServer',
    [IPC_MESSAGES.GET_SERVER_STATUS]: 'getServerStatus',
    [IPC_MESSAGES.UPDATE_SETTINGS]: 'updateSettings',
    [IPC_MESSAGES.GET_TOOLS_LIST]: 'getToolsList',
    [IPC_MESSAGES.GET_SERVER_SETTINGS]: 'getServerSettings',
    [IPC_MESSAGES.GET_TOOL_MANAGER_STATE]: 'getToolManagerState',
    [IPC_MESSAGES.CREATE_TOOL_CONFIGURATION]: 'createToolConfiguration',
    [IPC_MESSAGES.UPDATE_TOOL_CONFIGURATION]: 'updateToolConfiguration',
    [IPC_MESSAGES.DELETE_TOOL_CONFIGURATION]: 'deleteToolConfiguration',
    [IPC_MESSAGES.SET_CURRENT_TOOL_CONFIGURATION]: 'setCurrentToolConfiguration',
    [IPC_MESSAGES.UPDATE_TOOL_STATUS]: 'updateToolStatus',
    [IPC_MESSAGES.UPDATE_TOOL_STATUS_BATCH]: 'updateToolStatusBatch',
    [IPC_MESSAGES.EXPORT_TOOL_CONFIGURATION]: 'exportToolConfiguration',
    [IPC_MESSAGES.IMPORT_TOOL_CONFIGURATION]: 'importToolConfiguration',
    [IPC_MESSAGES.GET_ENABLED_TOOLS]: 'getEnabledTools',
} as const;

export interface ToolStatusUpdate {
    category: string;
    name: string;
    enabled: boolean;
}

export interface ToolManagerState {
    success: boolean;
    selectedConfigId: string;
    currentConfiguration: ToolConfiguration | null;
    configurations: ToolConfiguration[];
    availableTools: ToolConfig[];
    maxConfigSlots: number;
}

export interface CreateToolConfigurationResult {
    success: boolean;
    id: string;
    config: ToolConfiguration;
}

export interface ExportToolConfigurationResult {
    configJson: string;
}

export interface OperationResult {
    success: boolean;
}

export interface ServerStatusPayload extends ServerStatus {
    settings: MCPServerSettings;
}

export const TOOL_MANAGER_STATE_KEYS: Array<keyof ToolManagerState> = [
    'success',
    'selectedConfigId',
    'currentConfiguration',
    'configurations',
    'availableTools',
    'maxConfigSlots',
];

export function createToolManagerState(input: Omit<ToolManagerState, 'success'>): ToolManagerState {
    return {
        success: true,
        selectedConfigId: input.selectedConfigId,
        currentConfiguration: input.currentConfiguration,
        configurations: input.configurations,
        availableTools: input.availableTools,
        maxConfigSlots: input.maxConfigSlots,
    };
}
