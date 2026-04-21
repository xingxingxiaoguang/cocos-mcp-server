import * as assert from 'assert';
import { createCapabilityRegistry } from '../core/capability-registry';
import { RuntimeProfile } from '../core/profile';
import { ProjectBridgeDriver } from '../drivers/project/contract';

class MockProjectDriver implements ProjectBridgeDriver {
    public readonly calls: Array<{ method: string; args: any[] }> = [];

    getRuntimeInfo() {
        this.calls.push({ method: 'getRuntimeInfo', args: [] });
        return {
            name: 'demo-project',
            path: '/tmp/demo-project',
            uuid: 'project-uuid',
            version: '1.2.3',
            cocosVersion: '3.8.8',
        };
    }

    async readProjectConfigCandidates() {
        this.calls.push({ method: 'readProjectConfigCandidates', args: [] });
        return [
            {
                source: 'settings/project.json',
                config: {
                    general: { orientation: 'landscape' },
                    physics: { gravity: { x: 0, y: -10 } },
                },
            },
        ];
    }

    async queryProjectConfig(): Promise<unknown> {
        this.calls.push({ method: 'queryProjectConfig', args: [] });
        return {
            general: { orientation: 'portrait' },
            render: { pipeline: 'forward' },
        };
    }

    async findBestProjectConfig(_category?: string) {
        const candidates = await this.readProjectConfigCandidates();
        return candidates.length > 0 ? candidates[0] : null;
    }

    extractProjectSettings(projectConfig: unknown, category: string): unknown {
        if (!projectConfig || typeof projectConfig !== 'object') return null;
        const config = projectConfig as Record<string, any>;
        if (category === 'all') return config;
        if (category === 'general') return config.general ?? config;
        return config[category] ?? null;
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
    const driver = new MockProjectDriver();
    const registry = createCapabilityRegistry({
        profile,
        projectDriver: driver,
    });

    const info = await registry.project.queryInfo();
    assert.strictEqual(info.name, 'demo-project');
    assert.deepStrictEqual(info.config, {
        general: { orientation: 'landscape' },
        physics: { gravity: { x: 0, y: -10 } },
    });

    const settings = await registry.project.querySettings({ category: 'physics' });
    assert.strictEqual(settings.category, 'physics');
    assert.deepStrictEqual(settings.config, { gravity: { x: 0, y: -10 } });
    assert.strictEqual(settings.source, 'settings/project.json');

    const fallbackSettings = await registry.project.querySettings({ category: 'render' });
    assert.strictEqual(fallbackSettings.category, 'render');
    assert.deepStrictEqual(fallbackSettings.config, { pipeline: 'forward' });
    assert.strictEqual(fallbackSettings.source, 'Editor.Message (project config)');

    const queryCalls = driver.calls.filter((call) => call.method === 'queryProjectConfig');
    assert.strictEqual(queryCalls.length, 1);
    assert.strictEqual(registry.profile.features.projectQueryConfig, true);

    console.log('[project-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[project-capability-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
