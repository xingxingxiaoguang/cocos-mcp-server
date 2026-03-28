import { ToolDefinition, ToolResponse, ToolExecutor, ProjectInfo } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ProjectToolsV2 — 项目工具 v2
 * 合并自 ProjectTools (项目部分)
 * 2 个工具: query, build
 */
export class ProjectToolsV2 implements ToolExecutor {

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'query',
                description: 'Query project information. action=info (default): get project metadata. action=settings: get project settings by category. action=build_settings: get build settings and limitations.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['info', 'settings', 'build_settings'],
                            description: 'Query type. Default: info'
                        },
                        category: { type: 'string', description: 'Settings category for action=settings', enum: ['general', 'physics', 'render', 'assets'] }
                    }
                }
            },
            {
                name: 'build',
                description: 'Project build and preview operations. action=build: build project for platform. action=preview: run project in preview mode. action=status: check builder status. action=start_preview: start preview server. action=stop_preview: stop preview server. action=open_panel: open build panel.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['build', 'preview', 'status', 'start_preview', 'stop_preview', 'open_panel'],
                            description: 'Operation type'
                        },
                        platform: { type: 'string', description: 'Target platform for action=build/preview', enum: ['web-mobile', 'web-desktop', 'ios', 'android', 'windows', 'mac', 'browser', 'simulator'] },
                        buildOptions: { type: 'object', description: 'Build options for action=build' }
                    },
                    required: ['action']
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'query':
                return await this.handleQuery(args);
            case 'build':
                return await this.handleBuild(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // ==================== query ====================

    private async handleQuery(args: any): Promise<ToolResponse> {
        const action = args.action || 'info';
        switch (action) {
            case 'info':
                return await this.getProjectInfo();
            case 'settings':
                return await this.getProjectSettings(args.category);
            case 'build_settings':
                return await this.getBuildSettings();
            default:
                return { success: false, error: `Unknown query action: ${action}` };
        }
    }

    private async getProjectInfo(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const info: ProjectInfo = {
                name: Editor.Project.name,
                path: Editor.Project.path,
                uuid: Editor.Project.uuid,
                version: (Editor.Project as any).version || '1.0.0',
                cocosVersion: (Editor as any).versions?.cocos || 'Unknown'
            };

            const projectConfig = this.readProjectConfig();
            if (projectConfig) {
                Object.assign(info, { config: projectConfig });
                resolve({ success: true, data: info });
                return;
            }

            Editor.Message.request('project', 'query-config', 'project').then((additionalInfo: any) => {
                if (additionalInfo) {
                    Object.assign(info, { config: additionalInfo });
                }
                resolve({ success: true, data: info });
            }).catch(() => {
                resolve({ success: true, data: info });
            });
        });
    }

    private async getProjectSettings(category: string = 'general'): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const projectConfig = this.readProjectConfig(category);
            if (projectConfig) {
                const extracted = this.extractProjectSettings(projectConfig, category);
                if (extracted !== null && extracted !== undefined) {
                    resolve({
                        success: true,
                        data: {
                            category,
                            config: extracted,
                            message: `${category} settings retrieved successfully`,
                            source: 'settings/project.json'
                        }
                    });
                    return;
                }
            }

            // physics/render 等子分类在 Editor API 中不是独立的 configName，
            // 它们内嵌在 'project' config 中，需要先获取完整配置再提取
            Editor.Message.request('project', 'query-config', 'project').then((fullConfig: any) => {
                const extracted = this.extractProjectSettings(fullConfig, category);
                if (extracted !== null && extracted !== undefined) {
                    resolve({
                        success: true,
                        data: {
                            category,
                            config: extracted,
                            message: `${category} settings retrieved successfully`,
                            source: 'Editor.Message (project config)'
                        }
                    });
                    return;
                }
                const available = fullConfig ? Object.keys(fullConfig).filter(k => !k.startsWith('_')) : [];
                resolve({
                    success: false,
                    error: `Category '${category}' not found. Available: ${available.join(', ')}`
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private readProjectConfig(category?: string): any | null {
        const normalizedCategory = String(category || '').trim().toLowerCase();
        const candidates = [
            path.join(Editor.Project.path, 'settings', 'v2', 'packages', 'project.json'),
            path.join(Editor.Project.path, 'settings', 'project.json'),
        ];

        let bestMatch: { config: any; score: number } | null = null;

        for (const configPath of candidates) {
            try {
                if (fs.existsSync(configPath)) {
                    const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    if (!this.isMeaningfulProjectConfig(content)) {
                        continue;
                    }

                    if (!normalizedCategory) {
                        const score = Object.keys(content).length;
                        if (!bestMatch || score > bestMatch.score) {
                            bestMatch = { config: content, score };
                        }
                        continue;
                    }

                    const extracted = this.extractProjectSettings(content, normalizedCategory);
                    if (extracted !== null && extracted !== undefined) {
                        const score = Object.keys(content).length;
                        if (!bestMatch || score > bestMatch.score) {
                            bestMatch = { config: content, score };
                        }
                    }
                }
            } catch (err) {
                console.warn(`[ProjectToolsV2] Failed to read ${configPath}:`, err);
            }
        }

        return bestMatch?.config || null;
    }

    private extractProjectSettings(projectConfig: any, category: string): any {
        if (!projectConfig) {
            return null;
        }

        if (category === 'all') {
            return projectConfig;
        }

        if (category === 'general') {
            return projectConfig.general ?? projectConfig;
        }

        if (Object.prototype.hasOwnProperty.call(projectConfig, category)) {
            return projectConfig[category];
        }

        const nestedPaths = [
            projectConfig.settings?.[category],
            projectConfig.general?.[category],
            projectConfig.general?.settings?.[category],
            projectConfig.project?.[category]
        ];

        for (const candidate of nestedPaths) {
            if (candidate !== undefined && candidate !== null) {
                return candidate;
            }
        }

        return projectConfig[category] ?? null;
    }

    private isMeaningfulProjectConfig(content: any): boolean {
        if (!content || typeof content !== 'object') {
            return false;
        }
        const keys = Object.keys(content).filter(key => key !== '__version__');
        return keys.length > 0;
    }

    private async getBuildSettings(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('builder', 'query-worker-ready').then((ready: boolean) => {
                resolve({
                    success: true,
                    data: {
                        builderReady: ready,
                        message: 'Build settings are limited in MCP plugin environment',
                        availableActions: [
                            'Open build panel with project_build action=open_panel',
                            'Check builder status with project_build action=status',
                            'Start preview with project_build action=preview'
                        ],
                        limitation: 'Full build configuration requires direct Editor UI access'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ==================== build ====================

    private async handleBuild(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'build':
                return await this.buildProject(args);
            case 'preview':
                return await this.runProject(args.platform);
            case 'status':
                return await this.checkBuilderStatus();
            case 'start_preview':
                return { success: false, error: 'Preview server control is not supported through MCP API', instruction: 'Please start the preview server manually using the editor menu: Project > Preview' };
            case 'stop_preview':
                return { success: false, error: 'Preview server control is not supported through MCP API', instruction: 'Please stop the preview server manually using the preview panel in the editor' };
            case 'open_panel':
                return await this.openBuildPanel();
            default:
                return { success: false, error: `Unknown build action: ${args.action}` };
        }
    }

    private async buildProject(args: any): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('builder', 'open').then(() => {
                resolve({
                    success: true,
                    message: `Build panel opened for ${args.platform}. Please configure and start build manually.`,
                    data: {
                        platform: args.platform,
                        instruction: 'Use the build panel to configure and start the build process'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async runProject(platform: string = 'browser'): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('builder', 'open').then(() => {
                resolve({
                    success: true,
                    message: 'Build panel opened. Preview functionality requires manual setup.'
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async checkBuilderStatus(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('builder', 'query-worker-ready').then((ready: boolean) => {
                resolve({
                    success: true,
                    data: {
                        ready,
                        status: ready ? 'Builder worker is ready' : 'Builder worker is not ready',
                        message: 'Builder status checked successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async openBuildPanel(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('builder', 'open').then(() => {
                resolve({ success: true, message: 'Build panel opened successfully' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
}
