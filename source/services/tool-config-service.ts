import { v4 as uuidv4 } from 'uuid';
import { createToolManagerState, ToolManagerState, ToolStatusUpdate } from '../ipc/contracts';
import { ToolConfig, ToolConfiguration, ToolManagerSettings } from '../tools/interface';
import { SettingsRepository } from './settings-repository';
import { createAvailableToolConfigs, createToolKey } from './tool-registry';

export class ToolConfigService {
    private settings: ToolManagerSettings;
    private readonly availableTools: ToolConfig[];

    constructor(private readonly settingsRepository: SettingsRepository = new SettingsRepository()) {
        this.settings = this.settingsRepository.readToolManagerSettings();
        this.availableTools = createAvailableToolConfigs();

        this.syncConfigurationsWithAvailableTools();

        if (this.settings.configurations.length === 0) {
            console.log('[ToolConfigService] No configurations found, creating default configuration...');
            this.createConfiguration('默认配置', '自动创建的默认工具配置');
        }
    }

    public getAvailableTools(): ToolConfig[] {
        return this.availableTools.map((tool) => ({ ...tool }));
    }

    public getConfigurations(): ToolConfiguration[] {
        return this.settings.configurations.map((config) => ({
            ...config,
            tools: config.tools.map((tool) => ({ ...tool })),
        }));
    }

    public getCurrentConfiguration(): ToolConfiguration | null {
        if (!this.settings.currentConfigId) {
            return null;
        }

        const config = this.settings.configurations.find((item) => item.id === this.settings.currentConfigId);
        return config ? this.cloneConfiguration(config) : null;
    }

    public createConfiguration(name: string, description?: string): ToolConfiguration {
        if (this.settings.configurations.length >= this.settings.maxConfigSlots) {
            throw new Error(`已达到最大配置槽位数量 (${this.settings.maxConfigSlots})`);
        }

        const config: ToolConfiguration = {
            id: uuidv4(),
            name,
            description,
            tools: this.getAvailableTools(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        this.settings.configurations.push(config);
        this.settings.currentConfigId = config.id;
        this.saveSettings();

        return this.cloneConfiguration(config);
    }

    public updateConfiguration(configId: string, updates: Partial<ToolConfiguration>): ToolConfiguration {
        const config = this.findConfiguration(configId);
        const updatedConfig: ToolConfiguration = {
            ...config,
            ...updates,
            id: config.id,
            updatedAt: new Date().toISOString(),
        };

        this.syncConfigurationTools(updatedConfig);
        this.replaceConfiguration(updatedConfig);
        this.saveSettings();

        return this.cloneConfiguration(updatedConfig);
    }

    public deleteConfiguration(configId: string): void {
        const configIndex = this.settings.configurations.findIndex((config) => config.id === configId);

        if (configIndex === -1) {
            throw new Error('配置不存在');
        }

        this.settings.configurations.splice(configIndex, 1);

        if (this.settings.currentConfigId === configId) {
            this.settings.currentConfigId = this.settings.configurations.length > 0
                ? this.settings.configurations[0].id
                : '';
        }

        this.saveSettings();
    }

    public setCurrentConfiguration(configId: string): void {
        this.findConfiguration(configId);
        this.settings.currentConfigId = configId;
        this.saveSettings();
    }

    public updateToolStatus(configId: string, category: string, toolName: string, enabled: boolean): void {
        const config = this.findConfiguration(configId);
        const tool = config.tools.find((item) => item.category === category && item.name === toolName);

        if (!tool) {
            throw new Error('工具不存在');
        }

        tool.enabled = enabled;
        config.updatedAt = new Date().toISOString();
        this.saveSettings();
    }

    public updateToolStatusBatch(configId: string, updates: ToolStatusUpdate[]): void {
        const config = this.findConfiguration(configId);
        const toolMap = new Map(config.tools.map((tool) => [createToolKey(tool.category, tool.name), tool]));
        let changed = false;

        for (const update of updates) {
            const tool = toolMap.get(createToolKey(update.category, update.name));

            if (!tool || tool.enabled === update.enabled) {
                continue;
            }

            tool.enabled = update.enabled;
            changed = true;
        }

        if (!changed) {
            return;
        }

        config.updatedAt = new Date().toISOString();
        this.saveSettings();
    }

    public exportConfiguration(configId: string): string {
        const config = this.findConfiguration(configId);
        return this.settingsRepository.exportToolConfiguration(config);
    }

    public importConfiguration(configJson: string): ToolConfiguration {
        const config = this.settingsRepository.importToolConfiguration(configJson);

        if (this.settings.configurations.length >= this.settings.maxConfigSlots) {
            throw new Error(`已达到最大配置槽位数量 (${this.settings.maxConfigSlots})`);
        }

        const importedConfig: ToolConfiguration = {
            ...config,
            id: uuidv4(),
            tools: Array.isArray(config.tools) ? config.tools.map((tool) => ({ ...tool })) : [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        this.syncConfigurationTools(importedConfig);
        this.settings.configurations.push(importedConfig);
        this.saveSettings();

        return this.cloneConfiguration(importedConfig);
    }

    public getEnabledTools(): ToolConfig[] {
        const currentConfig = this.findCurrentConfigurationReference();
        const source = currentConfig ? currentConfig.tools : this.availableTools;
        return source.filter((tool) => tool.enabled).map((tool) => ({ ...tool }));
    }

    public getToolManagerState(): ToolManagerState {
        const currentConfig = this.getCurrentConfiguration();

        return createToolManagerState({
            selectedConfigId: this.settings.currentConfigId,
            currentConfiguration: currentConfig,
            configurations: this.getConfigurations(),
            availableTools: currentConfig ? currentConfig.tools.map((tool) => ({ ...tool })) : this.getAvailableTools(),
            maxConfigSlots: this.settings.maxConfigSlots,
        });
    }

    private findCurrentConfigurationReference(): ToolConfiguration | null {
        if (!this.settings.currentConfigId) {
            return null;
        }

        return this.settings.configurations.find((config) => config.id === this.settings.currentConfigId) || null;
    }

    private findConfiguration(configId: string): ToolConfiguration {
        const config = this.settings.configurations.find((item) => item.id === configId);

        if (!config) {
            throw new Error('配置不存在');
        }

        return config;
    }

    private replaceConfiguration(updatedConfig: ToolConfiguration): void {
        const configIndex = this.settings.configurations.findIndex((config) => config.id === updatedConfig.id);
        this.settings.configurations[configIndex] = updatedConfig;
    }

    private syncConfigurationsWithAvailableTools(): void {
        let changed = false;

        for (const config of this.settings.configurations) {
            const configChanged = this.syncConfigurationTools(config);

            if (!configChanged) {
                continue;
            }

            config.updatedAt = new Date().toISOString();
            changed = true;
        }

        if (changed) {
            this.saveSettings();
        }
    }

    private syncConfigurationTools(config: ToolConfiguration): boolean {
        const existingTools = new Map(
            config.tools.map((tool) => [createToolKey(tool.category, tool.name), tool]),
        );
        let changed = false;

        for (const availableTool of this.availableTools) {
            const toolKey = createToolKey(availableTool.category, availableTool.name);
            const existingTool = existingTools.get(toolKey);

            if (!existingTool) {
                config.tools.push({ ...availableTool });
                changed = true;
                continue;
            }

            if (existingTool.description !== availableTool.description) {
                existingTool.description = availableTool.description;
                changed = true;
            }
        }

        return changed;
    }

    private cloneConfiguration(config: ToolConfiguration): ToolConfiguration {
        return {
            ...config,
            tools: config.tools.map((tool) => ({ ...tool })),
        };
    }

    private saveSettings(): void {
        this.settingsRepository.saveToolManagerSettings(this.settings);
    }
}
