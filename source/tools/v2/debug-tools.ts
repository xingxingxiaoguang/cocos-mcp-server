import { ToolDefinition, ToolResponse, ToolExecutor, ConsoleMessage, PerformanceStats, ValidationResult, ValidationIssue } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * DebugToolsV2 — 调试工具 v2
 * 合并自 DebugTools
 * 3 个工具: logs, execute, inspect
 */
export class DebugToolsV2 implements ToolExecutor {
    private consoleMessages: ConsoleMessage[] = [];
    private readonly maxMessages = 1000;

    constructor() {
        this.setupConsoleCapture();
    }

    private setupConsoleCapture(): void {
        try {
            const msg = Editor.Message as any;
            const listener = (message: any) => {
                this.addConsoleMessage({
                    type: message.type || 'log',
                    content: message.message || message.content || String(message),
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
                description: 'Query logs. action=console (default): get editor console logs from memory cache. action=project: get project logs from log file. action=file_info: get log file metadata. action=search: search logs with regex. action=clear: clear console.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['console', 'project', 'file_info', 'search', 'clear'],
                            description: 'Operation type. Default: console'
                        },
                        limit: { type: 'number', description: 'Number of logs to retrieve (console/project)' },
                        filter: { type: 'string', description: 'Filter keyword' },
                        level: { type: 'string', enum: ['log', 'warn', 'error', 'info', 'all', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'ALL'], description: 'Log level filter' },
                        pattern: { type: 'string', description: 'Search pattern (supports regex) for action=search' },
                        maxResults: { type: 'number', description: 'Max search results for action=search' },
                        contextLines: { type: 'number', description: 'Context lines around each match for action=search' }
                    }
                }
            },
            {
                name: 'execute',
                description: 'Execute JavaScript code in scene context.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        script: { type: 'string', description: 'JavaScript code to execute' }
                    },
                    required: ['script']
                }
            },
            {
                name: 'inspect',
                description: 'Inspect editor/scene state. action=node_tree: get node tree for debugging. action=performance: get performance stats. action=validate: validate scene for issues. action=editor_info: get editor environment info.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['node_tree', 'performance', 'validate', 'editor_info'],
                            description: 'Inspection type'
                        },
                        uuid: { type: 'string', description: 'Root node UUID for action=node_tree' },
                        depth: { type: 'number', description: 'Max tree depth for action=node_tree' },
                        checkMissingAssets: { type: 'boolean', description: 'Check missing assets for action=validate' },
                        checkPerformance: { type: 'boolean', description: 'Check performance for action=validate' }
                    },
                    required: ['action']
                }
            }
        ];
    }

    async execute(toolName: string, args: any): Promise<ToolResponse> {
        switch (toolName) {
            case 'logs':
                return await this.handleLogs(args);
            case 'execute':
                return await this.handleExecute(args);
            case 'inspect':
                return await this.handleInspect(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // ==================== logs ====================

    private async handleLogs(args: any): Promise<ToolResponse> {
        const action = args.action || 'console';
        switch (action) {
            case 'console':
                return await this.getConsoleLogs(args.limit, args.filter || args.level);
            case 'project':
                return await this.getProjectLogs(args.limit, args.filter, args.level);
            case 'file_info':
                return await this.getLogFileInfo();
            case 'search':
                return await this.searchProjectLogs(args.pattern, args.maxResults, args.contextLines);
            case 'clear':
                return await this.clearConsole();
            default:
                return { success: false, error: `Unknown logs action: ${action}` };
        }
    }

    private async getConsoleLogs(limit: number = 100, filter: string = 'all'): Promise<ToolResponse> {
        let logs = this.consoleMessages;
        if (filter && filter !== 'all') {
            logs = logs.filter(log => log.type === filter);
        }
        const recentLogs = logs.slice(-limit);

        if (recentLogs.length === 0) {
            const projectLogs = await this.getProjectLogs(limit, undefined, filter === 'all' ? 'ALL' : filter);
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
            return { success: true, message: 'Console cleared successfully' };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private async getProjectLogs(lines: number = 100, filterKeyword?: string, logLevel: string = 'ALL'): Promise<ToolResponse> {
        try {
            const logFilePath = this.findLogFilePath();
            if (!logFilePath) {
                return { success: false, error: 'Project log file not found' };
            }

            const logContent = fs.readFileSync(logFilePath, 'utf8');
            const logLines = logContent.split('\n').filter(line => line.trim() !== '');
            const recentLines = logLines.slice(-lines);

            let filteredLines = recentLines;
            if (logLevel && logLevel !== 'ALL') {
                filteredLines = filteredLines.filter(line =>
                    line.includes(`[${logLevel}]`) || line.includes(logLevel.toLowerCase())
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
                    logLevel,
                    filterKeyword: filterKeyword || null,
                    logs: filteredLines,
                    logFilePath
                }
            };
        } catch (error: any) {
            return { success: false, error: `Failed to read project logs: ${error.message}` };
        }
    }

    private async getLogFileInfo(): Promise<ToolResponse> {
        try {
            const logFilePath = this.findLogFilePath();
            if (!logFilePath) {
                return { success: false, error: 'Project log file not found' };
            }

            const stats = fs.statSync(logFilePath);
            const logContent = fs.readFileSync(logFilePath, 'utf8');
            const lineCount = logContent.split('\n').filter(line => line.trim() !== '').length;

            return {
                success: true,
                data: {
                    filePath: logFilePath,
                    fileSize: stats.size,
                    fileSizeFormatted: this.formatFileSize(stats.size),
                    lastModified: stats.mtime.toISOString(),
                    lineCount,
                    created: stats.birthtime.toISOString(),
                    accessible: fs.constants.R_OK
                }
            };
        } catch (error: any) {
            return { success: false, error: `Failed to get log file info: ${error.message}` };
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

    private formatFileSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    // ==================== execute ====================

    private async handleExecute(args: any): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cocos-mcp-server',
                method: 'evalScript',
                args: [args.script]
            }).then((result: any) => {
                if (result === undefined || result === null) {
                    resolve({ success: false, error: 'evalScript method not found. Ensure the plugin scene script is loaded.' });
                    return;
                }
                resolve(result);
            }).catch((err: Error) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    // ==================== inspect ====================

    private async handleInspect(args: any): Promise<ToolResponse> {
        switch (args.action) {
            case 'node_tree':
                return await this.getNodeTree(args.uuid, args.depth);
            case 'performance':
                return await this.getPerformanceStats();
            case 'validate':
                return await this.validateScene(args);
            case 'editor_info':
                return await this.getEditorInfo();
            default:
                return { success: false, error: `Unknown inspect action: ${args.action}` };
        }
    }

    private async getNodeTree(rootUuid?: string, maxDepth: number = 10): Promise<ToolResponse> {
        try {
            const tree = await Editor.Message.request('scene', 'query-node-tree');
            if (!tree) {
                return { success: false, error: 'No scene data available' };
            }

            const buildTree = (node: any, depth: number): any => {
                if (depth >= maxDepth) return { name: node.name, uuid: node.uuid, truncated: true };
                return {
                    uuid: node.uuid,
                    name: node.name,
                    active: node.active,
                    type: node.type,
                    components: node.__comps__
                        ? node.__comps__.map((c: any) => this.normalizeComponentType(c.__type__))
                        : [],
                    childCount: node.children ? node.children.length : 0,
                    children: (node.children || []).map((child: any) => buildTree(child, depth + 1))
                };
            };

            if (rootUuid) {
                const findNode = (node: any): any => {
                    if (node.uuid === rootUuid) return node;
                    for (const child of (node.children || [])) {
                        const found = findNode(child);
                        if (found) return found;
                    }
                    return null;
                };
                const targetNode = findNode(tree);
                if (!targetNode) {
                    return { success: false, error: `Node ${rootUuid} not found in scene` };
                }
                return { success: true, data: buildTree(targetNode, 0) };
            }

            return { success: true, data: buildTree(tree, 0) };
        } catch (err: any) {
            try {
                const result = await Editor.Message.request('scene', 'execute-scene-script', {
                    name: 'cocos-mcp-server',
                    method: 'getSceneHierarchy',
                    args: [true]
                });
                if (result && result.success) {
                    return { success: true, data: result.data };
                }
                return { success: false, error: `query-node-tree failed: ${err.message}` };
            } catch (err2: any) {
                return { success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` };
            }
        }
    }

    private normalizeComponentType(rawType: any): string {
        if (rawType && typeof rawType === 'object') {
            const nested = rawType.value || rawType.cid || rawType.type || rawType.name;
            if (nested !== undefined && nested !== null) {
                return String(nested);
            }
        }
        if (rawType === undefined || rawType === null) {
            return 'Unknown';
        }
        return String(rawType);
    }

    private async getPerformanceStats(): Promise<ToolResponse> {
        try {
            const result = await Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cocos-mcp-server',
                method: 'getPerformanceStats',
                args: []
            });
            if (result && result.success) {
                return result;
            }
            return { success: false, error: result?.error || 'Failed to get performance stats from scene process' };
        } catch (err: any) {
            return {
                success: true,
                data: {
                    nodeCount: null,
                    componentCount: null,
                    drawCalls: null,
                    triangles: null,
                    memory: process.memoryUsage(),
                    note: 'Scene process unavailable, only main process memory data shown'
                }
            };
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
            return { success: true, data: result };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    private countNodes(nodes: any[]): number {
        let count = nodes.length;
        for (const node of nodes) {
            if (node.children) {
                count += this.countNodes(node.children);
            }
        }
        return count;
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
        return { success: true, data: info };
    }
}
