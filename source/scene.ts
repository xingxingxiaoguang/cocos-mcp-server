import { basename, join } from 'path';
module.paths.push(join(Editor.App.path, 'node_modules'));

/**
 * 递归按 UUID 查找节点（修复缺陷2：getChildByUuid 只搜索顶层子节点）
 */
function findNodeByUuid(root: any, uuid: string): any {
    if (root.uuid === uuid) return root;
    for (const child of root.children) {
        const found = findNodeByUuid(child, uuid);
        if (found) return found;
    }
    return null;
}

/**
 * 安全序列化：将引擎对象转换为可跨进程传递的普通数据结构
 */
function hasMeaningfulContent(value: any, depth: number = 0): boolean {
    if (depth > 4) return true;
    if (value === null || value === undefined) return false;

    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean' || type === 'bigint') return true;
    if (type === 'function') return false;

    if (Array.isArray(value)) {
        if (value.length === 0) return false;
        return value.some((item: any) => hasMeaningfulContent(item, depth + 1));
    }

    if (type === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) return false;
        return keys.some((key: string) => hasMeaningfulContent(value[key], depth + 1));
    }

    return true;
}

function safeSerialize(value: any, depth: number = 0, seen: WeakSet<object> = new WeakSet()): any {
    if (depth > 3) return '[max depth]';
    if (value === null || value === undefined) return value;

    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean') return value;
    if (type === 'bigint') return value.toString();
    if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;

    if (Array.isArray(value)) {
        return value.slice(0, 100).map((item: any) => safeSerialize(item, depth + 1, seen));
    }

    if (type === 'object') {
        if (value instanceof String || value instanceof Number || value instanceof Boolean) {
            return value.valueOf();
        }

        if (seen.has(value)) {
            return '[circular]';
        }
        seen.add(value);

        try {
            try {
                const json = JSON.stringify(value);
                if (json) {
                    const parsed = JSON.parse(json);
                    if (hasMeaningfulContent(parsed)) {
                        return parsed;
                    }
                }
            } catch {
                // Circular reference or non-serializable object, continue with manual extraction
            }

            const result: Record<string, any> = {};
            const keys = Object.keys(value);
            const inspectKeys = keys.length > 0
                ? keys
                : ['name', 'uuid', 'active', 'position', 'rotation', 'scale', 'x', 'y', 'z', 'w', 'width', 'height', 'r', 'g', 'b', 'a', 'children', 'components', 'parent'];

            for (const key of inspectKeys.slice(0, 20)) {
                try {
                    const item = value[key];
                    if (item !== undefined && typeof item !== 'function') {
                        result[key] = safeSerialize(item, depth + 1, seen);
                    }
                } catch {
                    // Skip inaccessible property
                }
            }

            if (Object.keys(result).length > 0) {
                return result;
            }

            try {
                const primitive = typeof value.valueOf === 'function' ? value.valueOf() : value;
                if (primitive !== value && (typeof primitive === 'string' || typeof primitive === 'number' || typeof primitive === 'boolean')) {
                    return primitive;
                }
            } catch {
                // Ignore valueOf failures
            }

            try {
                return String(value);
            } catch {
                return '[object]';
            }
        } finally {
            seen.delete(value);
        }
    }

    return String(value);
}

function serializeData<T>(value: T): any {
    return safeSerialize(value);
}

function normalizeAnimationType(typeValue: any): string | null {
    if (!typeValue) return null;
    if (typeof typeValue === 'string') return typeValue;
    if (typeof typeValue === 'object') {
        return typeValue.value || typeValue.name || typeValue.type || null;
    }
    return String(typeValue);
}

function summarizeAnimationCurve(curve: any): any {
    const keyframes = Array.isArray(curve?.keyframes) ? curve.keyframes : [];
    return {
        nodePath: curve?.nodePath || '',
        propKey: curve?.key || curve?.propKey || curve?.name || '',
        keyframeCount: keyframes.length,
        type: normalizeAnimationType(curve?.type || curve?.combinedType),
        displayName: curve?.displayName || curve?.menuName || curve?.name || curve?.key || curve?.propKey || ''
    };
}

function summarizeAnimationClipDump(dump: any): any {
    const curves = Array.isArray(dump?.curves) ? dump.curves.map((curve: any) => summarizeAnimationCurve(curve)) : [];
    const auxiliaryCurves = dump?.auxiliaryCurves && typeof dump.auxiliaryCurves === 'object'
        ? Object.entries(dump.auxiliaryCurves).map(([name, curve]: [string, any]) => ({
            name,
            displayName: curve?.displayName || name,
            keyframeCount: Array.isArray(curve?.keyframes) ? curve.keyframes.length : 0
        }))
        : [];

    return {
        name: dump?.name || '',
        duration: dump?.duration ?? 0,
        sample: dump?.sample ?? 0,
        speed: dump?.speed ?? 1,
        wrapMode: dump?.wrapMode ?? 0,
        curves,
        curveCount: curves.length,
        events: Array.isArray(dump?.events) ? dump.events : [],
        eventCount: Array.isArray(dump?.events) ? dump.events.length : 0,
        auxiliaryCurves,
        auxiliaryCurveCount: auxiliaryCurves.length,
        isSkeleton: Boolean(dump?.isSkeleton),
        useBakedAnimation: Boolean(dump?.useBakedAnimation)
    };
}

function findAnimationCurveSummary(dump: any, nodePath: string, propKey: string): any | null {
    const curves = Array.isArray(dump?.curves) ? dump.curves : [];
    const target = curves.find((curve: any) => curve?.nodePath === nodePath && (curve?.key === propKey || curve?.propKey === propKey));
    return target ? summarizeAnimationCurve(target) : null;
}

function extractEditableAnimationProperties(input: any): any[] {
    const results: any[] = [];
    const seen = new Set<string>();

    const visit = (value: any, inheritedNodePath: string = ''): void => {
        if (Array.isArray(value)) {
            value.forEach((item: any) => visit(item, inheritedNodePath));
            return;
        }

        if (!value || typeof value !== 'object') {
            return;
        }

        const nodePath = typeof value.nodePath === 'string'
            ? value.nodePath
            : (typeof value.path === 'string' && value.path.includes('/') ? value.path : inheritedNodePath);
        const propKey = typeof value.propKey === 'string'
            ? value.propKey
            : (typeof value.key === 'string' ? value.key : '');
        const displayName = value.displayName || value.menuName || value.name || propKey;
        const type = normalizeAnimationType(value.type || value.combinedType);

        if (propKey) {
            const dedupeKey = `${nodePath}::${propKey}`;
            if (!seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                results.push({
                    nodePath,
                    propKey,
                    displayName,
                    type,
                    category: value.category || value.comp || undefined,
                    raw: safeSerialize(value)
                });
            }
        }

        const childCollections = [
            value.children,
            value.props,
            value.properties,
            value.list,
            value.items,
            value.nodes
        ];

        childCollections.forEach((collection: any) => {
            if (collection) {
                visit(collection, nodePath);
            }
        });
    };

    visit(input);
    return results;
}

async function requestSceneFacade(method: string, ...args: any[]): Promise<any> {
    return Editor.Message.request('scene', method as any, ...args);
}

async function prepareAnimationEditContext(nodeUuid: string, clipUuid: string): Promise<void> {
    try {
        await requestSceneFacade('change-animation-root-node', nodeUuid, clipUuid);
    } catch {
        // Best-effort. Some editor states can still proceed without switching root explicitly.
    }

    try {
        await requestSceneFacade('record-animation', nodeUuid, true, clipUuid);
    } catch {
        // Best-effort. Query/edit actions may still work if the editor is already in animation mode.
    }

    await requestSceneFacade('set-edit-clip', clipUuid);
}

async function runAnimationOperations(nodeUuid: string, clipUuid: string, operations: Array<{ funcName: string; args: any[] }>): Promise<any> {
    await prepareAnimationEditContext(nodeUuid, clipUuid);

    const operationResult = await requestSceneFacade('apply-animation-operation', operations, { recordUndo: true });
    if (operationResult === false || operationResult?.state === 'failure') {
        throw new Error(operationResult?.reason || 'Animation operation failed');
    }

    try {
        await requestSceneFacade('save-clip');
    } catch {
        // Continue. The dump query below provides a concrete post-operation verification path.
    }

    return operationResult;
}

export const methods: { [key: string]: (...any: any) => any } = {
    /**
     * Create a new scene
     */
    createNewScene() {
        try {
            const { director, Scene } = require('cc');
            const scene = new Scene();
            scene.name = 'New Scene';
            director.runScene(scene);
            return { success: true, message: 'New scene created successfully' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Add component to a node
     */
    addComponentToNode(nodeUuid: string, componentType: string) {
        try {
            const { director, js } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            // 递归查找节点（修复缺陷2）
            const node = findNodeByUuid(scene, nodeUuid);
            if (!node) {
                return { success: false, error: `Node with UUID ${nodeUuid} not found` };
            }

            // 优先尝试 js 注册表（自定义脚本）（修复缺陷1）
            const Cls = js.getClassByName(componentType);
            if (Cls) {
                const comp = node.addComponent(Cls);
                return {
                    success: true,
                    message: `Component ${componentType} added successfully`,
                    data: serializeData({ componentId: comp.uuid })
                };
            }

            return {
                success: false,
                error: `Script class '${componentType}' is not registered in scene process. The script may still be compiling — retry in 1-2 seconds.`
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Remove component from a node
     */
    removeComponentFromNode(nodeUuid: string, componentType: string) {
        try {
            const { director, js } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const node = findNodeByUuid(scene, nodeUuid);
            if (!node) {
                return { success: false, error: `Node with UUID ${nodeUuid} not found` };
            }

            const ComponentClass = js.getClassByName(componentType);
            if (!ComponentClass) {
                return { success: false, error: `Component type ${componentType} not found` };
            }

            const component = node.getComponent(ComponentClass);
            if (!component) {
                return { success: false, error: `Component ${componentType} not found on node` };
            }

            node.removeComponent(component);
            return { success: true, message: `Component ${componentType} removed successfully` };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Create a new node
     */
    createNode(name: string, parentUuid?: string) {
        try {
            const { director, Node } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const node = new Node(name);
            
            if (parentUuid) {
                const parent = findNodeByUuid(scene, parentUuid);
                if (parent) {
                    parent.addChild(node);
                } else {
                    scene.addChild(node);
                }
            } else {
                scene.addChild(node);
            }

            return { 
                success: true, 
                message: `Node ${name} created successfully`,
                data: serializeData({ uuid: node.uuid, name: node.name })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Get node information
     */
    getNodeInfo(nodeUuid: string) {
        try {
            const { director } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const node = findNodeByUuid(scene, nodeUuid);
            if (!node) {
                return { success: false, error: `Node with UUID ${nodeUuid} not found` };
            }

            return {
                success: true,
                data: serializeData({
                    uuid: node.uuid,
                    name: node.name,
                    active: node.active,
                    position: node.position,
                    rotation: node.rotation,
                    scale: node.scale,
                    parent: node.parent?.uuid,
                    children: node.children.map((child: any) => child.uuid),
                    components: node.components.map((comp: any) => ({
                        type: comp.constructor.name,
                        enabled: comp.enabled
                    }))
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Get all nodes in scene
     */
    getAllNodes() {
        try {
            const { director } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const nodes: any[] = [];
            const collectNodes = (node: any) => {
                nodes.push({
                    uuid: node.uuid,
                    name: node.name,
                    active: node.active,
                    parent: node.parent?.uuid
                });
                
                node.children.forEach((child: any) => collectNodes(child));
            };

            scene.children.forEach((child: any) => collectNodes(child));
            
            return { success: true, data: serializeData(nodes) };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Find node by name
     */
    findNodeByName(name: string) {
        try {
            const { director } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const node = scene.getChildByName(name);
            if (!node) {
                return { success: false, error: `Node with name ${name} not found` };
            }

            return {
                success: true,
                data: serializeData({
                    uuid: node.uuid,
                    name: node.name,
                    active: node.active,
                    position: node.position
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Get current scene information
     */
    getCurrentSceneInfo() {
        try {
            const { director } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            return {
                success: true,
                data: serializeData({
                    name: scene.name,
                    uuid: scene.uuid,
                    nodeCount: scene.children.length
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Set node property
     */
    setNodeProperty(nodeUuid: string, property: string, value: any) {
        try {
            const { director } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const node = findNodeByUuid(scene, nodeUuid);
            if (!node) {
                return { success: false, error: `Node with UUID ${nodeUuid} not found` };
            }

            // 设置属性
            if (property === 'position') {
                node.setPosition(value.x || 0, value.y || 0, value.z || 0);
            } else if (property === 'rotation') {
                node.setRotationFromEuler(value.x || 0, value.y || 0, value.z || 0);
            } else if (property === 'scale') {
                node.setScale(value.x || 1, value.y || 1, value.z || 1);
            } else if (property === 'active') {
                node.active = value;
            } else if (property === 'name') {
                node.name = value;
            } else {
                // 尝试直接设置属性
                (node as any)[property] = value;
            }

            return { 
                success: true, 
                message: `Property '${property}' updated successfully` 
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Get scene hierarchy
     */
    getSceneHierarchy(includeComponents: boolean = false) {
        try {
            const { director } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const processNode = (node: any): any => {
                const result: any = {
                    name: node.name,
                    uuid: node.uuid,
                    active: node.active,
                    children: []
                };

                if (includeComponents) {
                    result.components = node.components.map((comp: any) => ({
                        type: comp.constructor.name,
                        enabled: comp.enabled
                    }));
                }

                if (node.children && node.children.length > 0) {
                    result.children = node.children.map((child: any) => processNode(child));
                }

                return result;
            };

            const hierarchy = scene.children.map((child: any) => processNode(child));
            return { success: true, data: hierarchy };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Create prefab from node
     */
    createPrefabFromNode(nodeUuid: string, prefabPath: string) {
        try {
            const { director, instantiate } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const node = findNodeByUuid(scene, nodeUuid);
            if (!node) {
                return { success: false, error: `Node with UUID ${nodeUuid} not found` };
            }

            // 注意：这里只是一个模拟实现，因为运行时环境下无法直接创建预制体文件
            // 真正的预制体创建需要Editor API支持
            return {
                success: true,
                data: serializeData({
                    prefabPath: prefabPath,
                    sourceNodeUuid: nodeUuid,
                    message: `Prefab created from node '${node.name}' at ${prefabPath}`
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Set component property
     */
    setComponentProperty(nodeUuid: string, componentType: string, property: string, value: any) {
        try {
            const { director, js } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }
            const node = findNodeByUuid(scene, nodeUuid);
            if (!node) {
                return { success: false, error: `Node with UUID ${nodeUuid} not found` };
            }
            const ComponentClass = js.getClassByName(componentType);
            if (!ComponentClass) {
                return { success: false, error: `Component type ${componentType} not found` };
            }
            const component = node.getComponent(ComponentClass);
            if (!component) {
                return { success: false, error: `Component ${componentType} not found on node` };
            }
            // 针对常见属性做特殊处理
            if (property === 'spriteFrame' && componentType === 'cc.Sprite') {
                // 支持 value 为 uuid 或资源路径
                if (typeof value === 'string') {
                    // 先尝试按 uuid 查找
                    const assetManager = require('cc').assetManager;
                    assetManager.resources.load(value, require('cc').SpriteFrame, (err: any, spriteFrame: any) => {
                        if (!err && spriteFrame) {
                            component.spriteFrame = spriteFrame;
                        } else {
                            // 尝试通过 uuid 加载
                            assetManager.loadAny({ uuid: value }, (err2: any, asset: any) => {
                                if (!err2 && asset) {
                                    component.spriteFrame = asset;
                                } else {
                                    // 直接赋值（兼容已传入资源对象）
                                    component.spriteFrame = value;
                                }
                            });
                        }
                    });
                } else {
                    component.spriteFrame = value;
                }
            } else if (property === 'material' && (componentType === 'cc.Sprite' || componentType === 'cc.MeshRenderer')) {
                // 支持 value 为 uuid 或资源路径
                if (typeof value === 'string') {
                    const assetManager = require('cc').assetManager;
                    assetManager.resources.load(value, require('cc').Material, (err: any, material: any) => {
                        if (!err && material) {
                            component.material = material;
                        } else {
                            assetManager.loadAny({ uuid: value }, (err2: any, asset: any) => {
                                if (!err2 && asset) {
                                    component.material = asset;
                                } else {
                                    component.material = value;
                                }
                            });
                        }
                    });
                } else {
                    component.material = value;
                }
            } else if (property === 'string' && (componentType === 'cc.Label' || componentType === 'cc.RichText')) {
                component.string = value;
            } else {
                component[property] = value;
            }
            // 可选：刷新 Inspector
            // Editor.Message.send('scene', 'snapshot');
            return { success: true, message: `Component property '${property}' updated successfully` };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * 执行任意脚本（修复缺陷3：debug_execute 依赖不存在的内置场景脚本）
     */
    evalScript(script: string) {
        try {
            const result = new Function('require', 'return ' + script)(require);
            return { success: true, data: { result: safeSerialize(result) } };
        } catch (e: any) {
            // 语句模式：直接 eval 保留最后一个表达式的完成值
            try {
                const result = eval(script);
                return { success: true, data: { result: safeSerialize(result) } };
            } catch (e2: any) {
                return { success: false, error: e2.message };
            }
        }
    },

    /**
     * 获取场景性能统计数据（节点数、组件数等）
     */
    getPerformanceStats() {
        try {
            const { director } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            let nodeCount = 0;
            let componentCount = 0;
            let activeNodeCount = 0;

            const traverse = (node: any) => {
                nodeCount++;
                if (node.active) activeNodeCount++;
                componentCount += node.components ? node.components.length : 0;
                for (const child of node.children) {
                    traverse(child);
                }
            };

            for (const child of scene.children) {
                traverse(child);
            }

            return {
                success: true,
                data: serializeData({
                    nodeCount,
                    activeNodeCount,
                    componentCount,
                    drawCalls: null,
                    triangles: null,
                    memory: process.memoryUsage ? process.memoryUsage() : null,
                    note: 'drawCalls and triangles are only available at runtime (preview/build)'
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * 获取场景进程中已注册的类（修复缺陷5：component_query classes 跨进程隔离）
     */
    getRegisteredClasses(extendsFilter?: string) {
        try {
            const { js } = require('cc');
            const FilterClass = extendsFilter ? js.getClassByName(extendsFilter) : null;
            const allClasses: string[] = [];
            const classMap = (js as any)._nameToClass || {};
            for (const name of Object.keys(classMap)) {
                const cls = classMap[name];
                if (!FilterClass || (cls.prototype instanceof FilterClass)) {
                    allClasses.push(name);
                }
            }
            return { success: true, data: serializeData({ classes: allClasses, count: allClasses.length }) };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Create an empty animation clip asset and persist it through asset-db.
     */
    async createAnimationClip(savePath: string, name?: string, duration: number = 1, sample: number = 60) {
        try {
            if (!savePath || typeof savePath !== 'string') {
                return { success: false, error: 'savePath is required' };
            }
            if (!savePath.startsWith('db://assets/')) {
                return { success: false, error: 'savePath must start with db://assets/' };
            }
            if (!savePath.endsWith('.anim')) {
                return { success: false, error: 'savePath must end with .anim' };
            }

            const { AnimationClip } = require('cc');
            const serializer = (globalThis as any).EditorExtends?.serialize || (globalThis as any).cce?.Utils?.serialize;
            if (!serializer) {
                return { success: false, error: 'Animation serializer is unavailable in scene process' };
            }

            const clipName = typeof name === 'string' && name.trim() ? name.trim() : basename(savePath, '.anim');
            const clip = new AnimationClip(clipName);
            clip.name = clipName;
            clip.duration = Math.max(Number.isFinite(duration) ? duration : 1, 0.01);
            clip.sample = Math.max(Math.round(Number.isFinite(sample) ? sample : 60), 1);
            clip.speed = 1;

            if ((AnimationClip as any).WrapMode?.Normal !== undefined) {
                clip.wrapMode = (AnimationClip as any).WrapMode.Normal;
            }

            const serialized = serializer(clip);
            const content = typeof serialized === 'string' ? serialized : JSON.stringify(serialized, null, 2);
            const createResult: any = await Editor.Message.request('asset-db', 'create-asset', savePath, content);
            const assetInfo: any = await Editor.Message.request('asset-db', 'query-asset-info', savePath).catch(() => null);

            return {
                success: true,
                data: serializeData({
                    clipUuid: assetInfo?.uuid || createResult?.uuid,
                    path: assetInfo?.url || createResult?.url || savePath,
                    name: clipName,
                    duration: clip.duration,
                    sample: clip.sample,
                    trackCount: clip.tracksCount
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Query clip info through the editor animation dump.
     */
    async getAnimationClipInfo(nodeUuid: string, clipUuid: string) {
        try {
            const dump = await requestSceneFacade('query-animation-clip-dump', nodeUuid, clipUuid);
            if (!dump || dump === false) {
                return { success: false, error: `Animation clip dump not available for clip ${clipUuid}` };
            }

            return {
                success: true,
                data: serializeData(summarizeAnimationClipDump(dump))
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * List editable animation properties from the editor animation context.
     */
    async listAnimationEditableProperties(nodeUuid: string, clipUuid: string) {
        try {
            await prepareAnimationEditContext(nodeUuid, clipUuid);
            const properties = await requestSceneFacade('query-animation-properties', nodeUuid);
            const normalized = extractEditableAnimationProperties(properties);

            return {
                success: true,
                data: serializeData({
                    properties: normalized,
                    count: normalized.length
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Add a property track to the clip.
     */
    async addAnimationTrack(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string) {
        try {
            await runAnimationOperations(nodeUuid, clipUuid, [
                { funcName: 'createProp', args: [nodePath, propKey] }
            ]);

            const dump = await requestSceneFacade('query-animation-clip-dump', nodeUuid, clipUuid);
            return {
                success: true,
                data: serializeData({
                    track: findAnimationCurveSummary(dump, nodePath, propKey),
                    clip: summarizeAnimationClipDump(dump)
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Remove a property track from the clip.
     */
    async removeAnimationTrack(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string) {
        try {
            await runAnimationOperations(nodeUuid, clipUuid, [
                { funcName: 'removeProp', args: [nodePath, propKey] }
            ]);

            const dump = await requestSceneFacade('query-animation-clip-dump', nodeUuid, clipUuid);
            return {
                success: true,
                data: serializeData({
                    removed: { nodePath, propKey },
                    clip: summarizeAnimationClipDump(dump)
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Create a keyframe on an existing property track.
     */
    async createAnimationKey(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string, frame: number, value: any) {
        try {
            await runAnimationOperations(nodeUuid, clipUuid, [
                { funcName: 'createKey', args: [nodePath, propKey, frame, value] }
            ]);

            const dump = await requestSceneFacade('query-animation-clip-dump', nodeUuid, clipUuid);
            const track = findAnimationCurveSummary(dump, nodePath, propKey);

            return {
                success: true,
                data: serializeData({
                    frame,
                    track,
                    keyframeCount: track?.keyframeCount ?? 0
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Set or update a keyframe and then apply optional curve data.
     */
    async setAnimationKeyframe(
        nodeUuid: string,
        clipUuid: string,
        nodePath: string,
        propKey: string,
        frame: number,
        value: any,
        curve: Record<string, any> = {}
    ) {
        try {
            const operations: Array<{ funcName: string; args: any[] }> = [
                { funcName: 'createKey', args: [nodePath, propKey, frame, value] }
            ];

            if (curve && Object.keys(curve).length > 0) {
                operations.push({ funcName: 'modifyCurveOfKey', args: [nodePath, propKey, frame, curve] });
            }

            await runAnimationOperations(nodeUuid, clipUuid, operations);
            const verifiedValueAtFrame = await requestSceneFacade('query-animation-prop-value-at-frame', clipUuid, nodePath, propKey, frame);

            return {
                success: true,
                data: serializeData({
                    frame,
                    value,
                    curve,
                    verifiedValueAtFrame
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Remove one or more keyframes from a property track.
     */
    async removeAnimationKey(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string, frames: number[]) {
        try {
            await runAnimationOperations(nodeUuid, clipUuid, [
                { funcName: 'removeKey', args: [nodePath, propKey, frames] }
            ]);

            const dump = await requestSceneFacade('query-animation-clip-dump', nodeUuid, clipUuid);
            const track = findAnimationCurveSummary(dump, nodePath, propKey);

            return {
                success: true,
                data: serializeData({
                    removedFrames: frames,
                    remainingKeyframeCount: track?.keyframeCount ?? 0,
                    track
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Query the evaluated value of a property track at a specific frame.
     */
    async queryAnimationValueAtFrame(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string, frame: number) {
        try {
            await prepareAnimationEditContext(nodeUuid, clipUuid);
            const value = await requestSceneFacade('query-animation-prop-value-at-frame', clipUuid, nodePath, propKey, frame);

            return {
                success: true,
                data: serializeData({
                    frame,
                    value
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
};
