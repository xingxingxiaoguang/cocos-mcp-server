import { getCapabilityRegistry } from '../../runtime/capability-registry';
import { ToolDefinition, ToolResponse } from '../../mcp/interface';
import { makeError, ToolErrorCode } from '../../utils/error-codes';
import { BaseToolExecutor, ToolHandler } from '../base-tool';
import { actionEnum, dbPath as dbPathSchema, uuid as uuidSchema } from '../schemas/common';

type PrefabCreateAction = 'from_node' | 'instantiate' | 'duplicate';
type PrefabUpdateAction = 'apply' | 'revert';

export class PrefabToolsV2 extends BaseToolExecutor {
    private readonly prefab = getCapabilityRegistry().prefab;

    protected readonly handlers: Record<string, ToolHandler> = {
        query: async (args: any) => this.handleQuery(args),
        create: async (args: any) => this.handleCreate(args),
        update: async (args: any) => this.handleUpdate(args),
    };

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'query',
                description: 'Query prefab information. With prefabPath: get detailed prefab info (metadata + validation). Without prefabPath: list all prefabs in project.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        prefabPath: {
                            ...dbPathSchema,
                            description: 'Prefab path, e.g. db://assets/prefabs/Player.prefab',
                        },
                        folder: {
                            ...dbPathSchema,
                            description: 'Restrict search to this folder (only when listing)',
                            default: 'db://assets',
                        },
                    },
                },
            },
            {
                name: 'create',
                description: 'Create, instantiate, or duplicate a prefab. action=from_node: create prefab from existing node. action=instantiate: instantiate prefab in scene. action=duplicate: duplicate a prefab asset.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            ...actionEnum(['from_node', 'instantiate', 'duplicate'], 'Operation type'),
                        },
                        uuid: {
                            ...uuidSchema,
                            description: 'Source node UUID (action=from_node)',
                        },
                        savePath: {
                            ...dbPathSchema,
                            description: 'Save path for new prefab (action=from_node), e.g. db://assets/prefabs/MyPrefab.prefab',
                        },
                        prefabName: {
                            type: 'string',
                            description: 'Prefab name (action=from_node)',
                        },
                        prefabPath: {
                            ...dbPathSchema,
                            description: 'Prefab path (action=instantiate)',
                        },
                        parentUuid: {
                            ...uuidSchema,
                            description: 'Parent node UUID (action=instantiate)',
                        },
                        name: {
                            type: 'string',
                            description: 'Custom node name for the instantiated prefab (action=instantiate). If omitted, the prefab asset name is used.',
                        },
                        position: {
                            type: 'object',
                            description: 'Initial position (action=instantiate)',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                                z: { type: 'number' },
                            },
                        },
                        sourcePath: {
                            ...dbPathSchema,
                            description: 'Source prefab path (action=duplicate)',
                        },
                        targetPath: {
                            ...dbPathSchema,
                            description: 'Target path (action=duplicate)',
                        },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'update',
                description: 'Update or revert a prefab instance. action=apply: save instance modifications back to prefab asset. action=revert: revert instance to original prefab state.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            ...actionEnum(
                                ['apply', 'revert'],
                                'apply=save changes to prefab asset, revert=restore instance to original state',
                            ),
                        },
                        uuid: {
                            ...uuidSchema,
                            description: 'Prefab instance node UUID',
                        },
                        assetUuid: {
                            ...uuidSchema,
                            description: 'Prefab asset UUID (optional, for revert with restore-prefab API)',
                        },
                    },
                    required: ['action', 'uuid'],
                },
            },
        ];
    }

    private async handleQuery(args: any): Promise<ToolResponse> {
        const prefabPath = this.optionalTrimmedString(args?.prefabPath);
        if (prefabPath) {
            const result = await this.prefab.query({ prefabPath });
            return {
                success: true,
                data: result,
            };
        }

        const result = await this.prefab.list({
            folder: this.optionalTrimmedString(args?.folder),
        });
        return {
            success: true,
            data: result.prefabs,
        };
    }

    private async handleCreate(args: any): Promise<ToolResponse> {
        const action = args?.action as PrefabCreateAction | undefined;

        switch (action) {
            case 'from_node':
                return await this.createFromNode(args);
            case 'instantiate':
                return await this.instantiatePrefab(args);
            case 'duplicate':
                return await this.duplicatePrefab(args);
            default:
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown action: ${String(action)}`);
        }
    }

    private async createFromNode(args: any): Promise<ToolResponse> {
        const nodeUuid = this.requireTrimmedString(args?.uuid, 'uuid');
        if (!nodeUuid.success) {
            return nodeUuid.response;
        }

        const savePath = this.requireTrimmedString(args?.savePath, 'savePath');
        if (!savePath.success) {
            return savePath.response;
        }

        const result = await this.prefab.createFromNode({
            nodeUuid: nodeUuid.value,
            savePath: savePath.value,
            prefabName: this.optionalTrimmedString(args?.prefabName),
        });

        return this.toToolResponse(result);
    }

    private async instantiatePrefab(args: any): Promise<ToolResponse> {
        const prefabPath = this.requireTrimmedString(args?.prefabPath, 'prefabPath');
        if (!prefabPath.success) {
            return prefabPath.response;
        }

        const result = await this.prefab.instantiate({
            prefabPath: prefabPath.value,
            parentUuid: this.optionalTrimmedString(args?.parentUuid),
            name: this.optionalTrimmedString(args?.name),
            position: this.normalizePosition(args?.position),
        });

        return this.toToolResponse(result);
    }

    private async duplicatePrefab(args: any): Promise<ToolResponse> {
        const sourcePath = this.requireTrimmedString(args?.sourcePath, 'sourcePath');
        if (!sourcePath.success) {
            return sourcePath.response;
        }

        const targetPath = this.requireTrimmedString(args?.targetPath, 'targetPath');
        if (!targetPath.success) {
            return targetPath.response;
        }

        const result = await this.prefab.duplicate({
            sourcePath: sourcePath.value,
            targetPath: targetPath.value,
            prefabName: this.optionalTrimmedString(args?.prefabName),
        });

        return this.toToolResponse(result);
    }

    private async handleUpdate(args: any): Promise<ToolResponse> {
        const action = args?.action as PrefabUpdateAction | undefined;
        const nodeUuid = this.requireTrimmedString(args?.uuid, 'uuid');
        if (!nodeUuid.success) {
            return nodeUuid.response;
        }

        switch (action) {
            case 'apply':
                return this.toToolResponse(await this.prefab.apply({
                    nodeUuid: nodeUuid.value,
                }));
            case 'revert':
                return this.toToolResponse(await this.prefab.revert({
                    nodeUuid: nodeUuid.value,
                    assetUuid: this.optionalTrimmedString(args?.assetUuid),
                }));
            default:
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown action: ${String(action)}`);
        }
    }

    private toToolResponse(result: { data: unknown; message?: string; warning?: string; instruction?: string }): ToolResponse {
        return {
            success: true,
            data: result.data,
            ...(result.message ? { message: result.message } : {}),
            ...(result.warning ? { warning: result.warning } : {}),
            ...(result.instruction ? { instruction: result.instruction } : {}),
        };
    }

    private optionalTrimmedString(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
    }

    private requireTrimmedString(
        value: unknown,
        fieldName: string,
    ): { success: true; value: string } | { success: false; response: ToolResponse } {
        const normalized = this.optionalTrimmedString(value);
        if (!normalized) {
            return {
                success: false,
                response: makeError(ToolErrorCode.MISSING_REQUIRED, `${fieldName} is required`),
            };
        }

        return {
            success: true,
            value: normalized,
        };
    }

    private normalizePosition(value: unknown): { x: number; y: number; z?: number } | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }

        const position = value as Record<string, unknown>;
        if (typeof position.x !== 'number' || typeof position.y !== 'number') {
            return undefined;
        }

        return {
            x: position.x,
            y: position.y,
            ...(typeof position.z === 'number' ? { z: position.z } : {}),
        };
    }
}
