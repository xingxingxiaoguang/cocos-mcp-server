import {
    AnimationBridgeDriver,
    AnimationClipRefRecord,
} from '../../drivers/animation/contract';
import {
    AnimationCapability,
    AnimationClipInfoResult,
    AnimationClipNodeContextInput,
    AnimationClipSelector,
    AnimationCreateClipResult,
    AnimationEditablePropertiesResult,
    AnimationFrameQueryInput,
    AnimationFrameValueResult,
    AnimationKeyframeInput,
    AnimationKeyframeResult,
    AnimationRemoveKeyInput,
    AnimationSaveResult,
    AnimationSetKeyframeInput,
    AnimationTrackInput,
    AnimationTrackResult,
    CreateAnimationClipInput,
    ListAnimationClipsResult,
    ResolvedAnimationClipRef,
} from './interface';

export class AnimationService implements AnimationCapability {
    constructor(private readonly driver: AnimationBridgeDriver) {}

    async listClips(): Promise<ListAnimationClipsResult> {
        const animations = await this.driver.listClipAssets();
        return {
            animations: animations.map((item) => ({
                uuid: item.uuid,
                path: item.path,
                name: item.name,
                type: item.type,
                size: item.size,
            })),
            count: animations.length,
        };
    }

    async createClip(input: CreateAnimationClipInput): Promise<AnimationCreateClipResult> {
        return this.executeSceneMethod('createAnimationClip', [
            input.savePath,
            input.name,
            typeof input.duration === 'number' ? input.duration : 1,
            typeof input.sample === 'number' ? input.sample : 60,
        ]);
    }

    async getClipInfo(input: AnimationClipNodeContextInput): Promise<AnimationClipInfoResult> {
        const clip = await this.resolveClip(input);
        return this.executeSceneMethod('getAnimationClipInfo', [input.nodeUuid, clip.clipUuid]);
    }

    async listEditableProperties(input: AnimationClipNodeContextInput): Promise<AnimationEditablePropertiesResult> {
        const clip = await this.resolveClip(input);
        return this.executeSceneMethod('listAnimationEditableProperties', [input.nodeUuid, clip.clipUuid]);
    }

    async addTrack(input: AnimationTrackInput): Promise<AnimationTrackResult> {
        const clip = await this.resolveClip(input);
        return this.executeSceneMethod('addAnimationTrack', [
            input.nodeUuid,
            clip.clipUuid,
            input.nodePath,
            input.propKey,
        ]);
    }

    async removeTrack(input: AnimationTrackInput): Promise<AnimationTrackResult> {
        const clip = await this.resolveClip(input);
        return this.executeSceneMethod('removeAnimationTrack', [
            input.nodeUuid,
            clip.clipUuid,
            input.nodePath,
            input.propKey,
        ]);
    }

    async createKey(input: AnimationKeyframeInput): Promise<AnimationKeyframeResult> {
        const clip = await this.resolveClip(input);
        return this.executeSceneMethod('createAnimationKey', [
            input.nodeUuid,
            clip.clipUuid,
            input.nodePath,
            input.propKey,
            input.frame,
            input.value,
        ]);
    }

    async setKeyframe(input: AnimationSetKeyframeInput): Promise<AnimationKeyframeResult> {
        const clip = await this.resolveClip(input);
        return this.executeSceneMethod('setAnimationKeyframe', [
            input.nodeUuid,
            clip.clipUuid,
            input.nodePath,
            input.propKey,
            input.frame,
            input.value,
            input.curve || {},
        ]);
    }

    async removeKey(input: AnimationRemoveKeyInput): Promise<AnimationKeyframeResult> {
        const clip = await this.resolveClip(input);
        return this.executeSceneMethod('removeAnimationKey', [
            input.nodeUuid,
            clip.clipUuid,
            input.nodePath,
            input.propKey,
            input.frames,
        ]);
    }

    async queryValueAtFrame(input: AnimationFrameQueryInput): Promise<AnimationFrameValueResult> {
        const clip = await this.resolveClip(input);
        return this.executeSceneMethod('queryAnimationValueAtFrame', [
            input.nodeUuid,
            clip.clipUuid,
            input.nodePath,
            input.propKey,
            input.frame,
        ]);
    }

    async saveClip(input: AnimationClipNodeContextInput): Promise<AnimationSaveResult> {
        const clip = await this.resolveClip(input);
        return this.executeSceneMethod('saveAnimationClip', [input.nodeUuid, clip.clipUuid]);
    }

    private async resolveClip(input: AnimationClipSelector): Promise<ResolvedAnimationClipRef> {
        const hasClipRef = Boolean(
            (typeof input.clipUuid === 'string' && input.clipUuid.trim())
            || (typeof input.uuid === 'string' && input.uuid.trim())
            || (typeof input.path === 'string' && input.path.trim()),
        );

        if (!hasClipRef) {
            throw new Error('Provide clipUuid, uuid, or path to identify the animation clip');
        }

        const resolved = await this.driver.resolveClipRef({
            clipUuid: input.clipUuid,
            uuid: input.uuid,
            path: input.path,
        });

        return this.mapResolvedClip(resolved);
    }

    private async executeSceneMethod(method: string, args: unknown[]): Promise<{ data: unknown; message?: string; warning?: string }> {
        const result = await this.driver.executeSceneMethod(method, args);
        return {
            data: result.data,
            ...(result.message ? { message: result.message } : {}),
            ...(result.warning ? { warning: result.warning } : {}),
        };
    }

    private mapResolvedClip(record: AnimationClipRefRecord): ResolvedAnimationClipRef {
        return {
            clipUuid: record.clipUuid,
            path: record.path,
            name: record.name,
            type: record.type,
        };
    }
}
