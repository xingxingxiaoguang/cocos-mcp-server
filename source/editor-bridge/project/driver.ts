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
            {
                absolutePath: path.join(projectPath, 'settings', 'v2', 'packages', 'project.json'),
                source: 'settings/v2/packages/project.json',
            },
            {
                absolutePath: path.join(projectPath, 'settings', 'project.json'),
                source: 'settings/project.json',
            },
        ];

        const results: ProjectConfigCandidate[] = [];

        for (const candidate of candidates) {
            try {
                if (!fs.existsSync(candidate.absolutePath)) {
                    continue;
                }

                const content = JSON.parse(fs.readFileSync(candidate.absolutePath, 'utf8'));
                results.push({
                    source: candidate.source,
                    config: content,
                });
            } catch (error) {
                console.warn(`[ProjectDriver] Failed to read ${candidate.absolutePath}:`, error);
            }
        }

        return results;
    }

    async queryProjectConfig(): Promise<unknown> {
        this.ensureProjectQueryAvailable();
        const request = (globalThis as any).Editor.Message.request as (
            channel: string,
            message: string,
            ...args: unknown[]
        ) => Promise<unknown>;

        return request(PROJECT_CHANNEL, 'query-config', 'project');
    }

    private getProjectPath(): string {
        const projectPath = String((globalThis as any).Editor?.Project?.path || '');
        if (!projectPath) {
            throw new Error('Editor.Project.path is unavailable in the current runtime');
        }

        return projectPath;
    }

    private ensureProjectQueryAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function') {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }

        if (!this.profile.features.projectQueryConfig) {
            throw new Error('Runtime profile does not support projectQueryConfig');
        }
    }
}

export function createProjectDriver(profile: RuntimeProfile): ProjectBridgeDriver {
    return new EditorProjectDriver(profile);
}
