export interface AnimationCapability {
    // Queries
    listClips(): Promise<ListAnimationClipsResult>;
    getClipInfo(input: AnimationClipNodeContextInput): Promise<AnimationClipInfoResult>;
    listEditableProperties(input: AnimationClipNodeContextInput): Promise<AnimationEditablePropertiesResult>;
    queryValueAtFrame(input: AnimationFrameQueryInput): Promise<AnimationFrameValueResult>;

    // Mutations
    createClip(input: CreateAnimationClipInput): Promise<AnimationCreateClipResult>;
    addTrack(input: AnimationTrackInput): Promise<AnimationTrackResult>;
    removeTrack(input: AnimationTrackInput): Promise<AnimationTrackResult>;
    createKey(input: AnimationKeyframeInput): Promise<AnimationKeyframeResult>;
    setKeyframe(input: AnimationSetKeyframeInput): Promise<AnimationKeyframeResult>;
    removeKey(input: AnimationRemoveKeyInput): Promise<AnimationKeyframeResult>;
    saveClip(input: AnimationClipNodeContextInput): Promise<AnimationSaveResult>;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface ListAnimationClipsResult {
    animations: AnimationClipSummary[];
    count: number;
}

export interface AnimationClipInfoResult {
    data: unknown;
    message?: string;
    warning?: string;
}

export interface AnimationEditablePropertiesResult {
    data: unknown;
    message?: string;
    warning?: string;
}

export interface AnimationFrameValueResult {
    data: unknown;
    message?: string;
    warning?: string;
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface AnimationCreateClipResult {
    data: unknown;
    message?: string;
    warning?: string;
}

export interface AnimationTrackResult {
    data: unknown;
    message?: string;
    warning?: string;
}

export interface AnimationKeyframeResult {
    data: unknown;
    message?: string;
    warning?: string;
}

export interface AnimationSaveResult {
    data: unknown;
    message?: string;
    warning?: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

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
