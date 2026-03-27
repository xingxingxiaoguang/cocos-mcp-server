import { ToolDefinition, ToolResponse, ToolExecutor } from '../../types';

/**
 * ArrayPropertyToolsV2 — 数组属性操作工具 v2
 * 合并自 SceneAdvancedTools (array element 部分)
 * category key: array
 * 1 个工具: property
 */
export class ArrayPropertyToolsV2 implements ToolExecutor {

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'property',
                description: 'Array property operations on nodes. action=move: move an array element by offset. action=remove: remove an array element at index.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uuid: { type: 'string', description: 'Node UUID' },
                        path: { type: 'string', description: 'Array property path, e.g. __comps__' },
                        action: {
                            type: 'string',
                            enum: ['move', 'remove'],
                            description: 'Operation type'
                        },
                        index: { type: 'number', description: 'Target index for action=remove' },
                        target: { type: 'number', description: 'Target index for action=move' },
                        offset: { type: 'number', description: 'Move offset for action=move' }
                    },
                    required: ['uuid', 'path', 'action']
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'property':
                return await this.handleProperty(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private async handleProperty(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'move':
                return await this.moveArrayElement(args.uuid, args.path, args.target, args.offset);
            case 'remove':
                return await this.removeArrayElement(args.uuid, args.path, args.index);
            default:
                return { success: false, error: `Unknown array property action: ${args.action}` };
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
