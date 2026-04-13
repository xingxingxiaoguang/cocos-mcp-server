import { RuntimeProfile } from '../../runtime/profile';
import { SceneHierarchyNode, SceneInfoResult } from '../../capabilities/scene/interface';
import { SceneAssetCreateResult, SceneAssetRecord, SceneBridgeDriver } from './contract';

const ASSET_DB_CHANNEL = 'asset-db';
const SCENE_CHANNEL = 'scene';
const SCENE_SCRIPT_PACKAGE = 'cocos-mcp-server';
const DEFAULT_SCENE_TYPE = 'cc.Scene';

class EditorSceneDriver implements SceneBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    // =========================================================================
    // 查询（含归一化 — 从 service 下沉）
    // =========================================================================

    async querySceneInfo(): Promise<SceneInfoResult> {
        try {
            const tree = await this.queryNodeTree();
            return this.mapTreeToSceneInfo(tree);
        } catch (directError: any) {
            try {
                const result = await this.executeSceneMethod('getCurrentSceneInfo', []);
                const data = this.unwrapSceneResult('getCurrentSceneInfo', result) as Record<string, unknown>;
                return {
                    name: this.asString(data.name, 'Current Scene'),
                    uuid: this.asString(data.uuid),
                    type: this.asString(data.type, DEFAULT_SCENE_TYPE),
                    active: this.asBoolean(data.active, true),
                    nodeCount: this.asNumber(data.nodeCount),
                };
            } catch (scriptError: any) {
                throw new Error(`Failed to query scene info. Direct API: ${directError?.message}; Scene script: ${scriptError?.message}`);
            }
        }
    }

    async querySceneHierarchy(includeComponents: boolean): Promise<SceneHierarchyNode> {
        try {
            const tree = await this.queryNodeTree();
            return this.buildHierarchy(tree, includeComponents);
        } catch (directError: any) {
            try {
                const result = await this.executeSceneMethod('getSceneHierarchy', [includeComponents]);
                const data = this.unwrapSceneResult('getSceneHierarchy', result);
                return await this.normalizeFallbackHierarchy(data, includeComponents);
            } catch (scriptError: any) {
                throw new Error(`Failed to query scene hierarchy. Direct API: ${directError?.message}; Scene script: ${scriptError?.message}`);
            }
        }
    }

    async listSceneAssets(): Promise<SceneAssetRecord[]> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const results = await this.request(ASSET_DB_CHANNEL, 'query-assets', { pattern: 'db://assets/**/*.scene' }) as any[];
        return (Array.isArray(results) ? results : []).map((item: any) => ({
            uuid: String(item.uuid),
            path: String(item.url || item.path || ''),
            name: String(item.name || this.getNameFromPath(item.url || item.path || '')),
        }));
    }

    async querySceneReady(): Promise<boolean> {
        this.ensureFeatureAvailable('sceneQueryState');
        return Boolean(await this.request(SCENE_CHANNEL, 'query-is-ready'));
    }

    async querySceneDirty(): Promise<boolean> {
        this.ensureFeatureAvailable('sceneQueryState');
        return Boolean(await this.request(SCENE_CHANNEL, 'query-dirty'));
    }

    async resolveSceneUuid(scenePath: string): Promise<string | null> {
        this.ensureFeatureAvailable('assetQueryUuid');
        const uuid = await this.request(ASSET_DB_CHANNEL, 'query-uuid', scenePath);
        return typeof uuid === 'string' && uuid ? uuid : null;
    }

    // =========================================================================
    // 生命周期操作
    // =========================================================================

    async openScene(sceneUuid: string): Promise<void> {
        this.ensureFeatureAvailable('sceneLifecycle');
        await this.request(SCENE_CHANNEL, 'open-scene', sceneUuid);
    }

    async saveScene(): Promise<void> {
        this.ensureFeatureAvailable('sceneLifecycle');
        await this.request(SCENE_CHANNEL, 'save-scene');
    }

    async saveSceneAs(): Promise<void> {
        this.ensureFeatureAvailable('sceneLifecycle');
        await this.request(SCENE_CHANNEL, 'save-as-scene');
    }

    async closeScene(): Promise<void> {
        this.ensureFeatureAvailable('sceneLifecycle');
        await this.request(SCENE_CHANNEL, 'close-scene');
    }

    // =========================================================================
    // 场景创建（含模板生成 — 从 service 下沉）
    // =========================================================================

    async createSceneAsset(sceneName: string, savePath: string): Promise<SceneAssetCreateResult> {
        this.ensureFeatureAvailable('assetCreateAsset');
        const fullPath = this.resolveScenePath(sceneName, savePath);
        const content = this.createSceneContent(sceneName);
        const result = await this.request(ASSET_DB_CHANNEL, 'create-asset', fullPath, content) as Record<string, unknown>;
        return {
            uuid: String(result.uuid || ''),
            url: String(result.url || fullPath),
        };
    }

    // =========================================================================
    // 场景管理
    // =========================================================================

    async softReloadScene(): Promise<void> {
        this.ensureFeatureAvailable('sceneManage');
        await this.request(SCENE_CHANNEL, 'soft-reload');
    }

    async createSnapshot(): Promise<void> {
        this.ensureFeatureAvailable('sceneManage');
        await this.request(SCENE_CHANNEL, 'snapshot');
    }

    async abortSnapshot(): Promise<void> {
        this.ensureFeatureAvailable('sceneManage');
        await this.request(SCENE_CHANNEL, 'snapshot-abort');
    }

    // =========================================================================
    // 归一化逻辑（从 service 下沉）
    // =========================================================================

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
        const children = Array.isArray(node.children) ? node.children.map((child: unknown) => this.buildHierarchy(child, includeComponents)) : [];

        const result: SceneHierarchyNode = {
            uuid: this.asString(node.uuid), name: this.asString(node.name, 'Current Scene'),
            type: this.asString(node.type, DEFAULT_SCENE_TYPE), active: this.asBoolean(node.active, true), children,
        };

        if (includeComponents) {
            const rawComponents = Array.isArray(node.__comps__) ? node.__comps__ : node.components;
            if (Array.isArray(rawComponents)) {
                result.components = rawComponents.map((component: unknown) => {
                    const item = this.requireObject(component, 'Invalid component payload');
                    return { type: this.normalizeComponentType(item.__type__ ?? item.type), enabled: this.extractComponentEnabled(item) };
                });
            }
        }

        return result;
    }

    private async normalizeFallbackHierarchy(data: unknown, includeComponents: boolean): Promise<SceneHierarchyNode> {
        if (Array.isArray(data)) {
            const info = await this.querySceneInfo();
            return { uuid: info.uuid, name: info.name, type: info.type, active: info.active, children: data.map(item => this.normalizeHierarchyNode(item, includeComponents)) };
        }
        return this.normalizeHierarchyNode(data, includeComponents);
    }

    private normalizeHierarchyNode(node: unknown, includeComponents: boolean): SceneHierarchyNode {
        const record = this.requireObject(node, 'Invalid scene hierarchy node');
        const children = Array.isArray(record.children) ? record.children.map((child: unknown) => this.normalizeHierarchyNode(child, includeComponents)) : [];
        const result: SceneHierarchyNode = {
            uuid: this.asString(record.uuid), name: this.asString(record.name, 'Node'),
            type: this.asString(record.type, DEFAULT_SCENE_TYPE), active: this.asBoolean(record.active, true), children,
        };
        if (includeComponents && Array.isArray(record.components)) {
            result.components = record.components.map((component: unknown) => {
                const item = this.requireObject(component, 'Invalid scene component payload');
                return { type: this.asString(item.type, 'Unknown'), enabled: this.asBoolean(item.enabled, true) };
            });
        }
        return result;
    }

    // =========================================================================
    // 场景模板
    // =========================================================================

    private resolveScenePath(sceneName: string, savePath: string): string {
        if (savePath.endsWith('.scene')) return savePath;
        const normalized = savePath.endsWith('/') ? savePath.slice(0, -1) : savePath;
        return `${normalized}/${sceneName}.scene`;
    }

    private createSceneContent(sceneName: string): string {
        return JSON.stringify([
            { '__type__': 'cc.SceneAsset', '_name': sceneName, '_objFlags': 0, '__editorExtras__': {}, '_native': '', 'scene': { '__id__': 1 } },
            { '__type__': 'cc.Scene', '_name': sceneName, '_objFlags': 0, '__editorExtras__': {}, '_parent': null, '_children': [], '_active': true, '_components': [], '_prefab': null, '_lpos': { '__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0 }, '_lrot': { '__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1 }, '_lscale': { '__type__': 'cc.Vec3', 'x': 1, 'y': 1, 'z': 1 }, '_mobility': 0, '_layer': 1073741824, '_euler': { '__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0 }, 'autoReleaseAssets': false, '_globals': { '__id__': 2 }, '_id': 'scene' },
            { '__type__': 'cc.SceneGlobals', 'ambient': { '__id__': 3 }, 'skybox': { '__id__': 4 }, 'fog': { '__id__': 5 }, 'octree': { '__id__': 6 } },
            { '__type__': 'cc.AmbientInfo', '_skyColorHDR': { '__type__': 'cc.Vec4', 'x': 0.2, 'y': 0.5, 'z': 0.8, 'w': 0.520833 }, '_skyColor': { '__type__': 'cc.Vec4', 'x': 0.2, 'y': 0.5, 'z': 0.8, 'w': 0.520833 }, '_skyIllumHDR': 20000, '_skyIllum': 20000, '_groundAlbedoHDR': { '__type__': 'cc.Vec4', 'x': 0.2, 'y': 0.2, 'z': 0.2, 'w': 1 }, '_groundAlbedo': { '__type__': 'cc.Vec4', 'x': 0.2, 'y': 0.2, 'z': 0.2, 'w': 1 } },
            { '__type__': 'cc.SkyboxInfo', '_envLightingType': 0, '_envmapHDR': null, '_envmap': null, '_envmapLodCount': 0, '_diffuseMapHDR': null, '_diffuseMap': null, '_enabled': false, '_useHDR': true, '_editableMaterial': null, '_reflectionHDR': null, '_reflectionMap': null, '_rotationAngle': 0 },
            { '__type__': 'cc.FogInfo', '_type': 0, '_fogColor': { '__type__': 'cc.Color', 'r': 200, 'g': 200, 'b': 200, 'a': 255 }, '_enabled': false, '_fogDensity': 0.3, '_fogStart': 0.5, '_fogEnd': 300, '_fogAtten': 5, '_fogTop': 1.5, '_fogRange': 1.2, '_accurate': false },
            { '__type__': 'cc.OctreeInfo', '_enabled': false, '_minPos': { '__type__': 'cc.Vec3', 'x': -1024, 'y': -1024, 'z': -1024 }, '_maxPos': { '__type__': 'cc.Vec3', 'x': 1024, 'y': 1024, 'z': 1024 }, '_depth': 8 },
        ], null, 2);
    }

    // =========================================================================
    // 类型转换工具
    // =========================================================================

    private normalizeComponentType(rawType: unknown): string {
        if (rawType && typeof rawType === 'object') {
            const nested = (rawType as Record<string, unknown>).value ?? (rawType as Record<string, unknown>).cid ?? (rawType as Record<string, unknown>).type ?? (rawType as Record<string, unknown>).name;
            if (nested !== undefined && nested !== null) return String(nested);
        }
        if (rawType === undefined || rawType === null) return 'Unknown';
        return String(rawType);
    }

    private extractComponentEnabled(component: Record<string, unknown>): boolean {
        const enabled = component.enabled;
        if (enabled && typeof enabled === 'object' && 'value' in enabled) return Boolean((enabled as Record<string, unknown>).value);
        if (enabled !== undefined) return Boolean(enabled);
        return true;
    }

    private requireObject(value: unknown, errorMessage: string): Record<string, any> {
        if (!value || typeof value !== 'object') throw new Error(errorMessage);
        return value as Record<string, any>;
    }

    private asString(value: unknown, fallback: string = ''): string {
        if (typeof value === 'string') return value;
        if (value === undefined || value === null) return fallback;
        return String(value);
    }

    private asBoolean(value: unknown, fallback: boolean = false): boolean {
        if (typeof value === 'boolean') return value;
        if (value === undefined || value === null) return fallback;
        return Boolean(value);
    }

    private asNumber(value: unknown, fallback: number = 0): number {
        if (typeof value === 'number') return value;
        if (value === undefined || value === null) return fallback;
        const num = Number(value);
        return isNaN(num) ? fallback : num;
    }

    // =========================================================================
    // 内部 IPC
    // =========================================================================

    private async queryNodeTree(): Promise<unknown> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        return this.request(SCENE_CHANNEL, 'query-node-tree');
    }

    private async executeSceneMethod(method: string, args: unknown[]): Promise<{ success: boolean; data?: unknown; error?: string }> {
        this.ensureFeatureAvailable('sceneScriptExecute');
        const result = await this.request(SCENE_CHANNEL, 'execute-scene-script', { name: SCENE_SCRIPT_PACKAGE, method, args });
        if (result === undefined || result === null) return { success: false, error: `Scene method '${method}' returned nothing.` };
        if (typeof result === 'object' && result && 'success' in (result as Record<string, unknown>)) {
            const r = result as Record<string, unknown>;
            return { success: Boolean(r.success), data: r.data, error: typeof r.error === 'string' ? r.error : undefined };
        }
        return { success: true, data: result };
    }

    private unwrapSceneResult(method: string, result: { success: boolean; data?: unknown; error?: string }): unknown {
        if (!result.success) throw new Error(result.error || `Scene method '${method}' failed`);
        return result.data;
    }

    private ensureFeatureAvailable(feature: keyof RuntimeProfile['features']): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function') throw new Error('Editor.Message.request is unavailable in the current runtime');
        if (!this.profile.features[feature]) throw new Error(`Runtime profile does not support '${feature}'`);
    }

    private async request(channel: string, message: string, ...args: unknown[]): Promise<unknown> {
        const request = (globalThis as any).Editor.Message.request as (targetChannel: string, targetMessage: string, ...payload: unknown[]) => Promise<unknown>;
        return request(channel, message, ...args);
    }

    private getNameFromPath(scenePath: string): string {
        const normalized = String(scenePath || '').replace(/\\/g, '/');
        const baseName = normalized.split('/').pop() || normalized;
        return baseName.replace(/\.scene$/i, '');
    }
}

export function createSceneDriver(profile: RuntimeProfile): SceneBridgeDriver {
    return new EditorSceneDriver(profile);
}
