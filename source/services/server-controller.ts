import { MCPServer } from '../mcp-server';
import { MCPServerSettings, ServerStatus, ToolDefinition } from '../types';
import { SettingsRepository } from './settings-repository';
import { ToolConfigService } from './tool-config-service';

export class ServerController {
    private server: MCPServer;

    constructor(
        private readonly settingsRepository: SettingsRepository = new SettingsRepository(),
        private readonly toolConfigService: ToolConfigService = new ToolConfigService(settingsRepository),
    ) {
        this.server = this.createServer(this.settingsRepository.readServerSettings());
        this.syncEnabledTools();
    }

    public async start(): Promise<void> {
        this.syncEnabledTools();
        await this.server.start();
    }

    public stop(): void {
        this.server.stop();
    }

    public async updateSettings(settings: MCPServerSettings): Promise<void> {
        this.settingsRepository.saveServerSettings(settings);
        await this.restartIfNeeded(settings);
    }

    public async restartIfNeeded(settings: MCPServerSettings): Promise<void> {
        const wasRunning = this.server.getStatus().running;

        if (wasRunning) {
            this.server.stop();
        }

        this.server = this.createServer(settings);
        this.syncEnabledTools();

        if (wasRunning) {
            await this.server.start();
        }
    }

    public syncEnabledTools(): void {
        this.server.updateEnabledTools(this.toolConfigService.getEnabledTools());
    }

    public getStatus(): ServerStatus {
        return this.server.getStatus();
    }

    public getSettings(): MCPServerSettings {
        return this.server.getSettings();
    }

    public getServer(): MCPServer {
        return this.server;
    }

    public getAvailableTools(): ToolDefinition[] {
        return this.server.getAvailableTools();
    }

    private createServer(settings: MCPServerSettings): MCPServer {
        return new MCPServer(settings);
    }
}
