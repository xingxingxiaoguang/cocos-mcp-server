import { getCapabilityRegistry } from '../../runtime/capability-registry';
import { ProjectSettingsCategory } from '../../capabilities/project/interface';
import { BaseToolExecutor, ToolHandler } from '../base-tool';
import { ToolDefinition, ToolResponse } from '../../mcp/interface';
import { makeError, ToolErrorCode } from '../../utils/error-codes';

/**
 * ProjectToolsV2 — 项目工具 v2
 * 合并自 ProjectTools (项目部分)
 * 2 个工具: query, build
 */
export class ProjectToolsV2 extends BaseToolExecutor {
    private readonly project = getCapabilityRegistry().project;

    protected readonly handlers: Record<string, ToolHandler> = {
        query: async (args: any) => this.handleQuery(args),
        build: async (args: any) => this.handleBuild(args),
    };

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
                        category: { type: 'string', description: 'Settings category for action=settings', enum: ['general', 'physics', 'render', 'assets', 'all'] }
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

    // ==================== query ====================

    private async handleQuery(args: any): Promise<ToolResponse> {
        const action = typeof args?.action === 'string' ? args.action : 'info';
        switch (action) {
            case 'info':
                return await this.getProjectInfo();
            case 'settings':
                return await this.getProjectSettings(args.category);
            case 'build_settings':
                return await this.getBuildSettings();
            default:
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown query action: ${action}`);
        }
    }

    private async getProjectInfo(): Promise<ToolResponse> {
        const info = await this.project.queryInfo();
        return {
            success: true,
            data: info,
        };
    }

    private async getProjectSettings(category: string = 'general'): Promise<ToolResponse> {
        const result = await this.project.querySettings({
            category: this.normalizeCategory(category),
        });
        return {
            success: true,
            data: result,
        };
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
        const action = typeof args?.action === 'string' ? args.action : '';

        switch (action) {
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
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown build action: ${action || 'undefined'}`);
        }
    }

    private async buildProject(args: any): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('builder', 'open', 'default').then(() => {
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
            Editor.Message.request('builder', 'open', 'default').then(() => {
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
            Editor.Message.request('builder', 'open', 'default').then(() => {
                resolve({ success: true, message: 'Build panel opened successfully' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private normalizeCategory(category?: string): ProjectSettingsCategory {
        const normalized = String(category || 'general').trim().toLowerCase();
        return (normalized || 'general') as ProjectSettingsCategory;
    }
}
