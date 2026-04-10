import { ToolResponse } from '../../mcp/interface';
import {
    NodeArrangeInput,
    NodeBatchCreateInput,
    NodeCapability,
    NodeComponentSpec,
    NodeCreateSpec,
    NodeInfo,
    NodeModifyInput,
    NodeQueryInput,
} from './interface';
import { ComponentCapability } from '../component/interface';
import { SceneQueryDriver } from '../../editor-bridge/scene-query/contract';
import { NodeBridgeDriver } from '../../editor-bridge/node/contract';
import {
    buildCidNameMap,
    buildNodeInfo,
    flattenNodeTree,
    is2DNode,
    normalizeComponentType,
    searchNodeTree,
} from '../../editor-bridge/scene-query/normalizer';
import { resolveDefaultSpriteFrameUuid } from '../../editor-bridge/scene-query/sprite-frame-resolver';

export class NodeService implements NodeCapability {
    constructor(
        private readonly sceneQuery: SceneQueryDriver,
        private readonly driver: NodeBridgeDriver,
        private readonly components: ComponentCapability,
    ) {}

    private cidNameMap: Map<string, string> | null = null;

    // =========================================================================
    // Public interface
    // =========================================================================

    async query(input: NodeQueryInput): Promise<ToolResponse> {
        if (input.uuid) return this.queryByUuid(input.uuid);
        if (input.pattern) return this.queryByPattern(input.pattern);
        if (input.assetUuid) return this.queryByAssetUuid(input.assetUuid);
        return this.queryAll();
    }

    async create(spec: NodeCreateSpec): Promise<ToolResponse> {
        return this.createNodeFromSpec(spec);
    }

    async batchCreate(input: NodeBatchCreateInput): Promise<ToolResponse> {
        return this.batchCreateNodes(input);
    }

    async modify(input: NodeModifyInput): Promise<ToolResponse> {
        switch (input.action) {
            case 'set_property':  return this.setNodeProperty(input.uuid, input.property, input.value);
            case 'set_transform': return this.setNodeTransform(input);
            case 'reset_property': return this.resetNodeProperty(input.uuid, input.path);
            case 'reset_transform': return this.resetNodeTransform(input.uuid);
        }
    }

    async delete(uuids: string | string[]): Promise<ToolResponse> {
        return this.deleteNode(uuids);
    }

    async arrange(input: NodeArrangeInput): Promise<ToolResponse> {
        switch (input.action) {
            case 'move':      return this.moveNode(input.uuid, input.parentUuid, input.siblingIndex);
            case 'duplicate': return this.duplicateNode(input.uuids);
            case 'copy':      return this.copyNode(input.uuids);
            case 'paste':     return this.pasteNode(input.parentUuid, input.uuids, input.keepWorldTransform);
            case 'cut':       return this.cutNode(input.uuids);
        }
    }

    // =========================================================================
    // Query
    // =========================================================================

    private async queryByUuid(uuid: string): Promise<ToolResponse> {
        try {
            const nodeData = await this.sceneQuery.queryNode(uuid);
            if (!nodeData) {
                return { success: false, error: 'Node not found or invalid response' };
            }
            const cidMap = await this.getCidNameMap();
            const info: NodeInfo = buildNodeInfo(uuid, nodeData, cidMap);
            return { success: true, data: { ...info, nodeType: is2DNode(info) ? '2D' : '3D' } };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    private async queryByPattern(pattern: string): Promise<ToolResponse> {
        try {
            const tree = await this.sceneQuery.queryNodeTree();
            return { success: true, data: searchNodeTree(tree, pattern) };
        } catch (directError: unknown) {
            try {
                const result = await this.sceneQuery.executeSceneScript('findNodes', [pattern, false]);
                return result as ToolResponse;
            } catch (err2: unknown) {
                return { success: false, error: `Tree search failed: ${(directError as Error).message}, Scene script failed: ${(err2 as Error).message}` };
            }
        }
    }

    private async queryByAssetUuid(assetUuid: string): Promise<ToolResponse> {
        try {
            const nodeUuids = await this.sceneQuery.queryNodesByAssetUuid(assetUuid);
            return {
                success: true,
                data: { assetUuid, nodeUuids, count: nodeUuids.length, message: `Found ${nodeUuids.length} nodes using asset` }
            };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    private async queryAll(): Promise<ToolResponse> {
        try {
            const tree = await this.sceneQuery.queryNodeTree();
            const nodes = flattenNodeTree(tree);
            return { success: true, data: { totalNodes: nodes.length, nodes } };
        } catch (directError: unknown) {
            try {
                const result = await this.sceneQuery.executeSceneScript('getAllNodes', []);
                return result as ToolResponse;
            } catch (err2: unknown) {
                return { success: false, error: `Direct API failed: ${(directError as Error).message}, Scene script failed: ${(err2 as Error).message}` };
            }
        }
    }

    private async getCidNameMap(): Promise<Map<string, string>> {
        this.cidNameMap = await buildCidNameMap(this.sceneQuery, this.cidNameMap);
        return this.cidNameMap;
    }

    // =========================================================================
    // Create
    // =========================================================================

    private async createNodeFromSpec(spec: NodeCreateSpec): Promise<ToolResponse> {
        try {
            let targetParentUuid = spec.parentUuid;

            if (!targetParentUuid) {
                try {
                    const sceneInfo = await this.sceneQuery.queryNodeTree();
                    if (sceneInfo && typeof sceneInfo === 'object' && !Array.isArray(sceneInfo)) {
                        const si = sceneInfo as { uuid?: string };
                        if (si.uuid) targetParentUuid = si.uuid;
                    } else if (Array.isArray(sceneInfo) && sceneInfo.length > 0) {
                        const first = sceneInfo[0] as { uuid?: string };
                        if (first.uuid) targetParentUuid = first.uuid;
                    }
                    if (!targetParentUuid) {
                        const currentScene = await this.sceneQuery.queryCurrentScene();
                        if (currentScene?.uuid) targetParentUuid = currentScene.uuid;
                    }
                } catch {
                    console.warn('Failed to get scene root, will use default behavior');
                }
            }

            let finalAssetUuid = spec.assetUuid;
            if (spec.assetPath && !finalAssetUuid) {
                const assetInfo = await this.sceneQuery.queryAssetInfo(spec.assetPath);
                if (assetInfo?.uuid) {
                    finalAssetUuid = assetInfo.uuid;
                } else {
                    return { success: false, error: `Asset not found at path: ${spec.assetPath}` };
                }
            }

            const normalizedComponents = Array.isArray(spec.components) ? spec.components : [];
            const componentTypes = normalizedComponents.map((c) => typeof c === 'string' ? c : c.type);

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
                } catch {
                    console.warn('Failed to set sibling index');
                }
            }

            const defaultSpriteFrameUuid = componentTypes.some((t) => normalizeComponentType(t) === 'cc.Sprite')
                ? await resolveDefaultSpriteFrameUuid(this.sceneQuery)
                : null;

            if (componentTypes.length > 0 && uuid) {
                await new Promise(resolve => setTimeout(resolve, 100));
                for (const componentSpec of normalizedComponents) {
                    const componentType = typeof componentSpec === 'string' ? componentSpec : componentSpec.type;
                    try {
                        const result = await this.components.add({ uuid, componentType });
                        if (!result.success) {
                            console.warn(`Failed to add component ${componentType}:`, result.error);
                        }

                        if (typeof componentSpec === 'object' && componentSpec.properties && Object.keys(componentSpec.properties).length > 0) {
                            const actualType = this.resolveAddedComponentType(componentType, result);
                            const propertyBatch = this.buildInlineComponentPropertyBatch(componentType, actualType, componentSpec.properties, defaultSpriteFrameUuid);
                            if (Object.keys(propertyBatch).length > 0) {
                                const batchResult = await this.components.batchSet({
                                    uuid,
                                    batch: [{ componentType: actualType, properties: propertyBatch }],
                                    continueOnError: true,
                                });
                                if (!batchResult.success) {
                                    console.warn(`Failed to initialize component ${actualType}:`, batchResult.error);
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
                } catch {
                    console.warn('Failed to set initial transform');
                }
            }

            let nodeInfo: NodeInfo | undefined;
            try {
                const infoResponse = await this.queryByUuid(uuid);
                if (infoResponse.success) nodeInfo = infoResponse.data as NodeInfo;
            } catch {
                console.warn('Failed to get verification data');
            }

            return {
                success: true,
                data: {
                    uuid,
                    name: spec.name,
                    parentUuid: targetParentUuid,
                    nodeType: spec.nodeType || 'Node',
                    fromAsset: !!finalAssetUuid,
                    assetUuid: finalAssetUuid,
                    message: finalAssetUuid
                        ? `Node '${spec.name}' instantiated from asset successfully`
                        : `Node '${spec.name}' created successfully`,
                    nodeInfo,
                }
            };
        } catch (err: unknown) {
            return { success: false, error: `Failed to create node: ${(err as Error).message}` };
        }
    }

    private async batchCreateNodes(input: NodeBatchCreateInput): Promise<ToolResponse> {
        const nodeSpecs = Array.isArray(input.nodes) ? input.nodes : [];
        if (nodeSpecs.length === 0) {
            return { success: false, error: 'nodes must be a non-empty array' };
        }

        const results: unknown[] = [];
        const failures: unknown[] = [];
        let previousComponentSpecs: Array<string | NodeComponentSpec> | null = null;

        for (let index = 0; index < nodeSpecs.length; index++) {
            const rawSpec = nodeSpecs[index];
            const normalized = this.normalizeNodeCreateSpec(rawSpec, input.parentUuid, previousComponentSpecs);
            if (!normalized.success || !normalized.data) {
                const failure = {
                    index,
                    name: rawSpec?.name || `Node_${index}`,
                    success: false,
                    error: 'error' in normalized ? normalized.error : 'Failed to normalize node spec'
                };
                results.push(failure);
                failures.push(failure);
                continue;
            }

            const createResult = await this.createNodeFromSpec(normalized.data);
            const entry = {
                index,
                name: normalized.data.name,
                success: createResult.success,
                uuid: createResult.data?.uuid,
                warning: createResult.warning,
                error: createResult.error,
                data: createResult.data
            };
            results.push(entry);

            if (createResult.success) {
                previousComponentSpecs = normalized.data.components ?? previousComponentSpecs;
            } else {
                failures.push(entry);
            }
        }

        if (failures.length > 0) {
            return { success: false, error: `Batch node creation completed with ${failures.length} failure(s)`, data: { results, failures } };
        }

        return { success: true, message: `Batch created ${results.length} node(s) successfully`, data: { results } };
    }

    private normalizeNodeCreateSpec(
        rawSpec: NodeCreateSpec,
        defaultParentUuid?: string,
        previousComponentSpecs: Array<string | NodeComponentSpec> | null = null,
    ): { success: true; data: NodeCreateSpec } | ToolResponse {
        if (!rawSpec || typeof rawSpec !== 'object') {
            return { success: false, error: 'Node spec must be an object' };
        }

        if (typeof rawSpec.name !== 'string' || !rawSpec.name.trim()) {
            return { success: false, error: 'Node spec must include a non-empty string name' };
        }

        const normalizedComponents = this.normalizeNodeComponents(rawSpec.components, previousComponentSpecs);
        if (!normalizedComponents.success) {
            return normalizedComponents;
        }

        return {
            success: true,
            data: {
                name: rawSpec.name,
                parentUuid: rawSpec.parentUuid || defaultParentUuid,
                nodeType: rawSpec.nodeType || 'Node',
                siblingIndex: rawSpec.siblingIndex,
                assetUuid: rawSpec.assetUuid,
                assetPath: rawSpec.assetPath,
                components: normalizedComponents.data,
                unlinkPrefab: rawSpec.unlinkPrefab,
                keepWorldTransform: rawSpec.keepWorldTransform,
                initialTransform: rawSpec.initialTransform,
            }
        };
    }

    private normalizeNodeComponents(
        rawComponents: unknown,
        previousComponentSpecs: Array<string | NodeComponentSpec> | null = null,
    ): { success: true; data: Array<string | NodeComponentSpec> } | ToolResponse {
        if (rawComponents === undefined || rawComponents === null) {
            return { success: true, data: [] };
        }

        if (rawComponents === 'same_as_previous') {
            if (!previousComponentSpecs || previousComponentSpecs.length === 0) {
                return { success: false, error: 'components = "same_as_previous" requires a previous node with component specs' };
            }
            return { success: true, data: previousComponentSpecs.map((s) => this.cloneComponentSpec(s)) };
        }

        if (!Array.isArray(rawComponents)) {
            return { success: false, error: 'components must be an array or "same_as_previous"' };
        }

        const normalized: Array<string | NodeComponentSpec> = [];
        for (const component of rawComponents) {
            if (typeof component === 'string') {
                normalized.push(component);
                continue;
            }
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
    // Modify
    // =========================================================================

    private async setNodeProperty(uuid: string, property: string, value: unknown): Promise<ToolResponse> {
        try {
            await this.driver.setProperty({ uuid, path: property, dump: { value } });
            const nodeInfo = await this.queryByUuid(uuid);
            return {
                success: true,
                message: `Property '${property}' updated successfully`,
                data: { nodeUuid: uuid, property, newValue: value, nodeInfo: nodeInfo.data }
            };
        } catch (err: unknown) {
            try {
                const result = await this.sceneQuery.executeSceneScript('setNodeProperty', [uuid, property, value]);
                return result as ToolResponse;
            } catch (err2: unknown) {
                return { success: false, error: `Direct API failed: ${(err as Error).message}, Scene script failed: ${(err2 as Error).message}` };
            }
        }
    }

    private async setNodeTransform(input: { uuid: string; position?: { x: number; y: number; z?: number }; rotation?: { x: number; y: number; z: number }; scale?: { x: number; y: number; z: number } }): Promise<ToolResponse> {
        const { uuid, position, rotation, scale } = input;

        try {
            const nodeInfoResponse = await this.queryByUuid(uuid);
            if (!nodeInfoResponse.success || !nodeInfoResponse.data) {
                return { success: false, error: 'Failed to get node information' };
            }

            const nodeInfo = nodeInfoResponse.data as NodeInfo;
            const is2D = is2DNode(nodeInfo);
            const updatePromises: Promise<void>[] = [];
            const updates: string[] = [];
            const warnings: string[] = [];

            if (position) {
                const normalized = this.normalizeTransformValue(position, 'position', is2D);
                if (normalized.warning) warnings.push(normalized.warning);
                updatePromises.push(this.driver.setProperty({ uuid, path: 'position', dump: { value: normalized.value } }));
                updates.push('position');
            }

            if (rotation) {
                const normalized = this.normalizeTransformValue(rotation, 'rotation', is2D);
                if (normalized.warning) warnings.push(normalized.warning);
                updatePromises.push(this.driver.setProperty({ uuid, path: 'rotation', dump: { value: normalized.value } }));
                updates.push('rotation');
            }

            if (scale) {
                const normalized = this.normalizeTransformValue(scale, 'scale', is2D);
                if (normalized.warning) warnings.push(normalized.warning);
                updatePromises.push(this.driver.setProperty({ uuid, path: 'scale', dump: { value: normalized.value } }));
                updates.push('scale');
            }

            if (updatePromises.length === 0) {
                return { success: false, error: 'No transform properties specified' };
            }

            await Promise.all(updatePromises);
            const updatedNodeInfo = await this.queryByUuid(uuid);

            const response: ToolResponse = {
                success: true,
                message: `Transform properties updated: ${updates.join(', ')} ${is2D ? '(2D node)' : '(3D node)'}`,
                data: { nodeUuid: uuid, nodeType: is2D ? '2D' : '3D', appliedChanges: updates, nodeInfo: updatedNodeInfo.data }
            };

            if (warnings.length > 0) response.warning = warnings.join('; ');
            return response;
        } catch (err: unknown) {
            return { success: false, error: `Failed to update transform: ${(err as Error).message}` };
        }
    }

    private async resetNodeProperty(uuid: string, pathStr: string): Promise<ToolResponse> {
        try {
            await this.driver.resetProperty({ uuid, path: pathStr });
            const nodeInfo = await this.queryByUuid(uuid);
            return { success: true, message: `Property '${pathStr}' reset to default value`, data: { nodeInfo: nodeInfo.data } };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    private async resetNodeTransform(uuid: string): Promise<ToolResponse> {
        try {
            await this.driver.resetNode(uuid);
            const nodeInfo = await this.queryByUuid(uuid);
            return { success: true, message: 'Node transform reset to default', data: { nodeInfo: nodeInfo.data } };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    // =========================================================================
    // Delete
    // =========================================================================

    private async deleteNode(uuids: string | string[]): Promise<ToolResponse> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        try {
            for (const uuid of uuidArray) {
                await this.driver.removeNode(uuid);
            }
            return { success: true, message: `${uuidArray.length} node(s) deleted successfully`, data: { deletedUuids: uuidArray } };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    // =========================================================================
    // Arrange
    // =========================================================================

    private async moveNode(uuid: string, parentUuid: string, siblingIndex: number = -1): Promise<ToolResponse> {
        try {
            await this.driver.setParent({ parent: parentUuid, uuids: [uuid], keepWorldTransform: false });
            return { success: true, message: 'Node moved successfully' };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    private async duplicateNode(uuids: string | string[]): Promise<ToolResponse> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        try {
            const results: string[] = [];
            for (const uuid of uuidArray) {
                results.push(await this.driver.duplicateNode(uuid));
            }
            return { success: true, data: { newNodes: results, message: `${uuidArray.length} node(s) duplicated successfully` } };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    private async copyNode(uuids: string | string[]): Promise<ToolResponse> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        try {
            const result = await this.driver.copyNode(uuidArray);
            return { success: true, data: { copiedUuids: result, message: 'Node(s) copied successfully' } };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    private async pasteNode(parentUuid: string, uuids: string | string[], keepWorldTransform: boolean = false): Promise<ToolResponse> {
        try {
            const result = await this.driver.pasteNode({ target: parentUuid, uuids, keepWorldTransform });
            return { success: true, data: { newUuids: result, message: 'Node(s) pasted successfully' } };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    private async cutNode(uuids: string | string[]): Promise<ToolResponse> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        try {
            const result = await this.driver.cutNode(uuidArray);
            return { success: true, data: { cutUuids: result, message: 'Node(s) cut successfully' } };
        } catch (err: unknown) {
            return { success: false, error: (err as Error).message };
        }
    }

    // =========================================================================
    // Utility
    // =========================================================================

    private resolveAddedComponentType(requestedType: string, result: ToolResponse): string {
        const data = result?.data as Record<string, unknown> | undefined;
        const candidate = data?.componentType ?? data?.componentName ?? data?.type;
        if (typeof candidate === 'string' && candidate.trim()) return candidate;
        return requestedType;
    }

    private buildInlineComponentPropertyBatch(
        requestedType: string,
        actualType: string,
        properties: Record<string, unknown>,
        defaultSpriteFrameUuid: string | null,
    ): Record<string, unknown> {
        const batch: Record<string, unknown> = {};
        const isSprite = normalizeComponentType(actualType || requestedType) === 'cc.Sprite';

        for (const [property, rawEntry] of Object.entries(properties)) {
            batch[property] = this.normalizeInlinePropertyEntry(property, rawEntry, defaultSpriteFrameUuid);
        }

        if (isSprite) {
            if (!Object.prototype.hasOwnProperty.call(batch, 'spriteFrame') && defaultSpriteFrameUuid) {
                batch.spriteFrame = { value: defaultSpriteFrameUuid, propertyType: 'spriteFrame' };
            }
            if (!Object.prototype.hasOwnProperty.call(batch, 'sizeMode')) {
                batch.sizeMode = { value: 0, propertyType: 'integer' };
            }
        }

        return batch;
    }

    private normalizeInlinePropertyEntry(property: string, rawEntry: unknown, defaultSpriteFrameUuid: string | null): unknown {
        if (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)) {
            const entry = rawEntry as Record<string, unknown>;
            if (Object.prototype.hasOwnProperty.call(entry, 'propertyType')) {
                const cloned = { ...entry };
                if (property === 'spriteFrame') {
                    const entryValue = cloned.value;
                    if (entryValue === 'auto' && defaultSpriteFrameUuid) {
                        cloned.value = defaultSpriteFrameUuid;
                        cloned.propertyType = 'spriteFrame';
                    }
                }
                return cloned;
            }
        }

        if (property === 'spriteFrame' && rawEntry === 'auto' && defaultSpriteFrameUuid) {
            return { value: defaultSpriteFrameUuid, propertyType: 'spriteFrame' };
        }

        return rawEntry;
    }

    private normalizeTransformValue(
        value: { x?: number; y?: number; z?: number },
        type: 'position' | 'rotation' | 'scale',
        is2D: boolean,
    ): { value: { x: number; y: number; z: number }; warning?: string } {
        const result = { x: value.x ?? (type === 'scale' ? 1 : 0), y: value.y ?? (type === 'scale' ? 1 : 0), z: value.z ?? (type === 'scale' ? 1 : 0) };
        let warning: string | undefined;

        if (is2D) {
            switch (type) {
                case 'position':
                    if (value.z !== undefined && Math.abs(value.z) > 0.001) {
                        warning = `2D node: z position (${value.z}) ignored, set to 0`;
                        result.z = 0;
                    } else {
                        result.z = 0;
                    }
                    break;
                case 'rotation':
                    if ((value.x !== undefined && Math.abs(value.x) > 0.001) || (value.y !== undefined && Math.abs(value.y) > 0.001)) {
                        warning = '2D node: x,y rotations ignored, only z rotation applied';
                        result.x = 0;
                        result.y = 0;
                    } else {
                        result.x = 0;
                        result.y = 0;
                    }
                    break;
                case 'scale':
                    if (value.z === undefined) result.z = 1;
                    break;
            }
        }

        return { value: result, warning };
    }
}
