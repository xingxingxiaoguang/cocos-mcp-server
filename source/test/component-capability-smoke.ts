import * as assert from 'assert';
import {
    ApplyPropertyInput,
    ApplyPropertyResult,
    AvailableComponentsResult,
    ComponentBridgeDriver,
    ComponentCreateInput,
    ComponentCreateResult,
    ComponentDetailResult,
    ComponentHasScriptResult,
    ComponentMethodInput,
    ComponentQueryResult,
    ComponentResetInput,
    ComponentSetPropertyInput,
    NormalizedComponent,
    PropertyVerificationResult,
    RemoveArrayElementInput,
    SceneClassesResult,
    SceneComponentsResult,
    SpriteStateResult,
} from '../drivers/component/contract';
import { RuntimeProfile } from '../core/profile';
import { createCapabilityRegistry } from '../core/capability-registry';

class MockComponentDriver implements ComponentBridgeDriver {
    public readonly calls: Array<{ method: string; args: unknown[] }> = [];

    // 低层级 IPC
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

    // 查询操作
    async queryNodeComponents(nodeUuid: string): Promise<ComponentQueryResult> {
        this.calls.push({ method: 'query-node-components', args: [nodeUuid] });
        return {
            nodeUuid,
            components: [
                { type: 'cc.Sprite', cid: 'cc.Sprite', uuid: 'comp-1', enabled: true, properties: {} },
            ],
        };
    }

    async queryComponentInfo(nodeUuid: string, componentType: string): Promise<ComponentDetailResult | null> {
        this.calls.push({ method: 'query-component-info', args: [nodeUuid, componentType] });
        return { nodeUuid, type: componentType, uuid: 'comp-1', enabled: true, properties: {} };
    }

    async queryAvailableComponents(category: string): Promise<AvailableComponentsResult> {
        return { category, components: ['cc.Sprite', 'cc.Label'] };
    }

    async querySceneClasses(_extendsClass?: string): Promise<SceneClassesResult> {
        return { classes: [], count: 0 };
    }

    async querySceneComponents(): Promise<SceneComponentsResult> {
        return { components: [], count: 0 };
    }

    async queryComponentHasScript(className: string): Promise<ComponentHasScriptResult> {
        return { className, hasScript: false, message: `Component '${className}' does not have script` };
    }

    // 属性操作
    async applyComponentProperty(input: ApplyPropertyInput): Promise<ApplyPropertyResult> {
        this.calls.push({ method: 'apply-component-property', args: [input] });
        return {
            success: true,
            message: `Set ${input.componentType}.${input.property}`,
            data: {
                nodeUuid: input.nodeUuid,
                componentType: input.componentType,
                property: input.property,
                changeVerified: true,
            },
        };
    }

    async ensureDefaultSpriteState(_nodeUuid: string): Promise<SpriteStateResult> {
        return {};
    }

    async verifyPropertyChange(
        _nodeUuid: string, _componentType: string, _property: string, _originalValue: unknown, _expectedValue: unknown,
    ): Promise<PropertyVerificationResult> {
        return { verified: true, actualValue: undefined, fullData: null };
    }

    // 组件匹配工具
    isComponentOnNode(components: NormalizedComponent[], componentType: string): NormalizedComponent | undefined {
        return components.find(c => c.type === componentType || c.cid === componentType);
    }

    countComponentOnNode(components: NormalizedComponent[], componentType: string): number {
        return components.filter(c => c.type === componentType || c.cid === componentType).length;
    }

    generateComponentSuggestion(_requestedType: string, _availableTypes: string[], _property: string): string {
        return '';
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

    const componentDriver = new MockComponentDriver();
    const registry = createCapabilityRegistry({
        profile,
        componentDriver,
    });

    // Test listNodeComponents (was query({ uuid }))
    const listed = await registry.component.listNodeComponents('node-1');
    assert.strictEqual(listed.nodeUuid, 'node-1');
    assert.strictEqual(listed.components.length, 1);
    assert.strictEqual(listed.components[0].type, 'cc.Sprite');

    // Test add — existing component returns without error
    const added = await registry.component.add({ uuid: 'node-1', componentType: 'cc.Sprite' });
    assert.strictEqual(added.existing, true);
    assert.strictEqual(added.componentType, 'cc.Sprite');
    assert.ok(added.message.includes('already exists'));

    // Test getComponentDetail
    const detail = await registry.component.getComponentDetail('node-1', 'cc.Sprite');
    assert.strictEqual(detail.componentType, 'cc.Sprite');
    assert.strictEqual(detail.enabled, true);

    // Test listAvailableTypes
    const available = await registry.component.listAvailableTypes('all');
    assert.strictEqual(available.category, 'all');
    assert.ok(available.types.includes('cc.Sprite'));

    // Test hasScript
    const scriptCheck = await registry.component.hasScript('MyScript');
    assert.strictEqual(scriptCheck.hasScript, false);
    assert.strictEqual(scriptCheck.className, 'MyScript');

    assert.ok(componentDriver.calls.some((call) => call.method === 'query-node-components'));
    console.log('[component-capability-smoke] OK');
}

main().catch((error) => {
    console.error('[component-capability-smoke] FAILED:', error);
    process.exit(1);
});
