import { ToolDefinition, ToolExecutor, ToolResponse } from '../../types';

type AnimationClipAction =
    | 'list'
    | 'create'
    | 'get_info'
    | 'list_editable_properties'
    | 'add_track'
    | 'remove_track'
    | 'create_key'
    | 'set_keyframe'
    | 'remove_key'
    | 'query_value_at_frame'
    | 'save';

interface ResolvedClipRef {
    clipUuid: string;
    path: string;
    name: string;
    type?: string;
}

export class AnimationToolsV2 implements ToolExecutor {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'clip',
                description: 'Manage animation clip assets. action=list: list .anim assets. action=create: create an empty clip. action=get_info/list_editable_properties/add_track/remove_track/create_key/set_keyframe/remove_key/query_value_at_frame: query or edit a clip through the scene animation editor context. action=save: persist in-memory changes to disk (call after finishing edits).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: [
                                'list',
                                'create',
                                'get_info',
                                'list_editable_properties',
                                'add_track',
                                'remove_track',
                                'create_key',
                                'set_keyframe',
                                'remove_key',
                                'query_value_at_frame',
                                'save'
                            ],
                            description: 'Animation clip action'
                        },
                        uuid: { type: 'string', description: 'Animation clip asset UUID' },
                        path: { type: 'string', description: 'Animation clip asset path in db:// format' },
                        nodeUuid: { type: 'string', description: 'Animation root node UUID. Required for query/edit actions except list/create.' },
                        clipUuid: { type: 'string', description: 'Animation clip UUID. Preferred over uuid for edit/query actions.' },
                        name: { type: 'string', description: 'Animation name when action=create' },
                        savePath: { type: 'string', description: 'Destination db:// path when action=create, e.g. db://assets/anim/walk.anim' },
                        duration: { type: 'number', description: 'Clip duration in seconds. Default: 1.0' },
                        sample: { type: 'number', description: 'Sample rate in frames per second. Default: 60' },
                        nodePath: { type: 'string', description: 'Target node path, e.g. Canvas/Player' },
                        propKey: { type: 'string', description: 'Property key from clip dump/editable property list' },
                        frame: { type: 'number', description: 'Frame index' },
                        frames: {
                            type: 'array',
                            items: { type: 'number' },
                            description: 'Frame indices for batch key removal'
                        },
                        value: { description: 'Keyframe value or creation payload' },
                        curve: {
                            type: 'object',
                            description: 'Curve settings such as interpMode, inTangent, outTangent, easingMethod'
                        }
                    },
                    required: ['action']
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        if (toolName !== 'clip') {
            throw new Error(`Unknown tool: ${toolName}`);
        }

        const action = args?.action as AnimationClipAction | undefined;
        switch (action) {
            case 'list':
                return await this.listClips();
            case 'create':
                return await this.createClip(args);
            case 'get_info':
                return await this.getClipInfo(args);
            case 'list_editable_properties':
                return await this.listEditableProperties(args);
            case 'add_track':
                return await this.addTrack(args);
            case 'remove_track':
                return await this.removeTrack(args);
            case 'create_key':
                return await this.createKey(args);
            case 'set_keyframe':
                return await this.setKeyframe(args);
            case 'remove_key':
                return await this.removeKey(args);
            case 'query_value_at_frame':
                return await this.queryValueAtFrame(args);
            case 'save':
                return await this.saveClip(args);
            default:
                return { success: false, error: `Unknown clip action: ${String(action)}` };
        }
    }

    private async listClips(): Promise<ToolResponse> {
        try {
            const results: any[] = await Editor.Message.request('asset-db', 'query-assets', {
                pattern: 'db://assets/**/*.anim'
            });

            const animations = (Array.isArray(results) ? results : []).map((item: any) => ({
                uuid: item.uuid,
                path: item.url || item.path,
                name: item.name || this.getNameFromPath(item.url || item.path || ''),
                type: item.type,
                size: item.fileSize ?? item.size
            }));

            return {
                success: true,
                data: {
                    animations,
                    count: animations.length
                }
            };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async createClip(args: any): Promise<ToolResponse> {
        const savePath = String(args?.savePath || '').trim();
        if (!savePath) {
            return { success: false, error: 'savePath is required for action=create' };
        }
        if (!savePath.startsWith('db://assets/')) {
            return { success: false, error: 'savePath must start with db://assets/' };
        }
        if (!savePath.endsWith('.anim')) {
            return { success: false, error: 'savePath must end with .anim' };
        }

        return await this.callSceneMethod('createAnimationClip', [
            savePath,
            args?.name,
            typeof args?.duration === 'number' ? args.duration : 1,
            typeof args?.sample === 'number' ? args.sample : 60
        ]);
    }

    private async getClipInfo(args: any): Promise<ToolResponse> {
        const nodeUuid = this.requireString(args?.nodeUuid, 'nodeUuid');
        if (!nodeUuid.success) return nodeUuid.response;

        try {
            const clip = await this.resolveClipRef(args);
            return await this.callSceneMethod('getAnimationClipInfo', [args.nodeUuid, clip.clipUuid]);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async listEditableProperties(args: any): Promise<ToolResponse> {
        const validation = this.requireNodeAndClipContext(args);
        if (!validation.success) return validation.response;

        try {
            const clip = await this.resolveClipRef(args);
            return await this.callSceneMethod('listAnimationEditableProperties', [args.nodeUuid, clip.clipUuid]);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async addTrack(args: any): Promise<ToolResponse> {
        const validation = this.requireTrackContext(args);
        if (!validation.success) return validation.response;

        try {
            const clip = await this.resolveClipRef(args);
            return await this.callSceneMethod('addAnimationTrack', [
                args.nodeUuid,
                clip.clipUuid,
                args.nodePath,
                args.propKey
            ]);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async removeTrack(args: any): Promise<ToolResponse> {
        const validation = this.requireTrackContext(args);
        if (!validation.success) return validation.response;

        try {
            const clip = await this.resolveClipRef(args);
            return await this.callSceneMethod('removeAnimationTrack', [
                args.nodeUuid,
                clip.clipUuid,
                args.nodePath,
                args.propKey
            ]);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async createKey(args: any): Promise<ToolResponse> {
        const validation = this.requireFrameContext(args);
        if (!validation.success) return validation.response;

        try {
            const clip = await this.resolveClipRef(args);
            return await this.callSceneMethod('createAnimationKey', [
                args.nodeUuid,
                clip.clipUuid,
                args.nodePath,
                args.propKey,
                args.frame,
                args.value
            ]);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async setKeyframe(args: any): Promise<ToolResponse> {
        const validation = this.requireFrameContext(args);
        if (!validation.success) return validation.response;

        try {
            const clip = await this.resolveClipRef(args);
            return await this.callSceneMethod('setAnimationKeyframe', [
                args.nodeUuid,
                clip.clipUuid,
                args.nodePath,
                args.propKey,
                args.frame,
                args.value,
                args.curve || {}
            ]);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async removeKey(args: any): Promise<ToolResponse> {
        const validation = this.requireTrackContext(args);
        if (!validation.success) return validation.response;
        if (!Array.isArray(args?.frames) || args.frames.length === 0) {
            return { success: false, error: 'frames must be a non-empty array for action=remove_key' };
        }

        try {
            const clip = await this.resolveClipRef(args);
            return await this.callSceneMethod('removeAnimationKey', [
                args.nodeUuid,
                clip.clipUuid,
                args.nodePath,
                args.propKey,
                args.frames
            ]);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async queryValueAtFrame(args: any): Promise<ToolResponse> {
        const validation = this.requireFrameContext(args);
        if (!validation.success) return validation.response;

        try {
            const clip = await this.resolveClipRef(args);
            return await this.callSceneMethod('queryAnimationValueAtFrame', [
                args.nodeUuid,
                clip.clipUuid,
                args.nodePath,
                args.propKey,
                args.frame
            ]);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async saveClip(args: any): Promise<ToolResponse> {
        const validation = this.requireNodeAndClipContext(args);
        if (!validation.success) return validation.response;

        try {
            const clip = await this.resolveClipRef(args);
            return await this.callSceneMethod('saveAnimationClip', [
                args.nodeUuid,
                clip.clipUuid
            ]);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async callSceneMethod(method: string, args: any[]): Promise<ToolResponse> {
        try {
            const result = await Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cocos-mcp-server',
                method,
                args
            });

            if (result === undefined || result === null) {
                return {
                    success: false,
                    error: `Scene method '${method}' returned nothing. Check package.json contributions.scene.methods.`
                };
            }

            if (result && typeof result === 'object' && 'success' in result) {
                return result as ToolResponse;
            }

            return { success: true, data: result };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async resolveClipRef(args: any): Promise<ResolvedClipRef> {
        const requestedPath = typeof args?.path === 'string' ? args.path.trim() : '';
        const requestedUuid = typeof args?.clipUuid === 'string' && args.clipUuid.trim()
            ? args.clipUuid.trim()
            : (typeof args?.uuid === 'string' ? args.uuid.trim() : '');

        if (!requestedPath && !requestedUuid) {
            throw new Error('Provide clipUuid, uuid, or path to identify the animation clip');
        }

        if (requestedPath) {
            const info: any = await Editor.Message.request('asset-db', 'query-asset-info', requestedPath);
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
                type: info.type
            };
        }

        const assetPath: string | null = await Editor.Message.request('asset-db', 'query-url', requestedUuid);
        if (!assetPath) {
            throw new Error(`Animation clip UUID not found: ${requestedUuid}`);
        }

        const info: any = await Editor.Message.request('asset-db', 'query-asset-info', assetPath);
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
            type: info.type
        };
    }

    private requireNodeAndClipContext(args: any): { success: true } | { success: false; response: ToolResponse } {
        const nodeUuid = this.requireString(args?.nodeUuid, 'nodeUuid');
        if (!nodeUuid.success) return nodeUuid;

        const hasClipRef = Boolean(
            (typeof args?.clipUuid === 'string' && args.clipUuid.trim()) ||
            (typeof args?.uuid === 'string' && args.uuid.trim()) ||
            (typeof args?.path === 'string' && args.path.trim())
        );

        if (!hasClipRef) {
            return { success: false, response: { success: false, error: 'Provide clipUuid, uuid, or path' } };
        }

        return { success: true };
    }

    private requireTrackContext(args: any): { success: true } | { success: false; response: ToolResponse } {
        const base = this.requireNodeAndClipContext(args);
        if (!base.success) return base;

        // nodePath allows empty string (root node), so only check type
        if (typeof args?.nodePath !== 'string') {
            return { success: false, response: { success: false, error: 'nodePath is required (use empty string for root node)' } };
        }

        const propKey = this.requireString(args?.propKey, 'propKey');
        if (!propKey.success) return propKey;

        return { success: true };
    }

    private requireFrameContext(args: any): { success: true } | { success: false; response: ToolResponse } {
        const base = this.requireTrackContext(args);
        if (!base.success) return base;

        if (typeof args?.frame !== 'number' || Number.isNaN(args.frame)) {
            return { success: false, response: { success: false, error: 'frame must be a number' } };
        }

        return { success: true };
    }

    private requireString(value: any, fieldName: string): { success: true } | { success: false; response: ToolResponse } {
        if (typeof value !== 'string' || !value.trim()) {
            return {
                success: false,
                response: { success: false, error: `${fieldName} is required` }
            };
        }
        return { success: true };
    }

    private getNameFromPath(assetPath: string): string {
        const normalized = String(assetPath || '').replace(/\\/g, '/');
        const baseName = normalized.split('/').pop() || normalized;
        return baseName.replace(/\.anim$/i, '');
    }
}
