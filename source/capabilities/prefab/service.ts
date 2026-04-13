import { safeSerialize } from '../../utils/serializer';
import { PrefabBridgeDriver } from '../../editor-bridge/prefab/contract';
import {
    ApplyPrefabInput,
    CreatePrefabFromNodeInput,
    DuplicatePrefabInput,
    InstantiatePrefabInput,
    PrefabCapability,
    PrefabCreateFromNodeResult,
    PrefabInstantiateResult,
    PrefabDuplicateResult,
    PrefabApplyResult,
    PrefabRevertResult,
    PrefabDetailResult,
    ListPrefabsInput,
    ListPrefabsResult,
    PrefabValidationResult,
    QueryPrefabInput,
    RevertPrefabInput,
} from './interface';

const DEFAULT_PREFAB_FOLDER = 'db://assets';

export class PrefabService implements PrefabCapability {
    constructor(private readonly driver: PrefabBridgeDriver) {}

    async list(input: ListPrefabsInput = {}): Promise<ListPrefabsResult> {
        const folder = typeof input.folder === 'string' && input.folder.trim()
            ? input.folder.trim()
            : DEFAULT_PREFAB_FOLDER;
        const prefabs = await this.driver.listPrefabAssets(folder);

        return {
            folder,
            prefabs: prefabs.map((item) => ({
                name: item.name,
                uuid: item.uuid,
                path: item.path,
                folder: item.folder,
                type: item.type,
                size: item.size,
            })),
            count: prefabs.length,
        };
    }

    async query(input: QueryPrefabInput): Promise<PrefabDetailResult> {
        const prefabPath = typeof input.prefabPath === 'string' ? input.prefabPath.trim() : '';
        if (!prefabPath) {
            throw new Error('prefabPath is required');
        }

        const asset = await this.driver.queryPrefabAsset(prefabPath);
        if (!asset) {
            throw new Error(`Prefab not found: ${prefabPath}`);
        }

        const meta = await this.driver.queryPrefabMeta(asset.uuid);
        const validation = await this.tryValidatePrefab(prefabPath);
        return {
            name: asset.name,
            uuid: asset.uuid,
            path: asset.path,
            folder: asset.folder,
            type: asset.type,
            size: asset.size,
            createTime: meta?.createTime,
            modifyTime: meta?.modifyTime,
            dependencies: meta?.depends || [],
            ...(validation ? { validation } : {}),
        };
    }

    async createFromNode(input: CreatePrefabFromNodeInput): Promise<PrefabCreateFromNodeResult> {
        const result = await this.driver.createFromNode({
            nodeUuid: input.nodeUuid,
            savePath: input.savePath,
            prefabName: input.prefabName,
        });

        return {
            data: this.serialize(result.data),
            message: result.message,
            warning: result.warning,
            instruction: result.instruction,
        };
    }

    async instantiate(input: InstantiatePrefabInput): Promise<PrefabInstantiateResult> {
        const result = await this.driver.instantiate(input);
        return {
            data: this.serialize(result.data),
            message: result.message,
            warning: result.warning,
            instruction: result.instruction,
        };
    }

    async duplicate(input: DuplicatePrefabInput): Promise<PrefabDuplicateResult> {
        const result = await this.driver.duplicate(input);
        return {
            data: this.serialize(result.data),
            message: result.message,
            warning: result.warning,
            instruction: result.instruction,
        };
    }

    async apply(input: ApplyPrefabInput): Promise<PrefabApplyResult> {
        await this.driver.apply(input.nodeUuid);
        return {
            nodeUuid: input.nodeUuid,
            message: 'Prefab updated successfully',
        };
    }

    async revert(input: RevertPrefabInput): Promise<PrefabRevertResult> {
        if (input.assetUuid) {
            try {
                await this.driver.restore(input.nodeUuid, input.assetUuid);
                return {
                    nodeUuid: input.nodeUuid,
                    assetUuid: input.assetUuid,
                    message: 'Prefab restored successfully',
                };
            } catch {
                // Fall through to generic revert.
            }
        }

        await this.driver.revert(input.nodeUuid);
        return {
            nodeUuid: input.nodeUuid,
            ...(input.assetUuid ? { assetUuid: input.assetUuid } : {}),
            message: 'Prefab instance reverted successfully',
        };
    }

    private async tryValidatePrefab(prefabPath: string): Promise<PrefabValidationResult | undefined> {
        try {
            const content = await this.driver.readPrefab(prefabPath);
            return this.validatePrefabFormat(JSON.parse(content));
        } catch {
            return undefined;
        }
    }

    private validatePrefabFormat(prefabData: unknown): PrefabValidationResult {
        const issues: string[] = [];
        let nodeCount = 0;
        let componentCount = 0;

        if (!Array.isArray(prefabData)) {
            issues.push('Prefab data must be an array');
            return { isValid: false, issues, nodeCount, componentCount };
        }

        if (prefabData.length === 0) {
            issues.push('Prefab data is empty');
            return { isValid: false, issues, nodeCount, componentCount };
        }

        const firstElement = prefabData[0] as Record<string, unknown> | undefined;
        if (!firstElement || firstElement.__type__ !== 'cc.Prefab') {
            issues.push('First element must be cc.Prefab type');
        }

        for (const item of prefabData) {
            if (!item || typeof item !== 'object') {
                continue;
            }

            const record = item as Record<string, unknown>;
            if (record.__type__ === 'cc.Node') {
                nodeCount += 1;
                continue;
            }

            if (typeof record.__type__ === 'string' && record.__type__.startsWith('cc.')) {
                componentCount += 1;
            }
        }

        if (nodeCount === 0) {
            issues.push('Prefab must contain at least one node');
        }

        return {
            isValid: issues.length === 0,
            issues,
            nodeCount,
            componentCount,
        };
    }

    private serialize(value: unknown): unknown {
        if (value === undefined) {
            return null;
        }

        return safeSerialize(value);
    }
}
