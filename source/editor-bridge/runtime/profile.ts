export interface RuntimeProfile {
    cocosVersion: string;
    features: {
        preferencesSetConfig: boolean;
        preferencesOpenSettings: boolean;
        projectQueryConfig: boolean;
        animationQueryClip: boolean;
        animationPropertyQuery: boolean;
        sceneScriptExecute: boolean;
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
            sceneScriptExecute: hasRequest,
        },
    };
}
