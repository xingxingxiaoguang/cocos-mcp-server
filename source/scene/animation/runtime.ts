import { safeSerialize } from '../../utils/serializer';

/**
 * Cocos Creator 3.8.8 编辑器 scene 进程消息名称常量。
 * 来源：app.asar → builtin/scene/package.json → contributions.messages
 */
export const SCENE_ANIM_MSG = {
    QUERY_CLIP: 'query-animation-clip',
    CHANGE_ROOT: 'change-animation-root',
    RECORD: 'record-animation',
    CHANGE_EDIT_CLIP: 'change-edit-clip',
    OPERATION: 'animation-operation',
    SAVE_CLIP: 'save-clip',
    QUERY_PROPERTIES: 'query-animation-properties',
    QUERY_VALUE_AT_FRAME: 'query-property-value-at-frame',
} as const;

export const PERSIST_WARNING = 'Changes are in memory only. Call animation_clip(action=save) to persist, or save the scene in the editor.';

export function normalizeAnimationType(typeValue: any): string | null {
    if (!typeValue) return null;
    if (typeof typeValue === 'string') return typeValue;
    if (typeof typeValue === 'object') {
        return typeValue.value || typeValue.name || typeValue.type || null;
    }
    return String(typeValue);
}

export function summarizeAnimationCurve(curve: any): any {
    const keyframes = Array.isArray(curve?.keyframes) ? curve.keyframes : [];
    return {
        nodePath: curve?.nodePath || '',
        propKey: curve?.key || curve?.propKey || curve?.name || '',
        keyframeCount: keyframes.length,
        type: normalizeAnimationType(curve?.type || curve?.combinedType),
        displayName: curve?.displayName || curve?.menuName || curve?.name || curve?.key || curve?.propKey || '',
    };
}

export function summarizeAnimationClipDump(dump: any): any {
    const curves = Array.isArray(dump?.curves) ? dump.curves.map((curve: any) => summarizeAnimationCurve(curve)) : [];
    const auxiliaryCurves = dump?.auxiliaryCurves && typeof dump.auxiliaryCurves === 'object'
        ? Object.entries(dump.auxiliaryCurves).map(([name, curve]: [string, any]) => ({
            name,
            displayName: curve?.displayName || name,
            keyframeCount: Array.isArray(curve?.keyframes) ? curve.keyframes.length : 0,
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
        useBakedAnimation: Boolean(dump?.useBakedAnimation),
    };
}

export function findAnimationCurveSummary(dump: any, nodePath: string, propKey: string): any | null {
    const curves = Array.isArray(dump?.curves) ? dump.curves : [];
    const target = curves.find((curve: any) => curve?.nodePath === nodePath && (curve?.key === propKey || curve?.propKey === propKey));
    return target ? summarizeAnimationCurve(target) : null;
}

export function extractEditableAnimationProperties(input: any): any[] {
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
                    raw: safeSerialize(value),
                });
            }
        }

        const childCollections = [
            value.children,
            value.props,
            value.properties,
            value.list,
            value.items,
            value.nodes,
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

export async function requestSceneFacade(method: string, ...args: any[]): Promise<any> {
    return Editor.Message.request('scene', method as any, ...args);
}

export async function prepareAnimationEditContext(nodeUuid: string, clipUuid: string): Promise<void> {
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

export async function runAnimationOperations(nodeUuid: string, clipUuid: string, operations: Array<{ funcName: string; args: any[] }>): Promise<any> {
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

export function getClipFromAssetManager(clipUuid: string): any {
    const { assetManager } = require('cc');
    const clip = assetManager.assets?.get(clipUuid);
    if (!clip) throw new Error(`Clip ${clipUuid} not loaded in assetManager`);
    return clip;
}

export function findTrackInClip(clip: any, nodePath: string, propKey: string): any | null {
    if (!clip.tracks) return null;
    for (const track of clip.tracks) {
        const pathSegs: string[] | undefined = track.path?._paths;
        if (!Array.isArray(pathSegs)) continue;

        const targetSegs: string[] = [];
        if (nodePath) targetSegs.push(...nodePath.split('/').filter((segment: string) => segment));
        targetSegs.push(propKey);

        if (pathSegs.length === targetSegs.length &&
            pathSegs.every((segment: string, index: number) => segment === targetSegs[index])) {
            return track;
        }
    }
    return null;
}

export function buildTrackPath(nodePath: string, propKey: string): any {
    const { animation } = require('cc');
    let trackPath = new animation.TrackPath();
    if (nodePath) {
        for (const segment of nodePath.split('/').filter((item: string) => item)) {
            trackPath = trackPath.toHierarchy(segment);
        }
    }
    trackPath = trackPath.toProperty(propKey);
    return trackPath;
}

const VEC3_PROPS = new Set(['position', 'scale', 'eulerAngles', 'skew', 'anchor', 'anchorPoint']);
const QUAT_PROPS = new Set(['rotation']);

export function engineAddTrack(clip: any, nodePath: string, propKey: string): any {
    const { animation } = require('cc');
    const trackPath = buildTrackPath(nodePath, propKey);

    let track: any;
    if (QUAT_PROPS.has(propKey)) {
        track = new animation.QuatTrack();
        track.path = trackPath;
    } else if (VEC3_PROPS.has(propKey)) {
        track = new animation.VectorTrack();
        track.path = trackPath;
        track.componentsCount = 3;
        for (const channel of track.channels()) {
            channel.curve.assignSorted([], []);
        }
    } else if (animation.RealTrack) {
        track = new animation.RealTrack();
        track.path = trackPath;
    } else {
        track = new animation.VectorTrack();
        track.path = trackPath;
        track.componentsCount = 1;
        for (const channel of track.channels()) {
            channel.curve.assignSorted([], []);
        }
    }
    clip.addTrack(track);
    return track;
}

export function engineRemoveTrack(clip: any, nodePath: string, propKey: string): boolean {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) return false;
    const index = clip.tracks.indexOf(track);
    if (index >= 0) {
        clip.removeTrack(index);
        return true;
    }
    return false;
}

export function getTrackCurves(track: any): any[] {
    if (typeof track.channels === 'function') {
        return track.channels().map((channel: any) => channel.curve);
    }
    if (track.curve) return [track.curve];
    return [];
}

export function readCurveKeyframes(curve: any): { times: number[]; values: any[] } {
    const rawTimes = curve._times;
    const rawValues = curve._values;
    if (!rawTimes || !rawValues) return { times: [], values: [] };
    const times: number[] = Array.from(rawTimes);
    const values: any[] = Array.from(rawValues);
    return { times, values };
}

export function writeCurveKeyframes(curve: any, times: number[], values: any[]): void {
    if (typeof curve.assignSorted === 'function') {
        curve.assignSorted(times, values);
    } else {
        if (Array.isArray(curve._times)) {
            curve._times.length = 0;
            curve._times.push(...times);
        }
        if (Array.isArray(curve._values)) {
            curve._values.length = 0;
            curve._values.push(...values);
        }
    }
}

export function makeKeyframeValue(value: number): any {
    return { value, leftTangent: 0, rightTangent: 0, interpMode: 0 };
}

export function engineSetKeyframe(clip: any, nodePath: string, propKey: string, time: number, value: any): void {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) throw new Error(`Track not found: ${nodePath}/${propKey}`);

    const curves = getTrackCurves(track);
    if (curves.length === 0) throw new Error(`No curves on track: ${nodePath}/${propKey}`);

    const components = typeof value === 'object' && value !== null
        ? [value.x ?? value.r ?? 0, value.y ?? value.g ?? 0, value.z ?? value.b ?? 0, value.w ?? value.a ?? undefined].filter((item) => item !== undefined)
        : [typeof value === 'number' ? value : 0];

    for (let index = 0; index < curves.length; index++) {
        const curve = curves[index];
        const component = index < components.length ? components[index] : 0;
        const { times, values } = readCurveKeyframes(curve);

        const existingIndex = times.findIndex((item: number) => Math.abs(item - time) < 1e-6);
        if (existingIndex >= 0) {
            values[existingIndex] = makeKeyframeValue(component);
        } else {
            let insertIndex = times.findIndex((item: number) => item > time);
            if (insertIndex < 0) insertIndex = times.length;
            times.splice(insertIndex, 0, time);
            values.splice(insertIndex, 0, makeKeyframeValue(component));
        }

        writeCurveKeyframes(curve, times, values);
    }
}

export function engineRemoveKeyframes(clip: any, nodePath: string, propKey: string, timesToRemove: number[]): number {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) return 0;

    const curves = getTrackCurves(track);
    let removed = 0;
    for (const curve of curves) {
        const { times, values } = readCurveKeyframes(curve);
        if (times.length === 0) continue;

        const newTimes: number[] = [];
        const newValues: any[] = [];
        for (let index = 0; index < times.length; index++) {
            const matched = timesToRemove.some((time) => Math.abs(times[index] - time) < 1e-6);
            if (matched) {
                removed++;
            } else {
                newTimes.push(times[index]);
                newValues.push(values[index]);
            }
        }

        writeCurveKeyframes(curve, newTimes, newValues);
    }
    return removed;
}

export function engineQueryValueAtTime(clip: any, nodePath: string, propKey: string, time: number): any {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) return null;

    const curves = getTrackCurves(track);
    const results: number[] = [];
    for (const curve of curves) {
        if (typeof curve.evaluate === 'function') {
            results.push(curve.evaluate(time));
        } else {
            const times: any[] = curve._times || [];
            const values: any[] = curve._values || [];
            if (times.length === 0) {
                results.push(0);
                continue;
            }
            if (time <= times[0]) {
                results.push(typeof values[0]?.value === 'number' ? values[0].value : (values[0] ?? 0));
            } else if (time >= times[times.length - 1]) {
                const last = values[values.length - 1];
                results.push(typeof last?.value === 'number' ? last.value : (last ?? 0));
            } else {
                for (let index = 0; index < times.length - 1; index++) {
                    if (time >= times[index] && time <= times[index + 1]) {
                        const t = (time - times[index]) / (times[index + 1] - times[index]);
                        const value0 = typeof values[index]?.value === 'number' ? values[index].value : (values[index] ?? 0);
                        const value1 = typeof values[index + 1]?.value === 'number' ? values[index + 1].value : (values[index + 1] ?? 0);
                        results.push(value0 + (value1 - value0) * t);
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

export function engineCountTrackKeyframes(clip: any, nodePath: string, propKey: string): number {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) return 0;
    const curves = getTrackCurves(track);
    if (curves.length === 0) return 0;
    const times = curves[0]._times;
    return times ? (Array.isArray(times) ? times.length : (times.length || 0)) : 0;
}

export function engineBuildTrackInfo(clip: any, nodePath: string, propKey: string): any | null {
    const track = findTrackInClip(clip, nodePath, propKey);
    if (!track) return null;
    return {
        nodePath,
        propKey,
        keyframeCount: engineCountTrackKeyframes(clip, nodePath, propKey),
        type: track.constructor?.name || null,
        displayName: propKey,
    };
}

export function getClipSample(clipUuid: string): number {
    try {
        const clip = getClipFromAssetManager(clipUuid);
        return clip.sample || 60;
    } catch {
        return 60;
    }
}

export async function queryClipDump(nodeUuid: string, clipUuid: string): Promise<any> {
    try {
        const dump = await requestSceneFacade(SCENE_ANIM_MSG.QUERY_CLIP, nodeUuid, clipUuid);
        if (dump && dump !== false) return dump;
    } catch {
        // fall through
    }

    return null;
}
