import { RuntimeProfile } from '../../runtime/profile';
import { ComponentBridgeDriver } from './contract';

const ASSET_DB_CHANNEL = 'asset-db';
const SCENE_CHANNEL = 'scene';

class EditorComponentDriver implements ComponentBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async queryComponentFunctionsOfNode(nodeUuid: string): Promise<any> {
        return this.requestSceneMessage('query-component-function-of-node', nodeUuid);
    }

    async queryComponents(): Promise<any> {
        return this.requestSceneMessage('query-components');
    }

    async queryNode(nodeUuid: string): Promise<any> {
        return this.requestSceneMessage('query-node', nodeUuid);
    }

    async queryNodeTree(): Promise<any> {
        return this.requestSceneMessage('query-node-tree');
    }

    async executeSceneScript(options: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('execute-scene-script', options);
    }

    async createComponent(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('create-component', payload);
    }

    async removeArrayElement(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('remove-array-element', payload);
    }

    async resetComponent(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('reset-component', payload);
    }

    async executeComponentMethod(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('execute-component-method', payload);
    }

    async setProperty(payload: Record<string, unknown>): Promise<any> {
        return this.requestSceneMessage('set-property', payload);
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

export function createComponentDriver(profile: RuntimeProfile): ComponentBridgeDriver {
    return new EditorComponentDriver(profile);
}
