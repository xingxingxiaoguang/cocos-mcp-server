import * as assert from 'assert';
import { SceneBridgeDriver } from '../drivers/scene/contract';
import { RuntimeProfile } from '../core/profile';
import { createCapabilityRegistry } from '../core/capability-registry';

class MockSceneDriver implements SceneBridgeDriver {
    public readonly calls: Array<{ method: string; args: any[] }> = [];

    async querySceneInfo() {
        this.calls.push({ method: 'querySceneInfo', args: [] });
        return { name: 'MainScene', uuid: 'scene-uuid', type: 'cc.Scene', active: true, nodeCount: 1 };
    }

    async querySceneHierarchy(includeComponents: boolean) {
        this.calls.push({ method: 'querySceneHierarchy', args: [includeComponents] });
        return {
            uuid: 'scene-uuid', name: 'MainScene', type: 'cc.Scene', active: true,
            children: [{
                uuid: 'node-1', name: 'Canvas', type: 'cc.Node', active: true, children: [],
                ...(includeComponents ? { components: [{ type: 'cc.UITransform', enabled: true }] } : {}),
            }],
        };
    }

    async listSceneAssets() {
        this.calls.push({ method: 'listSceneAssets', args: [] });
        return [
            {
                uuid: 'scene-uuid',
                path: 'db://assets/scenes/MainScene.scene',
                name: 'MainScene',
            },
        ];
    }

    async querySceneReady(): Promise<boolean> {
        this.calls.push({ method: 'querySceneReady', args: [] });
        return true;
    }

    async querySceneDirty(): Promise<boolean> {
        this.calls.push({ method: 'querySceneDirty', args: [] });
        return false;
    }

    async resolveSceneUuid(scenePath: string): Promise<string | null> {
        this.calls.push({ method: 'resolveSceneUuid', args: [scenePath] });
        return scenePath.includes('MainScene') ? 'scene-uuid' : null;
    }

    async openScene(sceneUuid: string): Promise<void> {
        this.calls.push({ method: 'openScene', args: [sceneUuid] });
    }

    async saveScene(): Promise<void> {
        this.calls.push({ method: 'saveScene', args: [] });
    }

    async saveSceneAs(): Promise<void> {
        this.calls.push({ method: 'saveSceneAs', args: [] });
    }

    async closeScene(): Promise<void> {
        this.calls.push({ method: 'closeScene', args: [] });
    }

    async createSceneAsset(scenePath: string, content: string) {
        this.calls.push({ method: 'createSceneAsset', args: [scenePath, content] });
        return {
            uuid: 'created-scene-uuid',
            url: scenePath,
        };
    }

    async softReloadScene(): Promise<void> {
        this.calls.push({ method: 'softReloadScene', args: [] });
    }

    async createSnapshot(): Promise<void> {
        this.calls.push({ method: 'createSnapshot', args: [] });
    }

    async abortSnapshot(): Promise<void> {
        this.calls.push({ method: 'abortSnapshot', args: [] });
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

    const driver = new MockSceneDriver();
    const registry = createCapabilityRegistry({
        profile,
        sceneDriver: driver,
    });

    const info = await registry.scene.queryInfo();
    assert.strictEqual(info.uuid, 'scene-uuid');
    assert.strictEqual(info.name, 'MainScene');

    const hierarchy = await registry.scene.queryHierarchy({ includeComponents: true });
    assert.strictEqual(hierarchy.children[0].name, 'Canvas');
    assert.strictEqual(hierarchy.children[0].components?.[0].type, 'cc.UITransform');

    const list = await registry.scene.listScenes();
    assert.strictEqual(list.count, 1);
    assert.strictEqual(list.scenes[0].path, 'db://assets/scenes/MainScene.scene');

    const status = await registry.scene.queryStatus();
    assert.strictEqual(status.ready, true);
    assert.strictEqual(status.dirty, false);

    const openResult = await registry.scene.openScene({
        scenePath: 'db://assets/scenes/MainScene.scene',
    });
    assert.ok(openResult.message.includes('Scene opened'));

    const saveResult = await registry.scene.saveScene();
    assert.strictEqual(saveResult.message, 'Scene saved successfully');

    const saveAsResult = await registry.scene.saveSceneAs({
        path: 'db://assets/scenes/Another.scene',
    });
    assert.strictEqual(saveAsResult.data?.path, 'db://assets/scenes/Another.scene');

    const createResult = await registry.scene.createScene({
        sceneName: 'Another',
        savePath: 'db://assets/scenes',
    });
    assert.strictEqual(createResult.data.uuid, 'created-scene-uuid');
    assert.strictEqual(createResult.data.sceneVerified, false);

    await registry.scene.closeScene();
    await registry.scene.reloadScene();
    await registry.scene.createSnapshot();
    await registry.scene.abortSnapshot();

    assert.ok(driver.calls.some((call) => call.method === 'queryNodeTree'));
    assert.ok(driver.calls.some((call) => call.method === 'createSceneAsset'));
    assert.ok(driver.calls.some((call) => call.method === 'openScene'));

    console.log('[scene-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[scene-capability-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
