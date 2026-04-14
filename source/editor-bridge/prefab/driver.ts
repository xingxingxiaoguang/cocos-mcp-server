import { safeSerialize } from '../../utils/serializer';
import { BaseDriver } from '../base-driver';
import { RuntimeProfile } from '../../runtime/profile';
import {
    Vector3Like,
    PrefabAssetRecord,
    PrefabBridgeDriver,
    PrefabCreateFromNodeRequest,
    PrefabDuplicateRequest,
    PrefabInstantiateRequest,
    PrefabMetaRecord,
    PrefabMutationResponse,
} from './contract';

const ASSET_DB_CHANNEL = 'asset-db';
const SCENE_CHANNEL = 'scene';

interface PrefabSourceNode {
    uuid?: string;
    name?: unknown;
    active?: unknown;
    position?: unknown;
    rotation?: unknown;
    scale?: unknown;
    layer?: unknown;
    mobility?: unknown;
    parent?: unknown;
    components: any[];
    children: PrefabSourceNode[];
    [key: string]: unknown;
}

interface PrefabTreeContext {
    prefabData: any[];
    currentId: number;
    prefabAssetIndex: number;
    nodeFileIds: Map<string, string>;
    nodeUuidToIndex: Map<string, number>;
    componentUuidToIndex: Map<string, number>;
}

class EditorPrefabDriver extends BaseDriver implements PrefabBridgeDriver {
    constructor(profile: RuntimeProfile) {
        super(profile);
    }

    async listPrefabAssets(folder: string): Promise<PrefabAssetRecord[]> {
        const pattern = folder.endsWith('/')
            ? `${folder}**/*.prefab`
            : `${folder}/**/*.prefab`;
        const results = await this.request(ASSET_DB_CHANNEL, 'query-assets', { pattern }) as any[];
        return this.normalizePrefabAssetRecords(results);
    }

    async queryPrefabAsset(prefabPath: string): Promise<PrefabAssetRecord | null> {
        const info = await this.request(ASSET_DB_CHANNEL, 'query-asset-info', prefabPath) as any;
        if (!info?.uuid) {
            return null;
        }

        return this.normalizePrefabAssetRecord(info, prefabPath);
    }

    async queryPrefabMeta(assetUuid: string): Promise<PrefabMetaRecord | null> {
        try {
            const meta = await this.request(ASSET_DB_CHANNEL, 'query-asset-meta', assetUuid) as any;
            if (!meta || typeof meta !== 'object') {
                return null;
            }

            return {
                name: typeof meta.name === 'string' ? meta.name : undefined,
                uuid: typeof meta.uuid === 'string' ? meta.uuid : undefined,
                createTime: typeof meta.createTime === 'string' ? meta.createTime : undefined,
                modifyTime: typeof meta.modifyTime === 'string' ? meta.modifyTime : undefined,
                depends: Array.isArray(meta.depends) ? meta.depends.map((item: unknown) => String(item)) : [],
            };
        } catch {
            return null;
        }
    }

    async readPrefab(prefabPath: string): Promise<string> {
        const content = await this.request(ASSET_DB_CHANNEL, 'read-asset', prefabPath);
        return String(content || '');
    }

    async createFromNode(input: PrefabCreateFromNodeRequest): Promise<PrefabMutationResponse> {
        const prefabPath = this.ensurePrefabPath(input.savePath, input.prefabName);
        const prefabName = this.resolvePrefabName(prefabPath, input.prefabName);
        const sourceNode = await this.getPrefabSourceNode(input.nodeUuid);

        const placeholderContent = JSON.stringify([
            {
                __type__: 'cc.Prefab',
                _name: prefabName,
            },
        ], null, 2);

        await this.request(ASSET_DB_CHANNEL, 'create-asset', prefabPath, placeholderContent, {
            overwrite: true,
            rename: false,
        });

        const assetInfo = await this.queryPrefabAsset(prefabPath);
        if (!assetInfo) {
            throw new Error(`Failed to resolve prefab asset after creation: ${prefabPath}`);
        }

        const prefabContent = await this.createStandardPrefabContent(sourceNode, prefabName, assetInfo.uuid);
        await this.request(ASSET_DB_CHANNEL, 'save-asset', prefabPath, JSON.stringify(prefabContent, null, 2));
        await this.request(ASSET_DB_CHANNEL, 'save-asset-meta', prefabPath, JSON.stringify(
            this.createStandardMetaContent(prefabName, assetInfo.uuid),
            null,
            2,
        ));

        const convertResult = await this.convertNodeToPrefabInstance(input.nodeUuid, assetInfo.uuid, prefabPath);

        return {
            data: {
                prefabUuid: assetInfo.uuid,
                prefabPath,
                nodeUuid: input.nodeUuid,
                prefabName,
                convertedToPrefabInstance: convertResult.success,
                convertedNodeUuid: convertResult.data?.replacementNodeUuid || input.nodeUuid,
            },
            message: convertResult.success
                ? 'Prefab created successfully and source node converted to a prefab instance'
                : 'Prefab created successfully, but converting the source node back to a prefab instance failed',
            ...(convertResult.success || !convertResult.error ? {} : { warning: convertResult.error }),
        };
    }

    async instantiate(input: PrefabInstantiateRequest): Promise<PrefabMutationResponse> {
        const assetInfo = await this.queryPrefabAsset(input.prefabPath);
        if (!assetInfo) {
            throw new Error(`Prefab not found: ${input.prefabPath}`);
        }

        const createNodeOptions: any = {
            assetUuid: assetInfo.uuid,
        };

        if (typeof input.parentUuid === 'string' && input.parentUuid.trim()) {
            createNodeOptions.parent = input.parentUuid.trim();
        }
        if (typeof input.name === 'string' && input.name.trim()) {
            createNodeOptions.name = input.name.trim();
        } else if (assetInfo.name) {
            createNodeOptions.name = assetInfo.name;
        }
        if (input.position) {
            createNodeOptions.dump = {
                position: {
                    value: this.normalizeVector3(input.position),
                },
            };
        }

        const nodeUuid = await this.request(SCENE_CHANNEL, 'create-node', createNodeOptions);
        const resolvedNodeUuid = Array.isArray(nodeUuid) ? nodeUuid[0] : nodeUuid;

        return {
            data: {
                nodeUuid: resolvedNodeUuid,
                prefabPath: input.prefabPath,
                parentUuid: input.parentUuid,
                position: input.position,
            },
            message: 'Prefab instantiated successfully',
        };
    }

    async duplicate(input: PrefabDuplicateRequest): Promise<PrefabMutationResponse> {
        const sourceInfo = await this.queryPrefabAsset(input.sourcePath);
        if (!sourceInfo) {
            throw new Error(`Source prefab not found: ${input.sourcePath}`);
        }

        await this.request(ASSET_DB_CHANNEL, 'copy-asset', input.sourcePath, input.targetPath, {
            overwrite: true,
            rename: false,
        });

        const targetInfo = await this.queryPrefabAsset(input.targetPath);
        if (!targetInfo) {
            throw new Error(`Duplicated prefab could not be resolved: ${input.targetPath}`);
        }

        return {
            data: {
                sourcePath: input.sourcePath,
                sourceUuid: sourceInfo.uuid,
                targetPath: input.targetPath,
                targetUuid: targetInfo.uuid,
            },
            message: 'Prefab duplicated successfully',
        };
    }

    async apply(nodeUuid: string): Promise<void> {
        await this.request(SCENE_CHANNEL, 'apply-prefab', {
            node: nodeUuid,
        });
    }

    async restore(nodeUuid: string, assetUuid: string): Promise<void> {
        await this.request(SCENE_CHANNEL, 'restore-prefab', nodeUuid, assetUuid);
    }

    async revert(nodeUuid: string): Promise<void> {
        await this.request(SCENE_CHANNEL, 'revert-prefab', {
            node: nodeUuid,
        });
    }

    private normalizePrefabAssetRecords(records: any[]): PrefabAssetRecord[] {
        return Array.isArray(records)
            ? records.map((item) => this.normalizePrefabAssetRecord(item, item?.url || item?.path || ''))
            : [];
    }

    private normalizePrefabAssetRecord(item: any, fallbackPath: string): PrefabAssetRecord {
        const path = String(item?.url || item?.path || fallbackPath || '');
        const folder = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : 'db://assets';
        return {
            uuid: String(item?.uuid || ''),
            path,
            name: String(item?.name || this.getNameFromPath(path)),
            folder,
            type: typeof item?.type === 'string' ? item.type : undefined,
            size: typeof item?.fileSize === 'number'
                ? item.fileSize
                : (typeof item?.size === 'number' ? item.size : undefined),
        };
    }

    private async getPrefabSourceNode(nodeUuid: string): Promise<PrefabSourceNode> {
        const tree = await this.request(SCENE_CHANNEL, 'query-node-tree');
        const treeNode = this.findNodeInTree(tree, nodeUuid);

        if (treeNode) {
            return await this.buildSourceNodeFromTree(treeNode);
        }

        const detail = await this.request(SCENE_CHANNEL, 'query-node', nodeUuid);
        if (!detail || typeof detail !== 'object') {
            throw new Error(`Node with UUID ${nodeUuid} not found`);
        }

        return this.decorateSourceNode(detail as Record<string, unknown>, []);
    }

    private async buildSourceNodeFromTree(treeNode: any): Promise<PrefabSourceNode> {
        const nodeUuid = this.extractNodeUuid(treeNode);
        if (!nodeUuid) {
            throw new Error('Failed to resolve node UUID from scene tree');
        }

        const detail = await this.request(SCENE_CHANNEL, 'query-node', nodeUuid);
        if (!detail || typeof detail !== 'object') {
            throw new Error(`Node with UUID ${nodeUuid} not found`);
        }

        const childTrees = this.getTreeChildren(treeNode);
        const children: PrefabSourceNode[] = [];
        for (const childTree of childTrees) {
            const childUuid = this.extractNodeUuid(childTree);
            if (!childUuid) {
                continue;
            }
            children.push(await this.buildSourceNodeFromTree(childTree));
        }

        return this.decorateSourceNode(detail as Record<string, unknown>, children);
    }

    private decorateSourceNode(detail: Record<string, unknown>, children: PrefabSourceNode[]): PrefabSourceNode {
        return {
            ...detail,
            components: this.normalizeComponentList((detail as any).__comps__),
            children,
        };
    }

    private normalizeComponentList(rawComponents: unknown): any[] {
        if (!Array.isArray(rawComponents)) {
            return [];
        }

        return rawComponents.map((component: any) => ({
            ...component,
            type: component?.__type__ || component?.type || component?.cid || 'cc.Component',
            enabled: component?.enabled?.value !== undefined
                ? component.enabled.value
                : (component?.enabled !== undefined ? component.enabled : true),
            uuid: component?.uuid?.value || component?.uuid || component?.value?.uuid || null,
            properties: this.extractComponentProperties(component),
        }));
    }

    private extractComponentProperties(component: any): Record<string, any> {
        const properties: Record<string, any> = {};
        const source = this.getComponentPropertySource(component);
        if (!source) {
            return properties;
        }

        for (const [key, propData] of Object.entries(source)) {
            if (key.startsWith('_') || this.shouldSkipComponentProperty(key)) {
                continue;
            }

            if (!this.isVisibleComponentPropertyDescriptor(propData)) {
                continue;
            }

            const descriptor = propData as any;
            const simplified: any = {};

            if (descriptor.value !== undefined) {
                simplified.value = safeSerialize(descriptor.value);
            }

            const resolvedType = descriptor.type !== undefined ? descriptor.type : descriptor.ctor;
            if (resolvedType !== undefined) {
                simplified.type = safeSerialize(resolvedType);
            }
            if (descriptor.ctor !== undefined) {
                simplified.ctor = safeSerialize(descriptor.ctor);
            }
            if (descriptor.readonly) {
                simplified.readonly = true;
            }
            if (descriptor.enumList !== undefined) {
                simplified.enumList = safeSerialize(descriptor.enumList);
            }
            if (descriptor.min !== undefined) {
                simplified.min = descriptor.min;
            }
            if (descriptor.max !== undefined) {
                simplified.max = descriptor.max;
            }
            if (descriptor.step !== undefined) {
                simplified.step = descriptor.step;
            }
            if (descriptor.extends !== undefined) {
                simplified.extends = safeSerialize(descriptor.extends);
            }

            if (Object.keys(simplified).length > 0) {
                properties[key] = simplified;
            }
        }

        return properties;
    }

    private getComponentPropertySource(component: any): Record<string, any> | null {
        if (!component || typeof component !== 'object') {
            return null;
        }

        if (component.value && typeof component.value === 'object' && !Array.isArray(component.value)) {
            return component.value;
        }

        if (component.properties && typeof component.properties === 'object') {
            if (component.properties.value && typeof component.properties.value === 'object' && !Array.isArray(component.properties.value)) {
                return component.properties.value;
            }
            return component.properties;
        }

        return component;
    }

    private shouldSkipComponentProperty(key: string): boolean {
        return [
            '__type__',
            '__prefab',
            '__scriptAsset',
            'enabled',
            'node',
            '_id',
            'uuid',
            'name',
            '_name',
            '_objFlags',
            '_enabled',
            'type',
            'readonly',
            'visible',
            'cid',
            'editor',
            'extends',
        ].includes(key);
    }

    private isVisibleComponentPropertyDescriptor(propData: any): boolean {
        if (typeof propData !== 'object' || propData === null) {
            return false;
        }
        if (propData.visible === false) {
            return false;
        }
        return 'value' in propData || 'type' in propData || 'ctor' in propData || 'readonly' in propData;
    }

    private async createStandardPrefabContent(nodeData: PrefabSourceNode, prefabName: string, prefabUuid: string): Promise<any[]> {
        const prefabData: any[] = [];
        const prefabAsset = {
            __type__: 'cc.Prefab',
            _name: prefabName,
            _objFlags: 0,
            __editorExtras__: {},
            _native: '',
            data: {
                __id__: 1,
            },
            optimizationPolicy: 0,
            persistent: false,
        };

        prefabData.push(prefabAsset);

        const context: PrefabTreeContext = {
            prefabData,
            currentId: 2,
            prefabAssetIndex: 0,
            nodeFileIds: new Map<string, string>(),
            nodeUuidToIndex: new Map<string, number>(),
            componentUuidToIndex: new Map<string, number>(),
        };

        await this.createCompleteNodeTree(nodeData, null, 1, context, prefabName);
        return prefabData;
    }

    private async createCompleteNodeTree(
        nodeData: PrefabSourceNode,
        parentNodeIndex: number | null,
        nodeIndex: number,
        context: PrefabTreeContext,
        nodeName?: string,
    ): Promise<void> {
        const { prefabData } = context;
        const node = this.createEngineStandardNode(nodeData, parentNodeIndex, nodeName);

        while (prefabData.length <= nodeIndex) {
            prefabData.push(null);
        }
        prefabData[nodeIndex] = node;

        const nodeUuid = this.extractNodeUuid(nodeData);
        const fileId = nodeUuid || this.generateFileId();
        context.nodeFileIds.set(nodeIndex.toString(), fileId);
        if (nodeUuid) {
            context.nodeUuidToIndex.set(nodeUuid, nodeIndex);
        }

        const childrenToProcess = this.getChildrenToProcess(nodeData);
        if (childrenToProcess.length > 0) {
            const childIndices: number[] = [];
            for (let index = 0; index < childrenToProcess.length; index += 1) {
                const childIndex = context.currentId++;
                childIndices.push(childIndex);
                node._children.push({ __id__: childIndex });
            }

            for (let index = 0; index < childrenToProcess.length; index += 1) {
                await this.createCompleteNodeTree(
                    childrenToProcess[index],
                    nodeIndex,
                    childIndices[index],
                    context,
                    this.extractNodeName(childrenToProcess[index].name) || `Child${index + 1}`,
                );
            }
        }

        if (Array.isArray(nodeData.components) && nodeData.components.length > 0) {
            for (const component of nodeData.components) {
                const componentIndex = context.currentId++;
                node._components.push({ __id__: componentIndex });

                const componentUuid = component.uuid || component?.value?.uuid;
                if (typeof componentUuid === 'string' && componentUuid) {
                    context.componentUuidToIndex.set(componentUuid, componentIndex);
                }

                prefabData[componentIndex] = this.createComponentObject(component, nodeIndex, context);

                const compPrefabInfoIndex = context.currentId++;
                prefabData[compPrefabInfoIndex] = {
                    __type__: 'cc.CompPrefabInfo',
                    fileId: this.generateFileId(),
                };

                if (prefabData[componentIndex] && typeof prefabData[componentIndex] === 'object') {
                    prefabData[componentIndex].__prefab = { __id__: compPrefabInfoIndex };
                }
            }
        }

        const prefabInfoIndex = context.currentId++;
        node._prefab = { __id__: prefabInfoIndex };
        prefabData[prefabInfoIndex] = {
            __type__: 'cc.PrefabInfo',
            root: { __id__: 1 },
            asset: { __id__: context.prefabAssetIndex },
            fileId,
            targetOverrides: null,
            nestedPrefabInstanceRoots: null,
            instance: null,
        };
    }

    private createComponentObject(
        componentData: any,
        nodeIndex: number,
        context?: {
            nodeUuidToIndex?: Map<string, number>;
            componentUuidToIndex?: Map<string, number>;
        },
    ): any {
        let componentType = componentData.type || componentData.__type__ || 'cc.Component';
        const enabled = componentData.enabled !== undefined ? componentData.enabled : true;

        if (componentType && !String(componentType).startsWith('cc.')) {
            componentType = String(componentType);
        }

        const component: any = {
            __type__: componentType,
            _name: '',
            _objFlags: 0,
            __editorExtras__: {},
            node: { __id__: nodeIndex },
            _enabled: enabled,
            __prefab: null,
        };

        if (componentType === 'cc.UITransform') {
            const contentSize = componentData.properties?.contentSize?.value || { width: 100, height: 100 };
            const anchorPoint = componentData.properties?.anchorPoint?.value || { x: 0.5, y: 0.5 };
            component._contentSize = {
                __type__: 'cc.Size',
                width: contentSize.width,
                height: contentSize.height,
            };
            component._anchorPoint = {
                __type__: 'cc.Vec2',
                x: anchorPoint.x,
                y: anchorPoint.y,
            };
        } else if (componentType === 'cc.Sprite') {
            const spriteFrameProp = componentData.properties?._spriteFrame || componentData.properties?.spriteFrame;
            component._spriteFrame = spriteFrameProp
                ? this.processComponentProperty(spriteFrameProp, context)
                : null;
            component._type = componentData.properties?._type?.value ?? 0;
            component._fillType = componentData.properties?._fillType?.value ?? 0;
            component._sizeMode = componentData.properties?._sizeMode?.value ?? 1;
            component._fillCenter = { __type__: 'cc.Vec2', x: 0, y: 0 };
            component._fillStart = componentData.properties?._fillStart?.value ?? 0;
            component._fillRange = componentData.properties?._fillRange?.value ?? 0;
            component._isTrimmedMode = componentData.properties?._isTrimmedMode?.value ?? true;
            component._useGrayscale = componentData.properties?._useGrayscale?.value ?? false;
            component._atlas = null;
            component._id = '';
        } else if (componentType === 'cc.Button') {
            component._interactable = true;
            component._transition = 3;
            component._normalColor = { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 };
            component._hoverColor = { __type__: 'cc.Color', r: 211, g: 211, b: 211, a: 255 };
            component._pressedColor = { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 };
            component._disabledColor = { __type__: 'cc.Color', r: 124, g: 124, b: 124, a: 255 };
            component._normalSprite = null;
            component._hoverSprite = null;
            component._pressedSprite = null;
            component._disabledSprite = null;
            component._duration = 0.1;
            component._zoomScale = 1.2;
            const targetProp = componentData.properties?._target || componentData.properties?.target;
            component._target = targetProp
                ? this.processComponentProperty(targetProp, context)
                : { __id__: nodeIndex };
            component._clickEvents = [];
            component._id = '';
        } else if (componentType === 'cc.Label') {
            component._string = componentData.properties?._string?.value || 'Label';
            component._horizontalAlign = 1;
            component._verticalAlign = 1;
            component._actualFontSize = 20;
            component._fontSize = 20;
            component._fontFamily = 'Arial';
            component._lineHeight = 25;
            component._overflow = 0;
            component._enableWrapText = true;
            component._font = null;
            component._isSystemFontUsed = true;
            component._spacingX = 0;
            component._isItalic = false;
            component._isBold = false;
            component._isUnderline = false;
            component._underlineHeight = 2;
            component._cacheMode = 0;
        } else if (componentData.properties) {
            for (const [key, value] of Object.entries(componentData.properties)) {
                if (key === 'node' || key === 'enabled' || key === '__type__'
                    || key === 'uuid' || key === 'name' || key === '__scriptAsset' || key === '_objFlags') {
                    continue;
                }

                const propValue = this.processComponentProperty(value, context);
                if (propValue !== undefined) {
                    component[key] = propValue;
                }
            }
        }

        const componentId = component._id || '';
        delete component._id;
        component._id = componentId;

        return component;
    }

    private processComponentProperty(
        propData: any,
        context?: {
            nodeUuidToIndex?: Map<string, number>;
            componentUuidToIndex?: Map<string, number>;
        },
    ): any {
        if (!propData || typeof propData !== 'object') {
            return propData;
        }

        const value = propData.value;
        const type = propData.type;

        if (value === null || value === undefined) {
            return null;
        }

        if (value && typeof value === 'object' && value.uuid === '') {
            return null;
        }

        if (type === 'cc.Node' && value?.uuid) {
            if (context?.nodeUuidToIndex?.has(value.uuid)) {
                return {
                    __id__: context.nodeUuidToIndex.get(value.uuid),
                };
            }
            return null;
        }

        if (value?.uuid && (
            type === 'cc.Prefab'
            || type === 'cc.Texture2D'
            || type === 'cc.SpriteFrame'
            || type === 'cc.Material'
            || type === 'cc.AnimationClip'
            || type === 'cc.AudioClip'
            || type === 'cc.Font'
            || type === 'cc.Asset'
        )) {
            const uuidToUse = type === 'cc.Prefab'
                ? value.uuid
                : this.uuidToCompressedId(value.uuid);
            return {
                __uuid__: uuidToUse,
                __expectedType__: type,
            };
        }

        if (value?.uuid && (
            type === 'cc.Component'
            || type === 'cc.Label'
            || type === 'cc.Button'
            || type === 'cc.Sprite'
            || type === 'cc.UITransform'
            || type === 'cc.RigidBody2D'
            || type === 'cc.BoxCollider2D'
            || type === 'cc.Animation'
            || type === 'cc.AudioSource'
            || (typeof type === 'string' && type.startsWith('cc.') && !type.includes('@'))
        )) {
            if (context?.componentUuidToIndex?.has(value.uuid)) {
                return {
                    __id__: context.componentUuidToIndex.get(value.uuid),
                };
            }
            return null;
        }

        if (value && typeof value === 'object') {
            if (type === 'cc.Color') {
                return {
                    __type__: 'cc.Color',
                    r: Math.min(255, Math.max(0, Number(value.r) || 0)),
                    g: Math.min(255, Math.max(0, Number(value.g) || 0)),
                    b: Math.min(255, Math.max(0, Number(value.b) || 0)),
                    a: value.a !== undefined ? Math.min(255, Math.max(0, Number(value.a))) : 255,
                };
            }
            if (type === 'cc.Vec3') {
                return {
                    __type__: 'cc.Vec3',
                    x: Number(value.x) || 0,
                    y: Number(value.y) || 0,
                    z: Number(value.z) || 0,
                };
            }
            if (type === 'cc.Vec2') {
                return {
                    __type__: 'cc.Vec2',
                    x: Number(value.x) || 0,
                    y: Number(value.y) || 0,
                };
            }
            if (type === 'cc.Size') {
                return {
                    __type__: 'cc.Size',
                    width: Number(value.width) || 0,
                    height: Number(value.height) || 0,
                };
            }
            if (type === 'cc.Quat') {
                return {
                    __type__: 'cc.Quat',
                    x: Number(value.x) || 0,
                    y: Number(value.y) || 0,
                    z: Number(value.z) || 0,
                    w: value.w !== undefined ? Number(value.w) : 1,
                };
            }
        }

        if (Array.isArray(value)) {
            if (propData.elementTypeData?.type === 'cc.Node') {
                return value
                    .map((item) => item?.uuid && context?.nodeUuidToIndex?.has(item.uuid)
                        ? { __id__: context.nodeUuidToIndex.get(item.uuid) }
                        : null)
                    .filter((item) => item !== null);
            }

            if (propData.elementTypeData?.type && propData.elementTypeData.type.startsWith('cc.')) {
                return value
                    .map((item) => item?.uuid
                        ? {
                            __uuid__: this.uuidToCompressedId(item.uuid),
                            __expectedType__: propData.elementTypeData.type,
                        }
                        : null)
                    .filter((item) => item !== null);
            }

            return value.map((item) => item?.value !== undefined ? item.value : item);
        }

        if (value && typeof value === 'object' && type && type.startsWith('cc.')) {
            return {
                __type__: type,
                ...value,
            };
        }

        return value;
    }

    private uuidToCompressedId(uuid: string): string {
        const base64Keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        const cleanUuid = uuid.replace(/-/g, '').toLowerCase();
        if (cleanUuid.length !== 32) {
            return uuid;
        }

        let result = cleanUuid.substring(0, 5);
        const remainder = cleanUuid.substring(5);

        for (let index = 0; index < remainder.length; index += 3) {
            const value = parseInt(
                `${remainder[index] || '0'}${remainder[index + 1] || '0'}${remainder[index + 2] || '0'}`,
                16,
            );
            const high6 = (value >> 6) & 63;
            const low6 = value & 63;
            result += base64Keys[high6] + base64Keys[low6];
        }

        return result;
    }

    private createEngineStandardNode(nodeData: PrefabSourceNode, parentNodeIndex: number | null, nodeName?: string): any {
        const position = this.extractNodeValue(nodeData.position) || { x: 0, y: 0, z: 0 };
        const rotation = this.extractNodeValue(nodeData.rotation) || { x: 0, y: 0, z: 0, w: 1 };
        const scale = this.extractNodeValue(nodeData.scale) || { x: 1, y: 1, z: 1 };
        const active = this.extractNodeValue(nodeData.active);
        const layer = this.extractNodeValue(nodeData.layer) || 1073741824;
        const name = nodeName || this.extractNodeName(nodeData.name) || 'Node';

        return {
            __type__: 'cc.Node',
            _name: name,
            _objFlags: 0,
            __editorExtras__: {},
            _parent: parentNodeIndex !== null ? { __id__: parentNodeIndex } : null,
            _children: [],
            _active: active === undefined ? true : active,
            _components: [],
            _prefab: { __id__: 0 },
            _lpos: {
                __type__: 'cc.Vec3',
                x: position.x,
                y: position.y,
                z: position.z,
            },
            _lrot: {
                __type__: 'cc.Quat',
                x: rotation.x,
                y: rotation.y,
                z: rotation.z,
                w: rotation.w,
            },
            _lscale: {
                __type__: 'cc.Vec3',
                x: scale.x,
                y: scale.y,
                z: scale.z,
            },
            _mobility: this.extractNodeValue(nodeData.mobility) || 0,
            _layer: layer,
            _euler: {
                __type__: 'cc.Vec3',
                x: 0,
                y: 0,
                z: 0,
            },
            _id: '',
        };
    }

    private getChildrenToProcess(nodeData: PrefabSourceNode): PrefabSourceNode[] {
        return Array.isArray(nodeData.children) ? nodeData.children : [];
    }

    private extractNodeUuid(nodeData: any): string | null {
        if (!nodeData) {
            return null;
        }

        const sources = [
            nodeData.uuid,
            nodeData.value?.uuid,
            nodeData.__uuid__,
            nodeData.value?.__uuid__,
            nodeData.id,
            nodeData.value?.id,
        ];

        for (const source of sources) {
            if (typeof source === 'string' && source.length > 0) {
                return source;
            }
        }

        return null;
    }

    private createStandardMetaContent(prefabName: string, prefabUuid: string): any {
        return {
            ver: '2.0.3',
            importer: 'prefab',
            imported: true,
            uuid: prefabUuid,
            files: ['.json'],
            subMetas: {},
            userData: {
                syncNodeName: prefabName,
                hasIcon: false,
            },
        };
    }

    private async convertNodeToPrefabInstance(
        nodeUuid: string,
        prefabUuid: string,
        prefabPath: string,
    ): Promise<{ success: boolean; error?: string; data?: any }> {
        try {
            const linkAttempts = [
                { method: 'link-prefab', payload: { nodeUuid, prefabAssetUuid: prefabUuid, prefabUuid, assetUuid: prefabUuid, prefabPath } },
                { method: 'connect-prefab-instance', payload: { nodeUuid, prefabAssetUuid: prefabUuid, prefabUuid, assetUuid: prefabUuid, prefabPath } },
                { method: 'set-prefab-connection', payload: { nodeUuid, prefabAssetUuid: prefabUuid, prefabUuid, assetUuid: prefabUuid, prefabPath } },
                { method: 'apply-prefab-link', payload: { nodeUuid, prefabAssetUuid: prefabUuid, prefabUuid, assetUuid: prefabUuid, prefabPath } },
            ];

            for (const attempt of linkAttempts) {
                try {
                    await this.request(SCENE_CHANNEL, attempt.method, attempt.payload);
                    return {
                        success: true,
                        data: {
                            strategy: attempt.method,
                            nodeUuid,
                            prefabUuid,
                            prefabPath,
                        },
                    };
                } catch {
                    // Try next strategy.
                }
            }

            const nodeData = await this.request(SCENE_CHANNEL, 'query-node', nodeUuid);
            if (!nodeData) {
                return { success: false, error: 'Failed to query source node for prefab conversion' };
            }

            const parentUuid = this.extractNodeUuid((nodeData as any).parent);
            const nodeName = this.extractNodeName((nodeData as any).name) || 'PrefabInstance';
            const createOptions: any = {
                assetUuid: prefabUuid,
                name: nodeName,
                keepWorldTransform: true,
            };

            if (parentUuid) {
                createOptions.parent = parentUuid;
            }

            const dump: any = {};
            const active = this.extractNodeValue((nodeData as any).active);
            const position = this.extractNodeValue((nodeData as any).position);
            const rotation = this.extractNodeValue((nodeData as any).rotation);
            const scale = this.extractNodeValue((nodeData as any).scale);
            const layer = this.extractNodeValue((nodeData as any).layer);

            if (active !== undefined) {
                dump.active = { value: active };
            }
            if (position) {
                dump.position = { value: position };
            }
            if (rotation) {
                dump.rotation = { value: rotation };
            }
            if (scale) {
                dump.scale = { value: scale };
            }
            if (layer !== undefined) {
                dump.layer = { value: layer };
            }
            if (Object.keys(dump).length > 0) {
                createOptions.dump = dump;
            }

            const createdNodeUuid = await this.request(SCENE_CHANNEL, 'create-node', createOptions);
            const replacementNodeUuid = Array.isArray(createdNodeUuid)
                ? createdNodeUuid[0]
                : createdNodeUuid;
            if (!replacementNodeUuid) {
                return { success: false, error: 'Prefab instance creation did not return a node UUID' };
            }

            try {
                await this.request(SCENE_CHANNEL, 'remove-node', { uuid: nodeUuid });
            } catch (error: any) {
                return {
                    success: false,
                    error: `Prefab instance was created as ${replacementNodeUuid}, but removing the original node failed: ${error?.message || error}`,
                    data: {
                        strategy: 'recreate',
                        nodeUuid,
                        replacementNodeUuid,
                        prefabUuid,
                        prefabPath,
                    },
                };
            }

            return {
                success: true,
                data: {
                    strategy: 'recreate',
                    nodeUuid,
                    replacementNodeUuid,
                    prefabUuid,
                    prefabPath,
                },
            };
        } catch (error: any) {
            return {
                success: false,
                error: error?.message || String(error),
            };
        }
    }

    private extractNodeName(value: any): string | null {
        if (!value) {
            return null;
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value.value === 'string') {
            return value.value;
        }
        if (typeof value.name === 'string') {
            return value.name;
        }
        if (value.name?.value !== undefined) {
            return String(value.name.value);
        }
        if (typeof value.uuid === 'string') {
            return value.uuid;
        }
        return null;
    }

    private extractNodeValue(value: any): any {
        if (value && typeof value === 'object' && 'value' in value) {
            return value.value;
        }
        return value;
    }

    private findNodeInTree(tree: any, targetUuid: string): any {
        if (!tree) {
            return null;
        }

        if (Array.isArray(tree)) {
            for (const item of tree) {
                const found = this.findNodeInTree(item, targetUuid);
                if (found) {
                    return found;
                }
            }
            return null;
        }

        const currentUuid = this.extractNodeUuid(tree);
        if (currentUuid === targetUuid) {
            return tree;
        }

        const children = this.getTreeChildren(tree);
        for (const child of children) {
            const found = this.findNodeInTree(child, targetUuid);
            if (found) {
                return found;
            }
        }

        return null;
    }

    private getTreeChildren(node: any): any[] {
        return Array.isArray(node?.children) ? node.children : [];
    }

    private normalizeVector3(position: Vector3Like): Required<Vector3Like> {
        return {
            x: typeof position.x === 'number' ? position.x : 0,
            y: typeof position.y === 'number' ? position.y : 0,
            z: typeof position.z === 'number' ? position.z : 0,
        };
    }

    private ensurePrefabPath(savePath: string, prefabName?: string): string {
        const trimmed = String(savePath || '').trim();
        if (!trimmed) {
            throw new Error('savePath is required');
        }
        if (trimmed.endsWith('.prefab')) {
            return trimmed;
        }
        const resolvedName = this.resolvePrefabName(trimmed, prefabName);
        return `${trimmed.replace(/\/$/, '')}/${resolvedName}.prefab`;
    }

    private resolvePrefabName(prefabPath: string, prefabName?: string): string {
        const explicitName = typeof prefabName === 'string' ? prefabName.trim() : '';
        if (explicitName) {
            return explicitName;
        }

        return this.getNameFromPath(prefabPath).replace(/\.prefab$/i, '') || 'NewPrefab';
    }

    private getNameFromPath(assetPath: string): string {
        const normalized = String(assetPath || '').replace(/\\/g, '/');
        const baseName = normalized.split('/').pop() || normalized;
        return baseName.replace(/\.prefab$/i, '');
    }

    private generateFileId(): string {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/';
        let fileId = '';
        for (let index = 0; index < 22; index += 1) {
            fileId += chars[Math.floor(Math.random() * chars.length)];
        }
        return fileId;
    }

}

export function createPrefabDriver(profile: RuntimeProfile): PrefabBridgeDriver {
    return new EditorPrefabDriver(profile);
}
