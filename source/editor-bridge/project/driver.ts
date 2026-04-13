import * as fs from 'fs';
import * as path from 'path';
import { RuntimeProfile } from '../../runtime/profile';
import { ProjectBridgeDriver, ProjectConfigCandidate, ProjectRuntimeInfo } from './contract';

const PROJECT_CHANNEL = 'project';

class EditorProjectDriver implements ProjectBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    getRuntimeInfo(): ProjectRuntimeInfo {
        const editor = (globalThis as any).Editor;
        return {
            name: String(editor?.Project?.name || ''),
            path: String(editor?.Project?.path || ''),
            uuid: String(editor?.Project?.uuid || ''),
            version: String(editor?.Project?.version || '1.0.0'),
            cocosVersion: String(editor?.versions?.cocos || this.profile.cocosVersion || 'Unknown'),
        };
    }

    async readProjectConfigCandidates(): Promise<ProjectConfigCandidate[]> {
        const projectPath = this.getProjectPath();
        const candidates = [
            { absolutePath: path.join(projectPath, 'settings', 'v2', 'packages', 'project.json'), source: 'settings/v2/packages/project.json' },
            { absolutePath: path.join(projectPath, 'settings', 'project.json'), source: 'settings/project.json' },
        ];

        const results: ProjectConfigCandidate[] = [];
        for (const candidate of candidates) {
            try {
                if (!fs.existsSync(candidate.absolutePath)) continue;
                const content = JSON.parse(fs.readFileSync(candidate.absolutePath, 'utf8'));
                results.push({ source: candidate.source, config: content });
            } catch (error) {
                console.warn(`[ProjectDriver] Failed to read ${candidate.absolutePath}:`, error);
            }
        }
        return results;
    }

    async queryProjectConfig(): Promise<unknown> {
        this.ensureProjectQueryAvailable();
        const request = (globalThis as any).Editor.Message.request as (channel: string, message: string, ...args: unknown[]) => Promise<unknown>;
        return request(PROJECT_CHANNEL, 'query-config', 'project');
    }

    // =========================================================================
    // 配置评分与提取（从 service 下沉）
    // =========================================================================

    async findBestProjectConfig(category?: string): Promise<ProjectConfigCandidate | null> {
        const candidates = await this.readProjectConfigCandidates();
        let bestMatch: { candidate: ProjectConfigCandidate; score: number } | null = null;

        for (const candidate of candidates) {
            if (!this.isMeaningfulProjectConfig(candidate.config)) continue;

            if (!category) {
                const score = this.getConfigScore(candidate.config);
                if (!bestMatch || score > bestMatch.score) bestMatch = { candidate, score };
                continue;
            }

            const extracted = this.extractProjectSettings(candidate.config, category);
            if (extracted !== null && extracted !== undefined) {
                const score = this.getConfigScore(candidate.config);
                if (!bestMatch || score > bestMatch.score) bestMatch = { candidate, score };
            }
        }

        return bestMatch?.candidate ?? null;
    }

    extractProjectSettings(projectConfig: unknown, category: string): unknown {
        if (!projectConfig || typeof projectConfig !== 'object') return null;
        const config = projectConfig as Record<string, any>;

        if (category === 'all') return config;
        if (category === 'general') return config.general ?? config;
        if (Object.prototype.hasOwnProperty.call(config, category)) return config[category];

        const nestedPaths = [
            config.settings?.[category],
            config.general?.[category],
            config.general?.settings?.[category],
            config.project?.[category],
        ];
        for (const candidate of nestedPaths) {
            if (candidate !== undefined && candidate !== null) return candidate;
        }

        return config[category] ?? null;
    }

    // =========================================================================
    // 内部工具
    // =========================================================================

    private isMeaningfulProjectConfig(content: unknown): boolean {
        if (!content || typeof content !== 'object') return false;
        return Object.keys(content as Record<string, unknown>).filter(key => key !== '__version__').length > 0;
    }

    private getConfigScore(content: unknown): number {
        if (!content || typeof content !== 'object') return 0;
        return Object.keys(content as Record<string, unknown>).length;
    }

    private getProjectPath(): string {
        const projectPath = String((globalThis as any).Editor?.Project?.path || '');
        if (!projectPath) throw new Error('Editor.Project.path is unavailable in the current runtime');
        return projectPath;
    }

    private ensureProjectQueryAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function') throw new Error('Editor.Message.request is unavailable in the current runtime');
        if (!this.profile.features.projectQueryConfig) throw new Error('Runtime profile does not support projectQueryConfig');
    }
}

export function createProjectDriver(profile: RuntimeProfile): ProjectBridgeDriver {
    return new EditorProjectDriver(profile);
}
