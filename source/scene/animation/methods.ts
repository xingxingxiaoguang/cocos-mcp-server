import { basename } from 'path';
import { safeSerialize } from '../../utils/serializer';
import {
    engineAddTrack,
    engineBuildTrackInfo,
    engineCountTrackKeyframes,
    engineQueryValueAtTime,
    engineRemoveKeyframes,
    engineRemoveTrack,
    engineSetKeyframe,
    extractEditableAnimationProperties,
    getClipFromAssetManager,
    getClipSample,
    getTrackCurves,
    PERSIST_WARNING,
    prepareAnimationEditContext,
    queryClipDump,
    requestSceneFacade,
    runAnimationOperations,
    SCENE_ANIM_MSG,
    summarizeAnimationClipDump,
} from './runtime';
import { isValidResult, tryEditorThenEngine } from './fallback';

export const animationMethods: Record<string, (...args: any[]) => any> = {
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
                data: safeSerialize({
                    clipUuid: assetInfo?.uuid || createResult?.uuid,
                    path: assetInfo?.url || createResult?.url || savePath,
                    name: clipName,
                    duration: clip.duration,
                    sample: clip.sample,
                    trackCount: clip.tracksCount,
                }),
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    async getAnimationClipInfo(nodeUuid: string, clipUuid: string) {
        try {
            const dump = await queryClipDump(nodeUuid, clipUuid);
            if (dump) {
                return {
                    success: true,
                    data: safeSerialize(summarizeAnimationClipDump(dump)),
                };
            }

            const clip = getClipFromAssetManager(clipUuid);
            const tracks = clip.tracks || [];
            const curves = tracks.map((track: any) => {
                const segments: string[] = track.path?._paths || [];
                const propKey = segments.length > 0 ? segments[segments.length - 1] : '';
                const nodePath = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
                return {
                    nodePath,
                    propKey,
                    keyframeCount: getTrackCurves(track).reduce((sum: number, curve: any) => {
                        const times = curve._times;
                        return sum + (times ? (Array.isArray(times) ? times.length : times.length || 0) : 0);
                    }, 0),
                    type: track.constructor?.name || null,
                    displayName: propKey,
                };
            });

            return {
                success: true,
                data: safeSerialize({
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
                    _source: 'engine-api-fallback',
                }),
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    async listAnimationEditableProperties(nodeUuid: string, clipUuid: string) {
        try {
            await prepareAnimationEditContext(nodeUuid, clipUuid);
            const properties = await requestSceneFacade(SCENE_ANIM_MSG.QUERY_PROPERTIES, nodeUuid);
            const normalized = extractEditableAnimationProperties(properties);

            return {
                success: true,
                data: safeSerialize({
                    properties: normalized,
                    count: normalized.length,
                }),
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    async addAnimationTrack(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string) {
        try {
            let usedEngine = false;

            await tryEditorThenEngine(
                async () => {
                    await runAnimationOperations(nodeUuid, clipUuid, [
                        { funcName: 'createProp', args: [nodePath, propKey] },
                    ]);
                    return true;
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    engineAddTrack(clip, nodePath, propKey);
                    usedEngine = true;
                    return true;
                },
            );

            const clip = getClipFromAssetManager(clipUuid);
            const trackInfo = engineBuildTrackInfo(clip, nodePath, propKey) || { nodePath, propKey };

            const result: any = {
                success: true,
                data: safeSerialize({ track: trackInfo }),
            };
            if (usedEngine) result.warning = PERSIST_WARNING;
            return result;
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    async removeAnimationTrack(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string) {
        try {
            let usedEngine = false;

            await tryEditorThenEngine(
                async () => {
                    await runAnimationOperations(nodeUuid, clipUuid, [
                        { funcName: 'removeProp', args: [nodePath, propKey] },
                    ]);
                    return true;
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    if (!engineRemoveTrack(clip, nodePath, propKey)) {
                        throw new Error(`Track not found: ${nodePath}/${propKey}`);
                    }
                    usedEngine = true;
                    return true;
                },
            );

            const result: any = {
                success: true,
                data: safeSerialize({ removed: { nodePath, propKey } }),
            };
            if (usedEngine) result.warning = PERSIST_WARNING;
            return result;
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    async createAnimationKey(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string, frame: number, value: any) {
        try {
            const sample = getClipSample(clipUuid);
            const time = frame / sample;
            let usedEngine = false;

            await tryEditorThenEngine(
                async () => {
                    await runAnimationOperations(nodeUuid, clipUuid, [
                        { funcName: 'createKey', args: [nodePath, propKey, frame, value] },
                    ]);
                    return true;
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    engineSetKeyframe(clip, nodePath, propKey, time, value);
                    usedEngine = true;
                    return true;
                },
            );

            const clip = getClipFromAssetManager(clipUuid);
            const verifiedValue = engineQueryValueAtTime(clip, nodePath, propKey, time);
            const keyframeCount = engineCountTrackKeyframes(clip, nodePath, propKey);

            const result: any = {
                success: true,
                data: safeSerialize({ frame, value: verifiedValue, keyframeCount }),
            };
            if (usedEngine) result.warning = PERSIST_WARNING;
            return result;
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    async setAnimationKeyframe(
        nodeUuid: string,
        clipUuid: string,
        nodePath: string,
        propKey: string,
        frame: number,
        value: any,
        curve: Record<string, any> = {},
    ) {
        try {
            const sample = getClipSample(clipUuid);
            const time = frame / sample;
            let usedEngine = false;

            await tryEditorThenEngine(
                async () => {
                    const operations: Array<{ funcName: string; args: any[] }> = [
                        { funcName: 'createKey', args: [nodePath, propKey, frame, value] },
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
                    usedEngine = true;
                    return true;
                },
            );

            const clip = getClipFromAssetManager(clipUuid);
            const verifiedValueAtFrame = engineQueryValueAtTime(clip, nodePath, propKey, time);

            const result: any = {
                success: true,
                data: safeSerialize({ frame, value, curve, verifiedValueAtFrame }),
            };
            if (usedEngine) result.warning = PERSIST_WARNING;
            return result;
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    async removeAnimationKey(nodeUuid: string, clipUuid: string, nodePath: string, propKey: string, frames: number[]) {
        try {
            const sample = getClipSample(clipUuid);
            let usedEngine = false;

            await tryEditorThenEngine(
                async () => {
                    await runAnimationOperations(nodeUuid, clipUuid, [
                        { funcName: 'removeKey', args: [nodePath, propKey, frames] },
                    ]);
                    return true;
                },
                isValidResult,
                async () => {
                    const clip = getClipFromAssetManager(clipUuid);
                    const times = frames.map((frameValue) => frameValue / sample);
                    engineRemoveKeyframes(clip, nodePath, propKey, times);
                    usedEngine = true;
                    return true;
                },
            );

            const clip = getClipFromAssetManager(clipUuid);
            const track = engineBuildTrackInfo(clip, nodePath, propKey);
            const remainingKeyframeCount = track?.keyframeCount ?? 0;

            const result: any = {
                success: true,
                data: safeSerialize({ removedFrames: frames, remainingKeyframeCount, track }),
            };
            if (usedEngine) result.warning = PERSIST_WARNING;
            return result;
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

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
                async () => engineQueryValueAtTime(getClipFromAssetManager(clipUuid), nodePath, propKey, time),
            );

            return {
                success: true,
                data: safeSerialize({ frame, value }),
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    async saveAnimationClip(nodeUuid: string, clipUuid: string) {
        try {
            try {
                await prepareAnimationEditContext(nodeUuid, clipUuid);
                await requestSceneFacade(SCENE_ANIM_MSG.SAVE_CLIP);
                return { success: true, data: safeSerialize({ persisted: true, method: 'editor-save-clip' }) };
            } catch {
                // not in animation edit mode
            }

            const serializer = (globalThis as any).EditorExtends?.serialize || (globalThis as any).cce?.Utils?.serialize;
            if (!serializer) {
                return {
                    success: false,
                    error: 'Serializer unavailable. Save the scene manually in the editor to persist changes.',
                };
            }

            const clip = getClipFromAssetManager(clipUuid);
            const data = serializer(clip);
            const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            const url = await Editor.Message.request('asset-db', 'query-url', clipUuid) as string | null;
            if (!url) {
                return { success: false, error: `Cannot resolve asset URL for clip ${clipUuid}` };
            }

            await Editor.Message.request('asset-db', 'save-asset', url, content);
            return { success: true, data: safeSerialize({ persisted: true, method: 'serialize-save-asset', url }) };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
};
