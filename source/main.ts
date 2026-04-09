import { MCPServerSettings } from './mcp/interface';
import { ToolManager } from './tools/tool-manager';
import { ToolStatusUpdate } from './ipc/contracts';
import { ServerController } from './services/server-controller';
import { SettingsRepository } from './services/settings-repository';
import { ToolConfigService } from './services/tool-config-service';

let serverController: ServerController;
let toolManager: ToolManager;

/**
 * @en Registration method for the main process of Extension
 * @zh 为扩展的主进程的注册方法
 */
export const methods: { [key: string]: (...any: any) => any } = {
    /**
     * @en Open the MCP server panel
     * @zh 打开 MCP 服务器面板
     */
    openPanel() {
        Editor.Panel.open('cocos-mcp-server');
    },



    /**
     * @en Start the MCP server
     * @zh 启动 MCP 服务器
     */
    async startServer() {
        await serverController.start();
    },

    /**
     * @en Stop the MCP server
     * @zh 停止 MCP 服务器
     */
    async stopServer() {
        serverController.stop();
    },

    /**
     * @en Get server status
     * @zh 获取服务器状态
     */
    getServerStatus() {
        const status = serverController.getStatus();
        const settings = serverController.getSettings();
        return {
            ...status,
            settings: settings
        };
    },

    /**
     * @en Update server settings
     * @zh 更新服务器设置
     */
    async updateSettings(settings: MCPServerSettings) {
        await serverController.updateSettings(settings);
    },

    /**
     * @en Get tools list
     * @zh 获取工具列表
     */
    getToolsList() {
        return serverController.getAvailableTools();
    },

    /**
     * @en Get server settings
     * @zh 获取服务器设置
     */
    async getServerSettings() {
        return serverController.getSettings();
    },

    // 工具管理器相关方法
    async getToolManagerState() {
        return toolManager.getToolManagerState();
    },

    async createToolConfiguration(name: string, description?: string) {
        try {
            const config = toolManager.createConfiguration(name, description);
            serverController.syncEnabledTools();
            return { success: true, id: config.id, config };
        } catch (error: any) {
            throw new Error(`创建配置失败: ${error.message}`);
        }
    },

    async updateToolConfiguration(configId: string, updates: any) {
        try {
            const config = toolManager.updateConfiguration(configId, updates);
            serverController.syncEnabledTools();
            return config;
        } catch (error: any) {
            throw new Error(`更新配置失败: ${error.message}`);
        }
    },

    async deleteToolConfiguration(configId: string) {
        try {
            toolManager.deleteConfiguration(configId);
            serverController.syncEnabledTools();
            return { success: true };
        } catch (error: any) {
            throw new Error(`删除配置失败: ${error.message}`);
        }
    },

    async setCurrentToolConfiguration(configId: string) {
        try {
            toolManager.setCurrentConfiguration(configId);
            serverController.syncEnabledTools();
            return { success: true };
        } catch (error: any) {
            throw new Error(`设置当前配置失败: ${error.message}`);
        }
    },

    async updateToolStatus(configId: string, category: string, toolName: string, enabled: boolean) {
        try {
            toolManager.updateToolStatus(configId, category, toolName, enabled);
            serverController.syncEnabledTools();
            return { success: true };
        } catch (error: any) {
            throw new Error(`更新工具状态失败: ${error.message}`);
        }
    },

    async updateToolStatusBatch(configId: string, updates: ToolStatusUpdate[]) {
        try {
            toolManager.updateToolStatusBatch(configId, updates);
            serverController.syncEnabledTools();
            return { success: true };
        } catch (error: any) {
            throw new Error(`批量更新工具状态失败: ${error.message}`);
        }
    },

    async exportToolConfiguration(configId: string) {
        try {
            return { configJson: toolManager.exportConfiguration(configId) };
        } catch (error: any) {
            throw new Error(`导出配置失败: ${error.message}`);
        }
    },

    async importToolConfiguration(configJson: string) {
        try {
            const config = toolManager.importConfiguration(configJson);
            serverController.syncEnabledTools();
            return config;
        } catch (error: any) {
            throw new Error(`导入配置失败: ${error.message}`);
        }
    },

    async getEnabledTools() {
        return toolManager.getEnabledTools();
    }
};

/**
 * @en Method Triggered on Extension Startup
 * @zh 扩展启动时触发的方法
 */
export function load() {
    console.log('Cocos MCP Server extension loaded');

    const settingsRepository = new SettingsRepository();
    const toolConfigService = new ToolConfigService(settingsRepository);
    toolManager = new ToolManager(toolConfigService);
    serverController = new ServerController(settingsRepository, toolConfigService);

    if (serverController.getSettings().autoStart) {
        serverController.start().catch(err => {
            console.error('Failed to auto-start MCP server:', err);
        });
    }
}

/**
 * @en Method triggered when uninstalling the extension
 * @zh 卸载扩展时触发的方法
 */
export function unload() {
    serverController?.stop();
}
