import { ResolvedAnimationClipRef } from '../../capabilities/animation/interface';

export interface AnimationAssetRecord {
    uuid: string;
    path: string;
    name: string;
    type?: string;
    size?: number;
}

export interface AnimationClipResolveInput {
    clipUuid?: string;
    uuid?: string;
    path?: string;
}

export interface AnimationSceneMethodResult {
    success: boolean;
    data?: unknown;
    message?: string;
    warning?: string;
    error?: string;
}

export interface AnimationBridgeDriver {
    listClipAssets(): Promise<AnimationAssetRecord[]>;
    resolveClipRef(input: AnimationClipResolveInput): Promise<ResolvedAnimationClipRef>;
    executeSceneMethod(method: string, args: unknown[]): Promise<AnimationSceneMethodResult>;
}
