import {
    SceneAssetSummary,
    SceneCapability,
    SceneHierarchyNode,
    SceneInfoResult,
    SceneMutationResult,
    SceneStatusResult,
    CreateSceneInput,
    CreateSceneResult,
    OpenSceneInput,
    QuerySceneHierarchyInput,
    SaveSceneAsInput,
} from './interface';
import {
    SceneBridgeDriver,
    SceneMethodResult,
} from '../../editor-bridge/scene/contract';

const DEFAULT_SCENE_TYPE = 'cc.Scene';

export class SceneService implements SceneCapability {
    constructor(private readonly driver: SceneBridgeDriver) {}

    async queryInfo(): Promise<SceneInfoResult> {
        try {
            const tree = await this.driver.queryNodeTree();
            return this.mapTreeToSceneInfo(tree);
        } catch (directError: any) {
            try {
                const result = await this.driver.executeSceneMethod('getCurrentSceneInfo', []);
                const data = this.unwrapSceneResult('getCurrentSceneInfo', result) as Record<string, unknown>;
                return {
                    name: this.asString(data.name, 'Current Scene'),
                    uuid: this.asString(data.uuid),
                    type: this.asString(data.type, DEFAULT_SCENE_TYPE),
                    active: this.asBoolean(data.active, true),
                    nodeCount: this.asNumber(data.nodeCount),
                };
            } catch (scriptError: any) {
                throw new Error(
                    `Failed to query scene info. Direct API: ${directError?.message || directError}; `
                    + `Scene script: ${scriptError?.message || scriptError}`,
                );
            }
        }
    }

    async queryHierarchy(input: QuerySceneHierarchyInput = {}): Promise<SceneHierarchyNode> {
        const includeComponents = Boolean(input.includeComponents);

        try {
            const tree = await this.driver.queryNodeTree();
            return this.buildHierarchy(tree, includeComponents);
        } catch (directError: any) {
            try {
                const result = await this.driver.executeSceneMethod('getSceneHierarchy', [includeComponents]);
                const data = this.unwrapSceneResult('getSceneHierarchy', result);
                return await this.normalizeFallbackHierarchy(data, includeComponents);
            } catch (scriptError: any) {
                throw new Error(
                    `Failed to query scene hierarchy. Direct API: ${directError?.message || directError}; `
                    + `Scene script: ${scriptError?.message || scriptError}`,
                );
            }
        }
    }

    async listScenes() {
        const scenes = await this.driver.listSceneAssets();
        return {
            scenes: scenes.map((item) => ({
                name: item.name,
                path: item.path,
                uuid: item.uuid,
            })),
            count: scenes.length,
        };
    }

    async queryStatus(): Promise<SceneStatusResult> {
        const [ready, dirty] = await Promise.all([
            this.driver.querySceneReady(),
            this.driver.querySceneDirty(),
        ]);

        return {
            ready,
            dirty,
            message: `Scene is ${ready ? 'ready' : 'not ready'}, ${dirty ? 'has unsaved changes' : 'clean'}`,
        };
    }

    async openScene(input: OpenSceneInput): Promise<SceneMutationResult> {
        const sceneUuid = await this.driver.resolveSceneUuid(input.scenePath);
        if (!sceneUuid) {
            throw new Error(`Scene not found: ${input.scenePath}`);
        }

        await this.driver.openScene(sceneUuid);
        return {
            message: `Scene opened: ${input.scenePath}`,
        };
    }

    async saveScene(): Promise<SceneMutationResult> {
        await this.driver.saveScene();
        return {
            message: 'Scene saved successfully',
        };
    }

    async saveSceneAs(input: SaveSceneAsInput): Promise<SceneMutationResult> {
        await this.driver.saveSceneAs();
        return {
            message: 'Scene save-as dialog opened',
            data: {
                path: input.path,
            },
        };
    }

    async closeScene(): Promise<SceneMutationResult> {
        await this.driver.closeScene();
        return {
            message: 'Scene closed successfully',
        };
    }

    async createScene(input: CreateSceneInput): Promise<CreateSceneResult> {
        const fullPath = this.resolveScenePath(input.sceneName, input.savePath);
        const created = await this.driver.createSceneAsset(fullPath, this.createSceneContent(input.sceneName));
        const scenes = await this.listScenes();
        const verificationData = scenes.scenes.find((scene) => scene.uuid === created.uuid);

        return {
            message: `Scene '${input.sceneName}' created successfully`,
            data: {
                uuid: created.uuid,
                url: created.url,
                name: input.sceneName,
                sceneVerified: Boolean(verificationData),
            },
            ...(verificationData ? { verificationData } : {}),
        };
    }

    async reloadScene(): Promise<SceneMutationResult> {
        await this.driver.softReloadScene();
        return {
            message: 'Scene soft reloaded successfully',
        };
    }

    async createSnapshot(): Promise<SceneMutationResult> {
        await this.driver.createSnapshot();
        return {
            message: 'Scene snapshot created',
        };
    }

    async abortSnapshot(): Promise<SceneMutationResult> {
        await this.driver.abortSnapshot();
        return {
            message: 'Scene snapshot aborted',
        };
    }

    private mapTreeToSceneInfo(tree: unknown): SceneInfoResult {
        const node = this.requireObject(tree, 'Scene tree is unavailable');
        return {
            name: this.asString(node.name, 'Current Scene'),
            uuid: this.asString(node.uuid),
            type: this.asString(node.type, DEFAULT_SCENE_TYPE),
            active: this.asBoolean(node.active, true),
            nodeCount: Array.isArray(node.children) ? node.children.length : 0,
        };
    }

    private buildHierarchy(tree: unknown, includeComponents: boolean): SceneHierarchyNode {
        const node = this.requireObject(tree, 'Scene hierarchy is unavailable');
        const children = Array.isArray(node.children)
            ? node.children.map((child) => this.buildHierarchy(child, includeComponents))
            : [];

        const result: SceneHierarchyNode = {
            uuid: this.asString(node.uuid),
            name: this.asString(node.name, 'Current Scene'),
            type: this.asString(node.type, DEFAULT_SCENE_TYPE),
            active: this.asBoolean(node.active, true),
            children,
        };

        if (includeComponents) {
            const rawComponents = Array.isArray(node.__comps__) ? node.__comps__ : node.components;
            if (Array.isArray(rawComponents)) {
                result.components = rawComponents.map((component) => {
                    const item = this.requireObject(component, 'Invalid component payload');
                    return {
                        type: this.normalizeComponentType(item.__type__ ?? item.type),
                        enabled: this.extractComponentEnabled(item),
                    };
                });
            }
        }

        return result;
    }

    private async normalizeFallbackHierarchy(data: unknown, includeComponents: boolean): Promise<SceneHierarchyNode> {
        if (Array.isArray(data)) {
            const info = await this.queryInfo();
            return {
                uuid: info.uuid,
                name: info.name,
                type: info.type,
                active: info.active,
                children: data.map((item) => this.normalizeHierarchyNode(item, includeComponents)),
            };
        }

        return this.normalizeHierarchyNode(data, includeComponents);
    }

    private normalizeHierarchyNode(node: unknown, includeComponents: boolean): SceneHierarchyNode {
        const record = this.requireObject(node, 'Invalid scene hierarchy node');
        const children = Array.isArray(record.children)
            ? record.children.map((child) => this.normalizeHierarchyNode(child, includeComponents))
            : [];

        const result: SceneHierarchyNode = {
            uuid: this.asString(record.uuid),
            name: this.asString(record.name, 'Node'),
            type: this.asString(record.type, DEFAULT_SCENE_TYPE),
            active: this.asBoolean(record.active, true),
            children,
        };

        if (includeComponents && Array.isArray(record.components)) {
            result.components = record.components.map((component) => {
                const item = this.requireObject(component, 'Invalid scene component payload');
                return {
                    type: this.asString(item.type, 'Unknown'),
                    enabled: this.asBoolean(item.enabled, true),
                };
            });
        }

        return result;
    }

    private unwrapSceneResult(method: string, result: SceneMethodResult): unknown {
        if (!result.success) {
            throw new Error(result.error || `Scene method '${method}' failed`);
        }

        return result.data;
    }

    private resolveScenePath(sceneName: string, savePath: string): string {
        if (savePath.endsWith('.scene')) {
            return savePath;
        }

        const normalized = savePath.endsWith('/') ? savePath.slice(0, -1) : savePath;
        return `${normalized}/${sceneName}.scene`;
    }

    private createSceneContent(sceneName: string): string {
        return JSON.stringify([
            {
                '__type__': 'cc.SceneAsset',
                '_name': sceneName,
                '_objFlags': 0,
                '__editorExtras__': {},
                '_native': '',
                'scene': { '__id__': 1 },
            },
            {
                '__type__': 'cc.Scene',
                '_name': sceneName,
                '_objFlags': 0,
                '__editorExtras__': {},
                '_parent': null,
                '_children': [],
                '_active': true,
                '_components': [],
                '_prefab': null,
                '_lpos': { '__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0 },
                '_lrot': { '__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1 },
                '_lscale': { '__type__': 'cc.Vec3', 'x': 1, 'y': 1, 'z': 1 },
                '_mobility': 0,
                '_layer': 1073741824,
                '_euler': { '__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0 },
                'autoReleaseAssets': false,
                '_globals': { '__id__': 2 },
                '_id': 'scene',
            },
            {
                '__type__': 'cc.SceneGlobals',
                'ambient': { '__id__': 3 },
                'skybox': { '__id__': 4 },
                'fog': { '__id__': 5 },
                'octree': { '__id__': 6 },
            },
            {
                '__type__': 'cc.AmbientInfo',
                '_skyColorHDR': { '__type__': 'cc.Vec4', 'x': 0.2, 'y': 0.5, 'z': 0.8, 'w': 0.520833 },
                '_skyColor': { '__type__': 'cc.Vec4', 'x': 0.2, 'y': 0.5, 'z': 0.8, 'w': 0.520833 },
                '_skyIllumHDR': 20000,
                '_skyIllum': 20000,
                '_groundAlbedoHDR': { '__type__': 'cc.Vec4', 'x': 0.2, 'y': 0.2, 'z': 0.2, 'w': 1 },
                '_groundAlbedo': { '__type__': 'cc.Vec4', 'x': 0.2, 'y': 0.2, 'z': 0.2, 'w': 1 },
            },
            {
                '__type__': 'cc.SkyboxInfo',
                '_envLightingType': 0,
                '_envmapHDR': null,
                '_envmap': null,
                '_envmapLodCount': 0,
                '_diffuseMapHDR': null,
                '_diffuseMap': null,
                '_enabled': false,
                '_useHDR': true,
                '_editableMaterial': null,
                '_reflectionHDR': null,
                '_reflectionMap': null,
                '_rotationAngle': 0,
            },
            {
                '__type__': 'cc.FogInfo',
                '_type': 0,
                '_fogColor': { '__type__': 'cc.Color', 'r': 200, 'g': 200, 'b': 200, 'a': 255 },
                '_enabled': false,
                '_fogDensity': 0.3,
                '_fogStart': 0.5,
                '_fogEnd': 300,
                '_fogAtten': 5,
                '_fogTop': 1.5,
                '_fogRange': 1.2,
                '_accurate': false,
            },
            {
                '__type__': 'cc.OctreeInfo',
                '_enabled': false,
                '_minPos': { '__type__': 'cc.Vec3', 'x': -1024, 'y': -1024, 'z': -1024 },
                '_maxPos': { '__type__': 'cc.Vec3', 'x': 1024, 'y': 1024, 'z': 1024 },
                '_depth': 8,
            },
        ], null, 2);
    }

    private normalizeComponentType(rawType: unknown): string {
        if (rawType && typeof rawType === 'object') {
            const nested = (rawType as Record<string, unknown>).value
                ?? (rawType as Record<string, unknown>).cid
                ?? (rawType as Record<string, unknown>).type
                ?? (rawType as Record<string, unknown>).name;
            if (nested !== undefined && nested !== null) {
                return String(nested);
            }
        }

        if (rawType === undefined || rawType === null) {
            return 'Unknown';
        }

        return String(rawType);
    }

    private extractComponentEnabled(component: Record<string, unknown>): boolean {
        const enabled = component.enabled;
        if (enabled && typeof enabled === 'object' && 'value' in enabled) {
            return Boolean((enabled as Record<string, unknown>).value);
        }

        if (enabled !== undefined) {
            return Boolean(enabled);
        }

        return true;
    }

    private requireObject(value: unknown, errorMessage: string): Record<string, any> {
        if (!value || typeof value !== 'object') {
            throw new Error(errorMessage);
        }

        return value as Record<string, any>;
    }

    private asString(value: unknown, fallback: string = ''): string {
        if (typeof value === 'string') {
            return value;
        }

        if (value === undefined || value === null) {
            return fallback;
        }

        return String(value);
    }

    private asBoolean(value: unknown, fallback: boolean): boolean {
        if (typeof value === 'boolean') {
            return value;
        }

        if (value === undefined || value === null) {
            return fallback;
        }

        return Boolean(value);
    }

    private asNumber(value: unknown): number {
        return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
}
