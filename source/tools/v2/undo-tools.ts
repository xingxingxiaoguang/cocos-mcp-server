import { BaseToolExecutor, ToolDefinition, ToolResponse, makeError, ToolErrorCode } from '../base-tool';
import { actionEnum, uuid as uuidSchema } from '../../utils/schemas';

/**
 * UndoToolsV2 — Undo 操作工具 v2
 * 合并自 SceneAdvancedTools (undo 部分)
 * 1 个工具: recording
 */
export class UndoToolsV2 extends BaseToolExecutor {
    protected readonly handlers = {
        recording: async (args: any) => this.handleRecording(args),
    };

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'recording',
                description: 'Undo recording operations. action=begin: start recording undo data for a node (returns undoId). action=end: end recording and commit. action=cancel: cancel recording and discard.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: actionEnum(
                            ['begin', 'end', 'cancel'],
                            'begin=start recording, end=end recording and commit, cancel=cancel recording',
                        ),
                        uuid: { ...uuidSchema, description: 'Node UUID for action=begin' },
                        undoId: { ...uuidSchema, description: 'Recording ID for action=end/cancel' }
                    },
                    required: ['action']
                }
            }
        ];
    }

    private async handleRecording(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'begin':
                return await this.beginUndoRecording(args.uuid);
            case 'end':
                return await this.endUndoRecording(args.undoId);
            case 'cancel':
                return await this.cancelUndoRecording(args.undoId);
            default:
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown recording action: ${args.action}`);
        }
    }

    private async beginUndoRecording(nodeUuid: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'begin-recording', nodeUuid).then((undoId: string) => {
                resolve({
                    success: true,
                    data: { undoId, message: 'Undo recording started' }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async endUndoRecording(undoId: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'end-recording', undoId).then(() => {
                resolve({ success: true, message: 'Undo recording ended' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async cancelUndoRecording(undoId: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'cancel-recording', undoId).then(() => {
                resolve({ success: true, message: 'Undo recording cancelled' });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
}
