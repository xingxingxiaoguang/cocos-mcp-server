import { RuntimeProfile } from '../../runtime/profile';
import {
    AssetBridgeDriver,
    AssetCopyInput,
    AssetCreateInput,
    AssetImportInput,
    AssetMetadata,
    AssetMoveInput,
    AssetMutationResult,
    AssetQueryInput,
    AssetSaveInput,
    AssetSaveMetaInput,
} from './contract';

const ASSET_DB_CHANNEL = 'asset-db';

class EditorAssetDriver implements AssetBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async queryReady(): Promise<boolean> {
        this.ensureAvailable();
        const result = await this.request('query-ready');
        return Boolean(result);
    }

    async queryAssetInfo(assetPath: string): Promise<AssetMetadata | null> {
        this.ensureAvailable();
        const result = await this.request('query-asset-info', assetPath);
        return result ? (result as AssetMetadata) : null;
    }

    async queryAssetMeta(urlOrUuid: string): Promise<Record<string, unknown>> {
        this.ensureAvailable();
        const result = await this.request('query-asset-meta', urlOrUuid);
        return (result ?? {}) as Record<string, unknown>;
    }

    async queryAssets(query: AssetQueryInput): Promise<AssetMetadata[]> {
        this.ensureAvailable();
        const result = await this.request('query-assets', query);
        return (Array.isArray(result) ? result : []) as AssetMetadata[];
    }

    async queryAssetUrl(uuid: string): Promise<string | null> {
        this.ensureAvailable();
        const result = await this.request('query-url', uuid);
        return typeof result === 'string' ? result : null;
    }

    async readAsset(urlOrUuid: string): Promise<string | unknown> {
        this.ensureAvailable();
        return this.request('read-asset', urlOrUuid);
    }

    async generateAvailableUrl(url: string): Promise<string> {
        this.ensureAvailable();
        const result = await this.request('generate-available-url', url);
        return typeof result === 'string' ? result : url;
    }

    async createAsset(input: AssetCreateInput): Promise<AssetMutationResult> {
        this.ensureAvailable();
        const result = await this.request('create-asset', input.url, input.content, {
            overwrite: input.overwrite,
            rename: input.rename,
        });
        return result as AssetMutationResult;
    }

    async importAsset(input: AssetImportInput): Promise<AssetMutationResult> {
        this.ensureAvailable();
        const result = await this.request('import-asset', input.source, input.target);
        return result as AssetMutationResult;
    }

    async saveAsset(input: AssetSaveInput): Promise<AssetMutationResult> {
        this.ensureAvailable();
        const result = await this.request('save-asset', input.url, input.content);
        return result as AssetMutationResult;
    }

    async saveAssetMeta(input: AssetSaveMetaInput): Promise<AssetMutationResult> {
        this.ensureAvailable();
        const result = await this.request('save-asset-meta', input.urlOrUuid, input.content);
        return result as AssetMutationResult;
    }

    async reimportAsset(url: string): Promise<void> {
        this.ensureAvailable();
        await this.request('reimport-asset', url);
    }

    async moveAsset(input: AssetMoveInput): Promise<AssetMutationResult> {
        this.ensureAvailable();
        const result = await this.request('move-asset', input.source, input.target);
        return result as AssetMutationResult;
    }

    async copyAsset(input: AssetCopyInput): Promise<AssetMutationResult> {
        this.ensureAvailable();
        const result = await this.request('copy-asset', input.source, input.target);
        return result as AssetMutationResult;
    }

    async deleteAsset(url: string): Promise<void> {
        this.ensureAvailable();
        await this.request('delete-asset', url);
    }

    async refreshAsset(targetPath?: string): Promise<void> {
        this.ensureAvailable();
        await this.request('refresh-asset', targetPath);
    }

    async openAsset(urlOrUuid: string): Promise<void> {
        this.ensureAvailable();
        await this.request('open-asset', urlOrUuid);
    }

    // -------------------------------------------------------------------------

    private async request(message: string, ...args: unknown[]): Promise<unknown> {
        const request = (globalThis as any).Editor.Message.request as (
            channel: string,
            message: string,
            ...payload: unknown[]
        ) => Promise<unknown>;
        return request(ASSET_DB_CHANNEL, message, ...args);
    }

    private ensureAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function' || !this.profile.features.assetQueryAssets) {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }
}

export function createAssetDriver(profile: RuntimeProfile): AssetBridgeDriver {
    return new EditorAssetDriver(profile);
}
