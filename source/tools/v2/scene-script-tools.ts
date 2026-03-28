import { ToolDefinition, ToolResponse, ToolExecutor } from '../../types';

function serializeResult(value: any, depth: number = 0, seen: WeakSet<object> = new WeakSet()): any {
    if (depth > 3) return '[max depth]';
    if (value === null || value === undefined) return value;

    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean' || type === 'bigint') {
        return type === 'bigint' ? value.toString() : value;
    }
    if (type === 'function') {
        return `[Function ${value.name || 'anonymous'}]`;
    }

    if (Array.isArray(value)) {
        return value.slice(0, 100).map((item: any) => serializeResult(item, depth + 1, seen));
    }

    if (type === 'object') {
        if (value instanceof String || value instanceof Number || value instanceof Boolean) {
            return value.valueOf();
        }

        if (seen.has(value)) {
            return '[circular]';
        }
        seen.add(value);

        try {
            const keys = Object.keys(value);
            const result: Record<string, any> = {};
            for (const key of keys.slice(0, 20)) {
                try {
                    const item = value[key];
                    if (item !== undefined && typeof item !== 'function') {
                        result[key] = serializeResult(item, depth + 1, seen);
                    }
                } catch {
                    // Skip inaccessible property
                }
            }
            if (Object.keys(result).length > 0) {
                return result;
            }
        } finally {
            seen.delete(value);
        }
    }

    return String(value);
}

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
                if (result === undefined || result === null) {
                    resolve({
                        success: false,
                        error: `Method '${method}' not found or returned nothing. Check that it is registered in package.json contributions.scene.methods.`
                    });
                    return;
                }
                resolve({ success: true, data: serializeResult(result) });
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
                    data: { result: serializeResult(result), message: `Method '${name}' executed successfully` }
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
}
