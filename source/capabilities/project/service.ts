import { JsonValue } from '../../utils/json';
import { safeSerialize } from '../../utils/serializer';
import { ProjectBridgeDriver } from '../../drivers/project/contract';
import {
    ProjectCapability,
    ProjectSettingsCategory,
    QueryProjectInfoResult,
    QueryProjectSettingsInput,
    QueryProjectSettingsResult,
} from './interface';

export class ProjectService implements ProjectCapability {
    constructor(private readonly driver: ProjectBridgeDriver) {}

    async queryInfo(): Promise<QueryProjectInfoResult> {
        const runtimeInfo = this.driver.getRuntimeInfo();
        let projectConfig = await this.driver.findBestProjectConfig();

        if (!projectConfig) {
            try {
                const queriedConfig = await this.driver.queryProjectConfig();
                if (queriedConfig !== null && queriedConfig !== undefined) {
                    projectConfig = { source: 'Editor.Message (project config)', config: queriedConfig };
                }
            } catch { /* keep runtime info even when query unavailable */ }
        }

        return {
            ...runtimeInfo,
            ...(projectConfig ? { config: this.serialize(projectConfig.config) } : {}),
        };
    }

    async querySettings(input: QueryProjectSettingsInput): Promise<QueryProjectSettingsResult> {
        const category = this.normalizeCategory(input.category);
        const fileConfig = await this.driver.findBestProjectConfig(category);
        if (fileConfig) {
            const extracted = this.driver.extractProjectSettings(fileConfig.config, category);
            if (extracted !== null && extracted !== undefined) {
                return { category, config: this.serialize(extracted), message: `${category} settings retrieved successfully`, source: fileConfig.source };
            }
        }

        const fullConfig = await this.driver.queryProjectConfig();
        const extracted = this.driver.extractProjectSettings(fullConfig, category);
        if (extracted !== null && extracted !== undefined) {
            return { category, config: this.serialize(extracted), message: `${category} settings retrieved successfully`, source: 'Editor.Message (project config)' };
        }

        const available = fullConfig && typeof fullConfig === 'object'
            ? Object.keys(fullConfig as Record<string, unknown>).filter(key => !key.startsWith('_'))
            : [];
        throw new Error(`Category '${category}' not found. Available: ${available.join(', ')}`);
    }

    private normalizeCategory(category?: ProjectSettingsCategory): string {
        return String(category || 'general').trim().toLowerCase() || 'general';
    }

    private serialize(value: unknown): JsonValue {
        return safeSerialize(value) as JsonValue;
    }
}
