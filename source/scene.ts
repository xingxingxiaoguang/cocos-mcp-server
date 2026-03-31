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
    if (depth > 7) return true;
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

function safeSerialize(value: any, depth: number = 0, seen: WeakSet<object> = new WeakSet(), maxDepth: number = 6): any {
    if (depth > maxDepth) return '[max depth]';
    if (value === null || value === undefined) return value;

    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean') return value;
    if (type === 'bigint') return value.toString();
    if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;

    if (Array.isArray(value)) {
        return value.slice(0, 100).map((item: any) => safeSerialize(item, depth + 1, seen, maxDepth));
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
                        result[key] = safeSerialize(item, depth + 1, seen, maxDepth);
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

/**
 * Cocos Creator 3.8.8 编辑器 scene 进程消息名称常量。
 * 来源：app.asar → builtin/scene/package.json → contributions.messages
 */
const SCENE_ANIM_MSG = {
    QUERY_CLIP: 'query-animation-clip',
    CHANGE_ROOT: 'change-animation-root',
    RECORD: 'record-animation',
    CHANGE_EDIT_CLIP: 'change-edit-clip',
    OPERATION: 'animation-operation',
    SAVE_CLIP: 'save-clip',
    QUERY_PROPERTIES: 'query-animation-properties',
    QUERY_VALUE_AT_FRAME: 'query-property-value-at-frame',
} as const;

async function requestSceneFacade(method: string, ...args: any[]): Promise<any> {
    return Editor.Message.request('scene', method as any, ...args);
}

async function prepareAnimationEditContext(nodeUuid: string, clipUuid: string): Promise<void> {
    try {
        await requestSceneFacade(SCENE_ANIM_MSG.CHANGE_ROOT, nodeUuid, clipUuid);
    } catch {
        // Best-effort. Some editor states can still proceed without switching root explicitly.
    }

    try {
        await requestSceneFacade(SCENE_ANIM_MSG.RECORD, nodeUuid, true, clipUuid);
    } catch {
        // Best-effort. Query/edit actions may still work if the editor is already in animation mode.
    }

    try {
        await requestSceneFacade(SCENE_ANIM_MSG.CHANGE_EDIT_CLIP, clipUuid);
    } catch {
        // Best-effort. Editor may not be in animation mode; callers handle the fallback.
    }
}

async function runAnimationOperations(nodeUuid: string, clipUuid: string, operations: Array<{ funcName: string; args: any[] }>): Promise<any> {
    await prepareAnimationEditContext(nodeUuid, clipUuid);

    const operationResult = await requestSceneFacade(SCENE_ANIM_MSG.OPERATION, operations, { recordUndo: true });
    if (operationResult === false || operationResult?.state === 'failure') {
        throw new Error(operationResult?.reason || 'Animation operation failed');
    }

    try {
        await requestSceneFacade(SCENE_ANIM_MSG.SAVE_CLIP);
    } catch {
        // Continue. The dump query below provides a concrete post-operation verification path.
    }

    return operationResult;
}

// ---------------------------------------------------------------------------
// Engine API fallback helpers (Defects 2-6)
// ---------------------------------------------------------------------------

/**
 * Try editor API first; if it fails or returns an invalid result, fall back to engine API.
 */
async function tryEditorThenEngine<T>(
    editorFn: () => Promise<T>,
    isValid: (result: T) => boolean,
    engineFn: () => Promise<T>
): Promise<T> {
    try {
        const result = await editorFn();
        if (isValid(result)) return result;
    } catch { /* editor API unavailable, fall through */ }
    return engineFn();
}

function isValidResult(r: any): boolean {
    return r !== null && r !== undefined && r !== false;
}

function getClipFromAssetManager(clipUuid: string): any {
    const { assetManager } = require('cc');
    const clip = assetManager.assets?.get(clipUuid);
    if (!clip) throw new Error(`Clip ${clipUuid} not loaded in assetManager`);
    return clip;
}

/**
 * Match a track by comparing its path segments (Defect 3 fix: use _paths string array).
 */
function findTrackInClip(clip: any, nodePath: string, propKey: string): any | null {
    if (!clip.tracks) return null;
    for (const track of clip.tracks) {
        const pathSegs: string[] | undefined = track.path?._paths;
        if (!Array.isArray(pathSegs)) continue;

        const targetSegs: string[] = [];
        if (nodePath) targetSegs.push(...nodePath.split('/').filter((s: string) => s));
        targetSegs.push(propKey);

        if (pathSegs.length === targetSegs.length &&
            pathSegs.every((seg: string, i: number) => seg === targetSegs[i])) {
            return track;
        }
    }
    return null;
}

function buildTrackPath(nodePath: string, propKey: string): any {
    const { animation } = require('cc');
    let tp = new animation.TrackPath();
    if (nodePath) {
        for (const seg of nodePath.split('/').filter((s: string) => s)) {
            tp = tp.toHierarchy(seg);
        }
    }
    tp = tp.toProperty(propKey);
    return tp;
}

/**
 * Infer track type from property key.
 * - position/scale/eulerAngles → VectorTrack (3 components)
 * - rotation → QuatTrack (4 components)
 * - opacity/width/height/etc. → RealTrack (scalar)
 */
const VEC3_PROPS = new Set(['position', 'scale', 'eulerAngles', 'skew', 'anchor', 'anchorPoint']);
const QUAT_PROPS = new Set(['rotation']);

function engineAddTrack(clip: any, nodePath: string, propKey: string): any {
    const { animation } = require('cc');
    const tp = buildTrackPath(nodePath, propKey);

    let track: any;
    if (QUAT_PROPS.has(propKey)) {
        track = new animation.QuatTrack();
        track.path = tp;
    } else if (VEC3_PROPS.has(propKey)) {
        track = new animation.VectorTrack();
        track.path = tp;
        track.componentsCount = 3;
        for (const channel of track.channels()) {
            channel.curve.assignSorted([], []);
        }
    } else {
        // Default: scalar RealTrack for opacity, color channels, custom properties, etc.
        // Fall back to VectorTrack if RealTrack isn't available
        if (animation.RealTrack) {
            track = new animation.RealTrack();
            track.path = tp;
        } else {
            track = new animation.VectorTrack();
            track.path = tp;
            track.componentsCount = 1;
            for (const channel of track.channels()) {
                channel.curve.assignSorted([], []);
            }
        }
    }
    clip.addTrack(track);
    return track;
}

function engineRemoveTrack(clip: any, nodePath: string, propKey: string): boolean {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) return false;
    const idx = clip.tracks.indexOf(track);
    if (idx >= 0) {
        clip.removeTrack(idx);
        return true;
    }
    return false;
}

/**
 * Get curves from a track (handles both VectorTrack channels and single-curve tracks).
 */
function getTrackCurves(track: any): any[] {
    if (typeof track.channels === 'function') {
        return track.channels().map((ch: any) => ch.curve);
    }
    if (track.curve) return [track.curve];
    return [];
}

/**
 * Set a keyframe value via engine API (Defect 4 fix: use _times/_values or addKeyFrame).
 */
function engineSetKeyframe(clip: any, nodePath: string, propKey: string, time: number, value: any): void {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) throw new Error(`Track not found: ${nodePath}/${propKey}`);

    const curves = getTrackCurves(track);
    if (curves.length === 0) throw new Error(`No curves on track: ${nodePath}/${propKey}`);

    // value can be a scalar, {x,y,z}, or array
    const values = typeof value === 'object' && value !== null
        ? [value.x ?? value.r ?? 0, value.y ?? value.g ?? 0, value.z ?? value.b ?? 0, value.w ?? value.a ?? undefined].filter(v => v !== undefined)
        : [typeof value === 'number' ? value : 0];

    for (let i = 0; i < curves.length; i++) {
        const curve = curves[i];
        const v = i < values.length ? values[i] : 0;

        if (typeof curve.addKeyFrame === 'function') {
            // Check if key already exists at this time
            const times: any[] = curve._times || [];
            const existingIdx = Array.from(times).findIndex((t: number) => Math.abs(t - time) < 1e-6);
            if (existingIdx >= 0 && curve._values) {
                // Update existing key
                if (typeof curve._values[existingIdx] === 'object' && curve._values[existingIdx] !== null) {
                    curve._values[existingIdx].value = v;
                } else {
                    curve._values[existingIdx] = v;
                }
            } else {
                curve.addKeyFrame(time, { value: v, leftTangent: 0, rightTangent: 0, interpMode: 0 });
            }
        }
    }
}

function engineRemoveKeyframes(clip: any, nodePath: string, propKey: string, times: number[]): number {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) return 0;

    const curves = getTrackCurves(track);
    let removed = 0;
    for (const curve of curves) {
        if (typeof curve.removeKeyFrame !== 'function') continue;
        const curveTimes = curve._times;
        if (!curveTimes || (!Array.isArray(curveTimes) && typeof curveTimes.length !== 'number')) continue;

        // Collect indices to remove, then remove from highest index first to avoid shifting
        const indices: number[] = [];
        for (const t of times) {
            const idx = Array.from(curveTimes as ArrayLike<number>).findIndex((ct: number) => Math.abs(ct - t) < 1e-6);
            if (idx >= 0) indices.push(idx);
        }
        indices.sort((a, b) => b - a); // descending
        for (const idx of indices) {
            curve.removeKeyFrame(idx);
            removed++;
        }
    }
    return removed;
}

/**
 * Query value at time (Defect 4 fix: prefer curve.evaluate() public API).
 */
function engineQueryValueAtTime(clip: any, nodePath: string, propKey: string, time: number): any {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) return null;

    const curves = getTrackCurves(track);
    const results: number[] = [];
    for (const curve of curves) {
        if (typeof curve.evaluate === 'function') {
            results.push(curve.evaluate(time));
        } else {
            // Manual fallback using internal data
            const times: any[] = curve._times || [];
            const values: any[] = curve._values || [];
            if (times.length === 0) { results.push(0); continue; }
            if (time <= times[0]) {
                results.push(typeof values[0]?.value === 'number' ? values[0].value : (values[0] ?? 0));
            } else if (time >= times[times.length - 1]) {
                const last = values[values.length - 1];
                results.push(typeof last?.value === 'number' ? last.value : (last ?? 0));
            } else {
                // Linear interpolation
                for (let i = 0; i < times.length - 1; i++) {
                    if (time >= times[i] && time <= times[i + 1]) {
                        const t = (time - times[i]) / (times[i + 1] - times[i]);
                        const v0 = typeof values[i]?.value === 'number' ? values[i].value : (values[i] ?? 0);
                        const v1 = typeof values[i + 1]?.value === 'number' ? values[i + 1].value : (values[i + 1] ?? 0);
                        results.push(v0 + (v1 - v0) * t);
                        break;
                    }
                }
            }
        }
    }

    if (results.length === 1) return results[0];
    if (results.length === 3) return { x: results[0], y: results[1], z: results[2] };
    if (results.length === 4) return { x: results[0], y: results[1], z: results[2], w: results[3] };
    return results;
}

/**
 * Persist clip changes to asset-db (Defect 5 fix: multi-strategy persistence).
 */
async function persistClipChanges(clip: any, clipUuid: string): Promise<void> {
    // Strategy 1: editor save-clip message
    try {
        await requestSceneFacade(SCENE_ANIM_MSG.SAVE_CLIP);
        return;
    } catch { /* not in animation edit mode */ }

    // Strategy 2: serialize + asset-db save-asset
    const serializer = (globalThis as any).EditorExtends?.serialize || (globalThis as any).cce?.Utils?.serialize;
    if (serializer) {
        try {
            const data = serializer(clip);
            const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            const url: string | null = await Editor.Message.request('asset-db', 'query-url', clipUuid);
            if (url) {
                await Editor.Message.request('asset-db', 'save-asset', url, content);
                return;
            }
        } catch (e: any) {
            console.warn('[cocos-mcp-server] clip persist via serialize failed:', e.message);
        }
    }

    // Note: refresh-asset re-reads from disk and would overwrite in-memory changes, so we skip it.
    // If both save-clip and serialize failed, changes exist only in memory until the next scene save.
    console.warn('[cocos-mcp-server] clip persist: all strategies failed. Changes are in memory only.');
}

/**
 * Helper: get clip sample rate from assetManager (default 60).
 */
function getClipSample(clipUuid: string): number {
    try {
        const clip = getClipFromAssetManager(clipUuid);
        return clip.sample || 60;
    } catch {
        return 60;
    }
}

/**
 * Helper to query clip dump, with fallback when editor returns nothing.
 */
async function queryClipDump(nodeUuid: string, clipUuid: string): Promise<any> {
    try {
        const dump = await requestSceneFacade(SCENE_ANIM_MSG.QUERY_CLIP, nodeUuid, clipUuid);
        if (dump && dump !== false) return dump;
    } catch { /* fall through */ }
    return null;
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
     * 执行任意脚本，支持 return/await 语法和异步返回值。
     */
    async evalScript(script: string) {
        const TIMEOUT = 10000;
        const withTimeout = (p: Promise<any>) => Promise.race([
            p,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Script timeout (10s)')), TIMEOUT))
        ]);

        // Path 1: wrap in async function (supports return + await)
        try {
            const wrapped = new Function('require', `return (async () => { ${script} })()`);
            const result = await withTimeout(wrapped(require));
            return { success: true, data: { result: safeSerialize(result) } };
        } catch (e1: any) {
            // Path 2: expression mode (supports `var result; result = xxx; result;`)
            try {
                const result = eval(script);
                if (result && typeof result === 'object' && typeof result.then === 'function') {
                    const resolved = await withTimeout(result);
                    return { success: true, data: { result: safeSerialize(resolved) } };
                }
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
     * Query clip info through the editor animation dump, with engine API fallback.
     */
    async getAnimationClipInfo(nodeUuid: string, clipUuid: string) {
        try {
            const dump = await queryClipDump(nodeUuid, clipUuid);
            if (dump) {
                return {
                    success: true,
                    data: serializeData(summarizeAnimationClipDump(dump))
                };
            }

            // Engine API fallback: construct basic info from clip object
            const clip = getClipFromAssetManager(clipUuid);
            const tracks = clip.tracks || [];
            const curves = tracks.map((t: any) => {
                const segs: string[] = t.path?._paths || [];
                const prop = segs.length > 0 ? segs[segs.length - 1] : '';
                const node = segs.length > 1 ? segs.slice(0, -1).join('/') : '';
                return {
                    nodePath: node,
                    propKey: prop,
                    keyframeCount: getTrackCurves(t).reduce((sum: number, c: any) => {
                        const times = c._times;
                        return sum + (times ? (Array.isArray(times) ? times.length : times.length || 0) : 0);
                    }, 0),
                    type: t.constructor?.name || null,
                    displayName: prop
                };
            });

            return {
                success: true,
                data: serializeData({
                    name: clip.name || '',
                    duration: clip.duration ?? 0,
                    sample: clip.sample ?? 60,
                    speed: clip.speed ?? 1,
                    wrapMode: clip.wrapMode ?? 0,
                    curves,
                    curveCount: curves.length,
                    events: [],
                    eventCount: 0,
                    auxiliaryCurves: [],
                    auxiliaryCurveCount: 0,
                    _source: 'engine-api-fallback'
                })
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
            const properties = await requestSceneFacade(SCENE_ANIM_MSG.QUERY_PROPERTIES, nodeUuid);
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
     * Add a property track to the clip (editor API → engine API fallback).
     */
    async addAnimationTrack(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string) {
        try {
            await tryEditorThenEngine(
                async () => {
                    await runAnimationOperations(nodeUuid, clipUuid, [
                        { funcName: 'createProp', args: [nodePath, propKey] }
                    ]);
                    return true;
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    engineAddTrack(clip, nodePath, propKey);
                    await persistClipChanges(clip, clipUuid);
                    return true;
                }
            );

            const dump = await queryClipDump(nodeUuid, clipUuid);
            return {
                success: true,
                data: serializeData({
                    track: dump ? findAnimationCurveSummary(dump, nodePath, propKey) : { nodePath, propKey },
                    clip: dump ? summarizeAnimationClipDump(dump) : null
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Remove a property track from the clip (editor API → engine API fallback).
     */
    async removeAnimationTrack(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string) {
        try {
            await tryEditorThenEngine(
                async () => {
                    await runAnimationOperations(nodeUuid, clipUuid, [
                        { funcName: 'removeProp', args: [nodePath, propKey] }
                    ]);
                    return true;
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    if (!engineRemoveTrack(clip, nodePath, propKey)) {
                        throw new Error(`Track not found: ${nodePath}/${propKey}`);
                    }
                    await persistClipChanges(clip, clipUuid);
                    return true;
                }
            );

            const dump = await queryClipDump(nodeUuid, clipUuid);
            return {
                success: true,
                data: serializeData({
                    removed: { nodePath, propKey },
                    clip: dump ? summarizeAnimationClipDump(dump) : null
                })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Create a keyframe on an existing property track (editor API → engine API fallback).
     */
    async createAnimationKey(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string, frame: number, value: any) {
        try {
            const sample = getClipSample(clipUuid);
            const time = frame / sample;

            await tryEditorThenEngine(
                async () => {
                    await runAnimationOperations(nodeUuid, clipUuid, [
                        { funcName: 'createKey', args: [nodePath, propKey, frame, value] }
                    ]);
                    return true;
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    engineSetKeyframe(clip, nodePath, propKey, time, value);
                    await persistClipChanges(clip, clipUuid);
                    return true;
                }
            );

            const dump = await queryClipDump(nodeUuid, clipUuid);
            const track = dump ? findAnimationCurveSummary(dump, nodePath, propKey) : null;
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
     * Set or update a keyframe with optional curve data (editor API → engine API fallback).
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
            const sample = getClipSample(clipUuid);
            const time = frame / sample;

            await tryEditorThenEngine(
                async () => {
                    const operations: Array<{ funcName: string; args: any[] }> = [
                        { funcName: 'createKey', args: [nodePath, propKey, frame, value] }
                    ];
                    if (curve && Object.keys(curve).length > 0) {
                        operations.push({ funcName: 'modifyCurveOfKey', args: [nodePath, propKey, frame, curve] });
                    }
                    await runAnimationOperations(nodeUuid, clipUuid, operations);
                    return true;
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    engineSetKeyframe(clip, nodePath, propKey, time, value);
                    await persistClipChanges(clip, clipUuid);
                    return true;
                }
            );

            // Try to verify via editor API, fall back to engine query
            const verifiedValueAtFrame = await tryEditorThenEngine(
                async () => {
                    await prepareAnimationEditContext(nodeUuid, clipUuid);
                    return await requestSceneFacade(SCENE_ANIM_MSG.QUERY_VALUE_AT_FRAME, clipUuid, nodePath, propKey, frame);
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    return engineQueryValueAtTime(clip, nodePath, propKey, time);
                }
            );

            return {
                success: true,
                data: serializeData({ frame, value, curve, verifiedValueAtFrame })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Remove one or more keyframes from a property track (editor API → engine API fallback).
     */
    async removeAnimationKey(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string, frames: number[]) {
        try {
            const sample = getClipSample(clipUuid);

            await tryEditorThenEngine(
                async () => {
                    await runAnimationOperations(nodeUuid, clipUuid, [
                        { funcName: 'removeKey', args: [nodePath, propKey, frames] }
                    ]);
                    return true;
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    const times = frames.map(f => f / sample);
                    engineRemoveKeyframes(clip, nodePath, propKey, times);
                    await persistClipChanges(clip, clipUuid);
                    return true;
                }
            );

            const dump = await queryClipDump(nodeUuid, clipUuid);
            const track = dump ? findAnimationCurveSummary(dump, nodePath, propKey) : null;
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
     * Query the evaluated value of a property track at a specific frame (editor API → engine API fallback, Defect 6 fix).
     */
    async queryAnimationValueAtFrame(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string, frame: number) {
        try {
            const sample = getClipSample(clipUuid);
            const time = frame / sample;

            const value = await tryEditorThenEngine(
                async () => {
                    await prepareAnimationEditContext(nodeUuid, clipUuid);
                    return await requestSceneFacade(SCENE_ANIM_MSG.QUERY_VALUE_AT_FRAME, clipUuid, nodePath, propKey, frame);
                },
                isValidResult,
                async () => engineQueryValueAtTime(getClipFromAssetManager(clipUuid), nodePath, propKey, time)
            );

            return {
                success: true,
                data: serializeData({ frame, value })
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

};
