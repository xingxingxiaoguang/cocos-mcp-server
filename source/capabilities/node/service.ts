import {
    NodeArrangeInput,
    NodeArrangeResult,
    NodeBatchCreateEntry,
    NodeBatchCreateInput,
    NodeBatchCreateResult,
    NodeCapability,
    NodeComponentSpec,
    NodeCreateResult,
    NodeCreateSpec,
    NodeDeleteResult,
    NodeDetail,
    NodeInfo,
    NodeModifyInput,
    NodeModifyResult,
    NodeAssetUsageResult,
    NodeListResult,
    NodeSearchResult,
} from './interface';
import { ComponentCapability, ComponentAddResult } from '../component/interface';
import { NodeBridgeDriver } from '../../editor-bridge/node/contract';

export class NodeService implements NodeCapability {
    constructor(
        private readonly driver: NodeBridgeDriver,
        private readonly components: ComponentCapability,
    ) {}

    // =========================================================================
    // Public interface — Queries
    // =========================================================================

    async queryByUuid(uuid: string): Promise<NodeDetail> {
        const info = await this.driver.queryNodeInfo(uuid);
        return { ...info, nodeType: NodeService.is2DNode(info) ? '2D' : '3D' };
    }

    async searchByName(pattern: string): Promise<NodeSearchResult> {
        const results = await this.driver.searchNodes(pattern);
        return { nodes: results };
    }

    async queryAssetUsage(assetUuid: string): Promise<NodeAssetUsageResult> {
        const nodeUuids = await this.driver.queryNodesByAssetUuid(assetUuid);
        return { assetUuid, nodeUuids, count: nodeUuids.length };
    }

    async listAll(): Promise<NodeListResult> {
        const nodes = await this.driver.flattenNodes();
        return { totalNodes: nodes.length, nodes };
    }

    // =========================================================================
    // Public interface — Mutations
    // =========================================================================

    async create(spec: NodeCreateSpec): Promise<NodeCreateResult> {
        return this.createNodeFromSpec(spec);
    }

    async batchCreate(input: NodeBatchCreateInput): Promise<NodeBatchCreateResult> {
        return this.batchCreateNodes(input);
    }

    async modify(input: NodeModifyInput): Promise<NodeModifyResult> {
        switch (input.action) {
            case 'set_property':  return this.setNodeProperty(input.uuid, input.property, input.value);
            case 'set_transform': return this.setNodeTransform(input);
            case 'reset_property': return this.resetNodeProperty(input.uuid, input.path);
            case 'reset_transform': return this.resetNodeTransform(input.uuid);
        }
    }

    async delete(uuids: string | string[]): Promise<NodeDeleteResult> {
        return this.deleteNode(uuids);
    }

    async arrange(input: NodeArrangeInput): Promise<NodeArrangeResult> {
        switch (input.action) {
            case 'move':      return this.moveNode(input.uuid, input.parentUuid, input.siblingIndex);
            case 'duplicate': return this.duplicateNode(input.uuids);
            case 'copy':      return this.copyNode(input.uuids);
            case 'paste':     return this.pasteNode(input.parentUuid, input.uuids, input.keepWorldTransform);
            case 'cut':       return this.cutNode(input.uuids);
        }
    }

    // =========================================================================
    // Create — orchestration
    // =========================================================================

    private async createNodeFromSpec(spec: NodeCreateSpec): Promise<NodeCreateResult> {
        const targetParentUuid = await this.driver.resolveParentUuid(spec.parentUuid);

        let finalAssetUuid = spec.assetUuid;
        if (spec.assetPath && !finalAssetUuid) {
            finalAssetUuid = await this.driver.resolveAssetUuid(spec.assetPath) ?? undefined;
            if (!finalAssetUuid) {
                throw new Error(`Asset not found at path: ${spec.assetPath}`);
            }
        }

        const normalizedComponents = Array.isArray(spec.components) ? spec.components : [];
        const componentTypes = normalizedComponents.map(c => typeof c === 'string' ? c : c.type);

        const uuid = await this.driver.createNode({
            name: spec.name,
            parent: targetParentUuid,
            assetUuid: finalAssetUuid,
            components: componentTypes.length > 0 ? componentTypes : spec.nodeType && spec.nodeType !== 'Node' && !finalAssetUuid ? [spec.nodeType] : undefined,
            unlinkPrefab: spec.unlinkPrefab,
            keepWorldTransform: spec.keepWorldTransform,
        });

        if (spec.siblingIndex !== undefined && spec.siblingIndex >= 0 && uuid && targetParentUuid) {
            try {
                await new Promise(resolve => setTimeout(resolve, 100));
                await this.driver.setParent({ parent: targetParentUuid, uuids: [uuid], keepWorldTransform: spec.keepWorldTransform ?? false });
            } catch { console.warn('Failed to set sibling index'); }
        }

        const defaultSpriteFrameUuid = componentTypes.some(t => t === 'cc.Sprite')
            ? await this.driver.resolveDefaultSpriteFrameUuid()
            : null;

        if (componentTypes.length > 0 && uuid) {
            await new Promise(resolve => setTimeout(resolve, 100));
            for (const componentSpec of normalizedComponents) {
                const componentType = typeof componentSpec === 'string' ? componentSpec : componentSpec.type;
                try {
                    const result = await this.components.add({ uuid, componentType });

                    if (typeof componentSpec === 'object' && componentSpec.properties && Object.keys(componentSpec.properties).length > 0) {
                        const actualType = this.resolveAddedComponentType(componentType, result);
                        const propertyBatch = this.driver.buildInlineComponentPropertyBatch({
                            requestedType: componentType,
                            actualType,
                            properties: componentSpec.properties,
                            defaultSpriteFrameUuid,
                        });
                        if (Object.keys(propertyBatch).length > 0) {
                            const batchResult = await this.components.batchSet({
                                uuid,
                                batch: [{ componentType: actualType, properties: propertyBatch }],
                                continueOnError: true,
                            });
                            if (batchResult.failures.length > 0) {
                                console.warn(`Failed to initialize component ${actualType}:`, batchResult.failures);
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to add component ${componentType}:`, err);
                }
            }
        }

        if (spec.initialTransform && uuid) {
            try {
                await new Promise(resolve => setTimeout(resolve, 150));
                await this.setNodeTransform({ uuid, ...spec.initialTransform });
            } catch { console.warn('Failed to set initial transform'); }
        }

        let nodeInfo: NodeInfo | undefined;
        try {
            nodeInfo = await this.queryByUuid(uuid);
        } catch { console.warn('Failed to get verification data'); }

        return {
            uuid, name: spec.name, parentUuid: targetParentUuid,
            nodeType: spec.nodeType || 'Node',
            fromAsset: !!finalAssetUuid, assetUuid: finalAssetUuid,
            message: finalAssetUuid
                ? `Node '${spec.name}' instantiated from asset successfully`
                : `Node '${spec.name}' created successfully`,
            nodeInfo,
        };
    }

    private async batchCreateNodes(input: NodeBatchCreateInput): Promise<NodeBatchCreateResult> {
        const nodeSpecs = Array.isArray(input.nodes) ? input.nodes : [];
        if (nodeSpecs.length === 0) throw new Error('nodes must be a non-empty array');

        const results: NodeBatchCreateEntry[] = [];
        const failures: NodeBatchCreateEntry[] = [];
        let previousComponentSpecs: Array<string | NodeComponentSpec> | null = null;

        for (let index = 0; index < nodeSpecs.length; index++) {
            const rawSpec = nodeSpecs[index];
            const normalized = this.normalizeNodeCreateSpec(rawSpec, input.parentUuid, previousComponentSpecs);
            if (!normalized.success) {
                const failure: NodeBatchCreateEntry = { index, name: rawSpec?.name || `Node_${index}`, success: false, error: normalized.error };
                results.push(failure);
                failures.push(failure);
                continue;
            }

            try {
                const createResult = await this.create(normalized.data);
                const entry: NodeBatchCreateEntry = {
                    index, name: normalized.data.name, success: true,
                    uuid: createResult.uuid, data: createResult,
                };
                results.push(entry);
                previousComponentSpecs = normalized.data.components ?? previousComponentSpecs;
            } catch (err) {
                const entry: NodeBatchCreateEntry = {
                    index, name: normalized.data.name, success: false,
                    error: (err as Error).message,
                };
                results.push(entry);
                failures.push(entry);
            }
        }

        if (failures.length > 0) {
            return { results, failures, message: `Batch node creation completed with ${failures.length} failure(s)` };
        }
        return { results, failures: [], message: `Batch created ${results.length} node(s) successfully` };
    }

    private normalizeNodeCreateSpec(
        rawSpec: NodeCreateSpec, defaultParentUuid?: string,
        previousComponentSpecs: Array<string | NodeComponentSpec> | null = null,
    ): { success: true; data: NodeCreateSpec } | { success: false; error: string } {
        if (!rawSpec || typeof rawSpec !== 'object') return { success: false, error: 'Node spec must be an object' };
        if (typeof rawSpec.name !== 'string' || !rawSpec.name.trim()) return { success: false, error: 'Node spec must include a non-empty string name' };

        const normalizedComponents = this.normalizeNodeComponents(rawSpec.components, previousComponentSpecs);
        if (!normalizedComponents.success) return normalizedComponents;

        return {
            success: true,
            data: {
                name: rawSpec.name, parentUuid: rawSpec.parentUuid || defaultParentUuid,
                nodeType: rawSpec.nodeType || 'Node', siblingIndex: rawSpec.siblingIndex,
                assetUuid: rawSpec.assetUuid, assetPath: rawSpec.assetPath,
                components: normalizedComponents.data, unlinkPrefab: rawSpec.unlinkPrefab,
                keepWorldTransform: rawSpec.keepWorldTransform, initialTransform: rawSpec.initialTransform,
            },
        };
    }

    private normalizeNodeComponents(
        rawComponents: unknown, previousComponentSpecs: Array<string | NodeComponentSpec> | null = null,
    ): { success: true; data: Array<string | NodeComponentSpec> } | { success: false; error: string } {
        if (rawComponents === undefined || rawComponents === null) return { success: true, data: [] };
        if (rawComponents === 'same_as_previous') {
            if (!previousComponentSpecs || previousComponentSpecs.length === 0) {
                return { success: false, error: 'components = "same_as_previous" requires a previous node with component specs' };
            }
            return { success: true, data: previousComponentSpecs.map(s => this.cloneComponentSpec(s)) };
        }
        if (!Array.isArray(rawComponents)) return { success: false, error: 'components must be an array or "same_as_previous"' };

        const normalized: Array<string | NodeComponentSpec> = [];
        for (const component of rawComponents) {
            if (typeof component === 'string') { normalized.push(component); continue; }
            if (!component || typeof component !== 'object' || typeof (component as NodeComponentSpec).type !== 'string') {
                return { success: false, error: 'Each component spec must be a string or an object with a type field' };
            }
            const spec = component as NodeComponentSpec;
            normalized.push({ type: spec.type, properties: spec.properties ? { ...spec.properties } : undefined });
        }
        return { success: true, data: normalized };
    }

    private cloneComponentSpec(spec: string | NodeComponentSpec): string | NodeComponentSpec {
        if (typeof spec === 'string') return spec;
        return { type: spec.type, properties: spec.properties ? { ...spec.properties } : undefined };
    }

    // =========================================================================
    // Modify — orchestration + thin delegation
    // =========================================================================

    private async setNodeProperty(uuid: string, property: string, value: unknown): Promise<NodeModifyResult> {
        await this.driver.setProperty({ uuid, path: property, dump: { value } });
        let nodeInfo: NodeInfo | undefined;
        try { nodeInfo = await this.queryByUuid(uuid); } catch { /* ignore */ }
        return {
            nodeUuid: uuid,
            property,
            newValue: value,
            nodeInfo,
            message: `Property '${property}' updated successfully`,
        };
    }

    private async setNodeTransform(input: { uuid: string; position?: { x: number; y: number; z?: number }; rotation?: { x: number; y: number; z: number }; scale?: { x: number; y: number; z: number } }): Promise<NodeModifyResult> {
        const { uuid, position, rotation, scale } = input;

        const nodeInfo = await this.driver.queryNodeInfo(uuid);
        const is2D = NodeService.is2DNode(nodeInfo);
        const updatePromises: Promise<void>[] = [];
        const updates: string[] = [];
        const warnings: string[] = [];

        if (position) {
            const normalized = this.driver.normalizeTransformValue(position, 'position', is2D);
            if (normalized.warning) warnings.push(normalized.warning);
            updatePromises.push(this.driver.setProperty({ uuid, path: 'position', dump: { value: normalized.value } }));
            updates.push('position');
        }

        if (rotation) {
            const normalized = this.driver.normalizeTransformValue(rotation, 'rotation', is2D);
            if (normalized.warning) warnings.push(normalized.warning);
            updatePromises.push(this.driver.setProperty({ uuid, path: 'rotation', dump: { value: normalized.value } }));
            updates.push('rotation');
        }

        if (scale) {
            const normalized = this.driver.normalizeTransformValue(scale, 'scale', is2D);
            if (normalized.warning) warnings.push(normalized.warning);
            updatePromises.push(this.driver.setProperty({ uuid, path: 'scale', dump: { value: normalized.value } }));
            updates.push('scale');
        }

        if (updatePromises.length === 0) throw new Error('No transform properties specified');

        await Promise.all(updatePromises);
        let updatedNodeInfo: NodeInfo | undefined;
        try { updatedNodeInfo = await this.queryByUuid(uuid); } catch { /* ignore */ }

        const result: NodeModifyResult = {
            nodeUuid: uuid,
            nodeType: is2D ? '2D' : '3D',
            appliedChanges: updates,
            nodeInfo: updatedNodeInfo,
            message: `Transform properties updated: ${updates.join(', ')} ${is2D ? '(2D node)' : '(3D node)'}`,
        };
        if (warnings.length > 0) result.warning = warnings.join('; ');
        return result;
    }

    private async resetNodeProperty(uuid: string, pathStr: string): Promise<NodeModifyResult> {
        await this.driver.resetProperty({ uuid, path: pathStr });
        let nodeInfo: NodeInfo | undefined;
        try { nodeInfo = await this.queryByUuid(uuid); } catch { /* ignore */ }
        return { nodeUuid: uuid, nodeInfo, message: `Property '${pathStr}' reset to default value` };
    }

    private async resetNodeTransform(uuid: string): Promise<NodeModifyResult> {
        await this.driver.resetNode(uuid);
        let nodeInfo: NodeInfo | undefined;
        try { nodeInfo = await this.queryByUuid(uuid); } catch { /* ignore */ }
        return { nodeUuid: uuid, nodeInfo, message: 'Node transform reset to default' };
    }

    // =========================================================================
    // Delete — iteration
    // =========================================================================

    private async deleteNode(uuids: string | string[]): Promise<NodeDeleteResult> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        for (const uuid of uuidArray) await this.driver.removeNode(uuid);
        return { deletedUuids: uuidArray, message: `${uuidArray.length} node(s) deleted successfully` };
    }

    // =========================================================================
    // Arrange — thin delegation
    // =========================================================================

    private async moveNode(uuid: string, parentUuid: string, _siblingIndex: number = -1): Promise<NodeArrangeResult> {
        await this.driver.setParent({ parent: parentUuid, uuids: [uuid], keepWorldTransform: false });
        return { message: 'Node moved successfully' };
    }

    private async duplicateNode(uuids: string | string[]): Promise<NodeArrangeResult> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        const results: string[] = [];
        for (const uuid of uuidArray) results.push(await this.driver.duplicateNode(uuid));
        return { uuids: results, message: `${uuidArray.length} node(s) duplicated successfully` };
    }

    private async copyNode(uuids: string | string[]): Promise<NodeArrangeResult> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        const result = await this.driver.copyNode(uuidArray);
        return { uuids: result, message: 'Node(s) copied successfully' };
    }

    private async pasteNode(parentUuid: string, uuids: string | string[], keepWorldTransform: boolean = false): Promise<NodeArrangeResult> {
        const result = await this.driver.pasteNode({ target: parentUuid, uuids, keepWorldTransform });
        return { uuids: result, message: 'Node(s) pasted successfully' };
    }

    private async cutNode(uuids: string | string[]): Promise<NodeArrangeResult> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        const result = await this.driver.cutNode(uuidArray);
        return { uuids: result, message: 'Node(s) cut successfully' };
    }

    // =========================================================================
    // Utility
    // =========================================================================

    private resolveAddedComponentType(requestedType: string, result: ComponentAddResult): string {
        return result.componentType || requestedType;
    }

    private static is2DNode(nodeInfo: NodeInfo): boolean {
        const components = nodeInfo.components ?? [];
        const has2D = components.some(c => c.type && (
            c.type.includes('cc.Sprite') || c.type.includes('cc.Label') || c.type.includes('cc.Button')
            || c.type.includes('cc.Layout') || c.type.includes('cc.Widget') || c.type.includes('cc.Mask')
            || c.type.includes('cc.Graphics')
        ));
        if (has2D) return true;
        const has3D = components.some(c => c.type && (
            c.type.includes('cc.MeshRenderer') || c.type.includes('cc.Camera') || c.type.includes('cc.Light')
            || c.type.includes('cc.DirectionalLight') || c.type.includes('cc.PointLight') || c.type.includes('cc.SpotLight')
        ));
        if (has3D) return false;
        const position = nodeInfo.position;
        return Boolean(position && Math.abs(position.z ?? 0) < 0.001);
    }
}
