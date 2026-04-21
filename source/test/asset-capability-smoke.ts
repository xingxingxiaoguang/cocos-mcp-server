import * as assert from 'assert';
import {
    AssetBridgeDriver,
    AssetCopyInput,
    AssetCreateInput,
    AssetDependencyItem,
    AssetImportInput,
    AssetMetadata,
    AssetMoveInput,
    AssetMutationResult,
    AssetQueryInput,
    AssetSaveInput,
    AssetSaveMetaInput,
} from '../drivers/asset/contract';
import { RuntimeProfile } from '../core/profile';
import { createCapabilityRegistry } from '../core/capability-registry';

class MockAssetDriver implements AssetBridgeDriver {
    public readonly calls: Array<{ method: string; args: unknown[] }> = [];

    async queryReady(): Promise<boolean> {
        this.calls.push({ method: 'query-ready', args: [] });
        return true;
    }

    async queryAssetInfo(assetPath: string): Promise<AssetMetadata | null> {
        this.calls.push({ method: 'query-asset-info', args: [assetPath] });
        return {
            uuid: 'asset-1',
            url: assetPath,
            path: assetPath,
            name: 'a',
            type: 'cc.ImageAsset',
        };
    }

    async queryAssetMeta(urlOrUuid: string): Promise<Record<string, unknown>> {
        this.calls.push({ method: 'query-asset-meta', args: [urlOrUuid] });
        return { ver: '1.0.0', importer: 'image' };
    }

    async queryAssets(query: AssetQueryInput): Promise<AssetMetadata[]> {
        this.calls.push({ method: 'query-assets', args: [query] });
        return [{
            uuid: 'asset-1',
            url: 'db://assets/textures/a.png',
            path: 'db://assets/textures/a.png',
            name: 'a',
            type: 'cc.ImageAsset',
        }];
    }

    async queryAssetUrl(uuid: string): Promise<string | null> {
        this.calls.push({ method: 'query-url', args: [uuid] });
        return 'db://assets/textures/a.png';
    }

    async readAsset(urlOrUuid: string): Promise<string | unknown> {
        this.calls.push({ method: 'read-asset', args: [urlOrUuid] });
        return '{"uuid":"asset-1"}';
    }

    async generateAvailableUrl(url: string): Promise<string> {
        this.calls.push({ method: 'generate-available-url', args: [url] });
        return url;
    }

    async createAsset(input: AssetCreateInput): Promise<AssetMutationResult> {
        this.calls.push({ method: 'create-asset', args: [input] });
        return { uuid: 'asset-created', url: input.url };
    }

    async importAsset(input: AssetImportInput): Promise<AssetMutationResult> {
        this.calls.push({ method: 'import-asset', args: [input] });
        return { uuid: 'asset-imported', url: input.target };
    }

    async saveAsset(input: AssetSaveInput): Promise<AssetMutationResult> {
        this.calls.push({ method: 'save-asset', args: [input] });
        return { uuid: 'asset-saved', url: input.url };
    }

    async saveAssetMeta(input: AssetSaveMetaInput): Promise<AssetMutationResult> {
        this.calls.push({ method: 'save-asset-meta', args: [input] });
        return { uuid: 'asset-meta-saved', url: input.urlOrUuid };
    }

    async reimportAsset(url: string): Promise<void> {
        this.calls.push({ method: 'reimport-asset', args: [url] });
    }

    async moveAsset(input: AssetMoveInput): Promise<AssetMutationResult> {
        this.calls.push({ method: 'move-asset', args: [input] });
        return { uuid: 'asset-moved', url: input.target };
    }

    async copyAsset(input: AssetCopyInput): Promise<AssetMutationResult> {
        this.calls.push({ method: 'copy-asset', args: [input] });
        return { uuid: 'asset-copied', url: input.target };
    }

    async deleteAsset(url: string): Promise<void> {
        this.calls.push({ method: 'delete-asset', args: [url] });
    }

    async refreshAsset(targetPath?: string): Promise<void> {
        this.calls.push({ method: 'refresh-asset', args: [targetPath] });
    }

    async openAsset(urlOrUuid: string): Promise<void> {
        this.calls.push({ method: 'open-asset', args: [urlOrUuid] });
    }

    // 新增合约方法
    async resolveAssetInfo(urlOrUUID: string): Promise<AssetMetadata | null> {
        return this.queryAssetInfo(urlOrUUID);
    }

    async collectAssetDependencies(_assetInfo: AssetMetadata): Promise<AssetDependencyItem[]> { return []; }
    async findAssetDependents(_targetUuid: string, _targetUrl: string, _allAssets: AssetMetadata[]): Promise<AssetDependencyItem[]> { return []; }
    async collectReferencedUuids(_assets: AssetMetadata[]): Promise<Set<string>> { return new Set(); }
    async readAssetMeta(_uuid: string, _assetUrl: string): Promise<Record<string, unknown> | null> { return null; }
    async readAssetContent(_assetUrl: string): Promise<string | null> { return null; }
    getFilesFromDirectory(_dirPath: string, _fileFilter: string[], _recursive: boolean): string[] { return []; }
    fileExists(_filePath: string): boolean { return false; }
}

async function main(): Promise<void> {
    const profile: RuntimeProfile = {
        cocosVersion: '3.8.8',
        features: {
            preferencesSetConfig: true,
            preferencesOpenSettings: true,
            projectQueryConfig: true,
            animationQueryClip: true,
            animationPropertyQuery: true,
            sceneQueryNodeTree: true,
            sceneQueryState: true,
            sceneLifecycle: true,
            sceneManage: true,
            sceneScriptExecute: true,
            assetQueryAssets: true,
            assetQueryUuid: true,
            assetCreateAsset: true,
        },
    };

    const driver = new MockAssetDriver();
    const registry = createCapabilityRegistry({
        profile,
        assetDriver: driver,
    });

    // checkDbReady returns AssetDbStatus directly
    const ready = await registry.asset.checkDbReady();
    assert.strictEqual(ready.ready, true);
    assert.strictEqual(ready.message, 'Asset database is ready');

    // list returns AssetListResult directly
    const list = await registry.asset.list({ folder: 'db://assets' });
    assert.strictEqual(list.assets.length, 1);
    assert.strictEqual(list.type, 'all');

    // create returns AssetCreateResult directly
    const created = await registry.asset.create({
        action: 'create',
        targetPath: 'db://assets/tmp/test.txt',
        content: 'hello',
    });
    assert.strictEqual(created.message, 'File created successfully');
    assert.strictEqual(created.uuid, 'asset-created');

    assert.ok(driver.calls.some((call) => call.method === 'query-ready'));
    assert.ok(driver.calls.some((call) => call.method === 'query-assets'));
    assert.ok(driver.calls.some((call) => call.method === 'create-asset'));
    console.log('[asset-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[asset-capability-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
