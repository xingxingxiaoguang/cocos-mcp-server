import { ToolDefinition, ToolExecutor, ToolResponse } from '../../mcp/interface';
import { SceneInfo } from './scene/interface';

export class SceneToolsV2 implements ToolExecutor {
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

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'query':
                return await this.query(args);
            case 'open':
                return await this.open(args.scenePath);
            case 'save':
                return await this.save(args);
            case 'create':
                return await this.create(args.sceneName, args.savePath);
            case 'manage':
                return await this.manage(args.action);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // ---- scene_query ----
    private async query(args: any): Promise<ToolResponse> {
        const action = args.action || 'info';
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
                return { success: false, error: `Unknown query action: ${action}` };
        }
    }

    private async queryInfo(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-node-tree').then((tree: any) => {
                if (tree && tree.uuid) {
                    resolve({
                        success: true,
                        data: {
                            name: tree.name || 'Current Scene',
                            uuid: tree.uuid,
                            type: tree.type || 'cc.Scene',
                            active: tree.active !== undefined ? tree.active : true,
                            nodeCount: tree.children ? tree.children.length : 0
                        }
                    });
                } else {
                    resolve({ success: false, error: 'No scene data available' });
                }
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'getCurrentSceneInfo',
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

    private async queryHierarchy(includeComponents: boolean = false): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-node-tree').then((tree: any) => {
                if (tree) {
                    const hierarchy = this.buildHierarchy(tree, includeComponents);
                    resolve({ success: true, data: hierarchy });
                } else {
                    resolve({ success: false, error: 'No scene hierarchy available' });
                }
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'getSceneHierarchy',
                    args: [includeComponents]
                };
                Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
                    resolve(result);
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }

    private buildHierarchy(node: any, includeComponents: boolean): any {
        const nodeInfo: any = {
            uuid: node.uuid,
            name: node.name,
            type: node.type,
            active: node.active,
            children: []
        };

        if (includeComponents && node.__comps__) {
            nodeInfo.components = node.__comps__.map((comp: any) => ({
                type: this.normalizeComponentType(comp.__type__),
                enabled: this.extractComponentEnabled(comp)
            }));
        }

        if (node.children) {
            nodeInfo.children = node.children.map((child: any) =>
                this.buildHierarchy(child, includeComponents)
            );
        }

        return nodeInfo;
    }

    private normalizeComponentType(rawType: any): string {
        if (rawType && typeof rawType === 'object') {
            const nested = rawType.value || rawType.cid || rawType.type || rawType.name;
            if (nested !== undefined && nested !== null) {
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

    private async queryList(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'query-assets', {
                pattern: 'db://assets/**/*.scene'
            }).then((results: any[]) => {
                const scenes: SceneInfo[] = results.map(asset => ({
                    name: asset.name,
                    path: asset.url,
                    uuid: asset.uuid
                }));
                resolve({ success: true, data: scenes });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async queryStatus(): Promise<ToolResponse> {
        try {
            const [ready, dirty] = await Promise.all([
                Editor.Message.request('scene', 'query-is-ready') as Promise<boolean>,
                Editor.Message.request('scene', 'query-dirty') as Promise<boolean>
            ]);
            return {
                success: true,
                data: {
                    ready,
                    dirty,
                    message: `Scene is ${ready ? 'ready' : 'not ready'}, ${dirty ? 'has unsaved changes' : 'clean'}`
                }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    // ---- scene_open ----
    private async open(scenePath: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('asset-db', 'query-uuid', scenePath).then((uuid: string | null) => {
                if (!uuid) {
                    throw new Error('Scene not found');
                }
                return Editor.Message.request('scene', 'open-scene', uuid);
            }).then(() => {
                resolve({ success: true, message: `Scene opened: ${scenePath}` });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ---- scene_save ----
    private async save(args: any): Promise<ToolResponse> {
        const action = args.action || 'save';
        switch (action) {
            case 'save':
                return await this.saveScene();
            case 'save_as':
                return await this.saveSceneAs(args.path);
            case 'close':
                return await this.closeScene();
            default:
                return { success: false, error: `Unknown save action: ${action}` };
        }
    }

    private async saveScene(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'save-scene').then(() => {
                resolve({ success: true, message: 'Scene saved successfully' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async saveSceneAs(path: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            (Editor.Message.request as any)('scene', 'save-as-scene').then(() => {
                resolve({
                    success: true,
                    data: {
                        path: path,
                        message: 'Scene save-as dialog opened'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async closeScene(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'close-scene').then(() => {
                resolve({ success: true, message: 'Scene closed successfully' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ---- scene_create ----
    private async create(sceneName: string, savePath: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            const fullPath = savePath.endsWith('.scene') ? savePath : `${savePath}/${sceneName}.scene`;

            const sceneContent = JSON.stringify([
                {
                    "__type__": "cc.SceneAsset",
                    "_name": sceneName,
                    "_objFlags": 0,
                    "__editorExtras__": {},
                    "_native": "",
                    "scene": { "__id__": 1 }
                },
                {
                    "__type__": "cc.Scene",
                    "_name": sceneName,
                    "_objFlags": 0,
                    "__editorExtras__": {},
                    "_parent": null,
                    "_children": [],
                    "_active": true,
                    "_components": [],
                    "_prefab": null,
                    "_lpos": { "__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0 },
                    "_lrot": { "__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1 },
                    "_lscale": { "__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1 },
                    "_mobility": 0,
                    "_layer": 1073741824,
                    "_euler": { "__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0 },
                    "autoReleaseAssets": false,
                    "_globals": { "__id__": 2 },
                    "_id": "scene"
                },
                {
                    "__type__": "cc.SceneGlobals",
                    "ambient": { "__id__": 3 },
                    "skybox": { "__id__": 4 },
                    "fog": { "__id__": 5 },
                    "octree": { "__id__": 6 }
                },
                {
                    "__type__": "cc.AmbientInfo",
                    "_skyColorHDR": { "__type__": "cc.Vec4", "x": 0.2, "y": 0.5, "z": 0.8, "w": 0.520833 },
                    "_skyColor": { "__type__": "cc.Vec4", "x": 0.2, "y": 0.5, "z": 0.8, "w": 0.520833 },
                    "_skyIllumHDR": 20000,
                    "_skyIllum": 20000,
                    "_groundAlbedoHDR": { "__type__": "cc.Vec4", "x": 0.2, "y": 0.2, "z": 0.2, "w": 1 },
                    "_groundAlbedo": { "__type__": "cc.Vec4", "x": 0.2, "y": 0.2, "z": 0.2, "w": 1 }
                },
                {
                    "__type__": "cc.SkyboxInfo",
                    "_envLightingType": 0,
                    "_envmapHDR": null,
                    "_envmap": null,
                    "_envmapLodCount": 0,
                    "_diffuseMapHDR": null,
                    "_diffuseMap": null,
                    "_enabled": false,
                    "_useHDR": true,
                    "_editableMaterial": null,
                    "_reflectionHDR": null,
                    "_reflectionMap": null,
                    "_rotationAngle": 0
                },
                {
                    "__type__": "cc.FogInfo",
                    "_type": 0,
                    "_fogColor": { "__type__": "cc.Color", "r": 200, "g": 200, "b": 200, "a": 255 },
                    "_enabled": false,
                    "_fogDensity": 0.3,
                    "_fogStart": 0.5,
                    "_fogEnd": 300,
                    "_fogAtten": 5,
                    "_fogTop": 1.5,
                    "_fogRange": 1.2,
                    "_accurate": false
                },
                {
                    "__type__": "cc.OctreeInfo",
                    "_enabled": false,
                    "_minPos": { "__type__": "cc.Vec3", "x": -1024, "y": -1024, "z": -1024 },
                    "_maxPos": { "__type__": "cc.Vec3", "x": 1024, "y": 1024, "z": 1024 },
                    "_depth": 8
                }
            ], null, 2);

            Editor.Message.request('asset-db', 'create-asset', fullPath, sceneContent).then((result: any) => {
                this.queryList().then((sceneList) => {
                    const createdScene = sceneList.data?.find((scene: any) => scene.uuid === result.uuid);
                    resolve({
                        success: true,
                        data: {
                            uuid: result.uuid,
                            url: result.url,
                            name: sceneName,
                            message: `Scene '${sceneName}' created successfully`,
                            sceneVerified: !!createdScene
                        },
                        verificationData: createdScene
                    });
                }).catch(() => {
                    resolve({
                        success: true,
                        data: {
                            uuid: result.uuid,
                            url: result.url,
                            name: sceneName,
                            message: `Scene '${sceneName}' created successfully (verification failed)`
                        }
                    });
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ---- scene_manage ----
    private async manage(action: string): Promise<ToolResponse> {
        switch (action) {
            case 'reload':
                return await this.softReloadScene();
            case 'snapshot':
                return await this.sceneSnapshot();
            case 'snapshot_abort':
                return await this.sceneSnapshotAbort();
            default:
                return { success: false, error: `Unknown manage action: ${action}` };
        }
    }

    private async softReloadScene(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'soft-reload').then(() => {
                resolve({ success: true, message: 'Scene soft reloaded successfully' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async sceneSnapshot(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'snapshot').then(() => {
                resolve({ success: true, message: 'Scene snapshot created' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async sceneSnapshotAbort(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'snapshot-abort').then(() => {
                resolve({ success: true, message: 'Scene snapshot aborted' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
}
