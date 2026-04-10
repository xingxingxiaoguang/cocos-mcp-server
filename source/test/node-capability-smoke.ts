import * as assert from 'assert';
import {
    NodeBridgeDriver,
    NodeCreateInput,
    NodePasteInput,
    NodeResetPropertyInput,
    NodeSetParentInput,
    NodeSetPropertyInput,
} from '../editor-bridge/node/contract';
import {
    CocosNodeDump,
    ComponentFunctionRecord,
    ComponentTypeRecord,
    NodeTreeItem,
    SceneAssetInfo,
    SceneAssetQueryInput,
    SceneQueryDriver,
} from '../editor-bridge/scene-query/contract';
import { ComponentCapability } from '../capabilities/component/interface';
import { RuntimeProfile } from '../runtime/profile';
import { createCapabilityRegistry } from '../runtime/capability-registry';

class MockSceneQueryDriver implements SceneQueryDriver {
    async queryNode(uuid: string): Promise<CocosNodeDump> {
        return {
            uuid:     { value: uuid },
            name:     { value: 'Player' },
            active:   { value: true },
            position: { value: { x: 0, y: 0, z: 0 } },
            rotation: { value: { x: 0, y: 0, z: 0 } },
            scale:    { value: { x: 1, y: 1, z: 1 } },
            parent:   { value: null },
            children: [],
            __comps__: [],
        };
    }

    async queryNodeTree(): Promise<NodeTreeItem | NodeTreeItem[]> {
        return { uuid: 'scene-1', name: 'Scene', active: true, children: [] };
    }

    async queryCurrentScene(): Promise<NodeTreeItem> {
        return { uuid: 'scene-1', name: 'Scene', active: true, children: [] };
    }

    async queryNodesByAssetUuid(_assetUuid: string): Promise<string[]> { return []; }
    async queryComponents(): Promise<ComponentTypeRecord[]> { return []; }
    async queryComponentFunctionsOfNode(_nodeUuid: string): Promise<ComponentFunctionRecord[]> { return []; }
    async executeSceneScript<T = unknown>(_method: string, _args: unknown[]): Promise<T> { return {} as T; }
    async queryAssetInfo(_assetPath: string): Promise<SceneAssetInfo | null> { return null; }
    async queryAssets(_query: SceneAssetQueryInput): Promise<SceneAssetInfo[]> { return []; }
    async queryAssetUrl(_uuid: string): Promise<string | null> { return null; }
}

class MockNodeDriver implements NodeBridgeDriver {
    public readonly calls: Array<{ method: string; args: unknown[] }> = [];

    async createNode(input: NodeCreateInput): Promise<string> {
        this.calls.push({ method: 'create-node', args: [input] });
        return 'node-created';
    }

    async setParent(input: NodeSetParentInput): Promise<void> {
        this.calls.push({ method: 'set-parent', args: [input] });
    }

    async setProperty(input: NodeSetPropertyInput): Promise<void> {
        this.calls.push({ method: 'set-property', args: [input] });
    }

    async resetProperty(input: NodeResetPropertyInput): Promise<void> {
        this.calls.push({ method: 'reset-property', args: [input] });
    }

    async resetNode(uuid: string): Promise<void> {
        this.calls.push({ method: 'reset-node', args: [uuid] });
    }

    async removeNode(uuid: string): Promise<void> {
        this.calls.push({ method: 'remove-node', args: [uuid] });
    }

    async duplicateNode(uuid: string): Promise<string> {
        this.calls.push({ method: 'duplicate-node', args: [uuid] });
        return 'dup-' + uuid;
    }

    async copyNode(uuids: string[]): Promise<string[]> {
        this.calls.push({ method: 'copy-node', args: uuids });
        return uuids;
    }

    async pasteNode(input: NodePasteInput): Promise<string[]> {
        this.calls.push({ method: 'paste-node', args: [input] });
        return [];
    }

    async cutNode(uuids: string[]): Promise<string[]> {
        this.calls.push({ method: 'cut-node', args: uuids });
        return uuids;
    }
}

const mockComponentCapability: ComponentCapability = {
    async query(): Promise<any> { return { success: true, data: [] }; },
    async add(): Promise<any>   { return { success: true, data: {} }; },
    async modify(): Promise<any> { return { success: true, data: {} }; },
    async batchSet(): Promise<any> { return { success: true, data: {} }; },
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

    const sceneQueryDriver = new MockSceneQueryDriver();
    const nodeDriver = new MockNodeDriver();
    const registry = createCapabilityRegistry({
        profile,
        sceneQueryDriver,
        nodeDriver,
        componentCapability: mockComponentCapability,
    });

    const queried = await registry.node.query({ uuid: 'node-1' });
    assert.strictEqual(queried.success, true);
    assert.strictEqual((queried.data as any).uuid, 'node-1');

    const created = await registry.node.create({ name: 'Player' });
    assert.strictEqual(created.success, true);

    assert.ok(nodeDriver.calls.some((call) => call.method === 'create-node'));
    console.log('[node-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[node-capability-smoke] FAILED:', error);
    process.exit(1);
});
