import { JsonValue } from '../../json';

export interface AnimationCapability {
    listClips(): Promise<ListAnimationClipsResult>;
    createClip(input: CreateAnimationClipInput): Promise<AnimationOperationResult>;
    getClipInfo(input: AnimationClipNodeContextInput): Promise<AnimationOperationResult>;
    listEditableProperties(input: AnimationClipNodeContextInput): Promise<AnimationOperationResult>;
    addTrack(input: AnimationTrackInput): Promise<AnimationOperationResult>;
    removeTrack(input: AnimationTrackInput): Promise<AnimationOperationResult>;
    createKey(input: AnimationKeyframeInput): Promise<AnimationOperationResult>;
    setKeyframe(input: AnimationSetKeyframeInput): Promise<AnimationOperationResult>;
    removeKey(input: AnimationRemoveKeyInput): Promise<AnimationOperationResult>;
    queryValueAtFrame(input: AnimationFrameQueryInput): Promise<AnimationOperationResult>;
    saveClip(input: AnimationClipNodeContextInput): Promise<AnimationOperationResult>;
}

export interface AnimationClipSummary {
    uuid: string;
    path: string;
    name: string;
    type?: string;
    size?: number;
}

export interface ResolvedAnimationClipRef {
    clipUuid: string;
    path: string;
    name: string;
    type?: string;
}

export interface ListAnimationClipsResult {
    animations: AnimationClipSummary[];
    count: number;
}

export interface AnimationOperationResult {
    data: JsonValue;
    warning?: string;
    message?: string;
}

export interface CreateAnimationClipInput {
    savePath: string;
    name?: string;
    duration?: number;
    sample?: number;
}

export interface AnimationClipSelector {
    clipUuid?: string;
    uuid?: string;
    path?: string;
}

export interface AnimationClipNodeContextInput extends AnimationClipSelector {
    nodeUuid: string;
}

export interface AnimationTrackInput extends AnimationClipNodeContextInput {
    nodePath: string;
    propKey: string;
}

export interface AnimationKeyframeInput extends AnimationTrackInput {
    frame: number;
    value: unknown;
}

export interface AnimationSetKeyframeInput extends AnimationKeyframeInput {
    curve?: Record<string, unknown>;
}

export interface AnimationRemoveKeyInput extends AnimationTrackInput {
    frames: number[];
}

export interface AnimationFrameQueryInput extends AnimationTrackInput {
    frame: number;
}
