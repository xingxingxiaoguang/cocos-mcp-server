import { ToolDefinition, ToolResponse, ToolExecutor } from '../../types';

/**
 * SceneScriptToolsV2 — 场景脚本执行工具 v2
 * 合并自 SceneAdvancedTools (scene script + component method 部分)
 * category key: sceneScript (避免与 scene → SceneToolsV2 冲突)
 * 1 个工具: execute
 */
export class SceneScriptToolsV2 implements ToolExecutor {

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'execute',
                description: 'Execute scene scripts or component methods. action=scene_script: call a scene script method. action=component_method: call a method on a component.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['scene_script', 'component_method'],
                            description: 'Execution type'
                        },
                        name: { type: 'string', description: 'Scene script name for action=scene_script' },
                        method: { type: 'string', description: 'Method name' },
                        args: { type: 'array', description: 'Argument list' },
                        uuid: { type: 'string', description: 'Node UUID for action=component_method' }
                    },
                    required: ['action']
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'execute':
                return await this.handleExecute(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private async handleExecute(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'scene_script':
                return await this.executeSceneScript(args.name, args.method, args.args);
            case 'component_method':
                return await this.executeComponentMethod(args.uuid, args.method || args.name, args.args);
            default:
                return { success: false, error: `Unknown execute action: ${args.action}` };
        }
    }

    private async executeSceneScript(name: string, method: string, args: any[] = []): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'execute-scene-script', {
                name,
                method,
                args
            }).then((result: any) => {
                resolve({ success: true, data: result });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    private async executeComponentMethod(uuid: string, name: string, args: any[] = []): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'execute-component-method', {
                uuid,
                name,
                args
            }).then((result: any) => {
                resolve({
                    success: true,
                    data: { result, message: `Method '${name}' executed successfully` }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
}
