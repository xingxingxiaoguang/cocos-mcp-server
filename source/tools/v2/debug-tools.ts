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
        console.log('Console capture setup - implementation depends on Editor API availability');
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
                name: 'console',
                method: 'eval',
                args: [args.script]
            }).then((result: any) => {
                resolve({
                    success: true,
                    data: { result, message: 'Script executed successfully' }
                });
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
        return new Promise((resolve) => {
            const buildTree = async (nodeUuid: string, depth: number = 0): Promise<any> => {
                if (depth >= maxDepth) {
                    return { truncated: true };
                }
                try {
                    const nodeData = await Editor.Message.request('scene', 'query-node', nodeUuid);
                    const tree = {
                        uuid: nodeData.uuid,
                        name: nodeData.name,
                        active: nodeData.active,
                        components: (nodeData as any).components ? (nodeData as any).components.map((c: any) => c.__type__) : [],
                        childCount: nodeData.children ? nodeData.children.length : 0,
                        children: [] as any[]
                    };
                    if (nodeData.children && nodeData.children.length > 0) {
                        for (const childId of nodeData.children) {
                            const childTree = await buildTree(childId, depth + 1);
                            tree.children.push(childTree);
                        }
                    }
                    return tree;
                } catch (err: any) {
                    return { error: err.message };
                }
            };

            if (rootUuid) {
                buildTree(rootUuid).then(tree => {
                    resolve({ success: true, data: tree });
                });
            } else {
                Editor.Message.request('scene', 'query-hierarchy').then(async (hierarchy: any) => {
                    const trees = [];
                    for (const rootNode of hierarchy.children) {
                        const tree = await buildTree(rootNode.uuid);
                        trees.push(tree);
                    }
                    resolve({ success: true, data: trees });
                }).catch((err: Error) => {
                    resolve({ success: false, error: err.message });
                });
            }
        });
    }

    private async getPerformanceStats(): Promise<ToolResponse> {
        return new Promise((resolve) => {
            Editor.Message.request('scene', 'query-performance').then((stats: any) => {
                const perfStats: PerformanceStats = {
                    nodeCount: stats.nodeCount || 0,
                    componentCount: stats.componentCount || 0,
                    drawCalls: stats.drawCalls || 0,
                    triangles: stats.triangles || 0,
                    memory: stats.memory || {}
                };
                resolve({ success: true, data: perfStats });
            }).catch(() => {
                resolve({
                    success: true,
                    data: { message: 'Performance stats not available in edit mode' }
                });
            });
        });
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
                    const hierarchy = await Editor.Message.request('scene', 'query-hierarchy');
                    const nodeCount = this.countNodes(hierarchy.children);
                    if (nodeCount > 1000) {
                        issues.push({
                            type: 'warning',
                            category: 'performance',
                            message: `High node count: ${nodeCount} nodes (recommended < 1000)`,
                            suggestion: 'Consider using object pooling or scene optimization'
                        });
                    }
                } catch {
                    // query-hierarchy may fail
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
