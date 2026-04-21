import * as assert from 'assert';
import {
    FlattenedNode,
    InlineComponentPropertyBatchInput,
    NodeBridgeDriver,
    NodeCreateInput,
    NodeInfo,
    NodePasteInput,
    NodeResetPropertyInput,
    NodeSearchResult,
    NodeSetParentInput,
    NodeSetPropertyInput,
    NormalizedTransform,
    TransformInput,
    TransformType,
} from '../drivers/node/contract';
import { ComponentCapability } from '../capabilities/component/interface';
import { RuntimeProfile } from '../core/profile';
import { createCapabilityRegistry } from '../core/capability-registry';

class MockNodeDriver implements NodeBridgeDriver {
    public readonly calls: Array<{ method: string; args: unknown[] }> = [];

    async createNode(input: NodeCreateInput): Promise<string> {
        this.calls.push({ method: 'create-node', args: [input] });
        return 'node-created';
    }
    async setParent(input: NodeSetParentInput): Promise<void> { this.calls.push({ method: 'set-parent', args: [input] }); }
    async setProperty(input: NodeSetPropertyInput): Promise<void> { this.calls.push({ method: 'set-property', args: [input] }); }
    async resetProperty(input: NodeResetPropertyInput): Promise<void> { this.calls.push({ method: 'reset-property', args: [input] }); }
    async resetNode(uuid: string): Promise<void> { this.calls.push({ method: 'reset-node', args: [uuid] }); }
    async removeNode(uuid: string): Promise<void> { this.calls.push({ method: 'remove-node', args: [uuid] }); }
    async duplicateNode(uuid: string): Promise<string> { this.calls.push({ method: 'duplicate-node', args: [uuid] }); return 'dup-' + uuid; }
    async copyNode(uuids: string[]): Promise<string[]> { this.calls.push({ method: 'copy-node', args: uuids }); return uuids; }
    async pasteNode(input: NodePasteInput): Promise<string[]> { this.calls.push({ method: 'paste-node', args: [input] }); return []; }
    async cutNode(uuids: string[]): Promise<string[]> { this.calls.push({ method: 'cut-node', args: uuids }); return uuids; }

    async queryNodeInfo(uuid: string): Promise<NodeInfo> {
        this.calls.push({ method: 'query-node-info', args: [uuid] });
        return {
            uuid, name: 'Player', active: true,
            position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
            parent: null, children: [], components: [], layer: 1073741824, mobility: 0,
        };
    }
    async searchNodes(_pattern: string): Promise<NodeSearchResult[]> { return []; }
    async flattenNodes(): Promise<FlattenedNode[]> { return []; }
    async queryNodesByAssetUuid(_assetUuid: string): Promise<string[]> { return []; }

    async resolveParentUuid(parentUuid?: string): Promise<string | undefined> { return parentUuid || 'scene-1'; }
    async resolveAssetUuid(_assetPath: string): Promise<string | null> { return null; }

    normalizeTransformValue(value: TransformInput, type: TransformType, _is2D: boolean): NormalizedTransform {
        return { value: { x: value.x ?? 0, y: value.y ?? 0, z: value.z ?? 0 } };
    }

    buildInlineComponentPropertyBatch(_input: InlineComponentPropertyBatchInput): Record<string, unknown> { return {}; }
    async resolveDefaultSpriteFrameUuid(): Promise<string | null> { return null; }
}

const mockComponentCapability: ComponentCapability = {
    async getComponentDetail(_uuid: string, _componentType: string) {
        return { type: '', enabled: true, componentType: '' };
    },
    async listNodeComponents(_uuid: string) {
        return { nodeUuid: _uuid, components: [] };
    },
    async listAvailableTypes(_category?: string) {
        return { category: _category || 'all', types: [] };
    },
    async listClasses(_extendsClass?: string) {
        return { classes: [], count: 0, extendsFilter: _extendsClass };
    },
    async listSceneComponents() {
        return { components: [], count: 0 };
    },
    async hasScript(_scriptPath: string) {
        return { className: '', hasScript: false, message: '' };
    },
    async add(_input: any) {
        return { nodeUuid: _input.uuid, componentType: _input.componentType, existing: false, message: 'Component added' };
    },
    async modify(_input: any) {
        return { message: 'Component modified' };
    },
    async batchSet(_input: any) {
        return { nodeUuid: _input.uuid, results: [], failures: [], message: 'Batch set complete' };
    },
};

async function main(): Promise<void> {
    const profile: RuntimeProfile = {
        cocosVersion: '3.8.8',
        features: {
            preferencesSetConfig: true, preferencesOpenSettings: true, projectQueryConfig: true,
            animationQueryClip: true, animationPropertyQuery: true, sceneQueryNodeTree: true,
            sceneQueryState: true, sceneLifecycle: true, sceneManage: true,
            sceneScriptExecute: true, assetQueryAssets: true, assetQueryUuid: true, assetCreateAsset: true,
        },
    };

    const nodeDriver = new MockNodeDriver();
    const registry = createCapabilityRegistry({
        profile,
        nodeDriver,
        componentCapability: mockComponentCapability,
    });

    // queryByUuid returns NodeDetail directly (no success wrapper)
    const queried = await registry.node.queryByUuid('node-1');
    assert.strictEqual(queried.uuid, 'node-1');
    assert.strictEqual(queried.nodeType, '2D'); // z=0 => 2D

    // create returns NodeCreateResult directly (no success wrapper)
    const created = await registry.node.create({ name: 'Player' });
    assert.strictEqual(typeof created.uuid, 'string');
    assert.strictEqual(created.name, 'Player');
    assert.strictEqual(typeof created.message, 'string');

    assert.ok(nodeDriver.calls.some((call) => call.method === 'create-node'));
    console.log('[node-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[node-capability-smoke] FAILED:', error);
    process.exit(1);
});
