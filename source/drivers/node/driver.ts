import { BaseDriver } from '../base-driver';
import { RuntimeProfile } from '../../core/profile';
import { SceneQueryDriver } from '../scene-query/contract';
import {
    buildCidNameMap,
    buildNodeInfo,
    flattenNodeTree,
    searchNodeTree,
    normalizeComponentType,
} from '../scene-query/normalizer';
import { resolveDefaultSpriteFrameUuid as resolveDefaultSpriteFrame } from '../scene-query/sprite-frame-resolver';
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
} from './contract';

class EditorNodeDriver extends BaseDriver implements NodeBridgeDriver {
    private cidNameMap: Map<string, string> | null = null;

    constructor(
        profile: RuntimeProfile,
        private readonly sceneQuery: SceneQueryDriver,
    ) {
        super(profile);
    }

    // =========================================================================
    // 低层级 IPC 操作（原有）
    // =========================================================================

    async createNode(input: NodeCreateInput): Promise<string> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        const result = await this.request('scene', 'create-node', input);
        return Array.isArray(result) ? (result[0] as string) : (result as string);
    }

    async setParent(input: NodeSetParentInput): Promise<void> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        await this.request('scene', 'set-parent', input);
    }

    async setProperty(input: NodeSetPropertyInput): Promise<void> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        await this.request('scene', 'set-property', input);
    }

    async resetProperty(input: NodeResetPropertyInput): Promise<void> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        await this.request('scene', 'reset-property', input);
    }

    async resetNode(uuid: string): Promise<void> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        await this.request('scene', 'reset-node', { uuid });
    }

    async removeNode(uuid: string): Promise<void> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        await this.request('scene', 'remove-node', { uuid });
    }

    async duplicateNode(uuid: string): Promise<string> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        const result = await this.request('scene', 'duplicate-node', uuid);
        return Array.isArray(result) ? (result[0] as string) : (result as string);
    }

    async copyNode(uuids: string[]): Promise<string[]> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        const result = await this.request('scene', 'copy-node', uuids);
        return Array.isArray(result) ? (result as string[]) : [result as string];
    }

    async pasteNode(input: NodePasteInput): Promise<string[]> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        const result = await this.request('scene', 'paste-node', input);
        return Array.isArray(result) ? (result as string[]) : [result as string];
    }

    async cutNode(uuids: string[]): Promise<string[]> {
        this.ensureFeatureAvailable('sceneQueryNodeTree');
        const result = await this.request('scene', 'cut-node', uuids);
        return Array.isArray(result) ? (result as string[]) : [result as string];
    }

    // =========================================================================
    // 查询操作
    // =========================================================================

    async queryNodeInfo(uuid: string): Promise<NodeInfo> {
        const nodeData = await this.sceneQuery.queryNode(uuid);
        if (!nodeData) throw new Error('Node not found or invalid response');
        const cidMap = await this.getCidNameMap();
        return buildNodeInfo(uuid, nodeData, cidMap);
    }

    async searchNodes(pattern: string): Promise<NodeSearchResult[]> {
        try {
            const tree = await this.sceneQuery.queryNodeTree();
            return searchNodeTree(tree, pattern);
        } catch (directError: any) {
            try {
                const result = await this.sceneQuery.executeSceneScript<any>('findNodes', [pattern, false]);
                if (result?.success && Array.isArray(result.data)) return result.data;
                return [];
            } catch (scriptError: any) {
                throw new Error(`Tree search failed: ${directError.message}, Scene script failed: ${scriptError.message}`);
            }
        }
    }

    async flattenNodes(): Promise<FlattenedNode[]> {
        try {
            const tree = await this.sceneQuery.queryNodeTree();
            return flattenNodeTree(tree);
        } catch (directError: any) {
            try {
                const result = await this.sceneQuery.executeSceneScript<any>('getAllNodes', []);
                if (result?.success && Array.isArray(result.data)) return result.data;
                return [];
            } catch (scriptError: any) {
                throw new Error(`Direct API failed: ${directError.message}, Scene script failed: ${scriptError.message}`);
            }
        }
    }

    async queryNodesByAssetUuid(assetUuid: string): Promise<string[]> {
        return this.sceneQuery.queryNodesByAssetUuid(assetUuid);
    }

    // =========================================================================
    // 父节点 / 资产解析
    // =========================================================================

    async resolveParentUuid(parentUuid?: string): Promise<string | undefined> {
        if (parentUuid) return parentUuid;

        try {
            const sceneInfo = await this.sceneQuery.queryNodeTree();
            if (sceneInfo && typeof sceneInfo === 'object' && !Array.isArray(sceneInfo)) {
                const si = sceneInfo as { uuid?: string };
                if (si.uuid) return si.uuid;
            } else if (Array.isArray(sceneInfo) && sceneInfo.length > 0) {
                const first = sceneInfo[0] as { uuid?: string };
                if (first.uuid) return first.uuid;
            }
        } catch { /* fall through */ }

        try {
            const currentScene = await this.sceneQuery.queryCurrentScene();
            if (currentScene?.uuid) return currentScene.uuid;
        } catch { /* fall through */ }

        return undefined;
    }

    async resolveAssetUuid(assetPath: string): Promise<string | null> {
        const assetInfo = await this.sceneQuery.queryAssetInfo(assetPath);
        return assetInfo?.uuid ?? null;
    }

    // =========================================================================
    // 变换归一化
    // =========================================================================

    normalizeTransformValue(value: TransformInput, type: TransformType, is2D: boolean): NormalizedTransform {
        const result = {
            x: value.x ?? (type === 'scale' ? 1 : 0),
            y: value.y ?? (type === 'scale' ? 1 : 0),
            z: value.z ?? (type === 'scale' ? 1 : 0),
        };
        let warning: string | undefined;

        if (is2D) {
            switch (type) {
                case 'position':
                    if (value.z !== undefined && Math.abs(value.z) > 0.001) {
                        warning = `2D node: z position (${value.z}) ignored, set to 0`;
                    }
                    result.z = 0;
                    break;
                case 'rotation':
                    if ((value.x !== undefined && Math.abs(value.x) > 0.001) || (value.y !== undefined && Math.abs(value.y) > 0.001)) {
                        warning = '2D node: x,y rotations ignored, only z rotation applied';
                    }
                    result.x = 0;
                    result.y = 0;
                    break;
                case 'scale':
                    if (value.z === undefined) result.z = 1;
                    break;
            }
        }

        return { value: result, warning };
    }

    // =========================================================================
    // 内联组件属性批量构建
    // =========================================================================

    buildInlineComponentPropertyBatch(input: InlineComponentPropertyBatchInput): Record<string, unknown> {
        const { requestedType, actualType, properties, defaultSpriteFrameUuid } = input;
        const batch: Record<string, unknown> = {};
        const isSprite = normalizeComponentType(actualType || requestedType) === 'cc.Sprite';

        for (const [property, rawEntry] of Object.entries(properties)) {
            batch[property] = this.normalizeInlinePropertyEntry(property, rawEntry, defaultSpriteFrameUuid);
        }

        if (isSprite) {
            if (!Object.prototype.hasOwnProperty.call(batch, 'spriteFrame') && defaultSpriteFrameUuid) {
                batch.spriteFrame = { value: defaultSpriteFrameUuid, propertyType: 'spriteFrame' };
            }
            if (!Object.prototype.hasOwnProperty.call(batch, 'sizeMode')) {
                batch.sizeMode = { value: 0, propertyType: 'integer' };
            }
        }

        return batch;
    }

    // =========================================================================
    // Sprite 默认帧解析
    // =========================================================================

    async resolveDefaultSpriteFrameUuid(): Promise<string | null> {
        return resolveDefaultSpriteFrame(this.sceneQuery);
    }

    // =========================================================================
    // 内部工具
    // =========================================================================

    private normalizeInlinePropertyEntry(property: string, rawEntry: unknown, defaultSpriteFrameUuid: string | null): unknown {
        if (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)) {
            const entry = rawEntry as Record<string, unknown>;
            if (Object.prototype.hasOwnProperty.call(entry, 'propertyType')) {
                const cloned = { ...entry };
                if (property === 'spriteFrame') {
                    if (cloned.value === 'auto' && defaultSpriteFrameUuid) {
                        cloned.value = defaultSpriteFrameUuid;
                        cloned.propertyType = 'spriteFrame';
                    }
                }
                return cloned;
            }
        }

        if (property === 'spriteFrame' && rawEntry === 'auto' && defaultSpriteFrameUuid) {
            return { value: defaultSpriteFrameUuid, propertyType: 'spriteFrame' };
        }

        return rawEntry;
    }

    private async getCidNameMap(): Promise<Map<string, string>> {
        this.cidNameMap = await buildCidNameMap(this.sceneQuery, this.cidNameMap);
        return this.cidNameMap;
    }

}

export function createNodeDriver(profile: RuntimeProfile, sceneQuery: SceneQueryDriver): NodeBridgeDriver {
    return new EditorNodeDriver(profile, sceneQuery);
}
