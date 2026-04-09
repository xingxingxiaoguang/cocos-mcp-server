import { ToolDefinition, ToolExecutor, ToolResponse } from '../mcp/interface';
import { makeError, normalizeUnknownError, ToolErrorCode } from '../utils/error-codes';

export type ToolHandler = (args: any) => Promise<ToolResponse>;

export abstract class BaseToolExecutor implements ToolExecutor {
    protected abstract readonly handlers: Record<string, ToolHandler>;

    abstract getTools(): ToolDefinition[];

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        const handler = this.handlers[toolName];
        if (!handler) {
            return makeError(ToolErrorCode.INVALID_ARGS, `Unknown tool: ${toolName}`);
        }

        try {
            return await handler(args);
        } catch (error) {
            return normalizeUnknownError(error);
        }
    }
}
