import { BaseToolExecutor, ToolDefinition, ToolResponse, makeError, ToolErrorCode } from '../base-tool';
import { actionEnum, path as pathSchema, uuid as uuidSchema } from '../../utils/schemas';

/**
 * ArrayPropertyToolsV2 — 数组属性操作工具 v2
 * 合并自 SceneAdvancedTools (array element 部分)
 * category key: array
 * 1 个工具: property
 */
export class ArrayPropertyToolsV2 extends BaseToolExecutor {
    protected readonly handlers = {
        property: async (args: any) => this.handleProperty(args),
    };

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'property',
                description: 'Array property operations on nodes. action=move: move an array element by offset. action=remove: remove an array element at index.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: { ...uuidSchema, description: 'Node UUID' },
                        path: { ...pathSchema, description: 'Array property path, e.g. __comps__' },
                        action: actionEnum(['move', 'remove'], 'Operation type'),
                        index: { type: 'number', description: 'Target index for action=remove' },
                        target: { type: 'number', description: 'Target index for action=move' },
                        offset: { type: 'number', description: 'Move offset for action=move' }
                    },
                    required: ['uuid', 'path', 'action']
                }
            }
        ];
    }

    private async handleProperty(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'move':
                return await this.moveArrayElement(args.uuid, args.path, args.target, args.offset);
            case 'remove':
                return await this.removeArrayElement(args.uuid, args.path, args.index);
            default:
                return makeError(ToolErrorCode.INVALID_ARGS, `Unknown array property action: ${args.action}`);
        }
    }

    private async moveArrayElement(uuid: string, path: string, target: number, offset: number): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'move-array-element', {
                uuid,
                path,
                target,
                offset
            }).then(() => {
                resolve({
                    success: true,
                    message: `Array element at index ${target} moved by ${offset}`
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async removeArrayElement(uuid: string, path: string, index: number): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'remove-array-element', {
                uuid,
                path,
                index
            }).then(() => {
                resolve({
                    success: true,
                    message: `Array element at index ${index} removed`
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
}
