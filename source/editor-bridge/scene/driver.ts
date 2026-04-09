import { RuntimeProfile } from '../../runtime/profile';
import { SceneAssetCreateResult, SceneAssetRecord, SceneBridgeDriver, SceneMethodResult } from './contract';

const ASSET_DB_CHANNEL = 'asset-db';
const SCENE_CHANNEL = 'scene';
const SCENE_SCRIPT_PACKAGE = 'cocos-mcp-server';

class EditorSceneDriver implements SceneBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async queryNodeTree(): Promise<unknown> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        return this.request(SCENE_CHANNEL, 'query-node-tree');
    }

    async executeSceneMethod(method: string, args: unknown[]): Promise<SceneMethodResult> {
        this.ensureFeatureAvailable('sceneScriptExecute');
        const result = await this.request(
            SCENE_CHANNEL,
            'execute-scene-script',
            {
                name: SCENE_SCRIPT_PACKAGE,
                method,
                args,
            },
        );

        if (result === undefined || result === null) {
            return {
                success: false,
                error: `Scene method '${method}' returned nothing. Check package.json contributions.scene.methods.`,
            };
        }

        if (typeof result === 'object' && result && 'success' in (result as Record<string, unknown>)) {
            const sceneResult = result as Record<string, unknown>;
            return {
                success: Boolean(sceneResult.success),
                data: sceneResult.data,
                message: typeof sceneResult.message === 'string' ? sceneResult.message : undefined,
                warning: typeof sceneResult.warning === 'string' ? sceneResult.warning : undefined,
                error: typeof sceneResult.error === 'string' ? sceneResult.error : undefined,
            };
        }

        return {
            success: true,
            data: result,
        };
    }

    async listSceneAssets(): Promise<SceneAssetRecord[]> {
        this.ensureFeatureAvailable('assetQueryAssets');
        const results = await this.request(ASSET_DB_CHANNEL, 'query-assets', {
            pattern: 'db://assets/**/*.scene',
        }) as any[];

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

    async createSceneAsset(scenePath: string, content: string): Promise<SceneAssetCreateResult> {
        this.ensureFeatureAvailable('assetCreateAsset');
        const result = await this.request(ASSET_DB_CHANNEL, 'create-asset', scenePath, content) as Record<string, unknown>;
        return {
            uuid: String(result.uuid || ''),
            url: String(result.url || scenePath),
        };
    }

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

    private ensureFeatureAvailable(feature: keyof RuntimeProfile['features']): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function') {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }

        if (!this.profile.features[feature]) {
            throw new Error(`Runtime profile does not support '${feature}'`);
        }
    }

    private async request(channel: string, message: string, ...args: unknown[]): Promise<unknown> {
        const request = (globalThis as any).Editor.Message.request as (
            targetChannel: string,
            targetMessage: string,
            ...payload: unknown[]
        ) => Promise<unknown>;

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
