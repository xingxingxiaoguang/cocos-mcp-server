import { JsonValue } from '../../json';
import { safeSerialize } from '../../utils/serializer';
import { ProjectBridgeDriver, ProjectConfigCandidate } from '../../editor-bridge/project/contract';
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
        let projectConfig = await this.findBestProjectConfig();

        if (!projectConfig) {
            try {
                const queriedConfig = await this.driver.queryProjectConfig();
                if (queriedConfig !== null && queriedConfig !== undefined) {
                    projectConfig = {
                        source: 'Editor.Message (project config)',
                        config: queriedConfig,
                    };
                }
            } catch {
                // Keep runtime info even when the project config query is unavailable.
            }
        }

        return {
            ...runtimeInfo,
            ...(projectConfig ? { config: this.serialize(projectConfig.config) } : {}),
        };
    }

    async querySettings(input: QueryProjectSettingsInput): Promise<QueryProjectSettingsResult> {
        const category = this.normalizeCategory(input.category);
        const fileConfig = await this.findBestProjectConfig(category);
        if (fileConfig) {
            const extracted = this.extractProjectSettings(fileConfig.config, category);
            if (extracted !== null && extracted !== undefined) {
                return {
                    category,
                    config: this.serialize(extracted),
                    message: `${category} settings retrieved successfully`,
                    source: fileConfig.source,
                };
            }
        }

        const fullConfig = await this.driver.queryProjectConfig();
        const extracted = this.extractProjectSettings(fullConfig, category);
        if (extracted !== null && extracted !== undefined) {
            return {
                category,
                config: this.serialize(extracted),
                message: `${category} settings retrieved successfully`,
                source: 'Editor.Message (project config)',
            };
        }

        const available = fullConfig && typeof fullConfig === 'object'
            ? Object.keys(fullConfig as Record<string, unknown>).filter((key) => !key.startsWith('_'))
            : [];
        throw new Error(`Category '${category}' not found. Available: ${available.join(', ')}`);
    }

    private async findBestProjectConfig(category?: string): Promise<ProjectConfigCandidate | null> {
        const candidates = await this.driver.readProjectConfigCandidates();
        let bestMatch: { candidate: ProjectConfigCandidate; score: number } | null = null;

        for (const candidate of candidates) {
            if (!this.isMeaningfulProjectConfig(candidate.config)) {
                continue;
            }

            if (!category) {
                const score = this.getConfigScore(candidate.config);
                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = { candidate, score };
                }
                continue;
            }

            const extracted = this.extractProjectSettings(candidate.config, category);
            if (extracted !== null && extracted !== undefined) {
                const score = this.getConfigScore(candidate.config);
                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = { candidate, score };
                }
            }
        }

        return bestMatch?.candidate ?? null;
    }

    private normalizeCategory(category?: ProjectSettingsCategory): string {
        const normalized = String(category || 'general').trim().toLowerCase();
        return normalized || 'general';
    }

    private extractProjectSettings(projectConfig: unknown, category: string): unknown {
        if (!projectConfig || typeof projectConfig !== 'object') {
            return null;
        }

        const config = projectConfig as Record<string, any>;

        if (category === 'all') {
            return config;
        }

        if (category === 'general') {
            return config.general ?? config;
        }

        if (Object.prototype.hasOwnProperty.call(config, category)) {
            return config[category];
        }

        const nestedPaths = [
            config.settings?.[category],
            config.general?.[category],
            config.general?.settings?.[category],
            config.project?.[category],
        ];

        for (const candidate of nestedPaths) {
            if (candidate !== undefined && candidate !== null) {
                return candidate;
            }
        }

        return config[category] ?? null;
    }

    private isMeaningfulProjectConfig(content: unknown): boolean {
        if (!content || typeof content !== 'object') {
            return false;
        }

        const keys = Object.keys(content as Record<string, unknown>).filter((key) => key !== '__version__');
        return keys.length > 0;
    }

    private getConfigScore(content: unknown): number {
        if (!content || typeof content !== 'object') {
            return 0;
        }

        return Object.keys(content as Record<string, unknown>).length;
    }

    private serialize(value: unknown): JsonValue {
        return safeSerialize(value) as JsonValue;
    }
}
