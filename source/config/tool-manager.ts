import { ToolManagerState, ToolStatusUpdate } from '../ui/ipc/contracts';
import { ToolConfig, ToolConfiguration } from './interface';
import { SettingsRepository } from './repository';
import { ToolConfigService } from './tool-config-service';

export class ToolManager {
    constructor(private readonly toolConfigService: ToolConfigService = new ToolConfigService(new SettingsRepository())) {}

    public getAvailableTools(): ToolConfig[] {
        return this.toolConfigService.getAvailableTools();
    }

    public getConfigurations(): ToolConfiguration[] {
        return this.toolConfigService.getConfigurations();
    }

    public getCurrentConfiguration(): ToolConfiguration | null {
        return this.toolConfigService.getCurrentConfiguration();
    }

    public createConfiguration(name: string, description?: string): ToolConfiguration {
        return this.toolConfigService.createConfiguration(name, description);
    }

    public updateConfiguration(configId: string, updates: Partial<ToolConfiguration>): ToolConfiguration {
        return this.toolConfigService.updateConfiguration(configId, updates);
    }

    public deleteConfiguration(configId: string): void {
        this.toolConfigService.deleteConfiguration(configId);
    }

    public setCurrentConfiguration(configId: string): void {
        this.toolConfigService.setCurrentConfiguration(configId);
    }

    public updateToolStatus(configId: string, category: string, toolName: string, enabled: boolean): void {
        this.toolConfigService.updateToolStatus(configId, category, toolName, enabled);
    }

    public updateToolStatusBatch(configId: string, updates: ToolStatusUpdate[]): void {
        this.toolConfigService.updateToolStatusBatch(configId, updates);
    }

    public exportConfiguration(configId: string): string {
        return this.toolConfigService.exportConfiguration(configId);
    }

    public importConfiguration(configJson: string): ToolConfiguration {
        return this.toolConfigService.importConfiguration(configJson);
    }

    public getEnabledTools(): ToolConfig[] {
        return this.toolConfigService.getEnabledTools();
    }

    public getToolManagerState(): ToolManagerState {
        return this.toolConfigService.getToolManagerState();
    }
} 
