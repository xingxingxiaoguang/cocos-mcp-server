import { getCapabilityRegistry } from '../../runtime/capability-registry';
import { ToolDefinition, ToolExecutor, ToolResponse } from '../base-tool';
import type { ComponentCapability } from '../../capabilities/component/interface';

export class ComponentToolsV2 implements ToolExecutor {
    private readonly component: ComponentCapability = getCapabilityRegistry().component;

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'query',
                description: 'Query component information. With uuid: list components on a node. With uuid+componentType: get specific component details. action=available: list all available component types. action=classes: query all registered classes. action=scene_components: query all scene components. action=has_script: check if component has script.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID, query components on this node'
                        },
                        componentType: {
                            type: 'string',
                            description: 'Component type name, used with uuid to query specific component details'
                        },
                        action: {
                            type: 'string',
                            enum: ['list', 'info', 'available', 'classes', 'scene_components', 'has_script'],
                            description: 'Query type. With uuid defaults to list. Without uuid, must specify action.'
                        },
                        category: {
                            type: 'string',
                            description: 'Component category filter for action=available',
                            enum: ['all', 'renderer', 'ui', 'physics', 'animation', 'audio'],
                            default: 'all'
                        },
                        extends: {
                            type: 'string',
                            description: 'Filter classes that extend this base class (action=classes)'
                        },
                        scriptPath: {
                            type: 'string',
                            description: 'Script class name for action=has_script'
                        }
                    }
                }
            },
            {
                name: 'add',
                description: 'Add a component to a node. For built-in components use type like "cc.Sprite". For script components use path like "db://assets/scripts/MyScript.ts" or filename like "MyScript.ts".',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Target node UUID'
                        },
                        componentType: {
                            type: 'string',
                            description: 'Component type. Built-in: "cc.Sprite". Script: "db://assets/scripts/MyScript.ts" or "MyScript.ts"'
                        }
                    },
                    required: ['uuid', 'componentType']
                }
            },
            {
                name: 'modify',
                description: 'Modify components on a node. action=set: set property value. action=remove: remove component. action=reset: reset component to defaults. action=execute: execute component method.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID'
                        },
                        action: {
                            type: 'string',
                            enum: ['set', 'remove', 'reset', 'execute'],
                            description: 'Operation type'
                        },
                        componentType: {
                            type: 'string',
                            description: 'Component type name (required for set/remove)'
                        },
                        property: {
                            type: 'string',
                            description: 'Property name for action=set'
                        },
                        propertyType: {
                            type: 'string',
                            description: 'Property data type for correct value conversion',
                            enum: [
                                'string', 'number', 'boolean', 'integer', 'float',
                                'color', 'vec2', 'vec3', 'size',
                                'node', 'component', 'cameraComponent', 'spriteFrame', 'prefab', 'asset',
                                'nodeArray', 'colorArray', 'numberArray', 'stringArray'
                            ]
                        },
                        value: {
                            description: 'Property value for action=set. Format depends on propertyType: color={r,g,b,a}, vec2={x,y}, vec3={x,y,z}, size={width,height}, node/asset="uuid-string", component/cameraComponent="component-uuid-or-node-uuid"'
                        },
                        method: {
                            type: 'string',
                            description: 'Method name for action=execute'
                        },
                        args: {
                            type: 'array',
                            description: 'Method arguments for action=execute'
                        }
                    },
                    required: ['uuid', 'action']
                }
            },
            {
                name: 'batch_set',
                description: 'Set multiple properties on one node in a single call. Shared node/component lookup makes it efficient for many property updates.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: {
                            type: 'string',
                            description: 'Node UUID'
                        },
                        batch: {
                            type: 'array',
                            description: 'Array of component property groups to set',
                            items: {
                                type: 'object',
                                properties: {
                                    componentType: {
                                        type: 'string',
                                        description: 'Target component type'
                                    },
                                    properties: {
                                        type: 'object',
                                        description: 'Property map. Use raw values for common types, or { value, propertyType } for explicit type control.'
                                    }
                                },
                                required: ['componentType', 'properties']
                            }
                        },
                        continueOnError: {
                            type: 'boolean',
                            description: 'Continue processing remaining items after a failure',
                            default: true
                        }
                    },
                    required: ['uuid', 'batch']
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        try {
            switch (toolName) {
                case 'query': {
                    const { uuid, componentType, action, category, scriptPath, className } = args || {};
                    if (uuid && componentType) return this.wrapResult(await this.component.getComponentDetail(uuid, componentType));
                    if (uuid) return this.wrapResult(await this.component.listNodeComponents(uuid));
                    switch (action) {
                        case 'available': return this.wrapResult(await this.component.listAvailableTypes(category));
                        case 'classes': return this.wrapResult(await this.component.listClasses(args?.extends));
                        case 'scene_components': return this.wrapResult(await this.component.listSceneComponents());
                        case 'has_script': return this.wrapResult(await this.component.hasScript(scriptPath || className));
                        default: throw new Error('Must provide uuid or specify action');
                    }
                }
                case 'add': {
                    const result = await this.component.add(args);
                    return { success: true, data: result, message: result.message, warning: result.warning };
                }
                case 'modify': {
                    const result = await this.component.modify(args);
                    return { success: true, data: result, message: result.message, warning: result.warning };
                }
                case 'batch_set': {
                    const result = await this.component.batchSet(args);
                    if (result.failures.length > 0) {
                        return { success: false, error: result.message, data: result };
                    }
                    return { success: true, data: result, message: result.message };
                }
                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    }

    private wrapResult(data: unknown): ToolResponse {
        return { success: true, data };
    }
}
