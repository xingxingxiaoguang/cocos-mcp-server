import * as assert from 'assert';
import { BaseToolExecutor } from '../tools/base-tool';
import { actionEnum, path as pathSchema, uuid as uuidSchema } from '../tools/schemas/common';
import { ToolDefinition, ToolResponse } from '../types';
import { makeError, normalizeUnknownError, ToolErrorCode } from '../utils/error-codes';
import { safeSerialize } from '../utils/serializer';

class MockExecutor extends BaseToolExecutor {
    protected readonly handlers = {
        ok: async (args: any): Promise<ToolResponse> => ({ success: true, data: args }),
        boom: async (): Promise<ToolResponse> => {
            throw new Error('executor exploded');
        },
    };

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'ok',
                description: 'mock success',
                inputSchema: { type: 'object' },
            },
            {
                name: 'boom',
                description: 'mock failure',
                inputSchema: { type: 'object' },
            },
        ];
    }
}

function verifySerializer(): void {
    const circular: Record<string, any> = { name: 'root' };
    circular.self = circular;
    circular.items = Array.from({ length: 6 }, (_, index) => index);
    circular.deep = {
        level1: {
            level2: {
                level3: {
                    level4: {
                        value: true,
                    },
                },
            },
        },
    };

    const wideObject = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`key${index}`, index]));

    const serialized = safeSerialize(circular, {
        maxDepth: 3,
        maxArrayLength: 4,
        maxObjectKeys: 5,
    }) as Record<string, any>;
    const serializedWide = safeSerialize(wideObject, { maxObjectKeys: 3 }) as Record<string, any>;

    assert.strictEqual(serialized.self, '[circular]');
    assert.deepStrictEqual(serialized.items, [0, 1, 2, 3]);
    assert.strictEqual(serialized.deep.level1.level2.level3, '[max depth]');
    assert.deepStrictEqual(Object.keys(serializedWide), ['key0', 'key1', 'key2']);
}

function verifyErrorCodes(): void {
    const invalidArgs = makeError(ToolErrorCode.INVALID_ARGS, 'bad input', {
        instruction: 'provide a valid uuid',
    });
    const normalized = normalizeUnknownError(new Error('boom'), ToolErrorCode.EDITOR_API_FAILED);

    assert.strictEqual(invalidArgs.success, false);
    assert.strictEqual(invalidArgs.error, 'bad input');
    assert.strictEqual(invalidArgs.errorCode, ToolErrorCode.INVALID_ARGS);
    assert.strictEqual(invalidArgs.instruction, 'provide a valid uuid');

    assert.strictEqual(normalized.success, false);
    assert.strictEqual(normalized.error, 'boom');
    assert.strictEqual(normalized.errorCode, ToolErrorCode.EDITOR_API_FAILED);
}

async function verifyBaseToolExecutor(): Promise<void> {
    const executor = new MockExecutor();

    const success = await executor.execute('ok', { value: 1 });
    const missing = await executor.execute('missing', {});
    const boom = await executor.execute('boom', {});

    assert.deepStrictEqual(success, { success: true, data: { value: 1 } });
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.errorCode, ToolErrorCode.INVALID_ARGS);
    assert.strictEqual(boom.success, false);
    assert.strictEqual(boom.errorCode, ToolErrorCode.INTERNAL_ERROR);
}

function verifyCompatibilityExports(): void {
    const tool: ToolDefinition = {
        name: 'sample',
        description: 'sample tool',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { ...uuidSchema },
                path: { ...pathSchema },
                action: actionEnum(['query'], 'Action type'),
            },
        },
    };

    const response: ToolResponse = { success: true, message: 'ok' };

    assert.strictEqual(tool.name, 'sample');
    assert.strictEqual(tool.inputSchema.properties.uuid.type, 'string');
    assert.strictEqual(tool.inputSchema.properties.path.type, 'string');
    assert.deepStrictEqual(tool.inputSchema.properties.action.enum, ['query']);
    assert.strictEqual(response.success, true);
}

async function main(): Promise<void> {
    verifySerializer();
    verifyErrorCodes();
    await verifyBaseToolExecutor();
    verifyCompatibilityExports();
    console.log('[foundation-modules-smoke] OK');
}

main().catch((error) => {
    console.error('[foundation-modules-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
