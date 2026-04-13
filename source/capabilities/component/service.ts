import {
    ComponentAddInput,
    ComponentAddResult,
    ComponentBatchSetEntry,
    ComponentBatchSetInput,
    ComponentBatchSetResult,
    ComponentCapability,
    ComponentDetail,
    ComponentListResult,
    AvailableTypesResult,
    ClassListResult,
    SceneComponentListResult,
    ScriptCheckResult,
    ComponentModifyInput,
    ComponentModifyResult,
} from './interface';
import { ComponentBridgeDriver, NormalizedComponent } from '../../editor-bridge/component/contract';
import { safeSerialize } from '../../utils/serializer';

export class ComponentService implements ComponentCapability {
    constructor(private readonly driver: ComponentBridgeDriver) {}

    // ============================================================
    // Query methods
    // ============================================================

    async getComponentDetail(uuid: string, componentType: string): Promise<ComponentDetail> {
        const detail = await this.driver.queryComponentInfo(uuid, componentType);
        if (!detail) throw new Error(`Component '${componentType}' not found on node`);
        return { ...detail, componentType: detail.type };
    }

    async listNodeComponents(uuid: string): Promise<ComponentListResult> {
        const result = await this.driver.queryNodeComponents(uuid);
        return {
            nodeUuid: result.nodeUuid,
            components: result.components.map(c => ({
                type: c.type,
                enabled: c.enabled,
                properties: c.properties,
            })),
        };
    }

    async listAvailableTypes(category?: string): Promise<AvailableTypesResult> {
        const result = await this.driver.queryAvailableComponents(category || 'all');
        return { category: result.category, types: result.components };
    }

    async listClasses(extendsClass?: string): Promise<ClassListResult> {
        const result = await this.driver.querySceneClasses(extendsClass);
        return { classes: result.classes, count: result.count, extendsFilter: result.extendsFilter };
    }

    async listSceneComponents(): Promise<SceneComponentListResult> {
        const result = await this.driver.querySceneComponents();
        return { components: result.components, count: result.count };
    }

    async hasScript(scriptPath: string): Promise<ScriptCheckResult> {
        const result = await this.driver.queryComponentHasScript(scriptPath);
        return { className: result.className, hasScript: result.hasScript, message: result.message };
    }

    // ============================================================
    // Mutation methods
    // ============================================================

    async add(input: ComponentAddInput): Promise<ComponentAddResult> {
        return this.handleAdd(input);
    }

    async modify(input: ComponentModifyInput): Promise<ComponentModifyResult> {
        return this.handleModify(input);
    }

    async batchSet(input: ComponentBatchSetInput): Promise<ComponentBatchSetResult> {
        return this.batchSetComponentProperties(input);
    }

    // ============================================================
    // Add handler — auto-detects script vs built-in component
    // ============================================================

    private async handleAdd(args: ComponentAddInput): Promise<ComponentAddResult> {
        const { uuid, componentType } = args;

        if (componentType.includes('/') || componentType.endsWith('.ts') || componentType.endsWith('.js')) {
            return await this.attachScript(uuid, componentType);
        }
        return await this.addComponent(uuid, componentType);
    }

    // ============================================================
    // Modify handler
    // ============================================================

    private async handleModify(args: ComponentModifyInput): Promise<ComponentModifyResult> {
        switch (args.action) {
            case 'set':
                return await this.setComponentProperty(args);
            case 'remove':
                return await this.removeComponent(args.uuid, args.componentType);
            case 'remove_array_element':
                return await this.removeArrayElement(args.uuid, args.path, args.index);
            case 'reset':
                return await this.resetComponent(args.uuid, args.componentType);
            case 'call':
                return await this.executeComponentMethod(args.uuid, args.component, args.method, args.args || []);
            default:
                throw new Error(`Unknown action: ${(args as any).action}. Must be one of: set, remove, remove_array_element, reset, call`);
        }
    }

    // ============================================================
    // Add component — orchestration with before/after verification
    // ============================================================

    private async addComponent(nodeUuid: string, componentType: string): Promise<ComponentAddResult> {
        let beforeComponents: NormalizedComponent[] = [];
        let beforeCount = 0;

        try {
            const beforeInfo = await this.driver.queryNodeComponents(nodeUuid);
            beforeComponents = beforeInfo.components;
            beforeCount = beforeComponents.length;

            const existing = this.driver.isComponentOnNode(beforeComponents, componentType);
            if (existing) {
                return {
                    nodeUuid,
                    componentType: existing.type,
                    cid: existing.cid,
                    existing: true,
                    message: `Component '${componentType}' already exists on node`,
                };
            }
        } catch { /* proceed with add */ }

        try {
            await this.driver.createComponent({ uuid: nodeUuid, component: componentType });
        } catch (err: any) {
            throw new Error(err.message);
        }

        await new Promise(resolve => setTimeout(resolve, 150));

        try {
            const afterInfo = await this.driver.queryNodeComponents(nodeUuid);
            const afterComponents = afterInfo.components;
            const afterCount = afterComponents.length;
            const addedComponent = this.driver.isComponentOnNode(afterComponents, componentType);

            if (addedComponent && afterCount >= beforeCount) {
                const result: ComponentAddResult = {
                    nodeUuid,
                    componentType: addedComponent.type,
                    cid: addedComponent.cid,
                    existing: false,
                    message: `Component '${componentType}' added successfully`,
                };

                if (addedComponent.type === 'cc.Sprite') {
                    const spriteSetup = await this.driver.ensureDefaultSpriteState(nodeUuid);
                    if (spriteSetup.warning) result.warning = spriteSetup.warning;
                }

                return result;
            }

            if (afterCount > beforeCount) {
                const result: ComponentAddResult = {
                    nodeUuid,
                    componentType,
                    existing: false,
                    message: `Component '${componentType}' added successfully`,
                };

                if (componentType === 'cc.Sprite') {
                    const spriteSetup = await this.driver.ensureDefaultSpriteState(nodeUuid);
                    if (spriteSetup.warning) result.warning = spriteSetup.warning;
                }

                return result;
            }

            throw new Error(
                `Failed to add component '${componentType}'. Component count unchanged. Available components: ${afterComponents.map(c => c.type).join(', ')}`,
            );
        } catch (err: any) {
            if (err.message.startsWith('Failed to add component')) throw err;
            throw new Error(`Failed to verify component addition: ${err.message}`);
        }
    }

    private async attachScript(nodeUuid: string, scriptPath: string): Promise<ComponentAddResult> {
        const scriptName = scriptPath.split('/').pop()?.replace('.ts', '').replace('.js', '');
        if (!scriptName) throw new Error('Invalid script path');

        let beforeComponents: NormalizedComponent[] = [];
        let beforeCount = 0;

        try {
            const beforeInfo = await this.driver.queryNodeComponents(nodeUuid);
            beforeComponents = beforeInfo.components;
            beforeCount = beforeComponents.length;

            const existingScript = this.driver.isComponentOnNode(beforeComponents, scriptName);
            if (existingScript) {
                return {
                    nodeUuid,
                    componentType: existingScript.type,
                    cid: existingScript.cid,
                    existing: true,
                    message: `Script '${scriptName}' already exists on node`,
                };
            }
        } catch { /* proceed */ }

        try {
            await this.driver.createComponent({ uuid: nodeUuid, component: scriptName });
        } catch (err: any) {
            throw new Error(`Failed to attach script '${scriptName}': ${err.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 150));

        try {
            const afterInfo = await this.driver.queryNodeComponents(nodeUuid);
            const afterComponents = afterInfo.components;
            const afterCount = afterComponents.length;
            const addedScript = this.driver.isComponentOnNode(afterComponents, scriptName);

            if (addedScript && afterCount >= beforeCount) {
                return {
                    nodeUuid,
                    componentType: addedScript.type,
                    cid: addedScript.cid,
                    existing: false,
                    message: `Script '${scriptName}' attached successfully`,
                };
            }

            if (afterCount > beforeCount) {
                return {
                    nodeUuid,
                    componentType: scriptName,
                    existing: false,
                    message: `Script '${scriptName}' attached successfully`,
                };
            }

            throw new Error(
                `Script '${scriptName}' was not found on node after addition. Available components: ${afterComponents.map(c => c.type).join(', ')}`,
            );
        } catch (err: any) {
            if (err.message.startsWith('Script \'')) throw err;
            throw new Error(`Failed to verify script addition: ${err.message}`);
        }
    }

    // ============================================================
    // Remove component — orchestration with before/after verification
    // ============================================================

    private async removeComponent(nodeUuid: string, componentType: string): Promise<ComponentModifyResult> {
        let components: NormalizedComponent[];
        try {
            const result = await this.driver.queryNodeComponents(nodeUuid);
            components = result.components;
        } catch (err: any) {
            throw new Error(`Failed to get components for node '${nodeUuid}': ${err.message}`);
        }

        const targetIndex = components.findIndex(comp => {
            const existing = this.driver.isComponentOnNode([comp], componentType);
            return !!existing;
        });
        if (targetIndex < 0) {
            const available = components.map(comp => comp.type).join(', ');
            throw new Error(`Component '${componentType}' not found on node '${nodeUuid}'. Available: ${available}`);
        }

        const beforeCount = this.driver.countComponentOnNode(components, componentType);

        try {
            await this.driver.removeArrayElement({ uuid: nodeUuid, path: '__comps__', index: targetIndex });
        } catch (err: any) {
            throw new Error(`Failed to remove component: ${err.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            const afterInfo = await this.driver.queryNodeComponents(nodeUuid);
            const afterCount = this.driver.countComponentOnNode(afterInfo.components, componentType);
            if (afterCount >= beforeCount) {
                throw new Error(`Component '${componentType}' still exists after removal attempt`);
            }
        } catch (err: any) {
            if (err.message.includes('still exists after removal')) throw err;
            /* verification failed, proceed optimistically */
        }

        return {
            message: `Component '${componentType}' removed successfully`,
            nodeUuid,
            componentType,
            removedIndex: targetIndex,
        };
    }

    // ============================================================
    // Remove array element
    // ============================================================

    private async removeArrayElement(uuid: string, path: string, index: number): Promise<ComponentModifyResult> {
        try {
            await this.driver.removeArrayElement({ uuid, path, index });
        } catch (err: any) {
            throw new Error(`Failed to remove array element: ${err.message}`);
        }

        return {
            message: `Array element at index ${index} removed from '${path}'`,
            removedIndex: index,
        };
    }

    // ============================================================
    // Set component property — delegates to driver
    // ============================================================

    private async setComponentProperty(args: { uuid: string; componentType: string; property: string; value: unknown; propertyType?: string }): Promise<ComponentModifyResult> {
        const { uuid: nodeUuid, componentType, property, propertyType, value } = args;
        const result = await this.driver.applyComponentProperty({ nodeUuid, componentType, property, value, propertyType });

        if (!result.success) {
            throw new Error(result.error || `Failed to set ${componentType}.${property}`);
        }

        return {
            message: result.message || `Set ${componentType}.${property}`,
            nodeUuid: result.data?.nodeUuid,
            componentType: result.data?.componentType,
            property: result.data?.property,
            actualValue: result.data?.actualValue,
            changeVerified: result.data?.changeVerified,
        };
    }

    // ============================================================
    // Reset / Execute — thin delegation
    // ============================================================

    private async resetComponent(uuid: string, componentType?: string): Promise<ComponentModifyResult> {
        await this.driver.resetComponent({ uuid, componentType });
        return { message: 'Component reset to default values' };
    }

    private async executeComponentMethod(uuid: string, component: string, method: string, args: unknown[] = []): Promise<ComponentModifyResult> {
        const result = await this.driver.executeComponentMethod({ uuid, component, method, args });
        return {
            message: `Method '${method}' executed successfully`,
            executionResult: safeSerialize(result),
        };
    }

    // ============================================================
    // Batch set — orchestration with iteration
    // ============================================================

    private async batchSetComponentProperties(input: ComponentBatchSetInput): Promise<ComponentBatchSetResult> {
        const { uuid: nodeUuid, batch, continueOnError = true } = input;

        if (!Array.isArray(batch) || batch.length === 0) {
            throw new Error('batch must be a non-empty array');
        }

        const results: ComponentBatchSetEntry[] = [];
        const failures: ComponentBatchSetEntry[] = [];

        for (const item of batch) {
            if (!item || typeof item !== 'object') {
                const failure: ComponentBatchSetEntry = {
                    componentType: '',
                    property: '',
                    success: false,
                    error: 'Invalid batch item',
                };
                results.push(failure);
                failures.push(failure);
                if (!continueOnError) break;
                continue;
            }

            const { componentType, properties } = item;
            if (!componentType || !properties || typeof properties !== 'object') {
                const failure: ComponentBatchSetEntry = {
                    componentType: componentType || '',
                    property: '',
                    success: false,
                    error: 'Each batch item must include componentType and properties',
                };
                results.push(failure);
                failures.push(failure);
                if (!continueOnError) break;
                continue;
            }

            for (const [property, rawEntry] of Object.entries(properties)) {
                const normalized = this.normalizeBatchPropertyEntry(rawEntry);
                const setResult = await this.driver.applyComponentProperty({
                    nodeUuid,
                    componentType,
                    property,
                    value: normalized.value,
                    propertyType: normalized.propertyType,
                });

                const entry: ComponentBatchSetEntry = {
                    componentType,
                    property,
                    propertyType: normalized.propertyType || null,
                    success: setResult.success,
                    message: setResult.message,
                    error: setResult.error,
                    data: setResult.data,
                };
                results.push(entry);

                if (!setResult.success) {
                    failures.push(entry);
                    if (!continueOnError) break;
                }
            }

            if (!continueOnError && failures.length > 0) break;
        }

        return {
            nodeUuid,
            results,
            failures,
            message: failures.length > 0
                ? `Batch set completed with ${failures.length} failure(s)`
                : `Batch set completed for ${results.length} property update(s)`,
        };
    }

    private normalizeBatchPropertyEntry(entry: unknown): { value: unknown; propertyType?: string } {
        if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.prototype.hasOwnProperty.call(entry, 'propertyType')) {
            const obj = entry as Record<string, unknown>;
            return {
                value: Object.prototype.hasOwnProperty.call(obj, 'value') ? obj.value : entry,
                propertyType: String(obj.propertyType || ''),
            };
        }
        return { value: entry };
    }
}
