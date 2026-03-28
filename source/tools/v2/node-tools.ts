import { ToolDefinition, ToolResponse, ToolExecutor, NodeInfo } from '../../types';
import { ComponentToolsV2 } from './component-tools';

export class NodeToolsV2 implements ToolExecutor {
    private componentTools = new ComponentToolsV2();
    private cidNameMap: Map<string, string> | null = null;

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
                            items: { type: 'string' },
                            description: 'Component type names to add (e.g., ["cc.Sprite", "cc.Button"])'
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
        switch (toolName) {
            case 'query':
                return await this.query(args);
            case 'create':
                return await this.createNode(args);
            case 'modify':
                return await this.modify(args);
            case 'delete':
                return await this.deleteNode(args.uuids);
            case 'arrange':
                return await this.arrange(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // ---- node_query ----
    private async query(args: any): Promise<ToolResponse> {
        if (args.uuid) {
            return await this.queryByUuid(args.uuid);
        }
        if (args.pattern) {
            return await this.queryByPattern(args.pattern);
        }
        if (args.assetUuid) {
            return await this.queryByAssetUuid(args.assetUuid);
        }
        return await this.queryAll();
    }

    private async queryByUuid(uuid: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-node', uuid).then(async (nodeData: any) => {
                if (!nodeData) {
                    resolve({ success: false, error: 'Node not found or invalid response' });
                    return;
                }

                const cidMap = await this.buildCidNameMap();

                const info: NodeInfo = {
                    uuid: nodeData.uuid?.value || uuid,
                    name: nodeData.name?.value || 'Unknown',
                    active: nodeData.active?.value !== undefined ? nodeData.active.value : true,
                    position: nodeData.position?.value || { x: 0, y: 0, z: 0 },
                    rotation: nodeData.rotation?.value || { x: 0, y: 0, z: 0 },
                    scale: nodeData.scale?.value || { x: 1, y: 1, z: 1 },
                    parent: nodeData.parent?.value?.uuid || null,
                    children: Array.isArray(nodeData.children)
                        ? nodeData.children.map((child: any) => this.getNodeName(child)).filter(Boolean)
                        : [],
                    components: (nodeData.__comps__ || []).map((comp: any) => ({
                        type: this.resolveComponentType(comp.__type__ || comp.cid || comp.type, cidMap),
                        enabled: this.extractComponentEnabled(comp)
                    })),
                    layer: nodeData.layer?.value || 1073741824,
                    mobility: nodeData.mobility?.value || 0
                };

                // Include node type detection info
                const is2D = this.is2DNode(info);
                resolve({
                    success: true,
                    data: {
                        ...info,
                        nodeType: is2D ? '2D' : '3D'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async queryByPattern(pattern: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-node-tree').then((tree: any) => {
                const nodes: any[] = [];

                const searchTree = (node: any, currentPath: string = '') => {
                    const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;
                    const matches = node.name.toLowerCase().includes(pattern.toLowerCase());

                    if (matches) {
                        nodes.push({
                            uuid: node.uuid,
                            name: node.name,
                            path: nodePath
                        });
                    }

                    if (node.children) {
                        for (const child of node.children) {
                            searchTree(child, nodePath);
                        }
                    }
                };

                if (tree) {
                    searchTree(tree);
                }

                resolve({ success: true, data: nodes });
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'findNodes',
                    args: [pattern, false]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
                    resolve(result);
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Tree search failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }

    private async queryByAssetUuid(assetUuid: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-nodes-by-asset-uuid', assetUuid).then((nodeUuids: string[]) => {
                resolve({
                    success: true,
                    data: {
                        assetUuid,
                        nodeUuids,
                        count: nodeUuids.length,
                        message: `Found ${nodeUuids.length} nodes using asset`
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async queryAll(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-node-tree').then((tree: any) => {
                const nodes: any[] = [];

                const traverseTree = (node: any, currentPath: string = '') => {
                    const nodePath = currentPath ? `${currentPath}/${this.getNodeName(node)}` : this.getNodeName(node);
                    nodes.push({
                        uuid: node.uuid,
                        name: this.getNodeName(node),
                        type: node.type,
                        active: node.active,
                        path: nodePath
                    });

                    if (node.children) {
                        for (const child of node.children) {
                            traverseTree(child, nodePath);
                        }
                    }
                };

                if (Array.isArray(tree)) {
                    for (const root of tree) {
                        traverseTree(root);
                    }
                } else if (tree) {
                    traverseTree(tree);
                }

                resolve({
                    success: true,
                    data: {
                        totalNodes: nodes.length,
                        nodes
                    }
                });
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'getAllNodes',
                    args: []
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
                    resolve(result);
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }

    private getNodeName(node: any): string {
        if (!node) {
            return 'Unknown';
        }
        if (typeof node === 'string') {
            return node;
        }
        return node.name?.value || node.name || node.value?.name?.value || node.value?.name || 'Unknown';
    }

    private async buildCidNameMap(): Promise<Map<string, string>> {
        if (this.cidNameMap) {
            return this.cidNameMap;
        }

        const map = new Map<string, string>();

        const collect = (items: any[]) => {
            for (const item of items) {
                if (item && item.cid && item.name) {
                    map.set(String(item.cid), String(item.name));
                }
            }
        };

        try {
            const result = await Editor.Message.request('scene', 'query-component-function-of-node', '');
            if (Array.isArray(result)) {
                collect(result);
            }
        } catch {
            // fall through
        }

        if (map.size === 0) {
            try {
                const result = await Editor.Message.request('scene', 'query-components');
                if (Array.isArray(result)) {
                    collect(result);
                }
            } catch {
                // best effort
            }
        }

        this.cidNameMap = map;
        return map;
    }

    private resolveComponentType(rawType: any, cidMap: Map<string, string>): string {
        const normalizedType = this.normalizeComponentType(rawType);
        return cidMap.get(normalizedType) || normalizedType;
    }

    private normalizeComponentType(rawType: any): string {
        if (rawType && typeof rawType === 'object') {
            const nested = rawType.value || rawType.cid || rawType.type || rawType.name;
            if (nested !== undefined && nested !== null) {
                if (typeof nested === 'object') {
                    return this.normalizeComponentType(nested);
                }
                return String(nested);
            }
        }
        if (rawType === undefined || rawType === null) {
            return 'Unknown';
        }
        return String(rawType);
    }

    private extractComponentEnabled(comp: any): boolean {
        if (comp?.enabled?.value !== undefined) {
            return !!comp.enabled.value;
        }
        if (comp?.enabled !== undefined) {
            return !!comp.enabled;
        }
        return true;
    }

    // ---- node_create ----
    private async createNode(args: any): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            try {
                let targetParentUuid = args.parentUuid;

                if (!targetParentUuid) {
                    try {
                        const sceneInfo = await Editor.Message.request('scene', 'query-node-tree');
                        if (sceneInfo && typeof sceneInfo === 'object' && !Array.isArray(sceneInfo) && Object.prototype.hasOwnProperty.call(sceneInfo, 'uuid')) {
                            targetParentUuid = (sceneInfo as any).uuid;
                        } else if (Array.isArray(sceneInfo) && sceneInfo.length > 0 && sceneInfo[0].uuid) {
                            targetParentUuid = sceneInfo[0].uuid;
                        } else {
                            const currentScene = await Editor.Message.request('scene', 'query-current-scene');
                            if (currentScene && currentScene.uuid) {
                                targetParentUuid = currentScene.uuid;
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to get scene root, will use default behavior');
                    }
                }

                let finalAssetUuid = args.assetUuid;
                if (args.assetPath && !finalAssetUuid) {
                    try {
                        const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', args.assetPath);
                        if (assetInfo && assetInfo.uuid) {
                            finalAssetUuid = assetInfo.uuid;
                        } else {
                            resolve({ success: false, error: `Asset not found at path: ${args.assetPath}` });
                            return;
                        }
                    } catch (err) {
                        resolve({ success: false, error: `Failed to resolve asset path '${args.assetPath}': ${err}` });
                        return;
                    }
                }

                const createNodeOptions: any = { name: args.name };

                if (targetParentUuid) {
                    createNodeOptions.parent = targetParentUuid;
                }

                if (finalAssetUuid) {
                    createNodeOptions.assetUuid = finalAssetUuid;
                    if (args.unlinkPrefab) {
                        createNodeOptions.unlinkPrefab = true;
                    }
                }

                if (args.components && args.components.length > 0) {
                    createNodeOptions.components = args.components;
                } else if (args.nodeType && args.nodeType !== 'Node' && !finalAssetUuid) {
                    createNodeOptions.components = [args.nodeType];
                }

                if (args.keepWorldTransform) {
                    createNodeOptions.keepWorldTransform = true;
                }

                const nodeUuid = await Editor.Message.request('scene', 'create-node', createNodeOptions);
                const uuid = Array.isArray(nodeUuid) ? nodeUuid[0] : nodeUuid;

                if (args.siblingIndex !== undefined && args.siblingIndex >= 0 && uuid && targetParentUuid) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        await Editor.Message.request('scene', 'set-parent', {
                            parent: targetParentUuid,
                            uuids: [uuid],
                            keepWorldTransform: args.keepWorldTransform || false
                        });
                    } catch (err) {
                        console.warn('Failed to set sibling index:', err);
                    }
                }

                if (args.components && args.components.length > 0 && uuid) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        for (const componentType of args.components) {
                            try {
                                const result = await this.componentTools.execute('add', {
                                    uuid: uuid,
                                    componentType: componentType
                                });
                                if (!result.success) {
                                    console.warn(`Failed to add component ${componentType}:`, result.error);
                                }
                            } catch (err) {
                                console.warn(`Failed to add component ${componentType}:`, err);
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to add components:', err);
                    }
                }

                if (uuid && Array.isArray(args.components) && args.components.some((componentType: string) => this.normalizeComponentType(componentType) === 'cc.Sprite')) {
                    try {
                        await this.ensureDefaultSpriteComponentState(uuid);
                    } catch (err) {
                        console.warn('Failed to apply default Sprite state:', err);
                    }
                }

                if (args.initialTransform && uuid) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 150));
                        await this.setNodeTransform({
                            uuid,
                            position: args.initialTransform.position,
                            rotation: args.initialTransform.rotation,
                            scale: args.initialTransform.scale
                        });
                    } catch (err) {
                        console.warn('Failed to set initial transform:', err);
                    }
                }

                // Return complete node info after creation
                let nodeInfo: any = null;
                try {
                    const infoResponse = await this.queryByUuid(uuid);
                    if (infoResponse.success) {
                        nodeInfo = infoResponse.data;
                    }
                } catch (err) {
                    console.warn('Failed to get verification data:', err);
                }

                resolve({
                    success: true,
                    data: {
                        uuid,
                        name: args.name,
                        parentUuid: targetParentUuid,
                        nodeType: args.nodeType || 'Node',
                        fromAsset: !!finalAssetUuid,
                        assetUuid: finalAssetUuid,
                        message: finalAssetUuid
                            ? `Node '${args.name}' instantiated from asset successfully`
                            : `Node '${args.name}' created successfully`,
                        nodeInfo
                    }
                });

            } catch (err: any) {
                resolve({
                    success: false,
                    error: `Failed to create node: ${err.message}. Args: ${JSON.stringify(args)}`
                });
            }
        });
    }

    private async ensureDefaultSpriteComponentState(nodeUuid: string): Promise<void> {
        const defaultSpriteFrameUuid = await this.resolveDefaultSpriteFrameUuid();
        const batch: any[] = [];

        if (defaultSpriteFrameUuid) {
            batch.push({
                componentType: 'cc.Sprite',
                properties: {
                    spriteFrame: { value: defaultSpriteFrameUuid, propertyType: 'spriteFrame' }
                }
            });
        }

        batch.push({
            componentType: 'cc.Sprite',
            properties: {
                sizeMode: { value: 0, propertyType: 'integer' }
            }
        });

        await this.componentTools.execute('batch_set', {
            uuid: nodeUuid,
            batch,
            continueOnError: true
        });
    }

    private async resolveDefaultSpriteFrameUuid(): Promise<string | null> {
        const candidates = [
            'db://internal/default_ui/default_sprite.png',
            'db://internal/default_ui/default_sprite/default_sprite.spriteframe',
            'db://internal/default_ui/default_sprite',
            'db://internal/default_ui/default_sprite.spriteframe',
            'db://internal/default_ui/default_sprite/default_sprite'
        ];

        for (const candidate of candidates) {
            try {
                const assetInfo: any = await Editor.Message.request('asset-db', 'query-asset-info', candidate);
                if (assetInfo && assetInfo.uuid) {
                    const resolvedUuid = await this.resolveSpriteFrameUuidFromAssetInfo(assetInfo);
                    if (resolvedUuid) {
                        return resolvedUuid;
                    }
                }
            } catch {
                // Try next candidate.
            }
        }

        const searchPatterns = [
            'db://internal/**/default_sprite*',
            'db://internal/**/*default_sprite*.spriteframe',
            'db://internal/default_ui/**/*spriteframe'
        ];

        for (const pattern of searchPatterns) {
            try {
                const assets: any = await Editor.Message.request('asset-db', 'query-assets', { pattern });
                if (!Array.isArray(assets)) {
                    continue;
                }

                const matched = assets.find((asset: any) => {
                    const url = String(asset?.url || asset?.path || asset?.name || '').toLowerCase();
                    const type = String(asset?.type || '').toLowerCase();
                    return type === 'cc.spriteframe' && url.includes('default_sprite');
                }) || assets.find((asset: any) => {
                    const url = String(asset?.url || asset?.path || asset?.name || '').toLowerCase();
                    return url.includes('default_sprite');
                });

                if (matched?.uuid) {
                    return String(matched.uuid);
                }
            } catch {
                // Try next pattern.
            }
        }

        return null;
    }

    private async resolveSpriteFrameUuidFromAssetInfo(assetInfo: any): Promise<string | null> {
        const assetUuid = String(assetInfo?.uuid || '').trim();
        if (!assetUuid) {
            return null;
        }

        const assetType = String(assetInfo?.type || '').toLowerCase();
        if (assetType === 'cc.spriteframe') {
            return assetUuid;
        }

        const subAssets = Array.isArray(assetInfo?.subAssets)
            ? assetInfo.subAssets
            : (assetInfo?.subAssets && Array.isArray(assetInfo.subAssets.value) ? assetInfo.subAssets.value : []);
        if (Array.isArray(subAssets)) {
            const spriteFrameSubAsset = subAssets.find((subAsset: any) => {
                const subType = String(subAsset?.type || '').toLowerCase();
                return subType === 'cc.spriteframe' || subType === 'spriteframe';
            });
            if (spriteFrameSubAsset?.uuid) {
                return String(spriteFrameSubAsset.uuid);
            }
        }

        const spriteFrameUuid = `${assetUuid}@f9941`;
        try {
            const spriteFrameUrl = await Editor.Message.request('asset-db', 'query-url', spriteFrameUuid);
            if (spriteFrameUrl) {
                return spriteFrameUuid;
            }
        } catch {
            // fall back below
        }

        return null;
    }

    // ---- node_modify ----
    private async modify(args: any): Promise<ToolResponse> {
        const { uuid, action } = args;
        switch (action) {
            case 'set_property':
                return await this.setNodeProperty(uuid, args.property, args.value);
            case 'set_transform':
                return await this.setNodeTransform(args);
            case 'reset_property':
                return await this.resetNodeProperty(uuid, args.path);
            case 'reset_transform':
                return await this.resetNodeTransform(uuid);
            default:
                return { success: false, error: `Unknown modify action: ${action}` };
        }
    }

    private async setNodeProperty(uuid: string, property: string, value: any): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'set-property', {
                uuid,
                path: property,
                dump: { value }
            }).then(() => {
                this.queryByUuid(uuid).then((nodeInfo) => {
                    resolve({
                        success: true,
                        message: `Property '${property}' updated successfully`,
                        data: {
                            nodeUuid: uuid,
                            property,
                            newValue: value,
                            nodeInfo: nodeInfo.data
                        }
                    });
                }).catch(() => {
                    resolve({
                        success: true,
                        message: `Property '${property}' updated successfully (verification failed)`
                    });
                });
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'setNodeProperty',
                    args: [uuid, property, value]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
                    resolve(result);
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }

    private async setNodeTransform(args: any): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            const { uuid, position, rotation, scale } = args;
            const updatePromises: Promise<any>[] = [];
            const updates: string[] = [];
            const warnings: string[] = [];

            try {
                const nodeInfoResponse = await this.queryByUuid(uuid);
                if (!nodeInfoResponse.success || !nodeInfoResponse.data) {
                    resolve({ success: false, error: 'Failed to get node information' });
                    return;
                }

                const nodeInfo = nodeInfoResponse.data;
                const is2DNode = this.is2DNode(nodeInfo);

                if (position) {
                    const normalized = this.normalizeTransformValue(position, 'position', is2DNode);
                    if (normalized.warning) warnings.push(normalized.warning);
                    updatePromises.push(
                        Editor.Message.request('scene', 'set-property', {
                            uuid,
                            path: 'position',
                            dump: { value: normalized.value }
                        })
                    );
                    updates.push('position');
                }

                if (rotation) {
                    const normalized = this.normalizeTransformValue(rotation, 'rotation', is2DNode);
                    if (normalized.warning) warnings.push(normalized.warning);
                    updatePromises.push(
                        Editor.Message.request('scene', 'set-property', {
                            uuid,
                            path: 'rotation',
                            dump: { value: normalized.value }
                        })
                    );
                    updates.push('rotation');
                }

                if (scale) {
                    const normalized = this.normalizeTransformValue(scale, 'scale', is2DNode);
                    if (normalized.warning) warnings.push(normalized.warning);
                    updatePromises.push(
                        Editor.Message.request('scene', 'set-property', {
                            uuid,
                            path: 'scale',
                            dump: { value: normalized.value }
                        })
                    );
                    updates.push('scale');
                }

                if (updatePromises.length === 0) {
                    resolve({ success: false, error: 'No transform properties specified' });
                    return;
                }

                await Promise.all(updatePromises);

                const updatedNodeInfo = await this.queryByUuid(uuid);
                const response: any = {
                    success: true,
                    message: `Transform properties updated: ${updates.join(', ')} ${is2DNode ? '(2D node)' : '(3D node)'}`,
                    data: {
                        nodeUuid: uuid,
                        nodeType: is2DNode ? '2D' : '3D',
                        appliedChanges: updates,
                        nodeInfo: updatedNodeInfo.data
                    }
                };

                if (warnings.length > 0) {
                    response.warning = warnings.join('; ');
                }

                resolve(response);

            } catch (err: any) {
                resolve({ success: false, error: `Failed to update transform: ${err.message}` });
            }
        });
    }

    private async resetNodeProperty(uuid: string, path: string): Promise<ToolResponse> {
        try {
            await Editor.Message.request('scene', 'reset-property', {
                uuid,
                path,
                dump: { value: null }
            });
            const nodeInfo = await this.queryByUuid(uuid);
            return {
                success: true,
                message: `Property '${path}' reset to default value`,
                data: { nodeInfo: nodeInfo.data }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async resetNodeTransform(uuid: string): Promise<ToolResponse> {
        try {
            await Editor.Message.request('scene', 'reset-node', { uuid });
            const nodeInfo = await this.queryByUuid(uuid);
            return {
                success: true,
                message: 'Node transform reset to default',
                data: { nodeInfo: nodeInfo.data }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    // ---- node_delete ----
    private async deleteNode(uuids: string | string[]): Promise<ToolResponse> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        try {
            for (const uuid of uuidArray) {
                await Editor.Message.request('scene', 'remove-node', { uuid });
            }
            return {
                success: true,
                message: `${uuidArray.length} node(s) deleted successfully`,
                data: { deletedUuids: uuidArray }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    // ---- node_arrange ----
    private async arrange(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'move':
                return await this.moveNode(args.uuid, args.parentUuid, args.siblingIndex);
            case 'duplicate':
                return await this.duplicateNode(args.uuids);
            case 'copy':
                return await this.copyNode(args.uuids);
            case 'paste':
                return await this.pasteNode(args.parentUuid, args.uuids, args.keepWorldTransform);
            case 'cut':
                return await this.cutNode(args.uuids);
            default:
                return { success: false, error: `Unknown arrange action: ${args.action}` };
        }
    }

    private async moveNode(uuid: string, parentUuid: string, siblingIndex: number = -1): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'set-parent', {
                parent: parentUuid,
                uuids: [uuid],
                keepWorldTransform: false
            }).then(() => {
                resolve({ success: true, message: 'Node moved successfully' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async duplicateNode(uuids: string | string[]): Promise<ToolResponse> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        try {
            const results: any[] = [];
            for (const uuid of uuidArray) {
                const result = await Editor.Message.request('scene', 'duplicate-node', uuid);
                results.push(result);
            }
            return {
                success: true,
                data: {
                    newNodes: results,
                    message: `${uuidArray.length} node(s) duplicated successfully`
                }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async copyNode(uuids: string | string[]): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'copy-node', uuids).then((result: string | string[]) => {
                resolve({
                    success: true,
                    data: {
                        copiedUuids: result,
                        message: 'Node(s) copied successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async pasteNode(parentUuid: string, uuids: string | string[], keepWorldTransform: boolean = false): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'paste-node', {
                target: parentUuid,
                uuids,
                keepWorldTransform
            }).then((result: string | string[]) => {
                resolve({
                    success: true,
                    data: {
                        newUuids: result,
                        message: 'Node(s) pasted successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async cutNode(uuids: string | string[]): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'cut-node', uuids).then((result: any) => {
                resolve({
                    success: true,
                    data: {
                        cutUuids: result,
                        message: 'Node(s) cut successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ---- Utility methods ----
    private is2DNode(nodeInfo: any): boolean {
        const components = nodeInfo.components || [];

        const has2DComponents = components.some((comp: any) =>
            comp.type && (
                comp.type.includes('cc.Sprite') ||
                comp.type.includes('cc.Label') ||
                comp.type.includes('cc.Button') ||
                comp.type.includes('cc.Layout') ||
                comp.type.includes('cc.Widget') ||
                comp.type.includes('cc.Mask') ||
                comp.type.includes('cc.Graphics')
            )
        );

        if (has2DComponents) return true;

        const has3DComponents = components.some((comp: any) =>
            comp.type && (
                comp.type.includes('cc.MeshRenderer') ||
                comp.type.includes('cc.Camera') ||
                comp.type.includes('cc.Light') ||
                comp.type.includes('cc.DirectionalLight') ||
                comp.type.includes('cc.PointLight') ||
                comp.type.includes('cc.SpotLight')
            )
        );

        if (has3DComponents) return false;

        const position = nodeInfo.position;
        if (position && Math.abs(position.z) < 0.001) return true;

        return false;
    }

    private normalizeTransformValue(value: any, type: 'position' | 'rotation' | 'scale', is2D: boolean): { value: any, warning?: string } {
        const result = { ...value };
        let warning: string | undefined;

        if (is2D) {
            switch (type) {
                case 'position':
                    if (value.z !== undefined && Math.abs(value.z) > 0.001) {
                        warning = `2D node: z position (${value.z}) ignored, set to 0`;
                        result.z = 0;
                    } else if (value.z === undefined) {
                        result.z = 0;
                    }
                    break;
                case 'rotation':
                    if ((value.x !== undefined && Math.abs(value.x) > 0.001) ||
                        (value.y !== undefined && Math.abs(value.y) > 0.001)) {
                        warning = '2D node: x,y rotations ignored, only z rotation applied';
                        result.x = 0;
                        result.y = 0;
                    } else {
                        result.x = result.x || 0;
                        result.y = result.y || 0;
                    }
                    result.z = result.z || 0;
                    break;
                case 'scale':
                    if (value.z === undefined) {
                        result.z = 1;
                    }
                    break;
            }
        } else {
            result.x = result.x !== undefined ? result.x : (type === 'scale' ? 1 : 0);
            result.y = result.y !== undefined ? result.y : (type === 'scale' ? 1 : 0);
            result.z = result.z !== undefined ? result.z : (type === 'scale' ? 1 : 0);
        }

        return { value: result, warning };
    }
}
