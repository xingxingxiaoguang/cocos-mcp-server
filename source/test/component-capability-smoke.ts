import * as assert from 'assert';
import {
    ComponentBridgeDriver,
    ComponentCreateInput,
    ComponentCreateResult,
    ComponentMethodInput,
    ComponentResetInput,
    ComponentSetPropertyInput,
    RemoveArrayElementInput,
} from '../editor-bridge/component/contract';
import {
    CocosNodeDump,
    ComponentFunctionRecord,
    ComponentTypeRecord,
    NodeTreeItem,
    SceneAssetInfo,
    SceneAssetQueryInput,
    SceneQueryDriver,
} from '../editor-bridge/scene-query/contract';
import { RuntimeProfile } from '../runtime/profile';
import { createCapabilityRegistry } from '../runtime/capability-registry';

class MockSceneQueryDriver implements SceneQueryDriver {
    public readonly calls: Array<{ method: string; args: unknown[] }> = [];

    async queryNode(uuid: string): Promise<CocosNodeDump> {
        this.calls.push({ method: 'query-node', args: [uuid] });
        return {
            uuid:     { value: uuid },
            name:     { value: 'TestNode' },
            active:   { value: true },
            position: { value: { x: 0, y: 0, z: 0 } },
            rotation: { value: { x: 0, y: 0, z: 0 } },
            scale:    { value: { x: 1, y: 1, z: 1 } },
            parent:   { value: null },
            children: [],
            __comps__: [
                { __type__: 'cc.Sprite', enabled: { value: true }, uuid: { value: 'comp-1' } },
            ],
        };
    }

    async queryNodeTree(): Promise<NodeTreeItem | NodeTreeItem[]> {
        return { uuid: 'scene-1', name: 'Scene', active: true, children: [] };
    }

    async queryCurrentScene(): Promise<NodeTreeItem> {
        return { uuid: 'scene-1', name: 'Scene', active: true, children: [] };
    }

    async queryNodesByAssetUuid(_assetUuid: string): Promise<string[]> { return []; }

    async queryComponents(): Promise<ComponentTypeRecord[]> {
        this.calls.push({ method: 'query-components', args: [] });
        return [
            { cid: 'cc.Sprite', name: 'cc.Sprite' },
            { cid: 'cc.Label',  name: 'cc.Label' },
        ];
    }

    async queryComponentFunctionsOfNode(nodeUuid: string): Promise<ComponentFunctionRecord[]> {
        this.calls.push({ method: 'query-component-function-of-node', args: [nodeUuid] });
        return [];
    }

    async executeSceneScript<T = unknown>(_method: string, _args: unknown[]): Promise<T> { return {} as T; }
    async queryAssetInfo(_assetPath: string): Promise<SceneAssetInfo | null> { return null; }
    async queryAssets(_query: SceneAssetQueryInput): Promise<SceneAssetInfo[]> { return []; }
    async queryAssetUrl(_uuid: string): Promise<string | null> { return null; }
}

class MockComponentDriver implements ComponentBridgeDriver {
    public readonly calls: Array<{ method: string; args: unknown[] }> = [];

    async createComponent(input: ComponentCreateInput): Promise<ComponentCreateResult> {
        this.calls.push({ method: 'create-component', args: [input] });
        return { uuid: 'comp-created', componentType: input.component };
    }

    async removeArrayElement(input: RemoveArrayElementInput): Promise<void> {
        this.calls.push({ method: 'remove-array-element', args: [input] });
    }

    async resetComponent(input: ComponentResetInput): Promise<void> {
        this.calls.push({ method: 'reset-component', args: [input] });
    }

    async executeComponentMethod(input: ComponentMethodInput): Promise<unknown> {
        this.calls.push({ method: 'execute-component-method', args: [input] });
        return {};
    }

    async setProperty(input: ComponentSetPropertyInput): Promise<void> {
        this.calls.push({ method: 'set-property', args: [input] });
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

    const sceneQueryDriver = new MockSceneQueryDriver();
    const componentDriver = new MockComponentDriver();
    const registry = createCapabilityRegistry({
        profile,
        sceneQueryDriver,
        componentDriver,
    });

    const listed = await registry.component.query({ uuid: 'node-1' });
    assert.strictEqual(listed.success, true);
    assert.strictEqual((listed.data as any).components.length, 1);

    const added = await registry.component.add({ uuid: 'node-1', componentType: 'cc.Sprite' });
    assert.strictEqual(added.success, true);

    assert.ok(sceneQueryDriver.calls.some((call) => call.method === 'query-node'));
    assert.ok(componentDriver.calls.some((call) => call.method === 'create-component'));
    console.log('[component-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[component-capability-smoke] FAILED:', error);
    process.exit(1);
});
