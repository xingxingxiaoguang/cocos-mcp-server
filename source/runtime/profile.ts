export interface RuntimeProfile {
    cocosVersion: string;
    features: {
        preferencesSetConfig: boolean;
        preferencesOpenSettings: boolean;
        projectQueryConfig: boolean;
        animationQueryClip: boolean;
        animationPropertyQuery: boolean;
        sceneQueryNodeTree: boolean;
        sceneQueryState: boolean;
        sceneLifecycle: boolean;
        sceneManage: boolean;
        sceneScriptExecute: boolean;
        assetQueryAssets: boolean;
        assetQueryUuid: boolean;
        assetCreateAsset: boolean;
    };
}

export function createRuntimeProfile(editor: any = (globalThis as any).Editor): RuntimeProfile {
    const request = editor?.Message?.request;
    const hasRequest = typeof request === 'function';

    return {
        cocosVersion: String(editor?.versions?.cocos || 'Unknown'),
        features: {
            preferencesSetConfig: hasRequest,
            preferencesOpenSettings: hasRequest,
            projectQueryConfig: hasRequest,
            animationQueryClip: hasRequest,
            animationPropertyQuery: hasRequest,
            sceneQueryNodeTree: hasRequest,
            sceneQueryState: hasRequest,
            sceneLifecycle: hasRequest,
            sceneManage: hasRequest,
            sceneScriptExecute: hasRequest,
            assetQueryAssets: hasRequest,
            assetQueryUuid: hasRequest,
            assetCreateAsset: hasRequest,
        },
    };
}
