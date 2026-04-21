import * as assert from 'assert';
import { PrefabBridgeDriver } from '../drivers/prefab/contract';
import { RuntimeProfile } from '../core/profile';
import { createCapabilityRegistry } from '../core/capability-registry';

class MockPrefabDriver implements PrefabBridgeDriver {
    public readonly calls: Array<{ method: string; args: any[] }> = [];

    async listPrefabAssets(folder: string) {
        this.calls.push({ method: 'listPrefabAssets', args: [folder] });
        return [
            {
                uuid: 'prefab-1',
                path: 'db://assets/prefabs/Player.prefab',
                name: 'Player',
                folder: 'db://assets/prefabs',
                type: 'cc.Prefab',
                size: 128,
            },
        ];
    }

    async queryPrefabAsset(prefabPath: string) {
        this.calls.push({ method: 'queryPrefabAsset', args: [prefabPath] });
        return {
            uuid: 'prefab-1',
            path: prefabPath,
            name: 'Player',
            folder: 'db://assets/prefabs',
            type: 'cc.Prefab',
            size: 128,
        };
    }

    async queryPrefabMeta(prefabUuid: string) {
        this.calls.push({ method: 'queryPrefabMeta', args: [prefabUuid] });
        return {
            name: 'Player',
            createTime: '2026-04-09',
            modifyTime: '2026-04-09',
            depends: ['dep-1'],
        };
    }

    async readPrefab(prefabPath: string) {
        this.calls.push({ method: 'readPrefab', args: [prefabPath] });
        return JSON.stringify([
            { __type__: 'cc.Prefab' },
            { __type__: 'cc.Node' },
            { __type__: 'cc.UITransform' },
        ]);
    }

    async createFromNode(input: { nodeUuid: string; savePath: string; prefabName?: string }) {
        this.calls.push({ method: 'createFromNode', args: [input] });
        return {
            data: {
                prefabUuid: 'prefab-1',
                prefabPath: 'db://assets/prefabs/Player.prefab',
                nodeUuid: input.nodeUuid,
            },
            message: 'Prefab created successfully',
        };
    }

    async instantiate(input: { prefabPath: string; parentUuid?: string; name?: string; position?: { x: number; y: number; z?: number } }) {
        this.calls.push({ method: 'instantiate', args: [input] });
        return {
            data: {
                nodeUuid: 'node-1',
                prefabPath: input.prefabPath,
            },
            message: 'Prefab instantiated successfully',
        };
    }

    async duplicate(input: { sourcePath: string; targetPath: string; prefabName?: string }) {
        this.calls.push({ method: 'duplicate', args: [input] });
        return {
            data: {
                sourcePath: input.sourcePath,
                targetPath: input.targetPath,
            },
            message: 'Prefab duplicated successfully',
        };
    }

    async apply(nodeUuid: string): Promise<void> {
        this.calls.push({ method: 'apply', args: [nodeUuid] });
    }

    async restore(nodeUuid: string, assetUuid: string): Promise<void> {
        this.calls.push({ method: 'restore', args: [nodeUuid, assetUuid] });
    }

    async revert(nodeUuid: string): Promise<void> {
        this.calls.push({ method: 'revert', args: [nodeUuid] });
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

    const driver = new MockPrefabDriver();
    const registry = createCapabilityRegistry({
        profile,
        prefabDriver: driver,
    });

    const list = await registry.prefab.list({ folder: 'db://assets/prefabs' });
    assert.strictEqual(list.count, 1);
    assert.strictEqual(list.prefabs[0].name, 'Player');

    const detail = await registry.prefab.query({ prefabPath: 'db://assets/prefabs/Player.prefab' });
    assert.strictEqual(detail.uuid, 'prefab-1');
    assert.strictEqual(detail.validation?.isValid, true);

    const created = await registry.prefab.createFromNode({
        nodeUuid: 'node-source',
        savePath: 'db://assets/prefabs',
        prefabName: 'Player',
    });
    assert.strictEqual(created.message, 'Prefab created successfully');

    const instantiated = await registry.prefab.instantiate({
        prefabPath: 'db://assets/prefabs/Player.prefab',
        parentUuid: 'canvas',
    });
    assert.strictEqual((instantiated.data as any).nodeUuid, 'node-1');

    const duplicated = await registry.prefab.duplicate({
        sourcePath: 'db://assets/prefabs/Player.prefab',
        targetPath: 'db://assets/prefabs/PlayerCopy.prefab',
    });
    assert.strictEqual(duplicated.message, 'Prefab duplicated successfully');

    const applied = await registry.prefab.apply({ nodeUuid: 'node-1' });
    assert.strictEqual(applied.message, 'Prefab updated successfully');

    const reverted = await registry.prefab.revert({ nodeUuid: 'node-1', assetUuid: 'prefab-1' });
    assert.strictEqual(reverted.message, 'Prefab restored successfully');

    assert.ok(driver.calls.some((call) => call.method === 'createFromNode'));
    assert.ok(driver.calls.some((call) => call.method === 'instantiate'));
    assert.ok(driver.calls.some((call) => call.method === 'duplicate'));
    assert.ok(driver.calls.some((call) => call.method === 'restore'));

    console.log('[prefab-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[prefab-capability-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
