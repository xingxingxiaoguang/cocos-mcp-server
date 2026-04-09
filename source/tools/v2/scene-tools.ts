import { getCapabilityRegistry } from '../../runtime/capability-registry';
import { ToolDefinition, ToolResponse } from '../../mcp/interface';
import { makeError, ToolErrorCode } from '../../utils/error-codes';
import { BaseToolExecutor, ToolHandler } from '../base-tool';

export class SceneToolsV2 extends BaseToolExecutor {
    private readonly scene = getCapabilityRegistry().scene;

    protected readonly handlers: Record<string, ToolHandler> = {
        query: async (args: any) => this.handleQuery(args),
        open: async (args: any) => this.handleOpen(args),
        save: async (args: any) => this.handleSave(args),
        create: async (args: any) => this.handleCreate(args),
        manage: async (args: any) => this.handleManage(args),
    };

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'query',
                description: 'Query scene information. action=info: current scene info, action=hierarchy: node tree, action=list: all scenes in project, action=status: ready/dirty state',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['info', 'hierarchy', 'list', 'status'],
                            description: 'Query type. info=current scene info, hierarchy=node tree, list=project scene list, status=ready/dirty state. Default: info'
                        },
                        includeComponents: {
                            type: 'boolean',
                            description: 'Only for action=hierarchy, whether to include component list',
                            default: false
                        }
                    }
                }
            },
            {
                name: 'open',
                description: 'Open a scene by path',
                inputSchema: {
                    type: 'object',
                    properties: {
                        scenePath: {
                            type: 'string',
                            description: 'Scene file path, e.g. db://assets/scenes/Main.scene'
                        }
                    },
                    required: ['scenePath']
                }
            },
            {
                name: 'save',
                description: 'Save, save-as, or close the current scene',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['save', 'save_as', 'close'],
                            description: 'Operation type. Default: save'
                        },
                        path: {
                            type: 'string',
                            description: 'Required only when action=save_as, target save path'
                        }
                    }
                }
            },
            {
                name: 'create',
                description: 'Create a new scene asset',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sceneName: {
                            type: 'string',
                            description: 'Scene name'
                        },
                        savePath: {
                            type: 'string',
                            description: 'Save path, e.g. db://assets/scenes/NewScene.scene'
                        }
                    },
                    required: ['sceneName', 'savePath']
                }
            },
            {
                name: 'manage',
                description: 'Scene management operations: reload, snapshot, snapshot_abort',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['reload', 'snapshot', 'snapshot_abort'],
                            description: 'Operation type'
                        }
                    },
                    required: ['action']
                }
            }
        ];
    }

    private async handleQuery(args: any): Promise<ToolResponse> {
        const action = typeof args?.action === 'string' ? args.action : 'info';
        switch (action) {
            case 'info':
                return await this.queryInfo();
            case 'hierarchy':
                return await this.queryHierarchy(args.includeComponents);
            case 'list':
                return await this.queryList();
            case 'status':
                return await this.queryStatus();
            default:
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown query action: ${action}`);
        }
    }

    private async queryInfo(): Promise<ToolResponse> {
        return {
            success: true,
            data: await this.scene.queryInfo(),
        };
    }

    private async queryHierarchy(includeComponents: boolean = false): Promise<ToolResponse> {
        return {
            success: true,
            data: await this.scene.queryHierarchy({ includeComponents }),
        };
    }

    private async queryList(): Promise<ToolResponse> {
        const result = await this.scene.listScenes();
        return {
            success: true,
            data: result.scenes,
        };
    }

    private async queryStatus(): Promise<ToolResponse> {
        return {
            success: true,
            data: await this.scene.queryStatus(),
        };
    }

    private async handleOpen(args: any): Promise<ToolResponse> {
        const scenePath = this.requireTrimmedString(args?.scenePath, 'scenePath');
        if (!scenePath.success) {
            return scenePath.response;
        }

        const result = await this.scene.openScene({
            scenePath: scenePath.value,
        });

        return {
            success: true,
            message: result.message,
        };
    }

    private async handleSave(args: any): Promise<ToolResponse> {
        const action = typeof args?.action === 'string' ? args.action : 'save';
        switch (action) {
            case 'save':
                return await this.saveScene();
            case 'save_as':
                return await this.saveSceneAs(args.path);
            case 'close':
                return await this.closeScene();
            default:
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown save action: ${action}`);
        }
    }

    private async saveScene(): Promise<ToolResponse> {
        const result = await this.scene.saveScene();
        return {
            success: true,
            message: result.message,
        };
    }

    private async saveSceneAs(path: string): Promise<ToolResponse> {
        const normalizedPath = this.requireTrimmedString(path, 'path');
        if (!normalizedPath.success) {
            return normalizedPath.response;
        }

        const result = await this.scene.saveSceneAs({
            path: normalizedPath.value,
        });
        return {
            success: true,
            data: {
                path: normalizedPath.value,
                message: result.message,
            },
        };
    }

    private async closeScene(): Promise<ToolResponse> {
        const result = await this.scene.closeScene();
        return {
            success: true,
            message: result.message,
        };
    }

    private async handleCreate(args: any): Promise<ToolResponse> {
        const sceneName = this.requireTrimmedString(args?.sceneName, 'sceneName');
        if (!sceneName.success) {
            return sceneName.response;
        }

        const savePath = this.requireTrimmedString(args?.savePath, 'savePath');
        if (!savePath.success) {
            return savePath.response;
        }

        const result = await this.scene.createScene({
            sceneName: sceneName.value,
            savePath: savePath.value,
        });

        return {
            success: true,
            message: result.message,
            data: {
                ...result.data,
                message: result.message,
            },
            ...(result.verificationData ? { verificationData: result.verificationData } : {}),
        };
    }

    private async handleManage(args: any): Promise<ToolResponse> {
        const action = typeof args?.action === 'string' ? args.action : '';
        switch (action) {
            case 'reload':
                return await this.softReloadScene();
            case 'snapshot':
                return await this.sceneSnapshot();
            case 'snapshot_abort':
                return await this.sceneSnapshotAbort();
            default:
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown manage action: ${action}`);
        }
    }

    private async softReloadScene(): Promise<ToolResponse> {
        const result = await this.scene.reloadScene();
        return {
            success: true,
            message: result.message,
        };
    }

    private async sceneSnapshot(): Promise<ToolResponse> {
        const result = await this.scene.createSnapshot();
        return {
            success: true,
            message: result.message,
        };
    }

    private async sceneSnapshotAbort(): Promise<ToolResponse> {
        const result = await this.scene.abortSnapshot();
        return {
            success: true,
            message: result.message,
        };
    }

    private requireTrimmedString(
        value: unknown,
        fieldName: string,
    ): { success: true; value: string } | { success: false; response: ToolResponse } {
        if (typeof value !== 'string' || !value.trim()) {
            return {
                success: false,
                response: makeError(ToolErrorCode.MISSING_REQUIRED, `${fieldName} is required`),
            };
        }

        return {
            success: true,
            value: value.trim(),
        };
    }
}
