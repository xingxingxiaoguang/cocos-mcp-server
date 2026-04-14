import { BaseDriver } from '../base-driver';
import { RuntimeProfile } from '../../runtime/profile';
import { safeSerialize } from '../../utils/serializer';
import {
    AnimationAssetRecord,
    AnimationBridgeDriver,
    AnimationClipRefRecord,
    AnimationClipResolveInput,
    AnimationSceneMethodResponse,
} from './contract';

const SCENE_SCRIPT_PACKAGE = 'cocos-mcp-server';

class EditorAnimationDriver extends BaseDriver implements AnimationBridgeDriver {

    async listClipAssets(): Promise<AnimationAssetRecord[]> {
        this.ensureRequestAvailable();
        const results = await this.request<Record<string, unknown>[]>(
            'asset-db', 'query-assets', { pattern: 'db://assets/**/*.anim' },
        );
        const items = Array.isArray(results) ? results : [];
        return items.map((item) => ({
            uuid: String(item.uuid),
            path: String(item.url || item.path || ''),
            name: String(item.name || this.getNameFromPath(String(item.url || item.path || ''))),
            type: item.type != null ? String(item.type) : undefined,
            size: item.fileSize != null ? Number(item.fileSize) : (item.size != null ? Number(item.size) : undefined),
        }));
    }

    async resolveClipRef(input: AnimationClipResolveInput): Promise<AnimationClipRefRecord> {
        this.ensureRequestAvailable();
        const requestedPath = typeof input.path === 'string' ? input.path.trim() : '';
        const requestedUuid = typeof input.clipUuid === 'string' && input.clipUuid.trim()
            ? input.clipUuid.trim()
            : (typeof input.uuid === 'string' ? input.uuid.trim() : '');

        if (requestedPath) {
            const info = await this.request<Record<string, unknown> | null>(
                'asset-db', 'query-asset-info', requestedPath,
            );
            if (!info?.uuid) {
                throw new Error(`Animation clip not found at path: ${requestedPath}`);
            }
            const infoUrl = String(info.url || requestedPath);
            if (!infoUrl.endsWith('.anim')) {
                throw new Error(`Asset is not an animation clip: ${requestedPath}`);
            }
            return {
                clipUuid: String(info.uuid),
                path: infoUrl,
                name: String(info.name || this.getNameFromPath(infoUrl)),
                type: info.type != null ? String(info.type) : undefined,
            };
        }

        const assetPath = await this.request<string | null>('asset-db', 'query-url', requestedUuid);
        if (!assetPath) {
            throw new Error(`Animation clip UUID not found: ${requestedUuid}`);
        }

        const info = await this.request<Record<string, unknown> | null>(
            'asset-db', 'query-asset-info', assetPath,
        );
        if (!info?.uuid) {
            throw new Error(`Failed to resolve animation clip info for UUID: ${requestedUuid}`);
        }
        const infoUrl = String(info.url || assetPath);
        if (!infoUrl.endsWith('.anim')) {
            throw new Error(`Asset is not an animation clip: ${requestedUuid}`);
        }
        return {
            clipUuid: String(info.uuid),
            path: infoUrl,
            name: String(info.name || this.getNameFromPath(infoUrl)),
            type: info.type != null ? String(info.type) : undefined,
        };
    }

    async executeSceneMethod(method: string, args: unknown[]): Promise<AnimationSceneMethodResponse> {
        this.ensureSceneSupport();
        const result = await this.request('scene', 'execute-scene-script', {
            name: SCENE_SCRIPT_PACKAGE,
            method,
            args,
        });

        if (result === undefined || result === null) {
            throw new Error(`Scene method '${method}' returned nothing. Check package.json contributions.scene.methods.`);
        }

        if (typeof result === 'object' && result && 'success' in (result as Record<string, unknown>)) {
            const sceneResult = result as Record<string, unknown>;
            if (!sceneResult.success) {
                throw new Error(typeof sceneResult.error === 'string' ? sceneResult.error : `Scene method '${method}' failed`);
            }
            return {
                data: safeSerialize(sceneResult.data),
                ...(typeof sceneResult.warning === 'string' ? { warning: sceneResult.warning } : {}),
                ...(typeof sceneResult.message === 'string' ? { message: sceneResult.message } : {}),
            };
        }

        return { data: safeSerialize(result) };
    }

    // -------------------------------------------------------------------------

    private ensureSceneSupport(): void {
        this.ensureRequestAvailable();
        if (
            !this.profile.features.animationQueryClip ||
            !this.profile.features.animationPropertyQuery ||
            !this.profile.features.sceneScriptExecute
        ) {
            throw new Error('Runtime profile does not support animation scene methods');
        }
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
