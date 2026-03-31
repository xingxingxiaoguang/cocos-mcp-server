import { MCPServerSettings, ToolConfig, ToolConfiguration, ToolDefinition } from '../types';
import {
    CreateToolConfigurationResult,
    ExportToolConfigurationResult,
    IPC_CHANNEL,
    IPC_MESSAGES,
    OperationResult,
    ServerStatusPayload,
    ToolManagerState,
    ToolStatusUpdate,
} from './contracts';

export interface PanelServerSettingsInput {
    port: number;
    autoStart: boolean;
    maxConnections: number;
    debugLog?: boolean;
    enableDebugLog?: boolean;
    allowedOrigins?: string[];
}

function request<T>(message: string, ...args: any[]): Promise<T> {
    return Editor.Message.request(IPC_CHANNEL, message, ...args) as Promise<T>;
}

function normalizeServerSettings(settings: PanelServerSettingsInput): MCPServerSettings {
    return {
        port: settings.port,
        autoStart: settings.autoStart,
        enableDebugLog: settings.enableDebugLog ?? settings.debugLog ?? false,
        allowedOrigins: settings.allowedOrigins ?? ['*'],
        maxConnections: settings.maxConnections,
    };
}

export function openPanel(): Promise<void> {
    return request<void>(IPC_MESSAGES.OPEN_PANEL);
}

export function startServer(): Promise<void> {
    return request<void>(IPC_MESSAGES.START_SERVER);
}

export function stopServer(): Promise<void> {
    return request<void>(IPC_MESSAGES.STOP_SERVER);
}

export function getServerStatus(): Promise<ServerStatusPayload> {
    return request<ServerStatusPayload>(IPC_MESSAGES.GET_SERVER_STATUS);
}

export function updateSettings(settings: PanelServerSettingsInput): Promise<void> {
    return request<void>(IPC_MESSAGES.UPDATE_SETTINGS, normalizeServerSettings(settings));
}

export function getToolsList(): Promise<ToolDefinition[]> {
    return request<ToolDefinition[]>(IPC_MESSAGES.GET_TOOLS_LIST);
}

export function getServerSettings(): Promise<MCPServerSettings> {
    return request<MCPServerSettings>(IPC_MESSAGES.GET_SERVER_SETTINGS);
}

export function getToolManagerState(): Promise<ToolManagerState> {
    return request<ToolManagerState>(IPC_MESSAGES.GET_TOOL_MANAGER_STATE);
}

export function createToolConfiguration(name: string, description?: string): Promise<CreateToolConfigurationResult> {
    return request<CreateToolConfigurationResult>(IPC_MESSAGES.CREATE_TOOL_CONFIGURATION, name, description);
}

export function updateToolConfiguration(
    configId: string,
    updates: Partial<ToolConfiguration>,
): Promise<ToolConfiguration> {
    return request<ToolConfiguration>(IPC_MESSAGES.UPDATE_TOOL_CONFIGURATION, configId, updates);
}

export function deleteToolConfiguration(configId: string): Promise<OperationResult> {
    return request<OperationResult>(IPC_MESSAGES.DELETE_TOOL_CONFIGURATION, configId);
}

export function setCurrentToolConfiguration(configId: string): Promise<OperationResult> {
    return request<OperationResult>(IPC_MESSAGES.SET_CURRENT_TOOL_CONFIGURATION, configId);
}

export function updateToolStatus(
    configId: string,
    category: string,
    name: string,
    enabled: boolean,
): Promise<OperationResult> {
    return request<OperationResult>(IPC_MESSAGES.UPDATE_TOOL_STATUS, configId, category, name, enabled);
}

export function updateToolStatusBatch(
    configId: string,
    updates: ToolStatusUpdate[],
): Promise<OperationResult> {
    return request<OperationResult>(IPC_MESSAGES.UPDATE_TOOL_STATUS_BATCH, configId, updates);
}

export function exportToolConfiguration(configId: string): Promise<ExportToolConfigurationResult> {
    return request<ExportToolConfigurationResult>(IPC_MESSAGES.EXPORT_TOOL_CONFIGURATION, configId);
}

export function importToolConfiguration(configJson: string): Promise<ToolConfiguration> {
    return request<ToolConfiguration>(IPC_MESSAGES.IMPORT_TOOL_CONFIGURATION, configJson);
}

export function getEnabledTools(): Promise<ToolConfig[]> {
    return request<ToolConfig[]>(IPC_MESSAGES.GET_ENABLED_TOOLS);
}
