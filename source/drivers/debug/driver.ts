import { BaseDriver } from '../base-driver';
import type { RuntimeProfile } from '../../core/profile';
import type {
    DebugBridgeDriver,
    MissingAssetsResult,
    PerformanceStatsResult,
} from './contract';
import type {
    ConsoleMessage,
    EditorEnvironmentInfo,
    TraceSampleOptions,
    TraceOptions,
    CollisionWaitOptions,
} from '../../capabilities/debug/interface';
import { getGlobalRuntimeBridge } from '../../preview/bridge';
import * as fs from 'fs';
import * as path from 'path';

class EditorDebugDriver extends BaseDriver implements DebugBridgeDriver {
    private consoleMessages: ConsoleMessage[] = [];
    private readonly maxMessages = 1000;
    private listeners: Array<{ channel: string; fn: (...args: any[]) => void }> = [];

    // =========================================================================
    // 生命周期
    // =========================================================================

    startConsoleCapture(): void {
        try {
            const msg = (globalThis as any).Editor?.Message;
            if (!msg?.addBroadcastListener) return;

            const listener = (message: any) => {
                let content: string;
                if (Array.isArray(message.message)) {
                    content = message.message.map((arg: any) =>
                        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                    ).join(' ');
                } else if (typeof message.message === 'string') {
                    content = message.message;
                } else {
                    content = message.content || String(message);
                }

                this.addMessage({
                    type: message.type || 'log',
                    content,
                    source: 'editor',
                });
            };

            for (const channel of ['console:log', 'console:warn', 'console:error']) {
                msg.addBroadcastListener(channel, listener);
                this.listeners.push({ channel, fn: listener });
            }
            console.log('[DebugDriver] Console capture initialized');
        } catch (err) {
            console.warn('[DebugDriver] Console capture setup failed, falling back to project log file');
        }
    }

    stopConsoleCapture(): void {
        try {
            const msg = (globalThis as any).Editor?.Message;
            if (msg?.removeBroadcastListener) {
                for (const { channel } of this.listeners) {
                    msg.removeBroadcastListener(channel);
                }
            }
        } catch {
            // ignore
        }
        this.listeners = [];
        this.consoleMessages = [];
    }

    // =========================================================================
    // Console 日志缓冲
    // =========================================================================

    getConsoleMessages(limit: number, filter?: string): ConsoleMessage[] {
        let logs = this.consoleMessages;
        if (filter && filter !== 'all') {
            logs = logs.filter(l => l.type === filter);
        }
        return logs.slice(-limit);
    }

    clearConsoleMessages(): void {
        this.consoleMessages = [];
    }

    sendClearConsole(): void {
        (globalThis as any).Editor?.Message?.send('console', 'clear');
    }

    // =========================================================================
    // 项目日志文件 I/O
    // =========================================================================

    findLogFilePath(): string | null {
        const possiblePaths = [
            (globalThis as any).Editor?.Project?.path ?? null,
            process.cwd(),
        ].filter((p): p is string => p !== null);

        for (const basePath of possiblePaths) {
            const testPath = path.join(basePath, 'temp/logs/project.log');
            if (fs.existsSync(testPath)) return testPath;
        }
        return null;
    }

    readLogFile(logFilePath: string): string[] {
        const content = fs.readFileSync(logFilePath, 'utf8');
        return content.split('\n').filter(line => line.trim() !== '');
    }

    // =========================================================================
    // Editor IPC
    // =========================================================================

    async executeInEditor(script: string): Promise<any> {
        return (globalThis as any).Editor.Message.request('scene', 'execute-scene-script', {
            name: 'cocos-mcp-server',
            method: 'evalScript',
            args: [script],
        });
    }

    getEditorInfo(): EditorEnvironmentInfo {
        const Editor = (globalThis as any).Editor;
        return {
            editor: {
                version: Editor?.versions?.editor || 'Unknown',
                cocosVersion: Editor?.versions?.cocos || 'Unknown',
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
            },
            project: {
                name: Editor.Project.name,
                path: Editor.Project.path,
                uuid: Editor.Project.uuid,
            },
            memory: process.memoryUsage(),
            uptime: process.uptime(),
        };
    }

    async checkMissingAssets(): Promise<MissingAssetsResult | null> {
        try {
            const result = await (globalThis as any).Editor.Message.request('scene', 'check-missing-assets');
            return result && result.missing ? result : null;
        } catch {
            return null;
        }
    }

    async getPerformanceStats(): Promise<PerformanceStatsResult | null> {
        try {
            const result = await (globalThis as any).Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cocos-mcp-server',
                method: 'getPerformanceStats',
                args: [],
            });
            return result?.success && result.data ? result.data : null;
        } catch {
            return null;
        }
    }

    // =========================================================================
    // RuntimeBridge 代理
    // =========================================================================

    isRuntimeConnected(): boolean {
        const bridge = getGlobalRuntimeBridge();
        return bridge !== null && bridge.isConnected();
    }

    getRuntimeLogs(limit: number, level: string): ConsoleMessage[] {
        const bridge = getGlobalRuntimeBridge();
        if (!bridge || !bridge.isConnected()) return [];
        return bridge.getLogs(limit, level);
    }

    async executeInRuntime(script: string): Promise<any> {
        return this.requireBridge().execute(script);
    }

    async getRuntimeSummary(): Promise<any> {
        return this.requireBridge().getSummary();
    }

    async traceSample(options: TraceSampleOptions): Promise<any> {
        return this.requireBridge().traceSample(options);
    }

    async trace(options: TraceOptions): Promise<any> {
        return this.requireBridge().trace(options);
    }

    async traceCollisionWait(options: CollisionWaitOptions): Promise<any> {
        return this.requireBridge().traceCollisionWait(options);
    }

    async getGameState(): Promise<any> {
        return this.requireBridge().getGameState();
    }

    // =========================================================================
    // 内部辅助
    // =========================================================================

    private requireBridge() {
        const bridge = getGlobalRuntimeBridge();
        if (!bridge || !bridge.isConnected()) {
            throw new Error(
                'Runtime agent not connected. Load the agent in Preview first: '
                + 'in DevTools console run: const s=document.createElement("script");'
                + 's.src="http://127.0.0.1:<port>/runtime-agent.js";document.head.appendChild(s);'
            );
        }
        return bridge;
    }

    private addMessage(msg: Omit<ConsoleMessage, 'timestamp'>): void {
        this.consoleMessages.push({ timestamp: new Date().toISOString(), ...msg });
        if (this.consoleMessages.length > this.maxMessages) {
            this.consoleMessages.shift();
        }
    }
}

export function createDebugDriver(profile: RuntimeProfile): DebugBridgeDriver {
    return new EditorDebugDriver(profile);
}
