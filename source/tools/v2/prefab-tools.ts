import { ToolDefinition, ToolResponse, ToolExecutor, PrefabInfo } from '../../types';
import { PrefabTools } from '../prefab-tools';

export class PrefabToolsV2 implements ToolExecutor {
    private legacyPrefabTools = new PrefabTools();

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
                        // from_node params
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
                        // instantiate params
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
                        // duplicate params
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
            case 'query':
                return await this.handleQuery(args);
            case 'create':
                return await this.handleCreate(args);
            case 'update':
                return await this.handleUpdate(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // ============================================================
    // Query handler
    // ============================================================

    private async handleQuery(args: any): Promise<ToolResponse> {
        const { prefabPath, folder } = args;

        if (prefabPath) {
            // Get detailed prefab info (combined from getPrefabInfo + validatePrefab + loadPrefab)
            return await this.getPrefabDetails(prefabPath);
        }
        // List all prefabs
        return await this.getPrefabList(folder || 'db://assets');
    }

    private async getPrefabList(folder: string = 'db://assets'): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const pattern = folder.endsWith('/') ?
                `${folder}**/*.prefab` : `${folder}/**/*.prefab`;

            Editor.Message.request('asset-db', 'query-assets', {
                pattern: pattern
            }).then((results: any[]) => {
                const prefabs: PrefabInfo[] = results.map(asset => ({
                    name: asset.name,
                    path: asset.url,
                    uuid: asset.uuid,
                    folder: asset.url.substring(0, asset.url.lastIndexOf('/'))
                }));
                resolve({ success: true, data: prefabs });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async getPrefabDetails(prefabPath: string): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            try {
                // Get asset info
                const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', prefabPath);
                if (!assetInfo) {
                    resolve({ success: false, error: 'Prefab not found' });
                    return;
                }

                // Get metadata
                let metaInfo: any = null;
                try {
                    metaInfo = await Editor.Message.request('asset-db', 'query-asset-meta', assetInfo.uuid);
                } catch {
                    // metadata optional
                }

                // Validate format
                let validation: any = null;
                try {
                    const content = await Editor.Message.request('asset-db', 'read-asset', prefabPath);
                    const prefabData = JSON.parse(content);
                    validation = this.validatePrefabFormat(prefabData);
                } catch {
                    // validation optional
                }

                const info: any = {
                    name: assetInfo.name || (metaInfo && metaInfo.name),
                    uuid: assetInfo.uuid,
                    path: prefabPath,
                    folder: prefabPath.substring(0, prefabPath.lastIndexOf('/')),
                };

                if (metaInfo) {
                    info.createTime = metaInfo.createTime;
                    info.modifyTime = metaInfo.modifyTime;
                    info.dependencies = metaInfo.depends || [];
                }

                if (validation) {
                    info.validation = {
                        isValid: validation.isValid,
                        issues: validation.issues,
                        nodeCount: validation.nodeCount,
                        componentCount: validation.componentCount
                    };
                }

                resolve({ success: true, data: info });
            } catch (err: any) {
                resolve({ success: false, error: err.message });
            }
        });
    }

    private validatePrefabFormat(prefabData: any): { isValid: boolean; issues: string[]; nodeCount: number; componentCount: number } {
        const issues: string[] = [];
        let nodeCount = 0;
        let componentCount = 0;

        if (!Array.isArray(prefabData)) {
            issues.push('Prefab data must be an array');
            return { isValid: false, issues, nodeCount, componentCount };
        }
        if (prefabData.length === 0) {
            issues.push('Prefab data is empty');
            return { isValid: false, issues, nodeCount, componentCount };
        }

        const firstElement = prefabData[0];
        if (!firstElement || firstElement.__type__ !== 'cc.Prefab') {
            issues.push('First element must be cc.Prefab type');
        }

        prefabData.forEach((item: any) => {
            if (item.__type__ === 'cc.Node') nodeCount++;
            else if (item.__type__ && item.__type__.includes('cc.')) componentCount++;
        });

        if (nodeCount === 0) {
            issues.push('Prefab must contain at least one node');
        }

        return { isValid: issues.length === 0, issues, nodeCount, componentCount };
    }

    // ============================================================
    // Create handler
    // ============================================================

    private async handleCreate(args: any): Promise<ToolResponse> {
        const { action } = args;

        switch (action) {
            case 'from_node':
                return await this.createPrefabFromNode(args);
            case 'instantiate':
                return await this.instantiatePrefab(args);
            case 'duplicate':
                return await this.duplicatePrefab(args);
            default:
                return { success: false, error: `Unknown action: ${action}. Must be one of: from_node, instantiate, duplicate` };
        }
    }

    private async createPrefabFromNode(args: any): Promise<ToolResponse> {
        const nodeUuid = args.uuid;
        const savePath = args.savePath;
        const prefabName = args.prefabName || 'NewPrefab';

        if (!nodeUuid) {
            return { success: false, error: 'Missing uuid: source node UUID is required for action=from_node' };
        }
        if (!savePath) {
            return { success: false, error: 'Missing savePath: save path is required for action=from_node' };
        }

        // Delegate to legacy PrefabTools which has the complex multi-strategy creation logic
        return await this.legacyPrefabTools.execute('create_prefab', {
            nodeUuid,
            savePath,
            prefabName
        });
    }

    private async instantiatePrefab(args: any): Promise<ToolResponse> {
        const { prefabPath, parentUuid, position } = args;

        if (!prefabPath) {
            return { success: false, error: 'Missing prefabPath: prefab path is required for action=instantiate' };
        }

        return new Promise(async (resolve) => {
            try {
                const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', prefabPath);
                if (!assetInfo) {
                    resolve({ success: false, error: 'Prefab not found' });
                    return;
                }

                const createNodeOptions: any = {
                    assetUuid: assetInfo.uuid
                };

                if (parentUuid) {
                    createNodeOptions.parent = parentUuid;
                }
                if (typeof args.name === 'string' && args.name.trim()) {
                    createNodeOptions.name = args.name.trim();
                } else if (assetInfo.name) {
                    createNodeOptions.name = assetInfo.name;
                }
                if (position) {
                    createNodeOptions.dump = {
                        position: { value: position }
                    };
                }

                const nodeUuid = await Editor.Message.request('scene', 'create-node', createNodeOptions);
                const uuid = Array.isArray(nodeUuid) ? nodeUuid[0] : nodeUuid;

                resolve({
                    success: true,
                    data: {
                        nodeUuid: uuid,
                        prefabPath,
                        parentUuid,
                        position,
                        message: 'Prefab instantiated successfully'
                    }
                });
            } catch (err: any) {
                resolve({
                    success: false,
                    error: `Prefab instantiation failed: ${err.message}`,
                    instruction: 'Please check that the prefab path is correct and the prefab file format is valid'
                });
            }
        });
    }

    private async duplicatePrefab(args: any): Promise<ToolResponse> {
        const sourcePath = args.sourcePath;
        const targetPath = args.targetPath;

        if (!sourcePath) {
            return { success: false, error: 'Missing sourcePath: source prefab path is required for action=duplicate' };
        }
        if (!targetPath) {
            return { success: false, error: 'Missing targetPath: target path is required for action=duplicate' };
        }

        // Delegate to legacy PrefabTools
        return await this.legacyPrefabTools.execute('duplicate_prefab', {
            sourcePrefabPath: sourcePath,
            targetPrefabPath: targetPath,
            newPrefabName: args.prefabName
        });
    }

    // ============================================================
    // Update handler
    // ============================================================

    private async handleUpdate(args: any): Promise<ToolResponse> {
        const { action, uuid, assetUuid } = args;

        switch (action) {
            case 'apply':
                return await this.applyPrefab(uuid);
            case 'revert':
                return await this.revertPrefab(uuid, assetUuid);
            default:
                return { success: false, error: `Unknown action: ${action}. Must be one of: apply, revert` };
        }
    }

    private async applyPrefab(nodeUuid: string): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            try {
                // Get the node's prefab info to find the prefab asset UUID
                const nodeData = await Editor.Message.request('scene', 'query-node', nodeUuid);
                if (!nodeData) {
                    resolve({ success: false, error: 'Node not found' });
                    return;
                }

                // Try apply-prefab with node UUID directly
                await Editor.Message.request('scene', 'apply-prefab', {
                    node: nodeUuid
                });

                resolve({
                    success: true,
                    message: 'Prefab updated successfully',
                    data: { nodeUuid }
                });
            } catch (err: any) {
                resolve({ success: false, error: `Failed to apply prefab: ${err.message}` });
            }
        });
    }

    private async revertPrefab(nodeUuid: string, assetUuid?: string): Promise<ToolResponse> {
        // Try multiple revert strategies, from most to least specific

        // Strategy 1: If assetUuid provided, use restore-prefab API (from SceneAdvancedTools.restorePrefab + PrefabTools.restorePrefabNode)
        if (assetUuid) {
            try {
                await (Editor.Message.request as any)('scene', 'restore-prefab', nodeUuid, assetUuid);
                return {
                    success: true,
                    message: 'Prefab restored successfully',
                    data: { nodeUuid, assetUuid }
                };
            } catch (err: any) {
                console.warn(`[PrefabToolsV2] restore-prefab failed, trying revert-prefab:`, err.message);
            }
        }

        // Strategy 2: Use revert-prefab API (from PrefabTools.revertPrefab)
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'revert-prefab', {
                node: nodeUuid
            }).then(() => {
                resolve({
                    success: true,
                    message: 'Prefab instance reverted successfully',
                    data: { nodeUuid }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: `Failed to revert prefab: ${err.message}` });
            });
        });
    }
}
