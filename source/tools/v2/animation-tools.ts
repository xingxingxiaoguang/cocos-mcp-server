import type { AnimationCapability } from '../../capabilities/animation/interface';
import { getCapabilityRegistry } from '../../runtime/capability-registry';
import { BaseToolExecutor, ToolHandler, ToolDefinition, ToolResponse, makeError, ToolErrorCode } from '../base-tool';

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

export class AnimationToolsV2 extends BaseToolExecutor {
    private readonly animation: AnimationCapability = getCapabilityRegistry().animation;

    protected readonly handlers: Record<string, ToolHandler> = {
        clip: async (args: any) => this.handleClip(args),
    };

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

    private async handleClip(args: any): Promise<ToolResponse> {
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
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown clip action: ${String(action)}`);
        }
    }

    private async listClips(): Promise<ToolResponse> {
        const result = await this.animation.listClips();
        return {
            success: true,
            data: result,
        };
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

        return this.toToolResponse(await this.animation.createClip({
            savePath,
            name: args?.name,
            duration: args?.duration,
            sample: args?.sample,
        }));
    }

    private async getClipInfo(args: any): Promise<ToolResponse> {
        const nodeUuid = this.requireString(args?.nodeUuid, 'nodeUuid');
        if (!nodeUuid.success) return nodeUuid.response;
        return this.toToolResponse(await this.animation.getClipInfo({
            nodeUuid: args.nodeUuid,
            clipUuid: this.optionalTrimmedString(args?.clipUuid),
            uuid: this.optionalTrimmedString(args?.uuid),
            path: this.optionalTrimmedString(args?.path),
        }));
    }

    private async listEditableProperties(args: any): Promise<ToolResponse> {
        const validation = this.requireNodeAndClipContext(args);
        if (!validation.success) return validation.response;

        return this.toToolResponse(await this.animation.listEditableProperties({
            nodeUuid: args.nodeUuid,
            clipUuid: this.optionalTrimmedString(args?.clipUuid),
            uuid: this.optionalTrimmedString(args?.uuid),
            path: this.optionalTrimmedString(args?.path),
        }));
    }

    private async addTrack(args: any): Promise<ToolResponse> {
        const validation = this.requireTrackContext(args);
        if (!validation.success) return validation.response;

        return this.toToolResponse(await this.animation.addTrack({
            nodeUuid: args.nodeUuid,
            clipUuid: this.optionalTrimmedString(args?.clipUuid),
            uuid: this.optionalTrimmedString(args?.uuid),
            path: this.optionalTrimmedString(args?.path),
            nodePath: args.nodePath,
            propKey: args.propKey,
        }));
    }

    private async removeTrack(args: any): Promise<ToolResponse> {
        const validation = this.requireTrackContext(args);
        if (!validation.success) return validation.response;

        return this.toToolResponse(await this.animation.removeTrack({
            nodeUuid: args.nodeUuid,
            clipUuid: this.optionalTrimmedString(args?.clipUuid),
            uuid: this.optionalTrimmedString(args?.uuid),
            path: this.optionalTrimmedString(args?.path),
            nodePath: args.nodePath,
            propKey: args.propKey,
        }));
    }

    private async createKey(args: any): Promise<ToolResponse> {
        const validation = this.requireFrameContext(args);
        if (!validation.success) return validation.response;

        return this.toToolResponse(await this.animation.createKey({
            nodeUuid: args.nodeUuid,
            clipUuid: this.optionalTrimmedString(args?.clipUuid),
            uuid: this.optionalTrimmedString(args?.uuid),
            path: this.optionalTrimmedString(args?.path),
            nodePath: args.nodePath,
            propKey: args.propKey,
            frame: args.frame,
            value: args.value,
        }));
    }

    private async setKeyframe(args: any): Promise<ToolResponse> {
        const validation = this.requireFrameContext(args);
        if (!validation.success) return validation.response;

        return this.toToolResponse(await this.animation.setKeyframe({
            nodeUuid: args.nodeUuid,
            clipUuid: this.optionalTrimmedString(args?.clipUuid),
            uuid: this.optionalTrimmedString(args?.uuid),
            path: this.optionalTrimmedString(args?.path),
            nodePath: args.nodePath,
            propKey: args.propKey,
            frame: args.frame,
            value: args.value,
            curve: args.curve || {},
        }));
    }

    private async removeKey(args: any): Promise<ToolResponse> {
        const validation = this.requireTrackContext(args);
        if (!validation.success) return validation.response;
        if (!Array.isArray(args?.frames) || args.frames.length === 0) {
            return { success: false, error: 'frames must be a non-empty array for action=remove_key' };
        }

        return this.toToolResponse(await this.animation.removeKey({
            nodeUuid: args.nodeUuid,
            clipUuid: this.optionalTrimmedString(args?.clipUuid),
            uuid: this.optionalTrimmedString(args?.uuid),
            path: this.optionalTrimmedString(args?.path),
            nodePath: args.nodePath,
            propKey: args.propKey,
            frames: args.frames,
        }));
    }

    private async queryValueAtFrame(args: any): Promise<ToolResponse> {
        const validation = this.requireFrameContext(args);
        if (!validation.success) return validation.response;

        return this.toToolResponse(await this.animation.queryValueAtFrame({
            nodeUuid: args.nodeUuid,
            clipUuid: this.optionalTrimmedString(args?.clipUuid),
            uuid: this.optionalTrimmedString(args?.uuid),
            path: this.optionalTrimmedString(args?.path),
            nodePath: args.nodePath,
            propKey: args.propKey,
            frame: args.frame,
        }));
    }

    private async saveClip(args: any): Promise<ToolResponse> {
        const validation = this.requireNodeAndClipContext(args);
        if (!validation.success) return validation.response;

        return this.toToolResponse(await this.animation.saveClip({
            nodeUuid: args.nodeUuid,
            clipUuid: this.optionalTrimmedString(args?.clipUuid),
            uuid: this.optionalTrimmedString(args?.uuid),
            path: this.optionalTrimmedString(args?.path),
        }));
    }

    private toToolResponse(result: { data: unknown; warning?: string; message?: string }): ToolResponse {
        return {
            success: true,
            data: result.data,
            ...(result.warning ? { warning: result.warning } : {}),
            ...(result.message ? { message: result.message } : {}),
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
                response: makeError(ToolErrorCode.MISSING_REQUIRED, `${fieldName} is required`)
            };
        }
        return { success: true };
    }

    private optionalTrimmedString(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
    }
}
