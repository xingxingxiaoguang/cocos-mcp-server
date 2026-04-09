import { RuntimeProfile } from '../../runtime/profile';
import {
    AnimationAssetRecord,
    AnimationBridgeDriver,
    AnimationClipRefRecord,
    AnimationClipResolveInput,
    AnimationSceneMethodResult,
} from './contract';

const ASSET_DB_CHANNEL = 'asset-db';
const SCENE_CHANNEL = 'scene';
const SCENE_SCRIPT_PACKAGE = 'cocos-mcp-server';

class EditorAnimationDriver implements AnimationBridgeDriver {
    constructor(private readonly profile: RuntimeProfile) {}

    async listClipAssets(): Promise<AnimationAssetRecord[]> {
        this.ensureRequestAvailable();
        const request = this.getRequest();
        const results = await request(ASSET_DB_CHANNEL, 'query-assets', {
            pattern: 'db://assets/**/*.anim',
        }) as any[];

        return (Array.isArray(results) ? results : []).map((item: any) => ({
            uuid: String(item.uuid),
            path: String(item.url || item.path || ''),
            name: String(item.name || this.getNameFromPath(item.url || item.path || '')),
            type: item.type,
            size: item.fileSize ?? item.size,
        }));
    }

    async resolveClipRef(input: AnimationClipResolveInput): Promise<AnimationClipRefRecord> {
        this.ensureRequestAvailable();
        const request = this.getRequest();
        const requestedPath = typeof input.path === 'string' ? input.path.trim() : '';
        const requestedUuid = typeof input.clipUuid === 'string' && input.clipUuid.trim()
            ? input.clipUuid.trim()
            : (typeof input.uuid === 'string' ? input.uuid.trim() : '');

        if (requestedPath) {
            const info: any = await request(ASSET_DB_CHANNEL, 'query-asset-info', requestedPath);
            if (!info?.uuid) {
                throw new Error(`Animation clip not found at path: ${requestedPath}`);
            }
            if (!String(info.url || requestedPath).endsWith('.anim')) {
                throw new Error(`Asset is not an animation clip: ${requestedPath}`);
            }

            return {
                clipUuid: info.uuid,
                path: info.url || requestedPath,
                name: info.name || this.getNameFromPath(info.url || requestedPath),
                type: info.type,
            };
        }

        const assetPath = await request(ASSET_DB_CHANNEL, 'query-url', requestedUuid) as string | null;
        if (!assetPath) {
            throw new Error(`Animation clip UUID not found: ${requestedUuid}`);
        }

        const info: any = await request(ASSET_DB_CHANNEL, 'query-asset-info', assetPath);
        if (!info?.uuid) {
            throw new Error(`Failed to resolve animation clip info for UUID: ${requestedUuid}`);
        }
        if (!String(info.url || assetPath).endsWith('.anim')) {
            throw new Error(`Asset is not an animation clip: ${requestedUuid}`);
        }

        return {
            clipUuid: info.uuid,
            path: info.url || assetPath,
            name: info.name || this.getNameFromPath(info.url || assetPath),
            type: info.type,
        };
    }

    async executeSceneMethod(method: string, args: unknown[]): Promise<AnimationSceneMethodResult> {
        this.ensureSceneSupport();
        const request = this.getRequest();
        const result = await request(SCENE_CHANNEL, 'execute-scene-script', {
            name: SCENE_SCRIPT_PACKAGE,
            method,
            args,
        });

        if (result === undefined || result === null) {
            return {
                success: false,
                error: `Scene method '${method}' returned nothing. Check package.json contributions.scene.methods.`,
            };
        }

        if (typeof result === 'object' && result && 'success' in (result as Record<string, unknown>)) {
            const sceneResult = result as Record<string, unknown>;
            return {
                success: Boolean(sceneResult.success),
                data: sceneResult.data,
                message: typeof sceneResult.message === 'string' ? sceneResult.message : undefined,
                warning: typeof sceneResult.warning === 'string' ? sceneResult.warning : undefined,
                error: typeof sceneResult.error === 'string' ? sceneResult.error : undefined,
            };
        }

        return {
            success: true,
            data: result,
        };
    }

    private ensureSceneSupport(): void {
        this.ensureRequestAvailable();
        if (!this.profile.features.animationQueryClip || !this.profile.features.animationPropertyQuery || !this.profile.features.sceneScriptExecute) {
            throw new Error('Runtime profile does not support animation scene methods');
        }
    }

    private ensureRequestAvailable(): void {
        const request = (globalThis as any).Editor?.Message?.request;
        if (typeof request !== 'function') {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }

    private getRequest(): (channel: string, message: string, ...args: unknown[]) => Promise<unknown> {
        return (globalThis as any).Editor.Message.request as (
            channel: string,
            message: string,
            ...args: unknown[]
        ) => Promise<unknown>;
    }

    private getNameFromPath(assetPath: string): string {
        const normalized = String(assetPath || '').replace(/\\/g, '/');
        const baseName = normalized.split('/').pop() || normalized;
        return baseName.replace(/\.anim$/i, '');
    }
}

export function createAnimationDriver(profile: RuntimeProfile): AnimationBridgeDriver {
    return new EditorAnimationDriver(profile);
}
