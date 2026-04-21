import { BaseDriver } from '../base-driver';
import { RuntimeProfile } from '../../core/profile';
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

class EditorSceneQueryDriver extends BaseDriver implements SceneQueryDriver {

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

    private requestScene(message: string, ...args: unknown[]): Promise<unknown> {
        return this.request('scene', message, ...args);
    }

    private requestAssetDb(message: string, ...args: unknown[]): Promise<unknown> {
        return this.request('asset-db', message, ...args);
    }

    private ensureAvailable(): void {
        this.ensureRequestAvailable();
        if (!this.profile.features.sceneQueryNodeTree || !this.profile.features.assetQueryAssets) {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }
}

export function createSceneQueryDriver(profile: RuntimeProfile): SceneQueryDriver {
    return new EditorSceneQueryDriver(profile);
}
