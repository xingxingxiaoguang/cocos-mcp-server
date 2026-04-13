import { ToolResponse } from '../../mcp/interface';
import {
    ComponentAddInput,
    ComponentBatchSetInput,
    ComponentCapability,
    ComponentModifyInput,
    ComponentQueryInput,
} from './interface';
import { ComponentBridgeDriver, NormalizedComponent } from '../../editor-bridge/component/contract';
import { safeSerialize } from '../../utils/serializer';

export class ComponentService implements ComponentCapability {
    constructor(private readonly driver: ComponentBridgeDriver) {}

    async query(input: ComponentQueryInput): Promise<ToolResponse> {
        return this.handleQuery(input);
    }

    async add(input: ComponentAddInput): Promise<ToolResponse> {
        return this.handleAdd(input);
    }

    async modify(input: ComponentModifyInput): Promise<ToolResponse> {
        return this.handleModify(input);
    }

    async batchSet(input: ComponentBatchSetInput): Promise<ToolResponse> {
        return this.batchSetComponentProperties(input);
    }

    // ============================================================
    // Query handler
    // ============================================================

    private async handleQuery(args: any): Promise<ToolResponse> {
        const { uuid, componentType, action, category, scriptPath } = args;

        if (uuid && componentType) {
            try {
                const detail = await this.driver.queryComponentInfo(uuid, componentType);
                if (!detail) return { success: false, error: `Component '${componentType}' not found on node` };
                return { success: true, data: { ...detail, componentType: detail.type } };
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        }

        if (uuid) {
            try {
                const result = await this.driver.queryNodeComponents(uuid);
                return { success: true, data: result };
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        }

        switch (action) {
            case 'available':
                try {
                    const result = await this.driver.queryAvailableComponents(category || 'all');
                    return { success: true, data: result };
                } catch (err: any) {
                    return { success: false, error: err.message };
                }
            case 'classes':
                try {
                    const result = await this.driver.querySceneClasses(args.extends);
                    return { success: true, data: result };
                } catch (err: any) {
                    return { success: false, error: err.message };
                }
            case 'scene_components':
                try {
                    const result = await this.driver.querySceneComponents();
                    return { success: true, data: result };
                } catch (err: any) {
                    return { success: false, error: err.message };
                }
            case 'has_script':
                try {
                    const result = await this.driver.queryComponentHasScript(scriptPath || args.className);
                    return { success: true, data: result };
                } catch (err: any) {
                    return { success: false, error: err.message };
                }
            default:
                return { success: false, error: 'Must provide uuid or specify action (available, classes, scene_components, has_script)' };
        }
    }

    // ============================================================
    // Add handler — auto-detects script vs built-in component
    // ============================================================

    private async handleAdd(args: any): Promise<ToolResponse> {
        const { uuid, componentType } = args;

        if (componentType.includes('/') || componentType.endsWith('.ts') || componentType.endsWith('.js')) {
            return await this.attachScript(uuid, componentType);
        }
        return await this.addComponent(uuid, componentType);
    }

    // ============================================================
    // Modify handler
    // ============================================================

    private async handleModify(args: any): Promise<ToolResponse> {
        const { uuid, action } = args;

        switch (action) {
            case 'set':
                return await this.setComponentProperty(args);
            case 'remove':
                return await this.removeComponent(uuid, args.componentType);
            case 'reset':
                return await this.resetComponent(uuid);
            case 'execute':
                return await this.executeComponentMethod(uuid, args.method, args.args || []);
            case 'batch_set':
                return await this.batchSetComponentProperties(args);
            default:
                return { success: false, error: `Unknown action: ${action}. Must be one of: set, remove, reset, execute, batch_set` };
        }
    }

    // ============================================================
    // Add component — orchestration with before/after verification
    // ============================================================

    private async addComponent(nodeUuid: string, componentType: string): Promise<ToolResponse> {
        let beforeComponents: NormalizedComponent[] = [];
        let beforeCount = 0;

        try {
            const beforeInfo = await this.driver.queryNodeComponents(nodeUuid);
            beforeComponents = beforeInfo.components;
            beforeCount = beforeComponents.length;

            const existing = this.driver.isComponentOnNode(beforeComponents, componentType);
            if (existing) {
                return {
                    success: true,
                    message: `Component '${componentType}' already exists on node`,
                    data: {
                        nodeUuid, componentType: existing.type, cid: existing.cid,
                        componentVerified: true, existing: true,
                    },
                };
            }
        } catch { /* proceed with add */ }

        try {
            await this.driver.createComponent({ uuid: nodeUuid, component: componentType });
        } catch (err: any) {
            return { success: false, error: err.message };
        }

        await new Promise(resolve => setTimeout(resolve, 150));

        try {
            const afterInfo = await this.driver.queryNodeComponents(nodeUuid);
            const afterComponents = afterInfo.components;
            const afterCount = afterComponents.length;
            const addedComponent = this.driver.isComponentOnNode(afterComponents, componentType);

            if (addedComponent && afterCount >= beforeCount) {
                const response: ToolResponse = {
                    success: true,
                    message: `Component '${componentType}' added successfully`,
                    data: {
                        nodeUuid, componentType: addedComponent.type, cid: addedComponent.cid,
                        componentVerified: true, existing: false,
                    },
                };

                if (addedComponent.type === 'cc.Sprite') {
                    const spriteSetup = await this.driver.ensureDefaultSpriteState(nodeUuid);
                    if (spriteSetup.warning) response.warning = spriteSetup.warning;
                }

                return response;
            }

            if (afterCount > beforeCount) {
                const response: ToolResponse = {
                    success: true,
                    message: `Component '${componentType}' added successfully`,
                    data: { nodeUuid, componentType, componentVerified: true, existing: false },
                };

                if (componentType === 'cc.Sprite') {
                    const spriteSetup = await this.driver.ensureDefaultSpriteState(nodeUuid);
                    if (spriteSetup.warning) response.warning = spriteSetup.warning;
                }

                return response;
            }

            return {
                success: false,
                error: `Failed to add component '${componentType}'. Component count unchanged. Available components: ${afterComponents.map(c => c.type).join(', ')}`,
            };
        } catch (err: any) {
            return { success: false, error: `Failed to verify component addition: ${err.message}` };
        }
    }

    private async attachScript(nodeUuid: string, scriptPath: string): Promise<ToolResponse> {
        const scriptName = scriptPath.split('/').pop()?.replace('.ts', '').replace('.js', '');
        if (!scriptName) return { success: false, error: 'Invalid script path' };

        let beforeComponents: NormalizedComponent[] = [];
        let beforeCount = 0;

        try {
            const beforeInfo = await this.driver.queryNodeComponents(nodeUuid);
            beforeComponents = beforeInfo.components;
            beforeCount = beforeComponents.length;

            const existingScript = this.driver.isComponentOnNode(beforeComponents, scriptName);
            if (existingScript) {
                return {
                    success: true,
                    message: `Script '${scriptName}' already exists on node`,
                    data: { nodeUuid, componentName: existingScript.type, cid: existingScript.cid, existing: true },
                };
            }
        } catch { /* proceed */ }

        try {
            await this.driver.createComponent({ uuid: nodeUuid, component: scriptName });
        } catch (err: any) {
            return {
                success: false,
                error: `Failed to attach script '${scriptName}': ${err.message}`,
                instruction: 'Please ensure the script is properly compiled and exported as a Component class.',
            };
        }

        await new Promise(resolve => setTimeout(resolve, 150));

        try {
            const afterInfo = await this.driver.queryNodeComponents(nodeUuid);
            const afterComponents = afterInfo.components;
            const afterCount = afterComponents.length;
            const addedScript = this.driver.isComponentOnNode(afterComponents, scriptName);

            if (addedScript && afterCount >= beforeCount) {
                return {
                    success: true,
                    message: `Script '${scriptName}' attached successfully`,
                    data: { nodeUuid, componentName: addedScript.type, cid: addedScript.cid, existing: false },
                };
            }

            if (afterCount > beforeCount) {
                return {
                    success: true,
                    message: `Script '${scriptName}' attached successfully`,
                    data: { nodeUuid, componentName: scriptName, existing: false },
                };
            }

            return {
                success: false,
                error: `Script '${scriptName}' was not found on node after addition. Available components: ${afterComponents.map(c => c.type).join(', ')}`,
            };
        } catch (err: any) {
            return { success: false, error: `Failed to verify script addition: ${err.message}` };
        }
    }

    // ============================================================
    // Remove component — orchestration with before/after verification
    // ============================================================

    private async removeComponent(nodeUuid: string, componentType: string): Promise<ToolResponse> {
        let components: NormalizedComponent[];
        try {
            const result = await this.driver.queryNodeComponents(nodeUuid);
            components = result.components;
        } catch (err: any) {
            return { success: false, error: `Failed to get components for node '${nodeUuid}': ${err.message}` };
        }

        const targetIndex = components.findIndex(comp => {
            const existing = this.driver.isComponentOnNode([comp], componentType);
            return !!existing;
        });
        if (targetIndex < 0) {
            const available = components.map(comp => comp.type).join(', ');
            return { success: false, error: `Component '${componentType}' not found on node '${nodeUuid}'. Available: ${available}` };
        }

        const beforeCount = this.driver.countComponentOnNode(components, componentType);

        try {
            await this.driver.removeArrayElement({ uuid: nodeUuid, path: '__comps__', index: targetIndex });
        } catch (err: any) {
            return { success: false, error: `Failed to remove component: ${err.message}` };
        }

        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            const afterInfo = await this.driver.queryNodeComponents(nodeUuid);
            const afterCount = this.driver.countComponentOnNode(afterInfo.components, componentType);
            if (afterCount >= beforeCount) {
                return { success: false, error: `Component '${componentType}' still exists after removal attempt` };
            }
        } catch { /* verification failed, proceed optimistically */ }

        return {
            success: true,
            message: `Component '${componentType}' removed successfully`,
            data: { nodeUuid, componentType, removedIndex: targetIndex },
        };
    }

    // ============================================================
    // Set component property — delegates to driver
    // ============================================================

    private async setComponentProperty(args: any): Promise<ToolResponse> {
        const { uuid: nodeUuid, componentType, property, propertyType, value } = args;
        const result = await this.driver.applyComponentProperty({ nodeUuid, componentType, property, value, propertyType });

        if (result.success) {
            return {
                success: true,
                message: result.message,
                data: result.data,
            };
        }

        return {
            success: false,
            error: result.error,
            instruction: result.instruction,
        };
    }

    // ============================================================
    // Reset / Execute — thin delegation
    // ============================================================

    private async resetComponent(uuid: string): Promise<ToolResponse> {
        try {
            await this.driver.resetComponent({ uuid });
            return { success: true, message: 'Component reset to default values' };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async executeComponentMethod(uuid: string, name: string, args: any[] = []): Promise<ToolResponse> {
        try {
            const result = await this.driver.executeComponentMethod({ uuid, component: name, method: name, args });
            return {
                success: true,
                data: { result: safeSerialize(result), message: `Method '${name}' executed successfully` },
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    // ============================================================
    // Batch set — orchestration with iteration
    // ============================================================

    private async batchSetComponentProperties(args: any): Promise<ToolResponse> {
        const { uuid: nodeUuid, batch, continueOnError = true } = args;

        if (!Array.isArray(batch) || batch.length === 0) {
            return { success: false, error: 'batch must be a non-empty array' };
        }

        const results: any[] = [];
        const failures: any[] = [];

        for (const item of batch) {
            if (!item || typeof item !== 'object') {
                const failure = { success: false, error: 'Invalid batch item', item };
                results.push(failure);
                failures.push(failure);
                if (!continueOnError) break;
                continue;
            }

            const { componentType, properties } = item;
            if (!componentType || !properties || typeof properties !== 'object') {
                const failure = { success: false, error: 'Each batch item must include componentType and properties', item };
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

                results.push({
                    componentType, property,
                    propertyType: normalized.propertyType || null,
                    success: setResult.success,
                    message: setResult.message,
                    error: setResult.error,
                    data: setResult.data,
                });

                if (!setResult.success) {
                    failures.push(setResult);
                    if (!continueOnError) break;
                }
            }

            if (!continueOnError && failures.length > 0) break;
        }

        if (failures.length > 0) {
            return {
                success: false,
                error: `Batch set completed with ${failures.length} failure(s)`,
                data: { nodeUuid, results, failures },
            };
        }

        return {
            success: true,
            message: `Batch set completed for ${results.length} property update(s)`,
            data: { nodeUuid, results },
        };
    }

    private normalizeBatchPropertyEntry(entry: any): { value: any; propertyType?: string } {
        if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.prototype.hasOwnProperty.call(entry, 'propertyType')) {
            return {
                value: Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : entry,
                propertyType: String(entry.propertyType || ''),
            };
        }
        return { value: entry };
    }
}
