import { ToolDefinition, ToolExecutor, ToolResponse } from '../mcp/interface';
import { makeError, normalizeUnknownError, ToolErrorCode } from '../utils/error-codes';

export { ToolDefinition, ToolExecutor, ToolResponse, makeError, normalizeUnknownError, ToolErrorCode };

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

    /** Wrap pure data as a success response. */
    protected ok(data: unknown): ToolResponse {
        return { success: true, data };
    }

    /** Success with message only (no data payload). */
    protected okMessage(message: string): ToolResponse {
        return { success: true, message };
    }

    /**
     * Extract `message`, `warning`, and `instruction` from a capability result
     * and place them as top-level ToolResponse fields; everything else becomes `data`.
     */
    protected okResult<T extends { message?: string; warning?: string; instruction?: string }>(result: T): ToolResponse {
        const { message, warning, instruction, ...data } = result;
        const response: ToolResponse = { success: true, data };
        if (message) response.message = message;
        if (warning) response.warning = warning;
        if (instruction) response.instruction = instruction;
        return response;
    }
}
