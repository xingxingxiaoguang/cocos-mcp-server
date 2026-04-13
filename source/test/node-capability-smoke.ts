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
} from '../editor-bridge/node/contract';
import { ComponentCapability } from '../capabilities/component/interface';
import { RuntimeProfile } from '../runtime/profile';
import { createCapabilityRegistry } from '../runtime/capability-registry';

class MockNodeDriver implements NodeBridgeDriver {
    public readonly calls: Array<{ method: string; args: unknown[] }> = [];

    // 低层级 IPC
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

    // 查询
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

    // 解析
    async resolveParentUuid(parentUuid?: string): Promise<string | undefined> { return parentUuid || 'scene-1'; }
    async resolveAssetUuid(_assetPath: string): Promise<string | null> { return null; }

    // 变换
    normalizeTransformValue(value: TransformInput, type: TransformType, _is2D: boolean): NormalizedTransform {
        return { value: { x: value.x ?? 0, y: value.y ?? 0, z: value.z ?? 0 } };
    }

    // 内联属性
    buildInlineComponentPropertyBatch(_input: InlineComponentPropertyBatchInput): Record<string, unknown> { return {}; }
    async resolveDefaultSpriteFrameUuid(): Promise<string | null> { return null; }
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
