import { BaseToolExecutor, ToolHandler, ToolDefinition, ToolResponse } from '../base-tool';
import { ConsoleMessage, ValidationIssue, ValidationResult, SubscriptionOptions, TraceSampleOptions, TraceOptions, CollisionWaitOptions } from './debug/interface';
import { getGlobalRuntimeBridge } from '../../services/runtime-bridge';
import * as fs from 'fs';
import * as path from 'path';

/**
 * DebugToolsV2 — 调试工具 v2
 * 合并自 DebugTools
 * 3 个工具: logs, execute, inspect
 */
export class DebugToolsV2 extends BaseToolExecutor {
    private consoleMessages: ConsoleMessage[] = [];
    private readonly maxMessages = 1000;

    protected readonly handlers: Record<string, ToolHandler> = {
        logs: async (args: any) => this.handleLogs(args),
        execute: async (args: any) => this.handleExecute(args),
        inspect: async (args: any) => this.handleInspect(args),
        monitor: async (args: any) => this.handleMonitor(args),
        trace: async (args: any) => this.handleTrace(args),
    };

    constructor() {
        super();
        this.setupConsoleCapture();
    }

    private setupConsoleCapture(): void {
        try {
            const msg = Editor.Message as any;
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

                this.addConsoleMessage({
                    type: message.type || 'log',
                    content: content,
                    source: 'editor'
                });
            };
            msg.addBroadcastListener('console:log', listener);
            msg.addBroadcastListener('console:warn', listener);
            msg.addBroadcastListener('console:error', listener);
            console.log('[DebugToolsV2] Console capture initialized');
        } catch (err) {
            console.warn('[DebugToolsV2] Console capture setup failed, falling back to project log file');
        }
    }

    dispose(): void {
        try {
            const msg = Editor.Message as any;
            msg.removeBroadcastListener('console:log');
            msg.removeBroadcastListener('console:warn');
            msg.removeBroadcastListener('console:error');
        } catch {
            // ignore
        }
        this.consoleMessages = [];
    }

    private addConsoleMessage(message: any): void {
        this.consoleMessages.push({
            timestamp: new Date().toISOString(),
            ...message
        });
        if (this.consoleMessages.length > this.maxMessages) {
            this.consoleMessages.shift();
        }
    }

    getTools(): ToolDefinition[] {
        return [
            {
                name: 'logs',
                description: 'Query logs. action=query (default): get logs with optional source/level/keyword filters. source=runtime for preview game logs. action=search: search logs with regex. action=clear: clear console.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['query', 'search', 'clear'],
                            description: 'Operation type. Default: query'
                        },
                        source: { type: 'string', enum: ['console', 'file', 'runtime', 'all'], description: 'Log source for action=query. runtime=preview game logs via RuntimeBridge. Default: all' },
                        limit: { type: 'number', description: 'Number of logs to retrieve for action=query' },
                        filter: { type: 'string', description: 'Filter keyword for action=query' },
                        level: { type: 'string', enum: ['log', 'warn', 'error', 'info', 'all'], description: 'Log level filter for action=query' },
                        pattern: { type: 'string', description: 'Search pattern (supports regex) for action=search' },
                        maxResults: { type: 'number', description: 'Max search results for action=search' },
                        contextLines: { type: 'number', description: 'Context lines around each match for action=search' }
                    }
                }
            },
            {
                name: 'execute',
                description: 'Execute JavaScript code. target=editor (default): execute in editor scene process. target=runtime: execute in preview browser (requires runtime agent connected). Use require("cc") or window.cc to access engine APIs.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        script: { type: 'string', description: 'JavaScript code to execute' },
                        target: { type: 'string', enum: ['editor', 'runtime'], description: 'Execution context. editor=scene process (default), runtime=preview browser' }
                    },
                    required: ['script']
                }
            },
            {
                name: 'inspect',
                description: 'Inspect editor/scene state. action=env (default): get editor environment info. action=validate: validate scene for issues. action=runtime_summary: get preview runtime snapshot (FPS, drawCalls, nodeCount, memory, physics gravity/PTM ratio, etc.). For node tree use scene_query action=hierarchy.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['env', 'validate', 'runtime_summary'],
                            description: 'Inspection type. Default: env'
                        },
                        checkMissingAssets: { type: 'boolean', description: 'Check missing assets for action=validate' },
                        checkPerformance: { type: 'boolean', description: 'Check performance for action=validate' }
                    }
                }
            },
            {
                name: 'monitor',
                description: '[DEPRECATED] Use debug_trace instead. Subscribe to runtime events for continuous monitoring. action=subscribe: start watching nodes or collision events with filtering. action=unsubscribe: stop a subscription. action=list: show active subscriptions. action=query_events: retrieve buffered events (consume semantics). action=clear_events: discard buffered events.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['subscribe', 'unsubscribe', 'list', 'query_events', 'clear_events'],
                            description: 'Operation type'
                        },
                        subscriptionType: {
                            type: 'string',
                            enum: ['node_watch', 'collision'],
                            description: 'For subscribe. node_watch: periodic property sampling. collision: event-driven collision detection.'
                        },
                        nodeFilter: {
                            type: 'object',
                            description: 'For subscribe. How to select target nodes.',
                            properties: {
                                name: { type: 'string', description: 'Match nodes by name (substring)' },
                                path: { type: 'string', description: 'Match node by path (e.g., "Canvas/Player")' },
                                uuid: { type: 'string', description: 'Match specific node by UUID' }
                            }
                        },
                        properties: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'For subscribe, type=node_watch. Properties to sample: position, localPosition, rotation, localRotation, scale, localScale, active, eulerAngles, childCount. Default: ["position", "rotation", "scale"]'
                        },
                        threshold: {
                            type: 'number',
                            description: 'For subscribe. Only push when value changes beyond this amount. 0 = push every interval. Default: 0'
                        },
                        interval: {
                            type: 'number',
                            description: 'For subscribe. Minimum push interval in ms. Default: 100'
                        },
                        duration: {
                            type: 'number',
                            description: 'For subscribe. Auto-stop after N seconds. 0 = no auto-stop. Default: 0'
                        },
                        collisionEvents: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'For subscribe, type=collision. Events: onCollisionEnter, onCollisionStay, onCollisionExit, onBeginContact, onEndContact. Default: ["onCollisionEnter"]'
                        },
                        subId: {
                            type: 'string',
                            description: 'Subscription ID (for unsubscribe, query_events, clear_events)'
                        },
                        limit: {
                            type: 'number',
                            description: 'For query_events. Max events to return. Default: 100'
                        }
                    },
                    required: ['action']
                }
            },
            {
                name: 'trace',
                description: 'Synchronous trigger+sample for runtime debugging. action=sample: pure property sampling on nodes. action=trace: trigger an action (keyboard/method/property/script) and sample before/after to analyze changes. action=collision_wait: synchronously wait for a collision event. action=game_state: get current game state (paused, fps, scene, physics).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['sample', 'trace', 'collision_wait', 'game_state'],
                            description: 'Operation type. Default: game_state'
                        },
                        nodeFilter: {
                            type: 'object',
                            description: 'How to select target nodes.',
                            properties: {
                                name: { type: 'string', description: 'Match nodes by name (substring)' },
                                path: { type: 'string', description: 'Match node by path (e.g., "Canvas/Player")' },
                                uuid: { type: 'string', description: 'Match specific node by UUID' }
                            }
                        },
                        properties: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Properties to sample: position, localPosition, rotation, localRotation, scale, localScale, active, eulerAngles, childCount. Default: ["position", "rotation", "scale"]'
                        },
                        frames: {
                            type: 'number',
                            description: 'For action=sample. Number of sample frames. Default: 5'
                        },
                        interval: {
                            type: 'number',
                            description: 'For action=sample/trace. Interval in ms between samples. Default: 100'
                        },
                        trigger: {
                            type: 'object',
                            description: 'For action=trace. The action to trigger.',
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['keyboard', 'method', 'property', 'script'],
                                    description: 'Trigger type'
                                },
                                key: { type: 'string', description: 'For keyboard: key name (e.g. "ArrowUp", "Space")' },
                                keyCode: { type: 'number', description: 'For keyboard: numeric keyCode' },
                                componentType: { type: 'string', description: 'For method/property: component type (e.g. "cc.RigidBody2D")' },
                                method: { type: 'string', description: 'For method: method name to call' },
                                args: {
                                    type: 'array',
                                    description: 'For method: arguments to pass'
                                },
                                property: { type: 'string', description: 'For property: property name to set' },
                                value: { description: 'For property: value to set' },
                                code: { type: 'string', description: 'For script: JS code to execute' }
                            },
                            required: ['type']
                        },
                        preFrames: {
                            type: 'number',
                            description: 'For action=trace. Frames to sample before trigger. Default: 3'
                        },
                        postFrames: {
                            type: 'number',
                            description: 'For action=trace. Frames to sample after trigger. Default: 10'
                        },
                        collisionEvents: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'For action=collision_wait. Events to listen for: onCollisionEnter, onCollisionStay, onCollisionExit, onBeginContact, onEndContact. Default: ["onCollisionEnter"]'
                        },
                        timeout: {
                            type: 'number',
                            description: 'For action=collision_wait. Wait timeout in seconds. Default: 5'
                        }
                    },
                    required: ['action']
                }
            }
        ];
    }

    // ==================== logs ====================

    private async handleLogs(args: any): Promise<ToolResponse> {
        const action = args.action || 'query';
        switch (action) {
            case 'query':
                return await this.queryLogs(args);
            case 'search':
                return await this.searchProjectLogs(args.pattern, args.maxResults, args.contextLines);
            case 'clear':
                return await this.clearConsole();
            default:
                return { success: false, error: `Unknown logs action: ${action}` };
        }
    }

    private async queryLogs(args: any): Promise<ToolResponse> {
        const source = args.source || 'all';
        const limit = args.limit || 100;
        const filter = args.filter;
        const level = args.level || 'all';

        if (source === 'console') {
            return await this.getConsoleLogs(limit, filter || level);
        }
        if (source === 'file') {
            return await this.getProjectLogs(limit, filter, level);
        }
        if (source === 'runtime') {
            return this.getRuntimeLogs(limit, level);
        }

        // source=all: merge all sources
        const consoleLogs = await this.getConsoleLogs(limit, filter || level);
        const fileLogs = await this.getProjectLogs(limit, filter, level);
        const runtimeResult = this.getRuntimeLogs(limit, level);

        const merged: any[] = [];
        if (consoleLogs.success && consoleLogs.data?.logs?.length) {
            merged.push(...consoleLogs.data.logs.map((log: any) => ({ ...log, source: log.source || 'console' })));
        }
        if (fileLogs.success && fileLogs.data?.logs?.length) {
            merged.push(...fileLogs.data.logs.map((log: any) => typeof log === 'string' ? { content: log, source: 'file' } : { ...log, source: 'file' }));
        }
        if (runtimeResult.success && runtimeResult.data?.logs?.length) {
            merged.push(...runtimeResult.data.logs);
        }

        return {
            success: true,
            data: {
                total: merged.length,
                returned: merged.length,
                logs: merged,
                sources: {
                    console: consoleLogs.success ? (consoleLogs.data?.returned ?? 0) : 0,
                    file: fileLogs.success ? (fileLogs.data?.filteredLines ?? 0) : 0,
                    runtime: runtimeResult.success ? (runtimeResult.data?.returned ?? 0) : 0,
                },
            }
        };
    }

    private getRuntimeLogs(limit: number, level: string): ToolResponse {
        const bridge = getGlobalRuntimeBridge();
        if (!bridge || !bridge.isConnected()) {
            return { success: true, data: { total: 0, returned: 0, logs: [], note: 'Runtime agent not connected' } };
        }
        const logs = bridge.getLogs(limit, level);
        return { success: true, data: { total: logs.length, returned: logs.length, logs } };
    }

    private async getConsoleLogs(limit: number = 100, filter: string = 'all'): Promise<ToolResponse> {
        let logs = this.consoleMessages;
        if (filter && filter !== 'all') {
            logs = logs.filter(log => log.type === filter);
        }
        const recentLogs = logs.slice(-limit);

        if (recentLogs.length === 0) {
            const projectLogs = await this.getProjectLogs(limit, undefined, filter);
            if (projectLogs.success && projectLogs.data) {
                return {
                    success: true,
                    data: {
                        total: projectLogs.data.filteredLines,
                        returned: projectLogs.data.filteredLines,
                        logs: projectLogs.data.logs,
                        source: 'project_log_fallback',
                        note: 'Console capture not available, showing project log instead'
                    }
                };
            }
        }

        return {
            success: true,
            data: { total: logs.length, returned: recentLogs.length, logs: recentLogs }
        };
    }

    private async clearConsole(): Promise<ToolResponse> {
        this.consoleMessages = [];
        try {
            Editor.Message.send('console', 'clear');
            return this.okMessage('Console cleared successfully');
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async getProjectLogs(lines: number = 100, filterKeyword?: string, logLevel: string = 'all'): Promise<ToolResponse> {
        try {
            const logFilePath = this.findLogFilePath();
            if (!logFilePath) {
                return { success: false, error: 'Project log file not found' };
            }

            const logContent = fs.readFileSync(logFilePath, 'utf8');
            const logLines = logContent.split('\n').filter(line => line.trim() !== '');
            const recentLines = logLines.slice(-lines);

            const normalizedLevel = (logLevel || 'all').toLowerCase();
            let filteredLines = recentLines;
            if (normalizedLevel !== 'all') {
                filteredLines = filteredLines.filter(line =>
                    line.toLowerCase().includes(`[${normalizedLevel}]`) || line.toLowerCase().includes(normalizedLevel)
                );
            }
            if (filterKeyword) {
                filteredLines = filteredLines.filter(line =>
                    line.toLowerCase().includes(filterKeyword.toLowerCase())
                );
            }

            return {
                success: true,
                data: {
                    totalLines: logLines.length,
                    requestedLines: lines,
                    filteredLines: filteredLines.length,
                    logLevel: normalizedLevel,
                    filterKeyword: filterKeyword || null,
                    logs: filteredLines,
                    logFilePath
                }
            };
        } catch (error: any) {
            return { success: false, error: `Failed to read project logs: ${error.message}` };
        }
    }

    private async searchProjectLogs(pattern: string, maxResults: number = 20, contextLines: number = 2): Promise<ToolResponse> {
        try {
            const logFilePath = this.findLogFilePath();
            if (!logFilePath) {
                return { success: false, error: 'Project log file not found' };
            }

            const logContent = fs.readFileSync(logFilePath, 'utf8');
            const logLines = logContent.split('\n');

            let regex: RegExp;
            try {
                regex = new RegExp(pattern, 'gi');
            } catch {
                regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            }

            const matches: any[] = [];
            let resultCount = 0;

            for (let i = 0; i < logLines.length && resultCount < maxResults; i++) {
                const line = logLines[i];
                if (regex.test(line)) {
                    const contextStart = Math.max(0, i - contextLines);
                    const contextEnd = Math.min(logLines.length - 1, i + contextLines);

                    const contextLinesArray = [];
                    for (let j = contextStart; j <= contextEnd; j++) {
                        contextLinesArray.push({
                            lineNumber: j + 1,
                            content: logLines[j],
                            isMatch: j === i
                        });
                    }

                    matches.push({
                        lineNumber: i + 1,
                        matchedLine: line,
                        context: contextLinesArray
                    });
                    resultCount++;
                    regex.lastIndex = 0;
                }
            }

            return {
                success: true,
                data: {
                    pattern,
                    totalMatches: matches.length,
                    maxResults,
                    contextLines,
                    logFilePath,
                    matches
                }
            };
        } catch (error: any) {
            return { success: false, error: `Failed to search project logs: ${error.message}` };
        }
    }

    private findLogFilePath(): string | null {
        const possiblePaths = [
            Editor.Project ? Editor.Project.path : null,
            process.cwd(),
        ].filter(p => p !== null) as string[];

        for (const basePath of possiblePaths) {
            const testPath = path.join(basePath, 'temp/logs/project.log');
            if (fs.existsSync(testPath)) {
                return testPath;
            }
        }
        return null;
    }

    // ==================== execute ====================

    private async handleExecute(args: any): Promise<ToolResponse> {
        const target = args.target || 'editor';

        if (target === 'runtime') {
            return this.executeInRuntime(args.script);
        }

        return this.executeInEditor(args.script);
    }

    private async executeInRuntime(script: string): Promise<ToolResponse> {
        const bridge = getGlobalRuntimeBridge();
        if (!bridge || !bridge.isConnected()) {
            return { success: false, error: 'Runtime agent not connected. Load the agent in Preview first: in DevTools console run: const s=document.createElement("script");s.src="http://127.0.0.1:<port>/runtime-agent.js";document.head.appendChild(s);' };
        }
        try {
            const data = await bridge.execute(script);
            return { success: true, data: { result: data } };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async executeInEditor(script: string): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cocos-mcp-server',
                method: 'evalScript',
                args: [script]
            }).then((result: any) => {
                if (result === undefined || result === null) {
                    resolve({ success: false, error: 'evalScript method not found. Ensure the plugin scene script is loaded.' });
                    return;
                }
                if (result && typeof result === 'object' && 'success' in result) {
                    const response = { ...result };
                    if (response.success) {
                        response.warning = response.warning
                            ? `${response.warning}; Runtime edits made through debug_execute are not persisted by scene_save. Use component_modify for persistent changes.`
                            : 'Runtime edits made through debug_execute are not persisted by scene_save. Use component_modify for persistent changes.';
                    }
                    resolve(response);
                    return;
                }

                resolve({
                    success: true,
                    data: { result },
                    warning: 'Runtime edits made through debug_execute are not persisted by scene_save. Use component_modify for persistent changes.'
                });
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ==================== inspect ====================

    private async handleInspect(args: any): Promise<ToolResponse> {
        const action = args?.action || 'env';
        switch (action) {
            case 'env':
                return await this.getEditorInfo();
            case 'validate':
                return await this.validateScene(args);
            case 'runtime_summary':
                return await this.getRuntimeSummary();
            default:
                return { success: false, error: `Unknown inspect action: ${action}` };
        }
    }

    private async getRuntimeSummary(): Promise<ToolResponse> {
        const bridge = getGlobalRuntimeBridge();
        if (!bridge || !bridge.isConnected()) {
            return { success: false, error: 'Runtime agent not connected. Load the agent in Preview first: in DevTools console run: const s=document.createElement("script");s.src="http://127.0.0.1:<port>/runtime-agent.js";document.head.appendChild(s);' };
        }
        try {
            const summary = await bridge.getSummary();
            return this.ok(summary);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async validateScene(options: any): Promise<ToolResponse> {
        const issues: ValidationIssue[] = [];
        try {
            if (options.checkMissingAssets !== false) {
                try {
                    const assetCheck = await Editor.Message.request('scene', 'check-missing-assets');
                    if (assetCheck && assetCheck.missing) {
                        issues.push({
                            type: 'error',
                            category: 'assets',
                            message: `Found ${assetCheck.missing.length} missing asset references`,
                            details: assetCheck.missing
                        });
                    }
                } catch {
                    // check-missing-assets may not be available
                }
            }

            if (options.checkPerformance !== false) {
                try {
                    const perfResult = await Editor.Message.request('scene', 'execute-scene-script', {
                        name: 'cocos-mcp-server',
                        method: 'getPerformanceStats',
                        args: []
                    });
                    if (perfResult && perfResult.success && perfResult.data) {
                        const nodeCount = perfResult.data.nodeCount;
                        if (nodeCount > 1000) {
                            issues.push({
                                type: 'warning',
                                category: 'performance',
                                message: `High node count: ${nodeCount} nodes (recommended < 1000)`,
                                suggestion: 'Consider using object pooling or scene optimization'
                            });
                        }
                        if (perfResult.data.componentCount > 5000) {
                            issues.push({
                                type: 'warning',
                                category: 'performance',
                                message: `High component count: ${perfResult.data.componentCount} components`,
                                suggestion: 'Review if all components are necessary'
                            });
                        }
                    }
                } catch {
                    // Scene script unavailable, skip performance check
                }
            }

            const result: ValidationResult = {
                valid: issues.length === 0,
                issueCount: issues.length,
                issues
            };
            return this.ok(result);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async getEditorInfo(): Promise<ToolResponse> {
        const info = {
            editor: {
                version: (Editor as any).versions?.editor || 'Unknown',
                cocosVersion: (Editor as any).versions?.cocos || 'Unknown',
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version
            },
            project: {
                name: Editor.Project.name,
                path: Editor.Project.path,
                uuid: Editor.Project.uuid
            },
            memory: process.memoryUsage(),
            uptime: process.uptime()
        };
        return this.ok(info);
    }

    // ==================== monitor ====================

    private async handleMonitor(args: any): Promise<ToolResponse> {
        const action = args.action;
        const bridge = getGlobalRuntimeBridge();

        if (!bridge) {
            return { success: false, error: 'RuntimeBridge not initialized' };
        }

        switch (action) {
            case 'subscribe': {
                if (!bridge.isConnected()) {
                    return { success: false, error: 'Runtime agent not connected. Load the agent in Preview first.' };
                }
                const subType = args.subscriptionType || 'node_watch';
                if (!args.nodeFilter && subType === 'node_watch') {
                    return { success: false, error: 'nodeFilter is required for node_watch subscriptions. Provide name, path, or uuid.' };
                }
                try {
                    const options: SubscriptionOptions = {
                        type: subType,
                        properties: args.properties,
                        threshold: args.threshold,
                        interval: args.interval,
                        duration: args.duration,
                        nodeFilter: args.nodeFilter,
                        collisionEvents: args.collisionEvents,
                    };
                    const subId = bridge.subscribe(options);
                    return this.ok({
                        subId,
                        message: `Subscription created. Use action=query_events with subId="${subId}" to retrieve events.`,
                        options,
                    });
                } catch (err: any) {
                    return { success: false, error: err.message };
                }
            }

            case 'unsubscribe': {
                if (!args.subId) {
                    return { success: false, error: 'subId is required for unsubscribe' };
                }
                const removed = bridge.unsubscribe(args.subId);
                if (removed) {
                    return this.okMessage(`Subscription ${args.subId} stopped and removed.`);
                }
                return { success: false, error: `Subscription ${args.subId} not found` };
            }

            case 'list': {
                const subs = bridge.listSubscriptions();
                return this.ok({
                    subscriptions: subs,
                    totalEvents: bridge.getEventCount(),
                });
            }

            case 'query_events': {
                const limit = args.limit || 100;
                const events = bridge.getEvents(args.subId, limit);
                return this.ok({
                    events,
                    returned: events.length,
                    remainingInBuffer: bridge.getEventCount(args.subId),
                });
            }

            case 'clear_events': {
                bridge.clearEvents(args.subId);
                return this.okMessage(
                    args.subId
                        ? `Events cleared for subscription ${args.subId}`
                        : 'All events cleared'
                );
            }

            default:
                return { success: false, error: `Unknown monitor action: ${action}` };
        }
    }

    // ==================== trace ====================

    private async handleTrace(args: any): Promise<ToolResponse> {
        const action = args.action || 'game_state';
        const bridge = getGlobalRuntimeBridge();

        if (!bridge) {
            return { success: false, error: 'RuntimeBridge not initialized' };
        }

        if (!bridge.isConnected()) {
            return { success: false, error: 'Runtime agent not connected. Load the agent in Preview first.' };
        }

        try {
            switch (action) {
                case 'sample': {
                    if (!args.nodeFilter) {
                        return { success: false, error: 'nodeFilter is required for sample action' };
                    }
                    const options: TraceSampleOptions = {
                        nodeFilter: args.nodeFilter,
                        properties: args.properties,
                        frames: args.frames,
                        interval: args.interval,
                    };
                    const data = await bridge.traceSample(options);
                    return this.ok(data);
                }

                case 'trace': {
                    if (!args.nodeFilter) {
                        return { success: false, error: 'nodeFilter is required for trace action' };
                    }
                    if (!args.trigger) {
                        return { success: false, error: 'trigger is required for trace action' };
                    }
                    const options: TraceOptions = {
                        nodeFilter: args.nodeFilter,
                        properties: args.properties,
                        trigger: args.trigger,
                        preFrames: args.preFrames,
                        postFrames: args.postFrames,
                        interval: args.interval,
                    };
                    const data = await bridge.trace(options);
                    return this.ok(data);
                }

                case 'collision_wait': {
                    if (!args.nodeFilter) {
                        return { success: false, error: 'nodeFilter is required for collision_wait action' };
                    }
                    const options: CollisionWaitOptions = {
                        nodeFilter: args.nodeFilter,
                        collisionEvents: args.collisionEvents,
                        timeout: args.timeout,
                    };
                    const data = await bridge.traceCollisionWait(options);
                    return this.ok(data);
                }

                case 'game_state': {
                    const data = await bridge.getGameState();
                    return this.ok(data);
                }

                default:
                    return { success: false, error: `Unknown trace action: ${action}` };
            }
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }
}
