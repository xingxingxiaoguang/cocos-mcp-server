import { getCapabilityRegistry } from '../../runtime/capability-registry';
import { ToolDefinition, ToolExecutor, ToolResponse } from '../base-tool';
import type { NodeCapability } from '../../capabilities/node/interface';

export class NodeToolsV2 implements ToolExecutor {
    private readonly node: NodeCapability = getCapabilityRegistry().node;

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'query',
                description: 'Query node information. With uuid: single node details. With pattern: search by name. With assetUuid: find nodes using an asset. No params: list all nodes.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID, query single node details'
                        },
                        pattern: {
                            type: 'string',
                            description: 'Name match pattern, supports partial match'
                        },
                        assetUuid: {
                            type: 'string',
                            description: 'Asset UUID, query nodes referencing this asset'
                        }
                    }
                }
            },
            {
                name: 'create',
                description: 'Create a new node in the scene. Supports creating empty nodes, nodes with components, or instantiating from assets (prefabs, etc.). Always provide parentUuid to specify where to create the node.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Node name'
                        },
                        parentUuid: {
                            type: 'string',
                            description: 'Parent node UUID. STRONGLY RECOMMENDED. Use scene_query or node_query to find UUIDs. If not provided, node is created at scene root.'
                        },
                        nodeType: {
                            type: 'string',
                            enum: ['Node', '2DNode', '3DNode'],
                            description: 'Node type',
                            default: 'Node'
                        },
                        siblingIndex: {
                            type: 'number',
                            description: 'Sibling index for ordering (-1 means append at end)',
                            default: -1
                        },
                        assetUuid: {
                            type: 'string',
                            description: 'Asset UUID to instantiate from (e.g., prefab UUID)'
                        },
                        assetPath: {
                            type: 'string',
                            description: 'Asset path to instantiate from (e.g., "db://assets/prefabs/MyPrefab.prefab"). Alternative to assetUuid.'
                        },
                        components: {
                            type: 'array',
                            items: {
                                oneOf: [
                                    { type: 'string', description: 'Component type name (e.g., "cc.Sprite")' },
                                    {
                                        type: 'object',
                                        properties: {
                                            type: {
                                                type: 'string',
                                                description: 'Component type name (e.g., "cc.Sprite" or a script path)'
                                            },
                                            properties: {
                                                type: 'object',
                                                description: 'Inline property values to apply after the component is added'
                                            }
                                        },
                                        required: ['type']
                                    }
                                ]
                            },
                            description: 'Component type names or inline component specs. Object specs support immediate property initialization.'
                        },
                        unlinkPrefab: {
                            type: 'boolean',
                            description: 'If true and creating from prefab, unlink to create a regular node',
                            default: false
                        },
                        keepWorldTransform: {
                            type: 'boolean',
                            description: 'Whether to keep world transform when creating the node',
                            default: false
                        },
                        initialTransform: {
                            type: 'object',
                            properties: {
                                position: {
                                    type: 'object',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                        z: { type: 'number' }
                                    }
                                },
                                rotation: {
                                    type: 'object',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                        z: { type: 'number' }
                                    }
                                },
                                scale: {
                                    type: 'object',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                        z: { type: 'number' }
                                    }
                                }
                            },
                            description: 'Initial transform to apply to the created node'
                        }
                    },
                    required: ['name']
                }
            },
            {
                name: 'batch_create',
                description: 'Create multiple nodes in one call. Each node supports the same inline component property syntax as node_create.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        parentUuid: {
                            type: 'string',
                            description: 'Default parent node UUID for created nodes'
                        },
                        nodes: {
                            type: 'array',
                            description: 'Array of node specs to create',
                            items: {
                                type: 'object',
                                properties: {
                                    name: {
                                        type: 'string',
                                        description: 'Node name'
                                    },
                                    parentUuid: {
                                        type: 'string',
                                        description: 'Optional per-node parent UUID override'
                                    },
                                    nodeType: {
                                        type: 'string',
                                        enum: ['Node', '2DNode', '3DNode'],
                                        description: 'Node type',
                                        default: 'Node'
                                    },
                                    siblingIndex: {
                                        type: 'number',
                                        description: 'Sibling index for ordering (-1 means append at end)',
                                        default: -1
                                    },
                                    assetUuid: {
                                        type: 'string',
                                        description: 'Asset UUID to instantiate from (e.g., prefab UUID)'
                                    },
                                    assetPath: {
                                        type: 'string',
                                        description: 'Asset path to instantiate from (e.g., db://assets/prefabs/MyPrefab.prefab)'
                                    },
                                    components: {
                                        oneOf: [
                                            {
                                                type: 'array',
                                                items: {
                                                    oneOf: [
                                                        { type: 'string' },
                                                        {
                                                            type: 'object',
                                                            properties: {
                                                                type: { type: 'string' },
                                                                properties: { type: 'object' }
                                                            },
                                                            required: ['type']
                                                        }
                                                    ]
                                                },
                                                description: 'Component specs for this node'
                                            },
                                            {
                                                type: 'string',
                                                enum: ['same_as_previous'],
                                                description: 'Reuse the previous node component specs'
                                            }
                                        ]
                                    },
                                    unlinkPrefab: {
                                        type: 'boolean',
                                        description: 'If true and creating from prefab, unlink to create a regular node',
                                        default: false
                                    },
                                    keepWorldTransform: {
                                        type: 'boolean',
                                        description: 'Whether to keep world transform when creating the node',
                                        default: false
                                    },
                                    initialTransform: {
                                        type: 'object',
                                        properties: {
                                            position: {
                                                type: 'object',
                                                properties: {
                                                    x: { type: 'number' },
                                                    y: { type: 'number' },
                                                    z: { type: 'number' }
                                                }
                                            },
                                            rotation: {
                                                type: 'object',
                                                properties: {
                                                    x: { type: 'number' },
                                                    y: { type: 'number' },
                                                    z: { type: 'number' }
                                                }
                                            },
                                            scale: {
                                                type: 'object',
                                                properties: {
                                                    x: { type: 'number' },
                                                    y: { type: 'number' },
                                                    z: { type: 'number' }
                                                }
                                            }
                                        },
                                        description: 'Initial transform to apply to the created node'
                                    }
                                },
                                required: ['name']
                            }
                        }
                    },
                    required: ['nodes']
                }
            },
            {
                name: 'modify',
                description: 'Modify node properties or transform. action=set_property: set a property, action=set_transform: set position/rotation/scale (auto 2D/3D detection), action=reset_property: reset property to default, action=reset_transform: reset transform to default.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID'
                        },
                        action: {
                            type: 'string',
                            enum: ['set_property', 'set_transform', 'reset_property', 'reset_transform'],
                            description: 'Operation type'
                        },
                        property: {
                            type: 'string',
                            description: 'action=set_property: property path (e.g., active, name, layer)'
                        },
                        value: {
                            description: 'action=set_property: property value'
                        },
                        position: {
                            type: 'object',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                                z: { type: 'number' }
                            },
                            description: 'action=set_transform: position {x,y,z}'
                        },
                        rotation: {
                            type: 'object',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                                z: { type: 'number' }
                            },
                            description: 'action=set_transform: rotation in euler angles {x,y,z}'
                        },
                        scale: {
                            type: 'object',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                                z: { type: 'number' }
                            },
                            description: 'action=set_transform: scale {x,y,z}'
                        },
                        path: {
                            type: 'string',
                            description: 'action=reset_property: property path to reset'
                        }
                    },
                    required: ['uuid', 'action']
                }
            },
            {
                name: 'delete',
                description: 'Delete node(s) from the scene',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuids: {
                            oneOf: [
                                { type: 'string' },
                                { type: 'array', items: { type: 'string' } }
                            ],
                            description: 'Node UUID(s) to delete, supports single string or array'
                        }
                    },
                    required: ['uuids']
                }
            },
            {
                name: 'arrange',
                description: 'Organize nodes: move, duplicate, copy, paste, cut',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['move', 'duplicate', 'copy', 'paste', 'cut'],
                            description: 'Operation type'
                        },
                        uuid: {
                            type: 'string',
                            description: 'action=move: node UUID to move'
                        },
                        parentUuid: {
                            type: 'string',
                            description: 'action=move/paste: target parent node UUID'
                        },
                        siblingIndex: {
                            type: 'number',
                            description: 'action=move: sibling index in new parent',
                            default: -1
                        },
                        uuids: {
                            oneOf: [
                                { type: 'string' },
                                { type: 'array', items: { type: 'string' } }
                            ],
                            description: 'action=duplicate/copy/cut/paste: node UUID(s)'
                        },
                        keepWorldTransform: {
                            type: 'boolean',
                            description: 'action=paste: keep world transform coordinates',
                            default: false
                        }
                    },
                    required: ['action']
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        try {
            switch (toolName) {
                case 'query': {
                    if (args?.uuid) return { success: true, data: await this.node.queryByUuid(args.uuid) };
                    if (args?.pattern) return { success: true, data: await this.node.searchByName(args.pattern) };
                    if (args?.assetUuid) return { success: true, data: await this.node.queryAssetUsage(args.assetUuid) };
                    return { success: true, data: await this.node.listAll() };
                }
                case 'create': {
                    const r = await this.node.create(args);
                    const { message, ...data } = r;
                    return { success: true, data, message };
                }
                case 'batch_create': {
                    const result = await this.node.batchCreate(args);
                    return { success: result.failures.length === 0, data: result, message: result.message };
                }
                case 'modify': {
                    const r = await this.node.modify(args);
                    const { message, warning, ...data } = r;
                    return { success: true, data, message, warning };
                }
                case 'delete': {
                    const r = await this.node.delete(args.uuids);
                    const { message, ...data } = r;
                    return { success: true, data, message };
                }
                case 'arrange': {
                    const r = await this.node.arrange(args);
                    const { message, ...data } = r;
                    return { success: true, data, message };
                }
                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    }
}
