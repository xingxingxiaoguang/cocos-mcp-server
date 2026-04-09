import * as fs from 'fs';
import * as path from 'path';
import { MCPServerSettings } from '../mcp/interface';
import { ToolConfiguration, ToolManagerSettings } from '../tools/interface';

export const DEFAULT_SETTINGS: MCPServerSettings = {
    port: 3000,
    autoStart: false,
    enableDebugLog: false,
    allowedOrigins: ['*'],
    maxConnections: 10,
};

export const DEFAULT_TOOL_MANAGER_SETTINGS: ToolManagerSettings = {
    configurations: [],
    currentConfigId: '',
    maxConfigSlots: 5,
};

export class SettingsRepository {
    private readonly settingsDir = path.join(Editor.Project.path, 'settings');

    public readServerSettings(): MCPServerSettings {
        return this.readJsonFile('mcp-server.json', DEFAULT_SETTINGS);
    }

    public saveServerSettings(settings: MCPServerSettings): void {
        this.writeJsonFile('mcp-server.json', settings);
    }

    public readToolManagerSettings(): ToolManagerSettings {
        return this.readJsonFile('tool-manager.json', DEFAULT_TOOL_MANAGER_SETTINGS);
    }

    public saveToolManagerSettings(settings: ToolManagerSettings): void {
        this.writeJsonFile('tool-manager.json', settings);
    }

    public exportToolConfiguration(config: ToolConfiguration): string {
        return JSON.stringify(config, null, 2);
    }

    public importToolConfiguration(configJson: string): ToolConfiguration {
        try {
            const config = JSON.parse(configJson);

            if (!config.id || !config.name || !Array.isArray(config.tools)) {
                throw new Error('Invalid configuration format');
            }

            return config;
        } catch (error) {
            console.error('Failed to parse tool configuration:', error);
            throw new Error('Invalid JSON format or configuration structure');
        }
    }

    private ensureSettingsDir(): void {
        if (!fs.existsSync(this.settingsDir)) {
            fs.mkdirSync(this.settingsDir, { recursive: true });
        }
    }

    private getSettingsFilePath(fileName: string): string {
        return path.join(this.settingsDir, fileName);
    }

    private readJsonFile<T>(fileName: string, defaults: T): T {
        try {
            this.ensureSettingsDir();
            const settingsFile = this.getSettingsFilePath(fileName);

            if (fs.existsSync(settingsFile)) {
                const content = fs.readFileSync(settingsFile, 'utf8');
                return { ...defaults, ...JSON.parse(content) };
            }
        } catch (error) {
            console.error(`Failed to read ${fileName}:`, error);
        }

        return defaults;
    }

    private writeJsonFile<T>(fileName: string, value: T): void {
        try {
            this.ensureSettingsDir();
            const settingsFile = this.getSettingsFilePath(fileName);
            fs.writeFileSync(settingsFile, JSON.stringify(value, null, 2));
        } catch (error) {
            console.error(`Failed to save ${fileName}:`, error);
            throw error;
        }
    }
}
