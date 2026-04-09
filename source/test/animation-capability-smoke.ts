import * as assert from 'assert';
import { createCapabilityRegistry } from '../runtime/capability-registry';
import { RuntimeProfile } from '../runtime/profile';
import { AnimationBridgeDriver } from '../editor-bridge/animation/contract';

class MockAnimationDriver implements AnimationBridgeDriver {
    public readonly calls: Array<{ method: string; args: any[] }> = [];

    async listClipAssets() {
        this.calls.push({ method: 'listClipAssets', args: [] });
        return [
            {
                uuid: 'clip-1',
                path: 'db://assets/anim/walk.anim',
                name: 'walk',
                type: 'cc.AnimationClip',
                size: 128,
            },
        ];
    }

    async resolveClipRef(input: { clipUuid?: string; uuid?: string; path?: string; }) {
        this.calls.push({ method: 'resolveClipRef', args: [input] });
        return {
            clipUuid: input.clipUuid || input.uuid || 'clip-1',
            path: input.path || 'db://assets/anim/walk.anim',
            name: 'walk',
            type: 'cc.AnimationClip',
        };
    }

    async executeSceneMethod(method: string, args: unknown[]) {
        this.calls.push({ method: 'executeSceneMethod', args: [method, args] });
        return {
            success: true,
            data: {
                method,
                args,
            },
            warning: method === 'saveAnimationClip' ? undefined : 'mock-warning',
        };
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

    const driver = new MockAnimationDriver();
    const registry = createCapabilityRegistry({
        profile,
        animationDriver: driver,
    });

    const list = await registry.animation.listClips();
    assert.strictEqual(list.count, 1);
    assert.strictEqual(list.animations[0].name, 'walk');

    const createResult = await registry.animation.createClip({
        savePath: 'db://assets/anim/walk.anim',
        name: 'walk',
    });
    assert.strictEqual((createResult.data as any).method, 'createAnimationClip');

    const info = await registry.animation.getClipInfo({
        nodeUuid: 'node-1',
        clipUuid: 'clip-1',
    });
    assert.strictEqual((info.data as any).method, 'getAnimationClipInfo');

    const setKey = await registry.animation.setKeyframe({
        nodeUuid: 'node-1',
        clipUuid: 'clip-1',
        nodePath: 'Canvas/Player',
        propKey: 'position',
        frame: 12,
        value: { x: 1, y: 2, z: 3 },
        curve: { interpMode: 0 },
    });
    assert.strictEqual((setKey.data as any).method, 'setAnimationKeyframe');
    assert.strictEqual(setKey.warning, 'mock-warning');

    const save = await registry.animation.saveClip({
        nodeUuid: 'node-1',
        clipUuid: 'clip-1',
    });
    assert.strictEqual((save.data as any).method, 'saveAnimationClip');

    assert.ok(driver.calls.some((call) => call.method === 'resolveClipRef'));
    assert.ok(driver.calls.some((call) => call.method === 'executeSceneMethod'));
    console.log('[animation-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[animation-capability-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
