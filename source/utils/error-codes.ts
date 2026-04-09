import { ToolResponse } from '../mcp/interface';

export enum ToolErrorCode {
    INVALID_ARGS = 'INVALID_ARGS',
    MISSING_REQUIRED = 'MISSING_REQUIRED',
    NODE_NOT_FOUND = 'NODE_NOT_FOUND',
    ASSET_NOT_FOUND = 'ASSET_NOT_FOUND',
    SCENE_NOT_OPEN = 'SCENE_NOT_OPEN',
    EDITOR_API_FAILED = 'EDITOR_API_FAILED',
    UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
}

type ToolErrorExtra = Partial<ToolResponse> & Record<string, unknown>;

function isToolResponse(value: unknown): value is ToolResponse {
    return Boolean(value) && typeof value === 'object' && 'success' in (value as Record<string, unknown>);
}

export function makeError(code: ToolErrorCode | string, message: string, extra: ToolErrorExtra = {}): ToolResponse {
    return {
        success: false,
        error: message,
        errorCode: code,
        ...extra,
    };
}

export function normalizeUnknownError(
    error: unknown,
    fallbackCode: ToolErrorCode | string = ToolErrorCode.INTERNAL_ERROR,
): ToolResponse {
    if (isToolResponse(error)) {
        return {
            ...error,
            success: false,
            error: typeof error.error === 'string' ? error.error : 'Unknown error',
            errorCode: typeof error.errorCode === 'string' ? error.errorCode : fallbackCode,
        };
    }

    if (typeof error === 'string') {
        return makeError(fallbackCode, error);
    }

    if (error instanceof Error) {
        const err = error as Error & { code?: unknown };
        const code = typeof err.code === 'string'
            ? err.code
            : fallbackCode;
        return makeError(code, error.message);
    }

    if (error && typeof error === 'object' && 'message' in error) {
        const err = error as { message?: unknown; code?: unknown };
        return makeError(
            typeof err.code === 'string' ? err.code : fallbackCode,
            typeof err.message === 'string' ? err.message : 'Unknown error',
        );
    }

    return makeError(fallbackCode, 'Unknown error');
}
