import { v4 as uuidv4 } from 'uuid';
import { ToolConfig, ToolConfiguration, ToolManagerSettings, ToolDefinition } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export class ToolManager {
    private settings: ToolManagerSettings;
    private availableTools: ToolConfig[] = [];

    constructor() {
        this.settings = this.readToolManagerSettings();
        this.initializeAvailableTools();
        
        // 如果没有配置，自动创建一个默认配置
        if (this.settings.configurations.length === 0) {
            console.log('[ToolManager] No configurations found, creating default configuration...');
            this.createConfiguration('默认配置', '自动创建的默认工具配置');
        }
    }

    private getToolManagerSettingsPath(): string {
        return path.join(Editor.Project.path, 'settings', 'tool-manager.json');
    }

    private ensureSettingsDir(): void {
        const settingsDir = path.dirname(this.getToolManagerSettingsPath());
        if (!fs.existsSync(settingsDir)) {
            fs.mkdirSync(settingsDir, { recursive: true });
        }
    }

    private readToolManagerSettings(): ToolManagerSettings {
        const DEFAULT_TOOL_MANAGER_SETTINGS: ToolManagerSettings = {
            configurations: [],
            currentConfigId: '',
            maxConfigSlots: 5
        };

        try {
            this.ensureSettingsDir();
            const settingsFile = this.getToolManagerSettingsPath();
            if (fs.existsSync(settingsFile)) {
                const content = fs.readFileSync(settingsFile, 'utf8');
                return { ...DEFAULT_TOOL_MANAGER_SETTINGS, ...JSON.parse(content) };
            }
        } catch (e) {
            console.error('Failed to read tool manager settings:', e);
        }
        return DEFAULT_TOOL_MANAGER_SETTINGS;
    }

    private saveToolManagerSettings(settings: ToolManagerSettings): void {
        try {
            this.ensureSettingsDir();
            const settingsFile = this.getToolManagerSettingsPath();
            fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
        } catch (e) {
            console.error('Failed to save tool manager settings:', e);
            throw e;
        }
    }

    private exportToolConfiguration(config: ToolConfiguration): string {
        return JSON.stringify(config, null, 2);
    }

    private importToolConfiguration(configJson: string): ToolConfiguration {
        try {
            const config = JSON.parse(configJson);
            // 验证配置格式
            if (!config.id || !config.name || !Array.isArray(config.tools)) {
                throw new Error('Invalid configuration format');
            }
            return config;
        } catch (e) {
            console.error('Failed to parse tool configuration:', e);
            throw new Error('Invalid JSON format or configuration structure');
        }
    }

    private initializeAvailableTools(): void {
        try {
            const { SceneToolsV2 } = require('./v2/scene-tools');
            const { NodeToolsV2 } = require('./v2/node-tools');
            const { ComponentToolsV2 } = require('./v2/component-tools');
            const { PrefabToolsV2 } = require('./v2/prefab-tools');
            const { AssetToolsV2 } = require('./v2/asset-tools');
            const { DebugToolsV2 } = require('./v2/debug-tools');
            const { ProjectToolsV2 } = require('./v2/project-tools');
            const { PreferencesToolsV2 } = require('./v2/preferences-tools');
            const { UndoToolsV2 } = require('./v2/undo-tools');
            const { SceneScriptToolsV2 } = require('./v2/scene-script-tools');
            const { ArrayPropertyToolsV2 } = require('./v2/array-property-tools');

            const tools = {
                scene: new SceneToolsV2(),
                node: new NodeToolsV2(),
                component: new ComponentToolsV2(),
                prefab: new PrefabToolsV2(),
                asset: new AssetToolsV2(),
                debug: new DebugToolsV2(),
                project: new ProjectToolsV2(),
                preferences: new PreferencesToolsV2(),
                undo: new UndoToolsV2(),
                sceneScript: new SceneScriptToolsV2(),
                array: new ArrayPropertyToolsV2()
            };

            this.availableTools = [];
            for (const [category, toolSet] of Object.entries(tools)) {
                const toolDefinitions = toolSet.getTools();
                toolDefinitions.forEach((tool: any) => {
                    this.availableTools.push({
                        category: category,
                        name: tool.name,
                        enabled: true,
                        description: tool.description
                    });
                });
            }

            console.log(`[ToolManager] Initialized ${this.availableTools.length} v2 tools from MCP server`);
        } catch (error) {
            console.error('[ToolManager] Failed to initialize v2 tools from MCP server:', error);
            this.initializeDefaultTools();
        }
    }

    private initializeDefaultTools(): void {
        const toolCategories = [
            { category: 'scene', tools: [
                { name: 'query', description: '查询场景信息和层级结构' },
                { name: 'open', description: '打开/加载场景' },
                { name: 'save', description: '保存场景' },
                { name: 'create', description: '创建新场景' },
                { name: 'manage', description: '场景管理操作' }
            ]},
            { category: 'node', tools: [
                { name: 'query', description: '查询节点信息' },
                { name: 'create', description: '创建节点' },
                { name: 'modify', description: '修改节点属性' },
                { name: 'delete', description: '删除节点' },
                { name: 'arrange', description: '排列节点' }
            ]},
            { category: 'component', tools: [
                { name: 'query', description: '查询组件信息' },
                { name: 'add', description: '添加组件' },
                { name: 'modify', description: '修改组件属性' }
            ]},
            { category: 'prefab', tools: [
                { name: 'query', description: '查询预制体信息' },
                { name: 'create', description: '创建预制体' },
                { name: 'update', description: '更新预制体' }
            ]},
            { category: 'asset', tools: [
                { name: 'query', description: '查询资源信息' },
                { name: 'create', description: '创建/导入资源' },
                { name: 'modify', description: '修改资源' },
                { name: 'delete', description: '删除资源' },
                { name: 'refresh', description: '资源辅助操作' }
            ]},
            { category: 'debug', tools: [
                { name: 'logs', description: '日志查询' },
                { name: 'execute', description: '执行脚本' },
                { name: 'inspect', description: '检查工具' }
            ]},
            { category: 'project', tools: [
                { name: 'query', description: '项目查询' },
                { name: 'build', description: '项目构建' }
            ]},
            { category: 'preferences', tools: [
                { name: 'query', description: '偏好查询' },
                { name: 'modify', description: '偏好修改' }
            ]},
            { category: 'undo', tools: [
                { name: 'recording', description: 'Undo 录制操作' }
            ]},
            { category: 'sceneScript', tools: [
                { name: 'execute', description: '场景脚本执行' }
            ]},
            { category: 'array', tools: [
                { name: 'property', description: '数组属性操作' }
            ]},
        ];

        this.availableTools = [];
        toolCategories.forEach(category => {
            category.tools.forEach(tool => {
                this.availableTools.push({
                    category: category.category,
                    name: tool.name,
                    enabled: true,
                    description: tool.description
                });
            });
        });

        console.log(`[ToolManager] Initialized ${this.availableTools.length} default v2 tools`);
    }

    public getAvailableTools(): ToolConfig[] {
        return [...this.availableTools];
    }

    public getConfigurations(): ToolConfiguration[] {
        return [...this.settings.configurations];
    }

    public getCurrentConfiguration(): ToolConfiguration | null {
        if (!this.settings.currentConfigId) {
            return null;
        }
        return this.settings.configurations.find(config => config.id === this.settings.currentConfigId) || null;
    }

    public createConfiguration(name: string, description?: string): ToolConfiguration {
        if (this.settings.configurations.length >= this.settings.maxConfigSlots) {
            throw new Error(`已达到最大配置槽位数量 (${this.settings.maxConfigSlots})`);
        }

        const config: ToolConfiguration = {
            id: uuidv4(),
            name,
            description,
            tools: this.availableTools.map(tool => ({ ...tool })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.settings.configurations.push(config);
        this.settings.currentConfigId = config.id;
        this.saveSettings();

        return config;
    }

    public updateConfiguration(configId: string, updates: Partial<ToolConfiguration>): ToolConfiguration {
        const configIndex = this.settings.configurations.findIndex(config => config.id === configId);
        if (configIndex === -1) {
            throw new Error('配置不存在');
        }

        const config = this.settings.configurations[configIndex];
        const updatedConfig: ToolConfiguration = {
            ...config,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        this.settings.configurations[configIndex] = updatedConfig;
        this.saveSettings();

        return updatedConfig;
    }

    public deleteConfiguration(configId: string): void {
        const configIndex = this.settings.configurations.findIndex(config => config.id === configId);
        if (configIndex === -1) {
            throw new Error('配置不存在');
        }

        this.settings.configurations.splice(configIndex, 1);
        
        // 如果删除的是当前配置，清空当前配置ID
        if (this.settings.currentConfigId === configId) {
            this.settings.currentConfigId = this.settings.configurations.length > 0 
                ? this.settings.configurations[0].id 
                : '';
        }

        this.saveSettings();
    }

    public setCurrentConfiguration(configId: string): void {
        const config = this.settings.configurations.find(config => config.id === configId);
        if (!config) {
            throw new Error('配置不存在');
        }

        this.settings.currentConfigId = configId;
        this.saveSettings();
    }

    public updateToolStatus(configId: string, category: string, toolName: string, enabled: boolean): void {
        console.log(`Backend: Updating tool status - configId: ${configId}, category: ${category}, toolName: ${toolName}, enabled: ${enabled}`);
        
        const config = this.settings.configurations.find(config => config.id === configId);
        if (!config) {
            console.error(`Backend: Config not found with ID: ${configId}`);
            throw new Error('配置不存在');
        }

        console.log(`Backend: Found config: ${config.name}`);

        const tool = config.tools.find(t => t.category === category && t.name === toolName);
        if (!tool) {
            console.error(`Backend: Tool not found - category: ${category}, name: ${toolName}`);
            throw new Error('工具不存在');
        }

        console.log(`Backend: Found tool: ${tool.name}, current enabled: ${tool.enabled}, new enabled: ${enabled}`);
        
        tool.enabled = enabled;
        config.updatedAt = new Date().toISOString();
        
        console.log(`Backend: Tool updated, saving settings...`);
        this.saveSettings();
        console.log(`Backend: Settings saved successfully`);
    }

    public updateToolStatusBatch(configId: string, updates: { category: string; name: string; enabled: boolean }[]): void {
        console.log(`Backend: updateToolStatusBatch called with configId: ${configId}`);
        console.log(`Backend: Current configurations count: ${this.settings.configurations.length}`);
        console.log(`Backend: Current config IDs:`, this.settings.configurations.map(c => c.id));
        
        const config = this.settings.configurations.find(config => config.id === configId);
        if (!config) {
            console.error(`Backend: Config not found with ID: ${configId}`);
            console.error(`Backend: Available config IDs:`, this.settings.configurations.map(c => c.id));
            throw new Error('配置不存在');
        }

        console.log(`Backend: Found config: ${config.name}, updating ${updates.length} tools`);

        updates.forEach(update => {
            const tool = config.tools.find(t => t.category === update.category && t.name === update.name);
            if (tool) {
                tool.enabled = update.enabled;
            }
        });

        config.updatedAt = new Date().toISOString();
        this.saveSettings();
        console.log(`Backend: Batch update completed successfully`);
    }

    public exportConfiguration(configId: string): string {
        const config = this.settings.configurations.find(config => config.id === configId);
        if (!config) {
            throw new Error('配置不存在');
        }

        return this.exportToolConfiguration(config);
    }

    public importConfiguration(configJson: string): ToolConfiguration {
        const config = this.importToolConfiguration(configJson);
        
        // 生成新的ID和时间戳
        config.id = uuidv4();
        config.createdAt = new Date().toISOString();
        config.updatedAt = new Date().toISOString();

        if (this.settings.configurations.length >= this.settings.maxConfigSlots) {
            throw new Error(`已达到最大配置槽位数量 (${this.settings.maxConfigSlots})`);
        }

        this.settings.configurations.push(config);
        this.saveSettings();

        return config;
    }

    public getEnabledTools(): ToolConfig[] {
        const currentConfig = this.getCurrentConfiguration();
        if (!currentConfig) {
            return this.availableTools.filter(tool => tool.enabled);
        }
        return currentConfig.tools.filter(tool => tool.enabled);
    }

    public getToolManagerState() {
        const currentConfig = this.getCurrentConfiguration();
        return {
            success: true,
            availableTools: currentConfig ? currentConfig.tools : this.getAvailableTools(),
            selectedConfigId: this.settings.currentConfigId,
            configurations: this.getConfigurations(),
            maxConfigSlots: this.settings.maxConfigSlots
        };
    }

    private saveSettings(): void {
        console.log(`Backend: Saving settings, current configs count: ${this.settings.configurations.length}`);
        this.saveToolManagerSettings(this.settings);
        console.log(`Backend: Settings saved to file`);
    }
} 