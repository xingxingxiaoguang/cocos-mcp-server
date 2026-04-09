import { ToolResponse } from '../../mcp/interface';
import { NodeCapability, NodeInfo } from './interface';
import { ComponentCapability } from '../component/interface';
import { NodeBridgeDriver } from '../../editor-bridge/node/contract';
import {
    buildCidNameMap,
    buildNodeInfo,
    flattenNodeTree,
    is2DNode,
    normalizeComponentType,
    searchNodeTree,
} from './normalizer';
import { resolveDefaultSpriteFrameUuid } from './sprite-frame-resolver';

interface NodeComponentSpec {
    type: string;
    properties?: Record<string, any>;
}

interface NodeCreateSpec {
    name: string;
    parentUuid?: string;
    nodeType?: 'Node' | '2DNode' | '3DNode' | string;
    siblingIndex?: number;
    assetUuid?: string;
    assetPath?: string;
    components?: Array<string | NodeComponentSpec>;
    unlinkPrefab?: boolean;
    keepWorldTransform?: boolean;
    initialTransform?: {
        position?: { x: number; y: number; z: number };
        rotation?: { x: number; y: number; z: number };
        scale?: { x: number; y: number; z: number };
    };
}

export class NodeService implements NodeCapability {
    constructor(
        private readonly driver: NodeBridgeDriver,
        private readonly components: ComponentCapability,
    ) {}
    private cidNameMap: Map<string, string> | null = null;

    async query(args: any): Promise<ToolResponse> {
        return this.queryInternal(args);
    }

    async create(args: any): Promise<ToolResponse> {
        return this.createNode(args);
    }

    async batchCreate(args: any): Promise<ToolResponse> {
        return this.batchCreateNodes(args);
    }

    async modify(args: any): Promise<ToolResponse> {
        return this.modifyNode(args);
    }

    async delete(args: any): Promise<ToolResponse> {
        return this.deleteNode(args?.uuids ?? args);
    }

    async arrange(args: any): Promise<ToolResponse> {
        return this.arrangeNodes(args);
    }

    // ---- node_query ----
    private async queryInternal(args: any): Promise<ToolResponse> {
        if (args.uuid) {
            return await this.queryByUuid(args.uuid);
        }
        if (args.pattern) {
            return await this.queryByPattern(args.pattern);
        }
        if (args.assetUuid) {
            return await this.queryByAssetUuid(args.assetUuid);
        }
        return await this.queryAll();
    }

    private async queryByUuid(uuid: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            this.driver.queryNode(uuid).then(async (nodeData: any) => {
                if (!nodeData) {
                    resolve({ success: false, error: 'Node not found or invalid response' });
                    return;
                }

                const cidMap = await this.getCidNameMap();
                const info: NodeInfo = buildNodeInfo(uuid, nodeData, cidMap);
                const is2D = is2DNode(info);
                resolve({
                    success: true,
                    data: {
                        ...info,
                        nodeType: is2D ? '2D' : '3D'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async queryByPattern(pattern: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            this.driver.queryNodeTree().then((tree: any) => {
                resolve({ success: true, data: searchNodeTree(tree, pattern) });
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'findNodes',
                    args: [pattern, false]
                };
                this.driver.executeSceneScript(options).then((result: any) => {
                    resolve(result);
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Tree search failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }

    private async queryByAssetUuid(assetUuid: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            this.driver.queryNodesByAssetUuid(assetUuid).then((nodeUuids: string[]) => {
                resolve({
                    success: true,
                    data: {
                        assetUuid,
                        nodeUuids,
                        count: nodeUuids.length,
                        message: `Found ${nodeUuids.length} nodes using asset`
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async queryAll(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            this.driver.queryNodeTree().then((tree: any) => {
                const nodes = flattenNodeTree(tree);

                resolve({
                    success: true,
                    data: {
                        totalNodes: nodes.length,
                        nodes
                    }
                });
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'getAllNodes',
                    args: []
                };
                this.driver.executeSceneScript(options).then((result: any) => {
                    resolve(result);
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }

    private async getCidNameMap(): Promise<Map<string, string>> {
        this.cidNameMap = await buildCidNameMap(this.driver, this.cidNameMap);
        return this.cidNameMap;
    }

    // ---- node_create ----
    private async createNode(args: any): Promise<ToolResponse> {
        return await this.createNodeFromSpec(args);
    }

    private async batchCreateNodes(args: any): Promise<ToolResponse> {
        const nodeSpecs = Array.isArray(args.nodes) ? args.nodes : [];
        if (nodeSpecs.length === 0) {
            return { success: false, error: 'nodes must be a non-empty array' };
        }

        const results: any[] = [];
        const failures: any[] = [];
        let previousComponentSpecs: Array<string | NodeComponentSpec> | null = null;

        for (let index = 0; index < nodeSpecs.length; index++) {
            const normalizedSpec = this.normalizeNodeCreateSpec(nodeSpecs[index], args.parentUuid, previousComponentSpecs);
            if (!normalizedSpec.success || !normalizedSpec.data) {
                const failure = {
                    index,
                    name: nodeSpecs[index]?.name || `Node_${index}`,
                    success: false,
                    error: 'error' in normalizedSpec ? normalizedSpec.error : 'Failed to normalize node spec'
                };
                results.push(failure);
                failures.push(failure);
                continue;
            }

            const createResult = await this.createNodeFromSpec(normalizedSpec.data);
            results.push({
                index,
                name: normalizedSpec.data.name,
                success: createResult.success,
                uuid: createResult.data?.uuid,
                warning: createResult.warning,
                error: createResult.error,
                data: createResult.data
            });

            if (createResult.success) {
                previousComponentSpecs = normalizedSpec.data.components || previousComponentSpecs;
            } else {
                failures.push(createResult);
            }
        }

        if (failures.length > 0) {
            return {
                success: false,
                error: `Batch node creation completed with ${failures.length} failure(s)`,
                data: { results, failures }
            };
        }

        return {
            success: true,
            message: `Batch created ${results.length} node(s) successfully`,
            data: { results }
        };
    }

    private normalizeNodeCreateSpec(
        rawSpec: any,
        defaultParentUuid?: string,
        previousComponentSpecs: Array<string | NodeComponentSpec> | null = null
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
                initialTransform: rawSpec.initialTransform
            }
        };
    }

    private normalizeNodeComponents(
        rawComponents: any,
        previousComponentSpecs: Array<string | NodeComponentSpec> | null = null
    ): { success: true; data: Array<string | NodeComponentSpec> } | ToolResponse {
        if (rawComponents === undefined || rawComponents === null) {
            return { success: true, data: [] };
        }

        if (rawComponents === 'same_as_previous') {
            if (!previousComponentSpecs || previousComponentSpecs.length === 0) {
                return { success: false, error: 'components = "same_as_previous" requires a previous node with component specs' };
            }
            return { success: true, data: previousComponentSpecs.map((spec) => this.cloneComponentSpec(spec)) };
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

            if (!component || typeof component !== 'object' || typeof component.type !== 'string' || !component.type) {
                return { success: false, error: 'Each component spec must be a string or an object with a type field' };
            }

            normalized.push({
                type: component.type,
                properties: component.properties && typeof component.properties === 'object'
                    ? { ...component.properties }
                    : undefined
            });
        }

        return { success: true, data: normalized };
    }

    private cloneComponentSpec(spec: string | NodeComponentSpec): string | NodeComponentSpec {
        if (typeof spec === 'string') {
            return spec;
        }

        return {
            type: spec.type,
            properties: spec.properties ? { ...spec.properties } : undefined
        };
    }

    private async createNodeFromSpec(args: NodeCreateSpec): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            try {
                let targetParentUuid = args.parentUuid;

                if (!targetParentUuid) {
                    try {
                        const sceneInfo = await this.driver.queryNodeTree();
                        if (sceneInfo && typeof sceneInfo === 'object' && !Array.isArray(sceneInfo) && Object.prototype.hasOwnProperty.call(sceneInfo, 'uuid')) {
                            targetParentUuid = (sceneInfo as any).uuid;
                        } else if (Array.isArray(sceneInfo) && sceneInfo.length > 0 && (sceneInfo[0] as any).uuid) {
                            targetParentUuid = (sceneInfo[0] as any).uuid;
                        } else {
                            const currentScene = await this.driver.queryCurrentScene();
                            if (currentScene && currentScene.uuid) {
                                targetParentUuid = currentScene.uuid;
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to get scene root, will use default behavior');
                    }
                }

                let finalAssetUuid = args.assetUuid;
                if (args.assetPath && !finalAssetUuid) {
                    try {
                        const assetInfo = await this.driver.queryAssetInfo(args.assetPath);
                        if (assetInfo && assetInfo.uuid) {
                            finalAssetUuid = assetInfo.uuid;
                        } else {
                            resolve({ success: false, error: `Asset not found at path: ${args.assetPath}` });
                            return;
                        }
                    } catch (err) {
                        resolve({ success: false, error: `Failed to resolve asset path '${args.assetPath}': ${err}` });
                        return;
                    }
                }

                const normalizedComponents = Array.isArray(args.components) ? args.components : [];
                const createNodeOptions: any = { name: args.name };

                if (targetParentUuid) {
                    createNodeOptions.parent = targetParentUuid;
                }

                if (finalAssetUuid) {
                    createNodeOptions.assetUuid = finalAssetUuid;
                    if (args.unlinkPrefab) {
                        createNodeOptions.unlinkPrefab = true;
                    }
                }

                const componentTypes = normalizedComponents.map((component) =>
                    typeof component === 'string' ? component : component.type
                );

                if (componentTypes.length > 0) {
                    createNodeOptions.components = componentTypes;
                } else if (args.nodeType && args.nodeType !== 'Node' && !finalAssetUuid) {
                    createNodeOptions.components = [args.nodeType];
                }

                if (args.keepWorldTransform) {
                    createNodeOptions.keepWorldTransform = true;
                }

                const nodeUuid = await this.driver.createNode(createNodeOptions);
                const uuid = Array.isArray(nodeUuid) ? nodeUuid[0] : nodeUuid;

                if (args.siblingIndex !== undefined && args.siblingIndex >= 0 && uuid && targetParentUuid) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        await this.driver.setParent({
                            parent: targetParentUuid,
                            uuids: [uuid],
                            keepWorldTransform: args.keepWorldTransform || false
                        });
                    } catch (err) {
                        console.warn('Failed to set sibling index:', err);
                    }
                }

                const defaultSpriteFrameUuid = componentTypes.some((componentType) => normalizeComponentType(componentType) === 'cc.Sprite')
                    ? await resolveDefaultSpriteFrameUuid(this.driver)
                    : null;

                if (componentTypes.length > 0 && uuid) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        for (let index = 0; index < normalizedComponents.length; index++) {
                            const componentSpec = normalizedComponents[index];
                            const componentType = typeof componentSpec === 'string' ? componentSpec : componentSpec.type;
                            try {
                                const result = await this.components.add({
                                    uuid: uuid,
                                    componentType: componentType
                                });
                                if (!result.success) {
                                    console.warn(`Failed to add component ${componentType}:`, result.error);
                                }

                                if (typeof componentSpec === 'object' && componentSpec.properties && Object.keys(componentSpec.properties).length > 0) {
                                    const actualComponentType = this.resolveAddedComponentType(componentType, result);
                                    const propertyBatch = this.buildInlineComponentPropertyBatch(
                                        componentType,
                                        actualComponentType,
                                        componentSpec.properties,
                                        defaultSpriteFrameUuid
                                    );
                                    if (Object.keys(propertyBatch).length > 0) {
                                        const batchResult = await this.components.batchSet({
                                            uuid,
                                            batch: [{
                                                componentType: actualComponentType,
                                                properties: propertyBatch
                                            }],
                                            continueOnError: true
                                        });
                                        if (!batchResult.success) {
                                            console.warn(`Failed to initialize component ${actualComponentType}:`, batchResult.error);
                                        }
                                    }
                                }
                            } catch (err) {
                                console.warn(`Failed to add component ${componentType}:`, err);
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to add components:', err);
                    }
                }

                if (args.initialTransform && uuid) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 150));
                        await this.setNodeTransform({
                            uuid,
                            position: args.initialTransform.position,
                            rotation: args.initialTransform.rotation,
                            scale: args.initialTransform.scale
                        });
                    } catch (err) {
                        console.warn('Failed to set initial transform:', err);
                    }
                }

                // Return complete node info after creation
                let nodeInfo: any = null;
                try {
                    const infoResponse = await this.queryByUuid(uuid);
                    if (infoResponse.success) {
                        nodeInfo = infoResponse.data;
                    }
                } catch (err) {
                    console.warn('Failed to get verification data:', err);
                }

                resolve({
                    success: true,
                    data: {
                        uuid,
                        name: args.name,
                        parentUuid: targetParentUuid,
                        nodeType: args.nodeType || 'Node',
                        fromAsset: !!finalAssetUuid,
                        assetUuid: finalAssetUuid,
                        message: finalAssetUuid
                            ? `Node '${args.name}' instantiated from asset successfully`
                            : `Node '${args.name}' created successfully`,
                        nodeInfo
                    }
                });

            } catch (err: any) {
                resolve({
                    success: false,
                    error: `Failed to create node: ${err.message}. Args: ${JSON.stringify(args)}`
                });
            }
        });
    }

    private resolveAddedComponentType(requestedType: string, result: ToolResponse): string {
        const candidate = result?.data?.componentType || result?.data?.componentName || result?.data?.type;
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate;
        }

        return requestedType;
    }

    private buildInlineComponentPropertyBatch(
        requestedType: string,
        actualType: string,
        properties: Record<string, any>,
        defaultSpriteFrameUuid: string | null
    ): Record<string, any> {
        const batch: Record<string, any> = {};
        const isSprite = normalizeComponentType(actualType || requestedType) === 'cc.Sprite';

        for (const [property, rawEntry] of Object.entries(properties)) {
            batch[property] = this.normalizeInlinePropertyEntry(property, rawEntry, defaultSpriteFrameUuid);
        }

        if (isSprite) {
            const hasSpriteFrame = Object.prototype.hasOwnProperty.call(batch, 'spriteFrame');
            const hasSizeMode = Object.prototype.hasOwnProperty.call(batch, 'sizeMode');

            if (!hasSpriteFrame && defaultSpriteFrameUuid) {
                batch.spriteFrame = { value: defaultSpriteFrameUuid, propertyType: 'spriteFrame' };
            }

            if (!hasSizeMode) {
                batch.sizeMode = { value: 0, propertyType: 'integer' };
            }
        }

        return batch;
    }

    private normalizeInlinePropertyEntry(property: string, rawEntry: any, defaultSpriteFrameUuid: string | null): any {
        if (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry) && Object.prototype.hasOwnProperty.call(rawEntry, 'propertyType')) {
            const cloned = { ...rawEntry };
            if (property === 'spriteFrame') {
                const entryValue = Object.prototype.hasOwnProperty.call(cloned, 'value') ? cloned.value : undefined;
                if (entryValue === 'auto' && defaultSpriteFrameUuid) {
                    cloned.value = defaultSpriteFrameUuid;
                    cloned.propertyType = 'spriteFrame';
                }
            }
            return cloned;
        }

        if (property === 'spriteFrame' && rawEntry === 'auto' && defaultSpriteFrameUuid) {
            return { value: defaultSpriteFrameUuid, propertyType: 'spriteFrame' };
        }

        return rawEntry;
    }

    private async ensureDefaultSpriteComponentState(nodeUuid: string): Promise<void> {
        const defaultSpriteFrameUuid = await resolveDefaultSpriteFrameUuid(this.driver);
        const batch: any[] = [];

        if (defaultSpriteFrameUuid) {
            batch.push({
                componentType: 'cc.Sprite',
                properties: {
                    spriteFrame: { value: defaultSpriteFrameUuid, propertyType: 'spriteFrame' }
                }
            });
        }

        batch.push({
            componentType: 'cc.Sprite',
            properties: {
                sizeMode: { value: 0, propertyType: 'integer' }
            }
        });

        await this.components.batchSet({
            uuid: nodeUuid,
            batch,
            continueOnError: true
        });
    }

    // ---- node_modify ----
    private async modifyNode(args: any): Promise<ToolResponse> {
        const { uuid, action } = args;
        switch (action) {
            case 'set_property':
                return await this.setNodeProperty(uuid, args.property, args.value);
            case 'set_transform':
                return await this.setNodeTransform(args);
            case 'reset_property':
                return await this.resetNodeProperty(uuid, args.path);
            case 'reset_transform':
                return await this.resetNodeTransform(uuid);
            default:
                return { success: false, error: `Unknown modify action: ${action}` };
        }
    }

    private async setNodeProperty(uuid: string, property: string, value: any): Promise<ToolResponse> {
        return new Promise((resolve) => {
            this.driver.setProperty({
                uuid,
                path: property,
                dump: { value }
            }).then(() => {
                this.queryByUuid(uuid).then((nodeInfo) => {
                    resolve({
                        success: true,
                        message: `Property '${property}' updated successfully`,
                        data: {
                            nodeUuid: uuid,
                            property,
                            newValue: value,
                            nodeInfo: nodeInfo.data
                        }
                    });
                }).catch(() => {
                    resolve({
                        success: true,
                        message: `Property '${property}' updated successfully (verification failed)`
                    });
                });
            }).catch((err: Error) => {
                const options = {
                    name: 'cocos-mcp-server',
                    method: 'setNodeProperty',
                    args: [uuid, property, value]
                };
                this.driver.executeSceneScript(options).then((result: any) => {
                    resolve(result);
                }).catch((err2: Error) => {
                    resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` });
                });
            });
        });
    }

    private async setNodeTransform(args: any): Promise<ToolResponse> {
        return new Promise(async (resolve) => {
            const { uuid, position, rotation, scale } = args;
            const updatePromises: Promise<any>[] = [];
            const updates: string[] = [];
            const warnings: string[] = [];

            try {
                const nodeInfoResponse = await this.queryByUuid(uuid);
                if (!nodeInfoResponse.success || !nodeInfoResponse.data) {
                    resolve({ success: false, error: 'Failed to get node information' });
                    return;
                }

                const nodeInfo = nodeInfoResponse.data;
                const is2DNodeValue = is2DNode(nodeInfo);

                if (position) {
                    const normalized = this.normalizeTransformValue(position, 'position', is2DNodeValue);
                    if (normalized.warning) warnings.push(normalized.warning);
                    updatePromises.push(
                        this.driver.setProperty({
                            uuid,
                            path: 'position',
                            dump: { value: normalized.value }
                        })
                    );
                    updates.push('position');
                }

                if (rotation) {
                    const normalized = this.normalizeTransformValue(rotation, 'rotation', is2DNodeValue);
                    if (normalized.warning) warnings.push(normalized.warning);
                    updatePromises.push(
                        this.driver.setProperty({
                            uuid,
                            path: 'rotation',
                            dump: { value: normalized.value }
                        })
                    );
                    updates.push('rotation');
                }

                if (scale) {
                    const normalized = this.normalizeTransformValue(scale, 'scale', is2DNodeValue);
                    if (normalized.warning) warnings.push(normalized.warning);
                    updatePromises.push(
                        this.driver.setProperty({
                            uuid,
                            path: 'scale',
                            dump: { value: normalized.value }
                        })
                    );
                    updates.push('scale');
                }

                if (updatePromises.length === 0) {
                    resolve({ success: false, error: 'No transform properties specified' });
                    return;
                }

                await Promise.all(updatePromises);

                const updatedNodeInfo = await this.queryByUuid(uuid);
                const response: any = {
                    success: true,
                    message: `Transform properties updated: ${updates.join(', ')} ${is2DNodeValue ? '(2D node)' : '(3D node)'}`,
                    data: {
                        nodeUuid: uuid,
                        nodeType: is2DNodeValue ? '2D' : '3D',
                        appliedChanges: updates,
                        nodeInfo: updatedNodeInfo.data
                    }
                };

                if (warnings.length > 0) {
                    response.warning = warnings.join('; ');
                }

                resolve(response);

            } catch (err: any) {
                resolve({ success: false, error: `Failed to update transform: ${err.message}` });
            }
        });
    }

    private async resetNodeProperty(uuid: string, path: string): Promise<ToolResponse> {
        try {
            await this.driver.resetProperty({
                uuid,
                path,
                dump: { value: null }
            });
            const nodeInfo = await this.queryByUuid(uuid);
            return {
                success: true,
                message: `Property '${path}' reset to default value`,
                data: { nodeInfo: nodeInfo.data }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async resetNodeTransform(uuid: string): Promise<ToolResponse> {
        try {
            await this.driver.resetNode({ uuid });
            const nodeInfo = await this.queryByUuid(uuid);
            return {
                success: true,
                message: 'Node transform reset to default',
                data: { nodeInfo: nodeInfo.data }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    // ---- node_delete ----
    private async deleteNode(uuids: string | string[]): Promise<ToolResponse> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        try {
            for (const uuid of uuidArray) {
                await this.driver.removeNode({ uuid });
            }
            return {
                success: true,
                message: `${uuidArray.length} node(s) deleted successfully`,
                data: { deletedUuids: uuidArray }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    // ---- node_arrange ----
    private async arrangeNodes(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'move':
                return await this.moveNode(args.uuid, args.parentUuid, args.siblingIndex);
            case 'duplicate':
                return await this.duplicateNode(args.uuids);
            case 'copy':
                return await this.copyNode(args.uuids);
            case 'paste':
                return await this.pasteNode(args.parentUuid, args.uuids, args.keepWorldTransform);
            case 'cut':
                return await this.cutNode(args.uuids);
            default:
                return { success: false, error: `Unknown arrange action: ${args.action}` };
        }
    }

    private async moveNode(uuid: string, parentUuid: string, siblingIndex: number = -1): Promise<ToolResponse> {
        return new Promise((resolve) => {
            this.driver.setParent({
                parent: parentUuid,
                uuids: [uuid],
                keepWorldTransform: false
            }).then(() => {
                resolve({ success: true, message: 'Node moved successfully' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async duplicateNode(uuids: string | string[]): Promise<ToolResponse> {
        const uuidArray = Array.isArray(uuids) ? uuids : [uuids];
        try {
            const results: any[] = [];
            for (const uuid of uuidArray) {
                const result = await this.driver.duplicateNode(uuid);
                results.push(result);
            }
            return {
                success: true,
                data: {
                    newNodes: results,
                    message: `${uuidArray.length} node(s) duplicated successfully`
                }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async copyNode(uuids: string | string[]): Promise<ToolResponse> {
        return new Promise((resolve) => {
            this.driver.copyNode(uuids).then((result: string | string[]) => {
                resolve({
                    success: true,
                    data: {
                        copiedUuids: result,
                        message: 'Node(s) copied successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async pasteNode(parentUuid: string, uuids: string | string[], keepWorldTransform: boolean = false): Promise<ToolResponse> {
        return new Promise((resolve) => {
            this.driver.pasteNode({
                target: parentUuid,
                uuids,
                keepWorldTransform
            }).then((result: string | string[]) => {
                resolve({
                    success: true,
                    data: {
                        newUuids: result,
                        message: 'Node(s) pasted successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async cutNode(uuids: string | string[]): Promise<ToolResponse> {
        return new Promise((resolve) => {
            this.driver.cutNode(uuids).then((result: any) => {
                resolve({
                    success: true,
                    data: {
                        cutUuids: result,
                        message: 'Node(s) cut successfully'
                    }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ---- Utility methods ----
    private normalizeTransformValue(value: any, type: 'position' | 'rotation' | 'scale', is2D: boolean): { value: any, warning?: string } {
        const result = { ...value };
        let warning: string | undefined;

        if (is2D) {
            switch (type) {
                case 'position':
                    if (value.z !== undefined && Math.abs(value.z) > 0.001) {
                        warning = `2D node: z position (${value.z}) ignored, set to 0`;
                        result.z = 0;
                    } else if (value.z === undefined) {
                        result.z = 0;
                    }
                    break;
                case 'rotation':
                    if ((value.x !== undefined && Math.abs(value.x) > 0.001) ||
                        (value.y !== undefined && Math.abs(value.y) > 0.001)) {
                        warning = '2D node: x,y rotations ignored, only z rotation applied';
                        result.x = 0;
                        result.y = 0;
                    } else {
                        result.x = result.x || 0;
                        result.y = result.y || 0;
                    }
                    result.z = result.z || 0;
                    break;
                case 'scale':
                    if (value.z === undefined) {
                        result.z = 1;
                    }
                    break;
            }
        } else {
            result.x = result.x !== undefined ? result.x : (type === 'scale' ? 1 : 0);
            result.y = result.y !== undefined ? result.y : (type === 'scale' ? 1 : 0);
            result.z = result.z !== undefined ? result.z : (type === 'scale' ? 1 : 0);
        }

        return { value: result, warning };
    }
}
