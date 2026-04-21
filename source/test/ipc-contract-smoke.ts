import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as ipcClient from '../ui/ipc/client';
import {
    createToolManagerState,
    IPC_CHANNEL,
    IPC_MESSAGE_METHODS,
    IPC_MESSAGES,
    TOOL_MANAGER_STATE_KEYS,
    ToolStatusUpdate,
} from '../ui/ipc/contracts';

type MessageRequestCall = {
    channel: string;
    message: string;
    args: any[];
};

type RegisteredMessage = {
    methods?: string[];
};

function getRepoRoot(): string {
    return join(__dirname, '../..');
}

function getRegisteredMessages(): Record<string, RegisteredMessage> {
    const packageJsonPath = join(getRepoRoot(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return packageJson.contributions.messages;
}

function getImplementedMethodNames(): string[] {
    const mainSourcePath = join(getRepoRoot(), 'source/main.ts');
    const mainSource = readFileSync(mainSourcePath, 'utf8');
    const matches = mainSource.matchAll(/^ {4}(?! )(?:async\s+)?([A-Za-z_$][\w$]*)\([^)]*\)\s*\{/gm);
    return Array.from(matches, (match) => match[1]);
}

async function verifyClientRequestOrder(): Promise<void> {
    const calls: MessageRequestCall[] = [];

    (globalThis as any).Editor = {
        Message: {
            request(channel: string, message: string, ...args: any[]) {
                calls.push({ channel, message, args });
                return Promise.resolve({ success: true });
            },
        },
    };

    const updates: ToolStatusUpdate[] = [
        { category: 'scene', name: 'query', enabled: true },
        { category: 'node', name: 'create', enabled: false },
    ];

    await ipcClient.getToolManagerState();
    await ipcClient.updateToolStatus('config-1', 'scene', 'query', true);
    await ipcClient.updateToolStatusBatch('config-1', updates);

    assert.strictEqual(calls.length, 3, 'expected three client IPC calls');
    assert.deepStrictEqual(calls[0], {
        channel: IPC_CHANNEL,
        message: IPC_MESSAGES.GET_TOOL_MANAGER_STATE,
        args: [],
    });
    assert.deepStrictEqual(calls[1], {
        channel: IPC_CHANNEL,
        message: IPC_MESSAGES.UPDATE_TOOL_STATUS,
        args: ['config-1', 'scene', 'query', true],
    });
    assert.deepStrictEqual(calls[2], {
        channel: IPC_CHANNEL,
        message: IPC_MESSAGES.UPDATE_TOOL_STATUS_BATCH,
        args: ['config-1', updates],
    });
}

function verifyToolManagerStateShape(): void {
    const sampleConfig = {
        id: 'config-1',
        name: 'Default',
        description: 'sample',
        tools: [{ category: 'scene', name: 'query', enabled: true, description: 'scene query' }],
        createdAt: '2026-03-31T00:00:00.000Z',
        updatedAt: '2026-03-31T00:00:00.000Z',
    };

    const state = createToolManagerState({
        selectedConfigId: sampleConfig.id,
        currentConfiguration: sampleConfig,
        configurations: [sampleConfig],
        availableTools: sampleConfig.tools,
        maxConfigSlots: 5,
    });

    for (const key of TOOL_MANAGER_STATE_KEYS) {
        assert.ok(key in state, `missing ToolManagerState key: ${String(key)}`);
    }

    assert.strictEqual(state.success, true);
    assert.strictEqual(state.selectedConfigId, state.currentConfiguration?.id);
}

function verifyMessageRegistration(): void {
    const registeredMessages = getRegisteredMessages();
    const registeredMessageNames = Object.keys(registeredMessages).sort();
    const contractMessageNames = Object.keys(IPC_MESSAGE_METHODS).sort();

    assert.deepStrictEqual(
        registeredMessageNames,
        contractMessageNames,
        'package.json messages must match IPC contract registry',
    );

    const implementedMethodNames = getImplementedMethodNames().sort();
    const registeredMethodNames = Object.values(registeredMessages)
        .flatMap((entry) => entry.methods || [])
        .sort();
    const contractMethodNames = Object.values(IPC_MESSAGE_METHODS).sort();

    assert.deepStrictEqual(
        registeredMethodNames,
        contractMethodNames,
        'registered methods must match IPC contract method mapping',
    );
    assert.deepStrictEqual(
        implementedMethodNames,
        registeredMethodNames,
        'main.ts exported methods must stay aligned with package.json message registrations',
    );
}

async function main(): Promise<void> {
    verifyMessageRegistration();
    verifyToolManagerStateShape();
    await verifyClientRequestOrder();
    console.log('[ipc-contract-smoke] OK');
}

main().catch((error) => {
    console.error('[ipc-contract-smoke] FAILED');
    console.error(error);
    process.exit(1);
});
