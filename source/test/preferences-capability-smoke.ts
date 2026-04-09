import * as assert from 'assert';
import { createCapabilityRegistry } from '../editor-bridge/runtime/registry';
import { RuntimeProfile } from '../editor-bridge/runtime/profile';
import { PreferencesBridgeDriver } from '../editor-bridge/preferences/contract';

class MockPreferencesDriver implements PreferencesBridgeDriver {
    public readonly calls: Array<{ method: string; args: any[] }> = [];

    async queryConfig(input: { name: string; path?: string; type: 'default' | 'global' | 'local' }): Promise<unknown> {
        this.calls.push({ method: 'queryConfig', args: [input] });
        if (input.name === 'missing') {
            throw new Error('missing category');
        }

        if (input.type === 'default') {
            return { restored: true, name: input.name };
        }

        return { category: input.name, path: input.path || null, scope: input.type };
    }

    async setConfig(input: { name: string; path: string; value: unknown; type: 'default' | 'global' | 'local' }): Promise<boolean> {
        this.calls.push({ method: 'setConfig', args: [input] });
        return true;
    }

    async openSettings(tab?: string): Promise<void> {
        this.calls.push({ method: 'openSettings', args: [tab] });
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
            sceneScriptExecute: true,
        },
    };
    const driver = new MockPreferencesDriver();
    const registry = createCapabilityRegistry({
        profile,
        preferencesDriver: driver,
    });

    const single = await registry.preferences.query({ name: 'general', path: 'language', type: 'global' });
    assert.strictEqual(single.mode, 'single');
    if (single.mode === 'single') {
        assert.strictEqual(single.target.name, 'general');
        assert.deepStrictEqual(single.config, {
            category: 'general',
            path: 'language',
            scope: 'global',
        });
    }

    const all = await registry.preferences.query({});
    assert.strictEqual(all.mode, 'all');
    if (all.mode === 'all') {
        assert.ok(all.categories.includes('general'));
        assert.ok(all.categories.includes('builder'));
    }

    const setResult = await registry.preferences.set({
        name: 'general',
        path: 'language',
        value: 'zh',
        type: 'global',
    });
    assert.strictEqual(setResult.action, 'set');

    const resetResult = await registry.preferences.reset({
        name: 'general',
        type: 'local',
    });
    assert.strictEqual(resetResult.action, 'reset');

    const exportResult = await registry.preferences.export();
    assert.ok(exportResult.jsonData.includes('"general"'));

    await registry.preferences.open({ tab: 'general' });

    const queryCalls = driver.calls.filter((call) => call.method === 'queryConfig');
    const setCalls = driver.calls.filter((call) => call.method === 'setConfig');
    const openCalls = driver.calls.filter((call) => call.method === 'openSettings');

    assert.ok(queryCalls.length >= 1);
    assert.strictEqual(setCalls.length, 2);
    assert.strictEqual(openCalls.length, 1);
    assert.strictEqual(registry.profile.cocosVersion, '3.8.8');

    console.log('[preferences-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[preferences-capability-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
