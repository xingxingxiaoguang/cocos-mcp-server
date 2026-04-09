import * as assert from 'assert';
import { ComponentBridgeDriver } from '../editor-bridge/component/contract';
import { RuntimeProfile } from '../runtime/profile';
import { createCapabilityRegistry } from '../runtime/capability-registry';

class MockComponentDriver implements ComponentBridgeDriver {
    public readonly calls: Array<{ method: string; args: any[] }> = [];

    async queryComponentFunctionsOfNode(nodeUuid: string): Promise<any> {
        return this.querySceneDispatch('query-component-function-of-node', nodeUuid);
    }

    async queryComponents(): Promise<any> {
        return this.querySceneDispatch('query-components');
    }

    async queryNode(nodeUuid: string): Promise<any> {
        return this.querySceneDispatch('query-node', nodeUuid);
    }

    async queryNodeTree(): Promise<any> {
        return this.querySceneDispatch('query-node-tree');
    }

    async executeSceneScript(options: Record<string, unknown>): Promise<any> {
        return this.querySceneDispatch('execute-scene-script', options);
    }

    async createComponent(payload: Record<string, unknown>): Promise<any> {
        return this.querySceneDispatch('create-component', payload);
    }

    async removeArrayElement(payload: Record<string, unknown>): Promise<any> {
        return this.querySceneDispatch('remove-array-element', payload);
    }

    async resetComponent(payload: Record<string, unknown>): Promise<any> {
        return this.querySceneDispatch('reset-component', payload);
    }

    async executeComponentMethod(payload: Record<string, unknown>): Promise<any> {
        return this.querySceneDispatch('execute-component-method', payload);
    }

    async setProperty(payload: Record<string, unknown>): Promise<any> {
        return this.querySceneDispatch('set-property', payload);
    }

    async queryAssetInfo(assetPath: string): Promise<any> {
        return this.queryAssetDispatch('query-asset-info', assetPath);
    }

    async queryAssets(query: Record<string, unknown>): Promise<any> {
        return this.queryAssetDispatch('query-assets', query);
    }

    async queryAssetUrl(uuid: string): Promise<any> {
        return this.queryAssetDispatch('query-url', uuid);
    }

    private async querySceneDispatch(message: string, ...args: unknown[]): Promise<any> {
        this.calls.push({ method: message, args: args as any[] });

        switch (message) {
            case 'query-component-function-of-node':
            case 'query-components':
                return [
                    { cid: 'cc.Sprite', name: 'cc.Sprite' },
                    { cid: 'cc.Label', name: 'cc.Label' },
                ];
            case 'query-node':
                return {
                    uuid: 'node-1',
                    __comps__: [
                        { __type__: 'cc.Sprite', enabled: { value: true }, uuid: 'comp-1' },
                    ],
                };
            case 'create-component':
                return { uuid: 'comp-created' };
            default:
                return {};
        }
    }

    private async queryAssetDispatch(message: string, ...args: unknown[]): Promise<any> {
        this.calls.push({ method: message, args: args as any[] });
        return null;
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

    const driver = new MockComponentDriver();
    const registry = createCapabilityRegistry({
        profile,
        componentDriver: driver,
    });

    const listed = await registry.component.query({ uuid: 'node-1' });
    assert.strictEqual(listed.success, true);
    assert.strictEqual((listed.data as any).components.length, 1);

    const added = await registry.component.add({ uuid: 'node-1', componentType: 'cc.Sprite' });
    assert.strictEqual(added.success, true);

    assert.ok(driver.calls.some((call) => call.method === 'query-node'));
    assert.ok(driver.calls.length >= 2);
    console.log('[component-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[component-capability-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
