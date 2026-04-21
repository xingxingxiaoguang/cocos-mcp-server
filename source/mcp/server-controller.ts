import { MCPServer } from './server';
import { MCPServerSettings, ServerStatus, ToolDefinition } from '../mcp/interface';
import { SettingsRepository } from '../config/repository';
import { ToolConfigService } from '../config/tool-config-service';
import { PreviewInjector } from '../preview/preview-injector';

export class ServerController {
    private server: MCPServer;
    private previewInjector: PreviewInjector;

    constructor(
        private readonly settingsRepository: SettingsRepository = new SettingsRepository(),
        private readonly toolConfigService: ToolConfigService = new ToolConfigService(settingsRepository),
    ) {
        this.server = this.createServer(this.settingsRepository.readServerSettings());
        this.previewInjector = new PreviewInjector();
        this.syncEnabledTools();
    }

    public async start(): Promise<void> {
        this.syncEnabledTools();
        await this.server.start();

        const port = this.server.getSettings().port;
        const result = this.previewInjector.inject(port);
        if (!result.success) {
            console.warn('[ServerController] Preview injection failed:', result.error);
        }
    }

    public stop(): void {
        const result = this.previewInjector.remove();
        if (!result.success) {
            console.warn('[ServerController] Preview removal failed:', result.error);
        }

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

            const port = this.server.getSettings().port;
            const result = this.previewInjector.update(port);
            if (!result.success) {
                console.warn('[ServerController] Preview injection update failed:', result.error);
            }
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
