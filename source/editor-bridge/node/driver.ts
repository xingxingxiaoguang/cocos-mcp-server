import { RuntimeProfile } from '../../runtime/profile';
import { NodeBridgeDriver } from './contract';

const ASSET_DB_CHANNEL = 'asset-db';
const SCENE_CHANNEL = 'scene';

class EditorNodeDriver implements NodeBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async queryNode(uuid: string): Promise<any> {
        return this.requestSceneMessage('query-node', uuid);
    }

    async queryNodeTree(): Promise<any> {
        return this.requestSceneMessage('query-node-tree');
    }

    async executeSceneScript(options: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('execute-scene-script', options);
    }

    async queryNodesByAssetUuid(assetUuid: string): Promise<any> {
        return this.requestSceneMessage('query-nodes-by-asset-uuid', assetUuid);
    }

    async queryComponentFunctionsOfNode(nodeUuid: string): Promise<any> {
        return this.requestSceneMessage('query-component-function-of-node', nodeUuid);
    }

    async queryComponents(): Promise<any> {
        return this.requestSceneMessage('query-components');
    }

    async queryCurrentScene(): Promise<any> {
        return this.requestSceneMessage('query-current-scene');
    }

    async queryAssetInfo(assetPath: string): Promise<any> {
        return this.requestAssetDbMessage('query-asset-info', assetPath);
    }

    async queryAssets(query: Record<string, unknown>): Promise<any> {
        return this.requestAssetDbMessage('query-assets', query);
    }

    async queryAssetUrl(uuid: string): Promise<any> {
        return this.requestAssetDbMessage('query-url', uuid);
    }

    async createNode(options: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('create-node', options);
    }

    async setParent(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('set-parent', payload);
    }

    async setProperty(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('set-property', payload);
    }

    async resetProperty(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('reset-property', payload);
    }

    async resetNode(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('reset-node', payload);
    }

    async removeNode(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('remove-node', payload);
    }

    async duplicateNode(uuid: string): Promise<any> {
        return this.requestSceneMessage('duplicate-node', uuid);
    }

    async copyNode(uuids: string | string[]): Promise<any> {
        return this.requestSceneMessage('copy-node', uuids);
    }

    async pasteNode(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('paste-node', payload);
    }

    async cutNode(uuids: string | string[]): Promise<any> {
        return this.requestSceneMessage('cut-node', uuids);
    }

    private async requestSceneMessage(message: string, ...args: unknown[]): Promise<any> {
        this.ensureRequestAvailable();
        return this.request(SCENE_CHANNEL, message, ...args);
    }

    private async requestAssetDbMessage(message: string, ...args: unknown[]): Promise<any> {
        this.ensureRequestAvailable();
        return this.request(ASSET_DB_CHANNEL, message, ...args);
    }

    private async request(channel: string, message: string, ...args: unknown[]): Promise<any> {
        const request = (globalThis as any).Editor.Message.request as (
            targetChannel: string,
            targetMessage: string,
            ...payload: unknown[]
        ) => Promise<any>;

        return request(channel, message, ...args);
    }

    private ensureRequestAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function'
            || !this.profile.features.sceneQueryNodeTree
            || !this.profile.features.assetQueryAssets) {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }
}

export function createNodeDriver(profile: RuntimeProfile): NodeBridgeDriver {
    return new EditorNodeDriver(profile);
}
