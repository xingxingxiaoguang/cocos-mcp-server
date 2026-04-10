import { RuntimeProfile } from '../../runtime/profile';
import {
    CocosNodeDump,
    ComponentFunctionRecord,
    ComponentTypeRecord,
    NodeTreeItem,
    SceneAssetInfo,
    SceneAssetQueryInput,
    SceneQueryDriver,
} from './contract';

const ASSET_DB_CHANNEL = 'asset-db';
const SCENE_CHANNEL = 'scene';
const SCENE_SCRIPT_PACKAGE = 'cocos-mcp-server';

class EditorSceneQueryDriver implements SceneQueryDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async queryNode(uuid: string): Promise<CocosNodeDump> {
        this.ensureAvailable();
        return this.requestScene('query-node', uuid) as Promise<CocosNodeDump>;
    }

    async queryNodeTree(): Promise<NodeTreeItem | NodeTreeItem[]> {
        this.ensureAvailable();
        return this.requestScene('query-node-tree') as Promise<NodeTreeItem | NodeTreeItem[]>;
    }

    async queryCurrentScene(): Promise<NodeTreeItem> {
        this.ensureAvailable();
        return this.requestScene('query-current-scene') as Promise<NodeTreeItem>;
    }

    async queryNodesByAssetUuid(assetUuid: string): Promise<string[]> {
        this.ensureAvailable();
        return this.requestScene('query-nodes-by-asset-uuid', assetUuid) as Promise<string[]>;
    }

    async queryComponents(): Promise<ComponentTypeRecord[]> {
        this.ensureAvailable();
        return this.requestScene('query-components') as Promise<ComponentTypeRecord[]>;
    }

    async queryComponentFunctionsOfNode(nodeUuid: string): Promise<ComponentFunctionRecord[]> {
        this.ensureAvailable();
        return this.requestScene('query-component-function-of-node', nodeUuid) as Promise<ComponentFunctionRecord[]>;
    }

    async executeSceneScript<T = unknown>(method: string, args: unknown[]): Promise<T> {
        this.ensureAvailable();
        return this.requestScene('execute-scene-script', {
            name: SCENE_SCRIPT_PACKAGE,
            method,
            args,
        }) as Promise<T>;
    }

    async queryAssetInfo(assetPath: string): Promise<SceneAssetInfo | null> {
        this.ensureAvailable();
        const result = await this.requestAssetDb('query-asset-info', assetPath);
        return result as SceneAssetInfo | null;
    }

    async queryAssets(query: SceneAssetQueryInput): Promise<SceneAssetInfo[]> {
        this.ensureAvailable();
        const result = await this.requestAssetDb('query-assets', query);
        return (Array.isArray(result) ? result : []) as SceneAssetInfo[];
    }

    async queryAssetUrl(uuid: string): Promise<string | null> {
        this.ensureAvailable();
        const result = await this.requestAssetDb('query-url', uuid);
        return typeof result === 'string' ? result : null;
    }

    // -------------------------------------------------------------------------

    private async requestScene(message: string, ...args: unknown[]): Promise<unknown> {
        return this.request(SCENE_CHANNEL, message, ...args);
    }

    private async requestAssetDb(message: string, ...args: unknown[]): Promise<unknown> {
        return this.request(ASSET_DB_CHANNEL, message, ...args);
    }

    private async request(channel: string, message: string, ...args: unknown[]): Promise<unknown> {
        const request = (globalThis as any).Editor.Message.request as (
            targetChannel: string,
            targetMessage: string,
            ...payload: unknown[]
        ) => Promise<unknown>;
        return request(channel, message, ...args);
    }

    private ensureAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (
            typeof request !== 'function' ||
            !this.profile.features.sceneQueryNodeTree ||
            !this.profile.features.assetQueryAssets
        ) {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }
}

export function createSceneQueryDriver(profile: RuntimeProfile): SceneQueryDriver {
    return new EditorSceneQueryDriver(profile);
}
