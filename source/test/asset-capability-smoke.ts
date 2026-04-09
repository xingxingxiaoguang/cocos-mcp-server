import * as assert from 'assert';
import { AssetBridgeDriver } from '../editor-bridge/asset/contract';
import { RuntimeProfile } from '../runtime/profile';
import { createCapabilityRegistry } from '../runtime/capability-registry';

class MockAssetDriver implements AssetBridgeDriver {
    public readonly calls: Array<{ method: string; args: any[] }> = [];

    async requestAssetDb(message: string, ...args: unknown[]): Promise<any> {
        this.calls.push({ method: message, args: args as any[] });

        switch (message) {
            case 'query-ready':
                return true;
            case 'query-assets':
                return [
                    {
                        uuid: 'asset-1',
                        url: 'db://assets/textures/a.png',
                        name: 'a',
                        type: 'cc.ImageAsset',
                    },
                ];
            case 'create-asset':
                return {
                    uuid: 'asset-created',
                    url: String(args[0]),
                };
            case 'query-asset-info':
                return {
                    uuid: 'asset-1',
                    url: String(args[0]),
                    path: String(args[0]),
                    name: 'a',
                    type: 'cc.ImageAsset',
                };
            case 'query-url':
                return 'db://assets/textures/a.png';
            case 'read-asset':
                return '{"uuid":"asset-1"}';
            case 'query-asset-meta':
                return {
                    ver: '1.0.0',
                    importer: 'image',
                };
            default:
                return null;
        }
    }
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

    const ready = await registry.asset.query({ action: 'db_ready' });
    assert.strictEqual(ready.success, true);
    assert.strictEqual((ready.data as any).ready, true);

    const list = await registry.asset.query({ action: 'list', folder: 'db://assets' });
    assert.strictEqual(list.success, true);
    assert.strictEqual((list.data as any).assets.length, 1);

    const created = await registry.asset.create({
        action: 'create',
        targetPath: 'db://assets/tmp/test.txt',
        content: 'hello',
    });
    assert.strictEqual(created.success, true);

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
