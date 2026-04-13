import { getCapabilityRegistry } from '../../runtime/capability-registry';
import { ToolDefinition, ToolExecutor, ToolResponse } from '../../mcp/interface';
import type { PrefabCapability } from '../../capabilities/prefab/interface';

export class PrefabToolsV2 implements ToolExecutor {
    private readonly prefab: PrefabCapability = getCapabilityRegistry().prefab;

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'query',
                description: 'Query prefab information. With prefabPath: get detailed prefab info (metadata + validation). Without prefabPath: list all prefabs in project.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        prefabPath: {
                            type: 'string',
                            description: 'Prefab path, e.g. db://assets/prefabs/Player.prefab'
                        },
                        folder: {
                            type: 'string',
                            description: 'Restrict search to this folder (only when listing)',
                            default: 'db://assets'
                        }
                    }
                }
            },
            {
                name: 'create',
                description: 'Create, instantiate, or duplicate a prefab. action=from_node: create prefab from existing node. action=instantiate: instantiate prefab in scene. action=duplicate: duplicate a prefab asset.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['from_node', 'instantiate', 'duplicate'],
                            description: 'Operation type'
                        },
                        uuid: {
                            type: 'string',
                            description: 'Source node UUID (action=from_node)'
                        },
                        savePath: {
                            type: 'string',
                            description: 'Save path for new prefab (action=from_node), e.g. db://assets/prefabs/MyPrefab.prefab'
                        },
                        prefabName: {
                            type: 'string',
                            description: 'Prefab name (action=from_node)'
                        },
                        prefabPath: {
                            type: 'string',
                            description: 'Prefab path (action=instantiate)'
                        },
                        parentUuid: {
                            type: 'string',
                            description: 'Parent node UUID (action=instantiate)'
                        },
                        name: {
                            type: 'string',
                            description: 'Custom node name for the instantiated prefab (action=instantiate). If omitted, the prefab asset name is used.'
                        },
                        position: {
                            type: 'object',
                            description: 'Initial position (action=instantiate)',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                                z: { type: 'number' }
                            }
                        },
                        sourcePath: {
                            type: 'string',
                            description: 'Source prefab path (action=duplicate)'
                        },
                        targetPath: {
                            type: 'string',
                            description: 'Target path (action=duplicate)'
                        }
                    },
                    required: ['action']
                }
            },
            {
                name: 'update',
                description: 'Update or revert a prefab instance. action=apply: save instance modifications back to prefab asset. action=revert: revert instance to original prefab state.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['apply', 'revert'],
                            description: 'apply=save changes to prefab asset, revert=restore instance to original state'
                        },
                        uuid: {
                            type: 'string',
                            description: 'Prefab instance node UUID'
                        },
                        assetUuid: {
                            type: 'string',
                            description: 'Prefab asset UUID (optional, for revert with restore-prefab API)'
                        }
                    },
                    required: ['action', 'uuid']
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'query': {
                if (args?.prefabPath) {
                    return { success: true, data: await this.prefab.query({ prefabPath: args.prefabPath }) };
                }
                const result = await this.prefab.list({ folder: args?.folder });
                return { success: true, data: result.prefabs };
            }
            case 'create':
                switch (args?.action) {
                    case 'from_node':
                        return this.toResponse(await this.prefab.createFromNode({
                            nodeUuid: args.uuid,
                            savePath: args.savePath,
                            prefabName: args.prefabName,
                        }));
                    case 'instantiate':
                        return this.toResponse(await this.prefab.instantiate({
                            prefabPath: args.prefabPath,
                            parentUuid: args.parentUuid,
                            name: args.name,
                            position: args.position,
                        }));
                    case 'duplicate':
                        return this.toResponse(await this.prefab.duplicate({
                            sourcePath: args.sourcePath,
                            targetPath: args.targetPath,
                            prefabName: args.prefabName,
                        }));
                    default:
                        throw new Error(`Unknown create action: ${args?.action}`);
                }
            case 'update':
                switch (args?.action) {
                    case 'apply': {
                        const result = await this.prefab.apply({ nodeUuid: args.uuid });
                        return { success: true, data: result, message: result.message };
                    }
                    case 'revert': {
                        const result = await this.prefab.revert({
                            nodeUuid: args.uuid,
                            assetUuid: args.assetUuid,
                        });
                        return { success: true, data: result, message: result.message };
                    }
                    default:
                        throw new Error(`Unknown update action: ${args?.action}`);
                }
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private toResponse(result: { data: unknown; message?: string; warning?: string; instruction?: string }): ToolResponse {
        return {
            success: true,
            data: result.data,
            ...(result.message ? { message: result.message } : {}),
            ...(result.warning ? { warning: result.warning } : {}),
            ...(result.instruction ? { instruction: result.instruction } : {}),
        };
    }
}
