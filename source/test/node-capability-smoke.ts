import * as assert from 'assert';
import { NodeBridgeDriver } from '../editor-bridge/node/contract';
import { ComponentCapability } from '../capabilities/component/interface';
import { RuntimeProfile } from '../runtime/profile';
import { createCapabilityRegistry } from '../runtime/capability-registry';

class MockNodeDriver implements NodeBridgeDriver {
    public readonly calls: Array<{ method: string; args: any[] }> = [];

    async queryNode(uuid: string): Promise<any> {
        return this.sceneDispatch('query-node', uuid);
    }

    async queryNodeTree(): Promise<any> {
        return this.sceneDispatch('query-node-tree');
    }

    async executeSceneScript(options: Record<string, unknown>): Promise<any> {
        return this.sceneDispatch('execute-scene-script', options);
    }

    async queryNodesByAssetUuid(assetUuid: string): Promise<any> {
        return this.sceneDispatch('query-nodes-by-asset-uuid', assetUuid);
    }

    async queryComponentFunctionsOfNode(nodeUuid: string): Promise<any> {
        return this.sceneDispatch('query-component-function-of-node', nodeUuid);
    }

    async queryComponents(): Promise<any> {
        return this.sceneDispatch('query-components');
    }

    async queryCurrentScene(): Promise<any> {
        return this.sceneDispatch('query-current-scene');
    }

    async queryAssetInfo(assetPath: string): Promise<any> {
        return this.assetDispatch('query-asset-info', assetPath);
    }

    async queryAssets(query: Record<string, unknown>): Promise<any> {
        return this.assetDispatch('query-assets', query);
    }

    async queryAssetUrl(uuid: string): Promise<any> {
        return this.assetDispatch('query-url', uuid);
    }

    async createNode(options: Record<string, unknown>): Promise<any> {
        return this.sceneDispatch('create-node', options);
    }

    async setParent(payload: Record<string, unknown>): Promise<any> {
        return this.sceneDispatch('set-parent', payload);
    }

    async setProperty(payload: Record<string, unknown>): Promise<any> {
        return this.sceneDispatch('set-property', payload);
    }

    async resetProperty(payload: Record<string, unknown>): Promise<any> {
        return this.sceneDispatch('reset-property', payload);
    }

    async resetNode(payload: Record<string, unknown>): Promise<any> {
        return this.sceneDispatch('reset-node', payload);
    }

    async removeNode(payload: Record<string, unknown>): Promise<any> {
        return this.sceneDispatch('remove-node', payload);
    }

    async duplicateNode(uuid: string): Promise<any> {
        return this.sceneDispatch('duplicate-node', uuid);
    }

    async copyNode(uuids: string | string[]): Promise<any> {
        return this.sceneDispatch('copy-node', uuids);
    }

    async pasteNode(payload: Record<string, unknown>): Promise<any> {
        return this.sceneDispatch('paste-node', payload);
    }

    async cutNode(uuids: string | string[]): Promise<any> {
        return this.sceneDispatch('cut-node', uuids);
    }

    private async sceneDispatch(message: string, ...args: unknown[]): Promise<any> {
        this.calls.push({ method: message, args: args as any[] });

        switch (message) {
            case 'query-node':
                return {
                    uuid: 'node-1',
                    name: 'Player',
                    active: true,
                    position: { value: { x: 0, y: 0, z: 0 } },
                    rotation: { value: { x: 0, y: 0, z: 0 } },
                    scale: { value: { x: 1, y: 1, z: 1 } },
                    parent: null,
                    children: [],
                    __comps__: [],
                };
            case 'create-node':
                return 'node-created';
            case 'query-node-tree':
                return {
                    uuid: 'scene-1',
                    children: [],
                };
            case 'query-component-function-of-node':
            case 'query-components':
                return [];
            default:
                return {};
        }
    }

    private async assetDispatch(message: string, ...args: unknown[]): Promise<any> {
        this.calls.push({ method: message, args: args as any[] });
        return null;
    }
}

const mockComponentCapability: ComponentCapability = {
    async query(): Promise<any> {
        return { success: true, data: [] };
    },
    async add(): Promise<any> {
        return { success: true, data: {} };
    },
    async modify(): Promise<any> {
        return { success: true, data: {} };
    },
    async batchSet(): Promise<any> {
        return { success: true, data: {} };
    },
};

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

    const driver = new MockNodeDriver();
    const registry = createCapabilityRegistry({
        profile,
        nodeDriver: driver,
        componentCapability: mockComponentCapability,
    });

    const queried = await registry.node.query({ uuid: 'node-1' });
    assert.strictEqual(queried.success, true);
    assert.strictEqual((queried.data as any).uuid, 'node-1');

    const created = await registry.node.create({ name: 'Player' });
    assert.strictEqual(created.success, true);

    assert.ok(driver.calls.some((call) => call.method === 'query-node'));
    assert.ok(driver.calls.some((call) => call.method === 'create-node'));
    console.log('[node-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[node-capability-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
