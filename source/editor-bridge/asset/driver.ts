import { RuntimeProfile } from '../../runtime/profile';
import { AssetBridgeDriver } from './contract';

const ASSET_DB_CHANNEL = 'asset-db';

class EditorAssetDriver implements AssetBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async requestAssetDb(message: string, ...args: unknown[]): Promise<any> {
        this.ensureRequestAvailable();
        const request = (globalThis as any).Editor.Message.request as (
            channel: string,
            message: string,
            ...payload: unknown[]
        ) => Promise<any>;
        return request(ASSET_DB_CHANNEL, message, ...args);
    }

    private ensureRequestAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function' || !this.profile.features.assetQueryAssets) {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }
}

export function createAssetDriver(profile: RuntimeProfile): AssetBridgeDriver {
    return new EditorAssetDriver(profile);
}
